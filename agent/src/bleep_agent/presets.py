# SPDX-License-Identifier: MIT
"""The preset library the assistant can learn from: whole-board example patches (presets.jsonl)."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


@dataclass
class PresetEntry:
    id: str
    name: str
    module: str
    description: str
    tags: list[str]
    types: list[str]  # module types used
    preset: dict[str, Any]

    def brief(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "module": self.module, "description": self.description[:200],
                "tags": self.tags, "uses": sorted(set(self.types))}


class PresetLibrary:
    def __init__(self, entries: list[PresetEntry]):
        self.entries = entries
        self.by_id = {e.id: e for e in entries}

    @staticmethod
    def load(path: str | Path) -> "PresetLibrary":
        out: list[PresetEntry] = []
        for line in Path(path).read_text().splitlines():
            if not line.strip():
                continue
            d = json.loads(line)
            out.append(PresetEntry(**d))
        return PresetLibrary(out)

    @staticmethod
    def from_demo_patches(file: str | Path) -> "PresetLibrary":
        raw = json.loads(Path(file).read_text())["patches"]
        out, used = [], set()
        for r in raw:
            pid = slug(r["name"])
            while pid in used:
                pid += "-2"
            used.add(pid)
            pr = r["preset"]
            out.append(PresetEntry(pid, r["name"], r.get("module", ""), pr.get("description", ""), pr.get("tags", []),
                                   [n["type"] for n in pr["nodes"]], pr))
        return PresetLibrary(out)

    def dump(self, path: str | Path) -> None:
        with open(path, "w") as f:
            for e in self.entries:
                f.write(json.dumps({"id": e.id, "name": e.name, "module": e.module, "description": e.description,
                                    "tags": e.tags, "types": e.types, "preset": e.preset}, separators=(",", ":")) + "\n")

    def search(self, query: str, limit: int = 8, uses: list[str] | None = None) -> list[PresetEntry]:
        words = [w for w in re.split(r"\W+", query.lower()) if len(w) > 1]
        scored: list[tuple[float, PresetEntry]] = []
        for e in self.entries:
            if uses and not all(u in e.types for u in uses):
                continue
            name = e.name.lower()
            hay_tags = " ".join(e.tags).lower()
            hay = f"{e.description} {e.module}".lower()
            s = 0.0
            for w in words:
                s += 4 * (w in name) + 3 * (w in hay_tags) + 1 * (w in hay)
            if words and s == 0:
                continue
            scored.append((s - 0.001 * len(e.types), e))
        scored.sort(key=lambda t: -t[0])
        return [e for _, e in scored[:limit]]
