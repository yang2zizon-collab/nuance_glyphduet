import os, sys, socket
os.chdir(os.path.dirname(os.path.abspath(__file__)))
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 8777))


class NoCacheHandler(SimpleHTTPRequestHandler):
    # 개발 중 캐시 때문에 옛 모듈이 로드되는 문제 방지: 항상 새로 받게 한다
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


class DualStack(ThreadingHTTPServer):
    address_family = socket.AF_INET6  # ::1 + 127.0.0.1 둘 다 받기


httpd = DualStack(('::', PORT), NoCacheHandler, bind_and_activate=False)
httpd.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
httpd.allow_reuse_address = True
httpd.server_bind()
httpd.server_activate()
print(f'serving sori-mokkoji on http://localhost:{PORT}')
httpd.serve_forever()
