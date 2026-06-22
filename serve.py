import os, sys, socket, json, queue, threading
os.chdir(os.path.dirname(os.path.abspath(__file__)))
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 8777))

# ===== 관객 폰 실시간 부호 탭 =====
# 폰(/tap.html)이 POST /tap 으로 부호를 보내면, 메인 화면(EventSource /events)에
# 실시간으로 흘려 보낸다. 외부 의존성 없이 표준 라이브러리 SSE만 사용한다.
MARKS = ('period', 'ellipsis', 'question', 'bang')
clients = set()             # 연결된 SSE 구독자(메인 화면)들의 큐
clients_lock = threading.Lock()


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
            return self._json(200, {'lanUrl': f'http://{lan_ip()}:{PORT}/tap.html', 'port': PORT})
        return super().do_GET()

    def do_POST(self):
        if self.path.split('?')[0] == '/tap':
            return self.handle_tap()
        self.send_error(404)

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
        payload = json.dumps({'mark': mark, 'who': 'aud'})
        with clients_lock:
            for q in list(clients):
                q.put(payload)
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
ip = lan_ip()
print(f'serving sori-mokkoji on http://localhost:{PORT}')
print(f'  메인 화면 : http://localhost:{PORT}/')
print(f'  관객 폰   : http://{ip}:{PORT}/tap.html   (같은 와이파이)')
print(f'  데이터로도 받으려면 터널을 띄우고 메인을 ?pub=<공개주소> 로 열어라:')
print(f'     cloudflared tunnel --url http://localhost:{PORT}')
print(f'     → http://localhost:{PORT}/?pub=https://xxxx.trycloudflare.com')
httpd.serve_forever()
