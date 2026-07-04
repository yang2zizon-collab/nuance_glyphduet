import os, sys, socket, json, queue, threading
os.chdir(os.path.dirname(os.path.abspath(__file__)))
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 8777))

# ===== 관객 폰 실시간 부호 탭 =====
# 폰(/tap.html)이 POST /tap 으로 부호를 보내면, 메인 화면(EventSource /events)에
# 실시간으로 흘려 보낸다. 외부 의존성 없이 표준 라이브러리 SSE만 사용한다.
MARKS = ('period', 'question', 'bang', 'ellipsis', 'tilde', 'semicolon')
clients = set()             # 연결된 SSE 구독자(메인 화면 + 폰)들의 큐
clients_lock = threading.Lock()
current_phase = {'v': 'idle'}   # 메인이 POST /phase 로 알려주는 현재 단계(폰 화면 전환용)


def broadcast(payload):
    with clients_lock:
        for q in list(clients):
            q.put(payload)


def lan_ip():
    """같은 와이파이에서 폰이 접속할 노트북의 사설 IP를 알아낸다."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip


PUB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public_url.txt')


def audience_base():
    """폰이 접속할 기준 주소. 터널 공개주소(public_url.txt)가 있으면 그걸,
    없으면 같은-와이파이 LAN 주소를 쓴다. 매 요청마다 파일을 읽어 즉시 반영된다."""
    try:
        with open(PUB_FILE, 'r') as f:
            u = f.read().strip().rstrip('/')
            if u:
                return u
    except Exception:
        pass
    return f'http://{lan_ip()}:{PORT}'


class NoCacheHandler(SimpleHTTPRequestHandler):
    # 개발 중 캐시 때문에 옛 모듈이 로드되는 문제 방지: 항상 새로 받게 한다
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split('?')[0] == '/events':
            return self.handle_events()
        if self.path.split('?')[0] == '/config':
            base = audience_base()
            return self._json(200, {
                'lanUrl': base + '/tap.html',
                'public': base.startswith('https://'),
                'phase': current_phase['v'],
                'port': PORT,
            })
        return super().do_GET()

    def do_POST(self):
        path = self.path.split('?')[0]
        if path == '/tap':
            return self.handle_tap()
        if path == '/phase':
            return self.handle_phase()
        if path == '/gift':
            return self.handle_gift()
        if path == '/ascii':
            return self.handle_ascii()
        self.send_error(404)

    def _body_json(self):
        length = int(self.headers.get('Content-Length', 0) or 0)
        raw = self.rfile.read(length) if length else b'{}'
        try:
            return json.loads(raw or b'{}')
        except Exception:
            return {}

    # 메인 화면이 단계 전환을 알림 → 모든 폰에 브로드캐스트(투표 패드 ↔ 선물 화면 전환).
    def handle_phase(self):
        data = self._body_json()
        phase = str(data.get('phase', ''))
        if phase not in ('idle', 'round', 'gift', 'ending'):
            return self._json(400, {'ok': False, 'error': 'bad phase'})
        current_phase['v'] = phase
        broadcast(json.dumps({'type': 'phase', 'phase': phase}))
        return self._json(200, {'ok': True})

    # 메인이 아스키아트(승자 부호 + 사용 글자들)를 알림 → 폰이 같은 그림을 그린다.
    def handle_ascii(self):
        data = self._body_json()
        mark = str(data.get('mark', ''))
        chars = str(data.get('chars', ''))[:800]
        if mark not in MARKS or not chars:
            return self._json(400, {'ok': False, 'error': 'bad ascii'})
        broadcast(json.dumps({'type': 'ascii', 'mark': mark, 'chars': chars}))
        return self._json(200, {'ok': True})

    # 폰이 선물을 보냄(주는이→받는이) → 메인 화면이 받아 적용.
    def handle_gift(self):
        data = self._body_json()
        try:
            giver = int(data.get('giver')); recip = int(data.get('recip'))
        except (TypeError, ValueError):
            return self._json(400, {'ok': False, 'error': 'bad gift'})
        if not (0 <= giver <= 3 and 0 <= recip <= 3 and giver != recip):
            return self._json(400, {'ok': False, 'error': 'bad gift'})
        broadcast(json.dumps({'type': 'gift', 'giver': giver, 'recip': recip}))
        return self._json(200, {'ok': True})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    # 메인 화면이 부호 이벤트를 받는 SSE 스트림
    def handle_events(self):
        q = queue.Queue()
        with clients_lock:
            clients.add(q)
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        try:
            self.wfile.write(b': connected\n\n')
            self.wfile.flush()
            while True:
                try:
                    msg = q.get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b': ping\n\n')   # 연결 유지용 핑
                    self.wfile.flush()
                    continue
                self.wfile.write(('data: ' + msg + '\n\n').encode('utf-8'))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with clients_lock:
                clients.discard(q)

    # 폰이 부호 하나를 보냄 → 모든 메인 화면에 브로드캐스트
    def handle_tap(self):
        length = int(self.headers.get('Content-Length', 0) or 0)
        raw = self.rfile.read(length) if length else b'{}'
        try:
            data = json.loads(raw or b'{}')
        except Exception:
            data = {}
        mark = str(data.get('mark', ''))
        if mark not in MARKS:
            return self._json(400, {'ok': False, 'error': 'bad mark'})
        broadcast(json.dumps({'mark': mark, 'who': 'aud'}))
        return self._json(200, {'ok': True})

    def log_message(self, *args):
        pass   # 조용히


class DualStack(ThreadingHTTPServer):
    address_family = socket.AF_INET6  # ::1 + 127.0.0.1 둘 다 받기
    daemon_threads = True


httpd = DualStack(('::', PORT), NoCacheHandler, bind_and_activate=False)
httpd.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
httpd.allow_reuse_address = True
httpd.server_bind()
httpd.server_activate()
base = audience_base()
print(f'serving sori-mokkoji on http://localhost:{PORT}')
print(f'  메인 화면 : http://localhost:{PORT}/   (그냥 열면 됨)')
print(f'  관객 폰   : {base}/tap.html')
if base.startswith('https://'):
    print(f'  ✓ 공개주소(터널) 사용 중 — QR이 이걸 가리켜 폰 데이터로도 접속됨')
else:
    print(f'  · 지금은 같은 와이파이(LAN)만 — 데이터로도 받으려면 ./start-show.sh 로 켜라')
httpd.serve_forever()
