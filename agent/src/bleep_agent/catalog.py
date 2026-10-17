# SPDX-License-Identifier: MIT
"""The module catalog: every node type with its params, jacks and roles (doc/specs/agent.md §2.2).

Built from the engine's own type export (patch/board/ui/demo-types.json, written by bleep_dump_types) plus the
module folders' module.json and docs. Loaded at run time from a single JSON file.

    python -m bleep_agent.catalog build  [--repo ROOT] [--out catalog.json]
    python -m bleep_agent.catalog check  [--repo ROOT] [--file catalog.json]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from functools import cached_property
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

CATALOG_VERSION = 1

FLOAT_SIGNALS = {"control", "pitch", "audio"}

# category prefix -> roles (first match wins; a module.json "agent.roles" overrides)
_CATEGORY_ROLES: list[tuple[str, list[str]]] = [
    ("Sources/", ["source"]),
    ("Drums/", ["source", "drum"]),
    ("Audio/Filters", ["filter"]),
    ("Audio/Mixing", ["mixer"]),
    ("Audio/Sampling", ["source", "sampler"]),
    ("Audio/Mangling", ["effect"]),
    ("Effects/", ["effect"]),
    ("Modulation/Envelopes", ["envelope", "modulator"]),
    ("Modulation/LFOs", ["lfo", "modulator"]),
    ("Modulation/", ["modulator"]),
    ("Sequencing/Clock", ["clock"]),
    ("Sequencing/", ["sequencer"]),
    ("Controllers/Performance", ["controller", "note_source"]),
    ("Controllers/", ["controller"]),
    ("Ports", ["port"]),
    ("Cells", ["cell"]),
    ("Utility/Metering", ["meter"]),
    ("Utility/", ["utility"]),
]
_TYPE_ROLES = {
    "vca": ["vca", "mixer"],
    "audio-mixer": ["mixer"],
    "crossfader": ["mixer"],
    "keyboard": ["controller", "note_source"],
    "midi-device": ["port", "note_source"],
    "midi-in": ["port", "note_source"],
    "instrument": ["port", "note_source"],
    "audio-out": ["port", "output"],
    "audio-in": ["port", "input"],
    "low-pass-gate": ["filter", "vca"],
    "reverb": ["effect", "reverb"],
    "chorus": ["effect", "chorus"],
    "delay": ["effect", "delay"],
    "compressor": ["effect", "dynamics"],
    "limiter": ["effect", "dynamics"],
    "eq": ["effect", "eq"],
}


def compatible(out_type: str, in_type: str) -> tuple[bool, str]:
    """Cable rule of doc/specs/specs.md §7.4: may an output of `out_type` feed an input of `in_type`?"""
    if out_type == in_type:
        return True, ""
    if "notes" in (out_type, in_type):
        if out_type == "notes":
            return False, "notes can only go to a notes input; use Notes to CV (or a Voice Cell) to get pitch and gate"
        return False, "only notes can feed a notes input; use CV to Notes to make notes"
    if "patchbay" in (out_type, in_type):
        return False, "patch bay jacks only connect to patch bay jacks"
    # control / pitch / audio / gate / trigger among themselves: all floats
    return True, "converted" if out_type != in_type and in_type in ("gate", "trigger") else ""


def _round(x: float, n: int = 6) -> float:
    return float(round(x, n))


class Param(BaseModel):
    id: str
    name: str
    kind: str = "float"  # float | choice | bool | int
    default: float = 0.0  # normalised
    min: float = 0.0
    max: float = 1.0
    def_: float = Field(0.0, alias="def")
    format: str = "number"
    decimals: int = 2
    label: str = ""
    map: str = "linear"  # linear | exp | skew
    centre: float | None = None
    choices: list[str] = []
    groups: list[str] = []
    modulatable: bool = True
    cableable: bool = False
    group: str = ""
    show: dict[str, Any] | None = None
    steps: int = 0

    model_config = {"populate_by_name": True}

    # ---- unit conversion (mirrors ParamSpec::toNormalised / fromNormalised) --------------------------------

    def to_normalised(self, v: float) -> float:
        lo, hi = self.min, self.max
        if hi <= lo:
            return 0.0
        v = min(max(v, lo), hi)
        if self.map == "exp" and lo > 0:
            x = math.log(v / lo) / math.log(hi / lo)
        elif self.map == "skew" and self.centre is not None and lo < self.centre < hi:
            skew = math.log(0.5) / math.log((self.centre - lo) / (hi - lo))
            p = (v - lo) / (hi - lo)
            x = 0.0 if p <= 0 else p**skew
        else:
            x = (v - lo) / (hi - lo)
        return _round(min(max(x, 0.0), 1.0))

    def from_normalised(self, x: float) -> float:
        x = min(max(x, 0.0), 1.0)
        lo, hi = self.min, self.max
        if self.map == "exp" and lo > 0:
            v = lo * (hi / lo) ** x
        elif self.map == "skew" and self.centre is not None and lo < self.centre < hi:
            skew = math.log(0.5) / math.log((self.centre - lo) / (hi - lo))
            v = lo if x <= 0 else lo + (hi - lo) * math.exp(math.log(x) / skew)
        else:
            v = lo + (hi - lo) * x
        return float(round(v)) if self.kind != "float" else v

    def parse(self, value: Any) -> tuple[float, str]:
        """A value as the model gives it (a number in real units, a choice name, a bool, or "50%", "2 kHz") ->
        (normalised, note). Raises ValueError with a message the model can act on."""
        note = ""
        if isinstance(value, bool):
            if self.kind not in ("bool", "choice", "int", "float"):
                raise ValueError(f"{self.id}: not a switch")
            return (1.0 if value else 0.0), ""
        if isinstance(value, str):
            s = value.strip()
            if self.choices:
                for i, c in enumerate(self.choices):
                    if c.lower() == s.lower():
                        return self.to_normalised(self.min + i), ""
                near = [c for c in self.choices if s.lower() in c.lower()]
                if len(near) == 1:
                    i = self.choices.index(near[0])
                    return self.to_normalised(self.min + i), f"read '{s}' as '{near[0]}'"
                raise ValueError(f"{self.id}: '{s}' is not one of {self.choices}")
            m = re.fullmatch(r"([-+]?\d*\.?\d+)\s*(%|khz|hz|ms|s|db|st)?", s, re.I)
            if not m:
                raise ValueError(f"{self.id}: cannot read '{value}' as a number")
            num, unit = float(m.group(1)), (m.group(2) or "").lower()
            if unit == "%":
                num = num / 100.0 if self.format == "percent" else num
            elif unit == "khz":
                num *= 1000.0
            elif unit == "ms":
                num /= 1000.0
            value = num
        if not isinstance(value, (int, float)):
            raise ValueError(f"{self.id}: expected a number, a choice name or a boolean, got {value!r}")
        v = float(value)
        if self.kind == "choice" or self.kind == "int":
            v = float(round(v))
        clamped = min(max(v, self.min), self.max)
        if abs(clamped - v) > 1e-9:
            note = f"{self.id}: {v:g} is outside {self.min:g}..{self.max:g}{(' ' + self.label) if self.label else ''}; used {clamped:g}"
        return self.to_normalised(clamped), note

    def text(self, norm: float) -> str:
        """The value as the board shows it."""
        v = self.from_normalised(norm)
        f = self.format
        if f == "seconds":
            return f"{round(v * 1000)} ms" if v < 1 else f"{v:.2f} s"
        if f == "percent":
            return f"{round(v * 100)} %"
        if f == "hertz":
            return f"{v:.2f} Hz" if v < 10 else f"{v:.0f} Hz" if v < 1000 else f"{v / 1000:.2f} kHz"
        if f == "choice" or self.choices:
            i = int(round(v - self.min))
            return self.choices[i] if 0 <= i < len(self.choices) else f"{v:g}"
        if f == "toggle":
            return "On" if v >= 0.5 else "Off"
        if f == "integer":
            return str(int(round(v)))
        if f == "semitones":
            return f"{int(round(v)):+d} st"
        s = f"{v:.{self.decimals}f}"
        return f"{s} {self.label}".strip()

    def summary(self) -> dict[str, Any]:
        d: dict[str, Any] = {"id": self.id, "name": self.name, "kind": self.kind}
        if self.choices:
            d["choices"] = self.choices
        else:
            d["range"] = [self.min, self.max]
            if self.label:
                d["unit"] = self.label
            elif self.format in ("seconds", "hertz", "percent", "semitones"):
                d["unit"] = {"seconds": "s", "hertz": "Hz", "percent": "0..1 = 0..100 %", "semitones": "st"}[self.format]
            if self.map != "linear":
                d["scale"] = self.map
        d["default"] = self.text(self.default)
        if not self.modulatable and not self.cableable:
            d["cable_target"] = False
        if self.show:
            d["only_when"] = self.show
        return d


class Jack(BaseModel):
    id: str
    name: str
    type: str = "control"
    bipolar: bool = True
    normal: str | None = None
    show: dict[str, Any] | None = None


class ModuleType(BaseModel):
    type: str
    name: str
    category: str = ""
    description: str = ""
    tagline: str = ""
    creatable: bool = True
    port: str = ""
    roles: list[str] = []
    doc: str = ""  # docs index id, e.g. "module:filter"
    typical: list[str] = []
    pitfalls: list[str] = []
    params: list[Param] = []
    inputs: list[Jack] = []
    outputs: list[Jack] = []
    buttons: list[dict[str, Any]] = []
    harmony: str | None = None
    memoryHeavy: bool = False

    def param(self, pid: str) -> Param | None:
        return next((p for p in self.params if p.id == pid), None)

    def input(self, jid: str) -> Jack | None:
        return next((j for j in self.inputs if j.id == jid), None)

    def output(self, jid: str) -> Jack | None:
        return next((j for j in self.outputs if j.id == jid), None)

    def summary(self, detail: bool = False) -> dict[str, Any]:
        d: dict[str, Any] = {"type": self.type, "name": self.name, "category": self.category, "roles": self.roles,
                             "description": self.description}
        if detail:
            d["inputs"] = [{"id": j.id, "name": j.name, "type": j.type, **({"normalled_to": j.normal} if j.normal else {})}
                           for j in self.inputs]
            d["outputs"] = [{"id": j.id, "name": j.name, "type": j.type} for j in self.outputs]
            d["params"] = [p.summary() for p in self.params]
            if self.buttons:
                d["buttons"] = [b.get("id") for b in self.buttons]
            if self.typical:
                d["typical"] = self.typical
            if self.pitfalls:
                d["pitfalls"] = self.pitfalls
        return d


class Catalog(BaseModel):
    version: int = CATALOG_VERSION
    source: dict[str, str] = {}
    types: list[ModuleType] = []

    @cached_property
    def by_type(self) -> dict[str, ModuleType]:
        return {t.type: t for t in self.types}

    def get(self, type_: str) -> ModuleType | None:
        return self.by_type.get(type_)

    def search(self, query: str = "", role: str = "", category: str = "", limit: int = 25) -> list[ModuleType]:
        words = [w for w in re.split(r"\W+", query.lower()) if w]
        scored: list[tuple[float, ModuleType]] = []
        for t in self.types:
            if not t.creatable:
                continue
            if role and role not in t.roles:
                continue
            if category and category.lower() not in t.category.lower():
                continue
            hay = f"{t.type} {t.name} {t.category} {' '.join(t.roles)} {t.description} {t.tagline}".lower()
            if not words:
                score = 1.0
            else:
                score = sum((3 if w in t.type or w in t.name.lower() else 1) for w in words if w in hay)
                if score == 0:
                    continue
            scored.append((score, t))
        scored.sort(key=lambda s: (-s[0], s[1].type))
        return [t for _, t in scored[:limit]]

    @staticmethod
    def load(path: str | Path) -> "Catalog":
        return Catalog.model_validate_json(Path(path).read_text())


# ---------------------------------------------------------------------------------------------------------
# Build from the repository


def _roles_for(t: str, category: str, override: list[str] | None) -> list[str]:
    if override:
        return list(override)
    if t in _TYPE_ROLES:
        return list(_TYPE_ROLES[t])
    for prefix, roles in _CATEGORY_ROLES:
        if category.startswith(prefix):
            return list(roles)
    return []


def _find_module_json(modules_dir: Path, type_: str) -> tuple[dict[str, Any], Path | None]:
    """module.json of the folder that documents `type_`: folder named like the type, or a folder with doc/<type>.md."""
    cand = modules_dir / type_ / "module.json"
    if cand.exists():
        return json.loads(cand.read_text()), cand.parent
    for d in sorted(modules_dir.glob("*/doc")):
        if (d / f"{type_}.md").exists() and (d.parent / "module.json").exists():
            return json.loads((d.parent / "module.json").read_text()), d.parent
    return {}, None


def build_catalog(repo: Path) -> Catalog:
    types_file = repo / "patch" / "board" / "ui" / "demo-types.json"
    raw_bytes = types_file.read_bytes()
    raw = json.loads(raw_bytes)
    modules_dir = repo / "patch" / "modules"
    out: list[ModuleType] = []
    for r in raw:
        mj, folder = _find_module_json(modules_dir, r["type"])
        agent = mj.get("agent", {}) if isinstance(mj, dict) else {}
        doc = ""
        if folder is not None and (folder / "doc" / f"{r['type']}.md").exists():
            doc = f"module:{r['type']}"
        params = []
        for p in r.get("params", []):
            q = dict(p)
            q["default"] = _round(q.get("default", 0.0))
            for k in ("min", "max", "def", "centre"):
                if k in q and isinstance(q[k], float):
                    q[k] = _round(q[k])
            q["map"] = {"exp": "exp", "skew": "skew"}.get(q.get("map", ""), "linear")
            params.append(Param.model_validate(q))
        out.append(ModuleType(
            type=r["type"], name=r["name"], category=r.get("category", ""), description=r.get("description", ""),
            tagline=mj.get("tagline", ""), creatable=r.get("creatable", True), port=r.get("port", ""),
            roles=_roles_for(r["type"], r.get("category", ""), agent.get("roles")), doc=doc,
            typical=agent.get("typical", []), pitfalls=agent.get("pitfalls", []),
            params=params, inputs=[Jack.model_validate(j) for j in r.get("inputs", [])],
            outputs=[Jack.model_validate(j) for j in r.get("outputs", [])], buttons=r.get("buttons", []),
            harmony=r.get("harmony"), memoryHeavy=r.get("memoryHeavy", False)))
    return Catalog(source={"types_sha256": hashlib.sha256(raw_bytes).hexdigest()}, types=out)


def dumps(cat: Catalog) -> str:
    d = cat.model_dump(by_alias=True, exclude_none=True)
    return json.dumps(d, indent=1, sort_keys=False, ensure_ascii=False) + "\n"


def repo_root(start: Path | None = None) -> Path:
    p = (start or Path(__file__)).resolve()
    for q in [p, *p.parents]:
        if (q / "patch" / "board" / "ui" / "demo-types.json").exists():
            return q
    raise FileNotFoundError("repository root (patch/board/ui/demo-types.json) not found")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="bleep_agent.catalog")
    ap.add_argument("cmd", choices=["build", "check"])
    ap.add_argument("--repo", type=Path, default=None)
    ap.add_argument("--out", "--file", dest="out", type=Path, default=None)
    a = ap.parse_args(argv)
    repo = a.repo or repo_root()
    out = a.out or repo / "website" / "api" / "agent_data" / "catalog.json"
    text = dumps(build_catalog(repo))
    if a.cmd == "build":
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text)
        print(f"{out}: {text.count(chr(10))} lines")
        return 0
    if not out.exists() or out.read_text() != text:
        print(f"{out} is out of date: run  python -m bleep_agent.catalog build", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
