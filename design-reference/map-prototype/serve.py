"""PROTOTYPE - throwaway. Serves the terrain-diorama viewer on loopback only.

    .venv/bin/python -I design-reference/map-prototype/serve.py   # then open http://127.0.0.1:8765/

Binds 127.0.0.1 so nothing beyond this machine can reach it. To view from
another machine, use an SSH tunnel: ssh -L 8765:127.0.0.1:8765 <this-host>
"""

import functools
import http.server
import sys
from pathlib import Path

HOST = "127.0.0.1"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
WEB = Path(__file__).resolve().parent / "web"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".f32": "application/octet-stream", ".woff2": "font/woff2"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer((HOST, PORT), functools.partial(Handler, directory=str(WEB)))
    print(f"Serving {WEB} at http://{HOST}:{PORT}/  (Ctrl+C to stop)", flush=True)
    server.serve_forever()
