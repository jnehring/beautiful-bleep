#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Serves one module's UI in a browser, the way the plugin serves it:
patch/modules/<module>/ui/ overlaid on patch/common/ui/ (module files win).
The page runs against bleep-demo.js, a fake backend.

    python3 scripts/ui-server.py function [--port 8765]
"""
import argparse
import functools
import http.server
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMMON = ROOT / "patch" / "common" / "ui"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, module_dir: Path, **kwargs):
        self.module_dir = module_dir
        super().__init__(*args, directory=str(module_dir), **kwargs)

    def translate_path(self, path):
        name = path.split("?", 1)[0].lstrip("/") or "index.html"
        for base in (self.module_dir, COMMON):
            candidate = base / name
            if candidate.is_file():
                return str(candidate)
        return str(self.module_dir / name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("module", help="folder name in patch/modules, e.g. function")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    module_dir = ROOT / "patch" / "modules" / args.module / "ui"
    if not module_dir.is_dir():
        raise SystemExit(f"no UI folder: {module_dir}")
    handler = functools.partial(Handler, module_dir=module_dir)
    print(f"{args.module} UI on http://localhost:{args.port}  (Ctrl-C to stop)")
    http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler).serve_forever()


if __name__ == "__main__":
    main()
