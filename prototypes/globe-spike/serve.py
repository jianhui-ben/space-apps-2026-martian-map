"""SPIKE - throwaway. Serves the globe spike on loopback only.

    python3 -I prototypes/globe-spike/serve.py [--data DIR] [PORT]   # then open http://127.0.0.1:8766/

/data/... is served read-only from DIR (default: ../../data relative to the repo root).
Binds 127.0.0.1 so nothing beyond this machine can reach it.
"""

import argparse
import functools
import http.server
import os
from pathlib import Path

HOST = "127.0.0.1"
WEB = Path(__file__).resolve().parent / "web"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".f32": "application/octet-stream"}
    data_dir: Path = None

    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean.startswith("/data/"):
            root = self.data_dir
            rel = clean[len("/data/"):]
        else:
            root = WEB
            rel = clean.lstrip("/")
        full = (root / rel).resolve()
        if full != root and root not in full.parents:
            return str(root / "__forbidden__")
        return str(full)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("port", nargs="?", type=int, default=8766)
    ap.add_argument("--data", default=str(Path(__file__).resolve().parents[2] / "data"))
    a = ap.parse_args()
    Handler.data_dir = Path(a.data).resolve()
    server = http.server.ThreadingHTTPServer((HOST, a.port), functools.partial(Handler, directory=str(WEB)))
    print(f"Serving {WEB} (+ /data -> {Handler.data_dir}) at http://{HOST}:{a.port}/", flush=True)
    server.serve_forever()
