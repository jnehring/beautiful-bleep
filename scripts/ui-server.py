#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Serves the board UI in a browser, the way the plugins serve it: files from
patch/board/ui, patch/common/ui, patch/modules/*/ui and patch/modules/*/doc side
by side. Outside a
plugin the page runs against board-demo.js, a fake engine (no audio).

    python3 scripts/ui-server.py [--port 8765]
"""
import argparse
import http.server
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATCH = ROOT / "patch"
MODULES = sorted(p for p in (PATCH / "modules").iterdir() if p.is_dir())
DIRS = [PATCH / "board" / "ui", PATCH / "common" / "ui"] + [m / sub for m in MODULES for sub in ("ui", "doc") if (m / sub).is_dir()]


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        name = path.split("?", 1)[0].lstrip("/") or "index.html"
        if "/" in name or ".." in name:
            return str(DIRS[0] / "404")
        for base in DIRS:
            candidate = base / name
            if candidate.is_file():
                return str(candidate)
        return str(DIRS[0] / name)

    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".md": "text/markdown; charset=utf-8"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    print(f"Bleep Board UI on http://localhost:{args.port}  (Ctrl-C to stop)")
    http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
