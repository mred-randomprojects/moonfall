#!/usr/bin/env python3
"""Static dev server with a /shot endpoint that saves a posted data-URL screenshot (used for visual testing)."""
import http.server, socketserver, base64, os, sys, urllib.parse
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp'
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def do_POST(self):
        if self.path.startswith('/shot'):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            name = q.get('name', ['shot'])[0]
            n = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(n).decode()
            if ',' in body: body = body.split(',', 1)[1]
            path = os.path.join(OUT, name + '.jpg')
            with open(path, 'wb') as f: f.write(base64.b64decode(body))
            self.send_response(200); self.end_headers(); self.wfile.write(path.encode())
        else:
            self.send_response(404); self.end_headers()
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', PORT), H) as httpd:
    httpd.serve_forever()
