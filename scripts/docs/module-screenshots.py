#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Takes the module view screenshots shown in the module docs and on the website.

Starts nothing itself: run scripts/run/ui-server.py first. For every module type
(patch/board/ui/demo-types.json) it puts one node on the demo board, opens the
node's view and saves the view window to patch/modules/<folder>/doc/<type>.png.
Needs Playwright for Python (pip install playwright; playwright install chromium).

    python3 scripts/docs/module-screenshots.py [--url http://localhost:8765] [type ...]
"""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent.parent
MODULES = ROOT / "patch" / "modules"
# Types that share a folder with their kit (Ring Drums, Punch Drums): type prefix → folder.
KITS = {"ring-": "ring-drums", "punch-": "punch-drums"}
# Views that draw history need to run a while before the shot (milliseconds).
SETTLE = {"envelope-follower": 8500}
# Types that are board plumbing (ports, cells), not modules with a folder.
PLUMBING = {"Ports", "Cells"}


def folder_of(t: str) -> Path | None:
    for prefix, folder in KITS.items():
        if t.startswith(prefix):
            return MODULES / folder
    d = MODULES / t
    return d if d.is_dir() else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8765")
    ap.add_argument("--executable", help="path to a Chromium / headless shell, if Playwright's own isn't installed")
    ap.add_argument("types", nargs="*")
    args = ap.parse_args()
    types = json.loads((ROOT / "patch" / "board" / "ui" / "demo-types.json").read_text())
    wanted = [t for t in types if t["category"] not in PLUMBING and (not args.types or t["type"] in args.types)]
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.executable) if args.executable else p.chromium.launch()
        failed = []
        for t in wanted:
            out = folder_of(t["type"])
            if out is None:
                print("no folder for", t["type"])
                continue
            board = {"format": 1, "id": "demo", "cables": [],
                     "nodes": [{"id": "n", "type": t["type"], "name": t["name"], "x": 40, "y": 40,
                                "parent": "", "muted": False, "params": {}}]}
            page = browser.new_page(viewport={"width": 1500, "height": 1100}, device_scale_factor=2)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(args.url + "/")
            page.evaluate("b => localStorage.setItem('bleep-demo-board', JSON.stringify(b))", board)
            page.reload()
            try:
                page.wait_for_selector("#nodes .node", timeout=5000)
                page.click("#nodes .node .n-head")
                page.wait_for_selector(".vwin", timeout=5000)
            except Exception:
                failed.append(t["type"])
                print("FAILED", t["type"], errors[:1])
                page.close()
                continue
            page.wait_for_timeout(SETTLE.get(t["type"], 400))
            doc = out / "doc"
            doc.mkdir(exist_ok=True)
            page.locator(".vwin").first.screenshot(path=str(doc / (t["type"] + ".png")))
            page.close()
            print("saved", doc / (t["type"] + ".png"))
        browser.close()
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
