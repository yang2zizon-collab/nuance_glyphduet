import os, sys, socket, json, queue, threading
# 파일 디스크립터 상한 올리기 — 접속자(SSE) 100+명이 소켓을 오래 물고 있어도 여유 있게.
try:
    import resource
    soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    resource.setrlimit(resource.RLIMIT_NOFILE, (min(4096, hard), hard))
except Exception:
    pass
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
current_ascii = {'v': None}     # 마지막 아스키아트(mark+chars) — 늦게 접속한 폰도 그린다
current_still = {'v': None}     # 그래픽 스코어 정지화면(dataURL) — 합주 때 폰이 띄운다
aud_colors = {'m': {}, 'n': 0}  # 관객 음표 색 — 폰 uid → 배정 순번(골든앵글 파스텔, 선착순)
current_jam = {'v': False}      # 잼(관객 합주) 진행 중 — 늦게 접속/이벤트 놓친 폰이 폴링으로 따라잡게


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


def build_stamp():
    """정적 파일들의 최신 수정시각 — 메인/폰이 자기 버전과 비교해 새 빌드면 새로고침한다."""
    latest = 0
    for f in ('index.html', 'tap.html', 'js/main.js', 'js/audio.js', 'js/sprites.js', 'css/style-score.css'):
        try:
            m = os.path.getmtime(f)
            if m > latest:
                latest = m
        except OSError:
            pass
    return int(latest)


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
                'ascii': current_ascii['v'],
                'hasStill': bool(current_still['v']),
                'stillLive': (current_still['v'] or {}).get('live', 0) if isinstance(current_still['v'], dict) else 0,
                'jam': 1 if current_jam['v'] else 0,
                'build': build_stamp(),
                'port': PORT,
            })
        if self.path.split('?')[0] == '/still':
            return self._json(200, current_still['v'] or {'img': None, 'live': 0})
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
        if path == '/still':
            return self.handle_still()
        if path == '/addnote':
            # 합주 중 폰 터치 → 메인에 음표 하나 추가. 폰(uid)마다 색 순번을 선착순 배정해
            # 자기 음표가 자기 색으로 보이게 한다(폰에도 응답으로 알려줌).
            data = self._body_json()
            uid = str(data.get('uid') or '')[:40]
            glyph = str(data.get('glyph') or '')[:2]   # 관객이 고른 모양(없으면 메인에서 랜덤)
            cidx = None
            if uid:
                if uid not in aud_colors['m']:
                    aud_colors['m'][uid] = aud_colors['n']
                    aud_colors['n'] += 1
                cidx = aud_colors['m'][uid]
            broadcast(json.dumps({'type': 'addnote', 'cidx': cidx, 'glyph': glyph}))
            return self._json(200, {'ok': True, 'cidx': cidx})
        if path == '/jam':
            current_jam['v'] = True
            broadcast(json.dumps({'type': 'jam'}))       # 합주 종료 → 관객 합주(잼) 개시 알림
            return self._json(200, {'ok': True})
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
        if phase in ('round', 'idle'):
            current_ascii['v'] = None
            current_still['v'] = None
            aud_colors['m'].clear(); aud_colors['n'] = 0   # 새 공연 — 색 배정도 새로
            current_jam['v'] = False
        broadcast(json.dumps({'type': 'phase', 'phase': phase}))
        return self._json(200, {'ok': True})

    # 메인이 아스키아트(승자 부호 + 사용 글자들)를 알림 → 폰이 같은 그림을 그린다.
    def handle_ascii(self):
        data = self._body_json()
        mark = str(data.get('mark', ''))
        chars = str(data.get('chars', ''))[:800]
        if mark not in MARKS or not chars:
            return self._json(400, {'ok': False, 'error': 'bad ascii'})
        current_ascii['v'] = {'mark': mark, 'chars': chars}
        broadcast(json.dumps({'type': 'ascii', 'mark': mark, 'chars': chars}))
        return self._json(200, {'ok': True})

    # 메인이 그래픽 스코어 정지화면(dataURL)을 올림 → 폰이 엔딩 동안 띄운다.
    # live=0: 보기 전용(독주 — 터치 참여 잠금), live=1: 합주 — 터치 참여 활성화.
    def handle_still(self):
        data = self._body_json()
        img = data.get('img')
        if not isinstance(img, str) or not img.startswith('data:image/') or len(img) > 2_000_000:
            return self._json(400, {'ok': False, 'error': 'bad still'})
        live = 1 if data.get('live') else 0
        current_still['v'] = {'img': img, 'live': live}
        broadcast(json.dumps({'type': 'still', 'live': live}))   # 폰: 알림만 받고 GET /still 로 가져간다
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
            # 접속(재접속 포함) 즉시 현재 상태를 밀어준다 — 놓친 전환을 스스로 따라잡게
            # replay 표시 — 재접속 따라잡기용. 폰이 "진짜 전환"과 구분해 연주 화면을 지킬 수 있게.
            self.wfile.write(('data: ' + json.dumps({'type': 'phase', 'phase': current_phase['v'], 'replay': True}) + '\n\n').encode('utf-8'))
            if current_ascii['v']:
                self.wfile.write(('data: ' + json.dumps({'type': 'ascii', **current_ascii['v']}) + '\n\n').encode('utf-8'))
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
    request_queue_size = 128          # 관객 폰 동시 접속 러시 대비(기본 5칸 → 100명 순간 접속에도 안 튕김)


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
