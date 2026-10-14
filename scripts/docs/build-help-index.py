#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Writes what the board's Help section shows: the tiles and the search index.

Tiles: one per article in website/content. Every article needs `title:` and `description:`
in its front matter. The board opens <site address>/docs/<slug>/ in the browser, the address
being the Store's.

Search: one entry (url, title, group, text) per article and per module manual
(patch/modules/<name>/doc/*.md), the pages the website's own search covers; the board
searches it in the app.

    python3 scripts/docs/build-help-index.py [--check]

Output: patch/board/ui/help-articles.json and help-search.json. With --check nothing is
written; the exit status says whether the files are up to date.
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
CONTENT = ROOT / "website" / "content"
UI = ROOT / "patch" / "board" / "ui"
OUT = UI / "help-articles.json"
SEARCH_OUT = UI / "help-search.json"
MODULES = ROOT / "patch" / "modules"
CATEGORIES = ["Sources/Oscillators", "Sources/Chords", "Sources/Voices", "Sources/Generators", "Modulation/Envelopes", "Modulation/Slopes", "Modulation/LFOs", "Modulation/Random", "Modulation/Followers", "Audio/Filters", "Audio/Mixing", "Audio/Sampling", "Audio/Mangling", "Effects/Space & Time", "Effects/Movement", "Effects/Dynamics & EQ", "Effects/Distortion", "Effects/Textures", "Utility/Signal", "Utility/Logic & Routing", "Utility/Harmony", "Utility/Converters", "Utility/Metering", "Controllers/Panel", "Controllers/Performance", "Sequencing/Melodic", "Sequencing/Drum", "Sequencing/Generative", "Sequencing/Clock", "Drums/Ring", "Drums/Punch"]  # the board's Add menu order
GROUPS = {  # folder under website/content -> heading, in the order of the section
    "musicians": "Musicians",
    "musicians/guides": "Guides",
    "developers": "Developers",
    "developers/api-reference": "API reference",
    "developers/spec": "Specification",
    "developers/modules": "Module developers",
    "developers/plugins": "Plugin developers",
    "developers/app": "Standalone app developers",
    "developers/web": "Web developers",
    "developers/reference": "Reference",
}


def meta_of(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    meta = {}
    if text.startswith("---\n"):
        for line in text[4:text.index("\n---\n", 4)].splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                meta[key.strip()] = value.strip()
    return meta


def build() -> list:
    articles = []
    for f in sorted(CONTENT.rglob("*.md")):
        rel = f.relative_to(CONTENT).with_suffix("")
        folder = "/".join(rel.parts[:-1])
        key = max((k for k in GROUPS if folder == k or folder.startswith(k + "/")), key=len, default=None)  # the deepest folder wins
        group = GROUPS.get(key)
        meta = meta_of(f)
        if group is None or not meta.get("title") or not meta.get("description"):
            sys.exit(f"{f}: needs a known folder ({', '.join(GROUPS)}) and title: and description: in the front matter")
        articles.append({"group": group, "title": meta["title"], "description": meta["description"],
                         "path": "/docs/" + "/".join(rel.parts) + "/", "order": int(meta.get("order", 1000))})
    groups = list(GROUPS.values())
    articles.sort(key=lambda a: (groups.index(a["group"]), a["order"], a["path"]))
    for a in articles:
        del a["order"]
    return articles


def plain(path: Path) -> str:
    """A Markdown file as plain text for searching: front matter, code fences, link targets and markup go; code stays."""
    text = path.read_text(encoding="utf-8")
    if text.startswith("---\n"):
        text = text[text.index("\n---\n", 4) + 5:]
    text = re.sub(r"```\w*", " ", text)
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"^\s*(#+|>|[-*+]|\d+\.)\s+", " ", text, flags=re.M)
    text = re.sub(r"^[\s|:-]+$", " ", text, flags=re.M)  # table rules
    text = re.sub(r"[*_`|]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def module_entries() -> list:
    """The module manuals, as the website lists them (website/app/src/lib/content.ts, modules()): one per doc, a kit has several."""
    types = {t["type"]: t for t in json.loads((UI / "demo-types.json").read_text(encoding="utf-8"))}
    found = []
    for folder in sorted(p for p in MODULES.iterdir() if (p / "module.json").is_file()):
        m = json.loads((folder / "module.json").read_text(encoding="utf-8"))
        docs = {m["doc"]} if m.get("doc") else set()
        docs |= {f"doc/{f.name}" for f in (folder / "doc").glob("*.md")}
        for doc in sorted(docs):
            f = folder / doc
            if not f.is_file():
                continue
            slug = f.stem
            t = types.get(slug)
            category = (t or {}).get("category") or m.get("category") or "Other"
            rank = CATEGORIES.index(category) if category in CATEGORIES else len(CATEGORIES)
            found.append((rank, (t or {}).get("name") or (m["name"] if slug == folder.name else slug), category, slug, f))
    found.sort(key=lambda e: (e[0], e[1].lower()))
    return [{"group": "Modules · " + c.replace("/", " · "), "title": n, "path": f"/docs/musicians/modules/{slug}/", "text": plain(f)}
            for _, n, c, slug, f in found]


def search_index() -> list:
    entries = []
    for f in sorted(CONTENT.rglob("*.md")):
        rel = f.relative_to(CONTENT).with_suffix("")
        meta = meta_of(f)
        entries.append({"group": "Documentation", "title": meta["title"], "path": "/docs/" + "/".join(rel.parts) + "/", "text": plain(f)})
    return entries + module_entries()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    files = {OUT: json.dumps(build(), indent=1, ensure_ascii=False) + "\n",
             SEARCH_OUT: json.dumps(search_index(), ensure_ascii=False, separators=(",", ":")) + "\n"}
    if ap.parse_args().check:
        stale = [f for f, text in files.items() if not f.exists() or f.read_text(encoding="utf-8") != text]
        if stale:
            sys.exit(f"{', '.join(str(f.relative_to(ROOT)) for f in stale)} out of date: run scripts/docs/build-help-index.py")
        return
    for f, text in files.items():
        f.write_text(text, encoding="utf-8")
        print(f"wrote {f.relative_to(ROOT)} ({len(text) // 1024} KB)")


if __name__ == "__main__":
    main()
