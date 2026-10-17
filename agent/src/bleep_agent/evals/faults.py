# SPDX-License-Identifier: MIT
"""Damage a working patch in a known way, so a diagnose case has a ground truth (and fixtures can be made messy)."""
from __future__ import annotations

import random
from typing import Any

from ..patch import Patch


def apply_fault(p: Patch, spec: dict[str, Any]) -> None:
    k = spec["fault"]
    if k == "remove_cable":
        p.data["cables"] = [c for c in p.cables if c["id"] != spec["cable"]]
    elif k == "remove_cables_to":  # all cables into node[.jack]
        p.data["cables"] = [c for c in p.cables if not (c["to"]["node"] == spec["node"] and spec.get("jack") in (None, c["to"]["jack"]))]
    elif k == "remove_cables_from":
        p.data["cables"] = [c for c in p.cables if not (c["from"]["node"] == spec["node"] and spec.get("jack") in (None, c["from"]["jack"]))]
    elif k == "set_param":  # normalised
        p.node(spec["node"]).setdefault("params", {})[spec["param"]] = spec["value"]
    elif k == "mute":
        p.node(spec["node"])["muted"] = True
    elif k == "remove_node":
        p.data["nodes"] = [n for n in p.nodes if n["id"] != spec["node"]]
        p.data["cables"] = [c for c in p.cables if spec["node"] not in (c["from"]["node"], c["to"]["node"])]
    elif k == "strip_panels":
        p.data["panels"] = []
    elif k == "scramble_panel":  # a messy panel: shuffle positions, shrink the grid, break the section frames
        rnd = random.Random(spec.get("seed", 1))
        for pn in p.data.get("panels", []):
            cols = pn["cols"]
            for c in pn["controls"]:
                if c["type"] in ("section", "label"):
                    continue
                c["at"] = [rnd.randint(0, max(0, cols - c["size"][0])), rnd.randint(0, max(0, pn["rows"] - c["size"][1]))]
    else:
        raise ValueError(f"unknown fault {k}")
    p._reindex()
