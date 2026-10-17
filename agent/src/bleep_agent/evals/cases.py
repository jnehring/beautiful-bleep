# SPDX-License-Identifier: MIT
"""Evaluation cases: one YAML file holds one case or a list of cases."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from ..patch import Patch
from ..presets import PresetLibrary
from .faults import apply_fault

CASES_DIR = Path(__file__).resolve().parents[3] / "evals" / "cases"


class Case(BaseModel):
    id: str
    skill: str  # docs | diagnose | patch | panel | compose | design
    difficulty: str = "medium"
    tags: list[str] = []
    patch: str | dict[str, Any] | None = None  # "preset:<id>" | "file:<path>" | inline board JSON | None (empty board)
    mutate: list[dict[str, Any]] = []  # fault injection / fixture damage applied after loading (faults.py)
    query: str
    env: dict[str, Any] = {}
    mode: str = "auto"
    selection: list[str] = []
    checks: list[dict[str, Any]] = Field(default_factory=list)  # deterministic: {"kind": ..., **args}
    judge: str | None = None  # rubric file name (evals/rubrics/<name>.md) for the soft score
    gold: dict[str, Any] = {}  # docs: {"docs": [page ids], "facts": [...]}; diagnose: {"fault": ..., "mentions": [...]}
    notes: str = ""

    def load_patch(self, lib: PresetLibrary | None) -> Patch:
        base: dict[str, Any]
        if self.patch is None:
            base = {"format": 1, "nodes": [], "cables": []}
        elif isinstance(self.patch, dict):
            base = self.patch
        elif self.patch.startswith("preset:"):
            if lib is None:
                raise ValueError("preset library needed for " + self.patch)
            base = lib.by_id[self.patch[7:]].preset
        elif self.patch.startswith("file:"):
            base = json.loads(Path(self.patch[5:]).read_text())
        else:
            raise ValueError(f"bad patch reference {self.patch!r}")
        p = Patch(base)
        for m in self.mutate:
            apply_fault(p, m)
        return p


def load_cases(root: Path | None = None, skills: list[str] | None = None, ids: list[str] | None = None) -> list[Case]:
    root = root or CASES_DIR
    out: list[Case] = []
    for f in sorted(root.rglob("*.yaml")):
        data = yaml.safe_load(f.read_text())
        for d in (data if isinstance(data, list) else [data]):
            c = Case.model_validate(d)
            if skills and c.skill not in skills:
                continue
            if ids and not any(c.id.startswith(i) for i in ids):
                continue
            out.append(c)
    return out


def dump_cases(cases: list[Case], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump([c.model_dump(exclude_defaults=True) | {"id": c.id, "skill": c.skill, "query": c.query} for c in cases],
                                   sort_keys=False, allow_unicode=True, width=120))
