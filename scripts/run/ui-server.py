#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Serves the board UI in a browser, the way the plugins serve it: files from
patch/board/ui, patch/common/ui, patch/modules/*/ui and patch/modules/*/doc side
by side. Outside a
plugin the page runs against board-demo.js, a fake engine (no audio).

    python3 scripts/run/ui-server.py [--port 8765]
"""
import argparse
import http.server
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
PATCH = ROOT / "patch"


def modules():
    return sorted(p for p in (PATCH / "modules").iterdir() if p.is_dir())


def dirs():  # looked up per request, so a new module ui/ folder is served without a restart
    return [PATCH / "board" / "ui", PATCH / "common" / "ui", PATCH / "script" / "dist"] + [m / sub for m in modules() for sub in ("ui", "doc") if (m / sub).is_dir()]


# The same policy as the browser build (scripts/build/build-web.sh), minus WebAssembly: the demo engine here is plain JavaScript.
CSP = ("default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; "
       "img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'")


def host_allowed(header):
    """Host header check against DNS rebinding: only this computer's names, with or without a numeric port."""
    m = re.fullmatch(r"(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?", (header or "").strip().lower())
    return m is not None


class Handler(http.server.SimpleHTTPRequestHandler):
    # Checked before anything is served (GET and HEAD alike): a rebinding page reaches this server under another name.
    def parse_request(self):
        if not super().parse_request():
            return False
        if not host_allowed(self.headers.get("Host")):
            self.send_error(403, "Forbidden host")
            return False
        return True

    def translate_path(self, path):
        name = path.split("?", 1)[0].lstrip("/") or "index.html"
        if "/" in name or ".." in name:
            return str(PATCH / "board" / "ui" / "404")
        for base in dirs():
            candidate = base / name
            if candidate.is_file():
                return str(candidate)
        return str(PATCH / "board" / "ui" / name)

    def do_GET(self):
        if self.path.split("?", 1)[0].lstrip("/") == "module-views.json":  # as the plugin build writes it
            names = sorted(f.name for m in modules() for f in (m / "ui").glob("*.js"))
            body = json.dumps(names).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".md": "text/markdown; charset=utf-8"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    print(f"Board UI on http://localhost:{args.port}  (Ctrl-C to stop)")
    http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
