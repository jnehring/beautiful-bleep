# SPDX-License-Identifier: MIT
"""The browser's part, simulated: executes the live tools against the graph model (sim.py)."""
from __future__ import annotations

from typing import Any, Callable

from ..catalog import Catalog
from ..patch import Patch
from ..sim import Stimulus, simulate


class SimClient:
    def __init__(self, get_patch: Callable[[], Patch], catalog: Catalog, env: dict[str, Any] | None = None):
        self.get_patch, self.catalog = get_patch, catalog
        self.env = env or {}
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def handle(self, tool: str, args: dict[str, Any]) -> Any:
        self.calls.append((tool, args))
        p = self.get_patch()
        if tool == "get_environment":
            kb = [n["id"] for n in p.of_type("keyboard")]
            base = {"audio": {"running": True, "sampleRate": 48000, "muted": False}, "midi": {"inputs": []},
                    "transport": {"playing": True, "bpm": p.tempo or 120}, "keyboard": kb}
            return {**base, **self.env}
        if tool == "probe_signals":
            has_note = bool(args.get("test_note"))
            sim = simulate(p, self.catalog, Stimulus(note_held=has_note, transport=(self.env.get("transport") or {}).get("playing", True)))
            note_src = bool(p.with_role(self.catalog, "note_source"))
            out = []
            for pt in args.get("points", []):
                pres = sim.present(pt["node"], pt["jack"])
                out.append({"node": pt["node"], "jack": pt["jack"], "present": pres, "moves": pres, "last": 1.0 if pres else 0.0,
                            "min": 0.0, "max": 1.0 if pres else 0.0, "transitions": 2 if pres else 0, "series": []})
            return {"points": out, "notes_sent": has_note and note_src}
        if tool == "play":
            return {"played": True}
        if tool == "highlight":
            return {"ok": True}
        if tool == "ask_user":
            ch = args.get("choices") or []
            return {"answer": ch[0] if ch else "yes"}
        return {"error": f"unknown tool {tool}"}
