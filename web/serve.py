"""Loopback-only dev server for the map: serves web/ and maps /data/ to a data folder.

Usage: python web/serve.py --data <dir> [--port 8770]
"""

from __future__ import annotations

import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urlsplit

HOST = "127.0.0.1"
DATA_PREFIX = "/data/"


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
    }

    def __init__(self, *args, web_dir: Path, data_dir: Optional[Path], **kwargs):
        self._web_dir = Path(web_dir).resolve()
        self._data_dir = Path(data_dir).resolve() if data_dir is not None else None
        super().__init__(*args, directory=str(self._web_dir), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):  # keep test output quiet
        pass

    def translate_path(self, path):
        raw = unquote(urlsplit(path).path)
        if raw.startswith(DATA_PREFIX):
            root, rel = self._data_dir, raw[len(DATA_PREFIX):]
        else:
            root, rel = self._web_dir, raw.lstrip("/")
        missing = str(self._web_dir / ".no-such-file-404")
        if root is None or "\0" in rel:
            return missing
        target = (root / rel).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            return missing
        return str(target)


def make_server(web_dir: Path, data_dir: Optional[Path], port: int = 0) -> ThreadingHTTPServer:
    handler = functools.partial(Handler, web_dir=web_dir, data_dir=data_dir)
    return ThreadingHTTPServer((HOST, port), handler)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=None, help="folder served under /data/")
    ap.add_argument("--port", type=int, default=8770)
    args = ap.parse_args()
    srv = make_server(Path(__file__).resolve().parent, args.data, args.port)
    print("Serving http://%s:%d/" % (HOST, srv.server_address[1]))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
