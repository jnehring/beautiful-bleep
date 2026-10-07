#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Checks that the API reference documents exactly the functions declared in
bus/include/bleep_bus.h (one "### `bb_name`" heading each)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
header = (ROOT / "bus/include/bleep_bus.h").read_text(encoding="utf-8")
declared = set(re.findall(r"^(?:const )?[A-Za-z0-9_]+[\s*]+(bb_[a-z_]+)\(", header, flags=re.M))
docs = "".join(p.read_text(encoding="utf-8") for p in (ROOT / "website/content/developers/api-reference").glob("*.md"))
documented = set(re.findall(r"^### `(bb_[a-z_]+)`", docs, flags=re.M))

missing = sorted(declared - documented)
stale = sorted(documented - declared)
for name in missing:
    print(f"undocumented: {name}")
for name in stale:
    print(f"documented but not in the header: {name}")
print(f"{len(declared)} functions declared, {len(documented)} documented")
sys.exit(1 if missing or stale else 0)
