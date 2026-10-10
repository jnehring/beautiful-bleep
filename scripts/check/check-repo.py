#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Repository rules (spec §17), enforced in CI:

1. bus/ depends on nothing else in the repository.
2. patch/ uses the bus only through its public API: bus/include and
   bus/wrappers (no bus/src, no layout header).
3. Nothing depends on website/.
4. Every source file carries an SPDX license identifier; every top-level
   part has a LICENSE file.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SOURCE_SUFFIXES = {".c", ".h", ".cpp", ".hpp", ".js", ".ts", ".tsx", ".css", ".py", ".cmake", ".sh"}
SKIP_DIRS = {"build", "node_modules", ".next", "out", ".git", "public"}
GENERATED = {"next-env.d.ts"}
problems: list[str] = []


def files(folder: str, code_only: bool = True):
    """Source files only by default: links in READMEs are not dependencies."""
    for p in (ROOT / folder).rglob("*"):
        if not p.is_file() or p.name in GENERATED or (SKIP_DIRS & set(p.relative_to(ROOT).parts)):
            continue
        if code_only and not (p.suffix in SOURCE_SUFFIXES or p.name == "CMakeLists.txt" or p.suffix == ".html"):
            continue
        yield p


def text(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return ""


# 1. bus/ is self-contained
for p in files("bus"):
    if re.search(r"\.\./(patch|website|scripts)\b|\b(patch|website)/(common|modules|app|content)/", text(p)):
        problems.append(f"{p.relative_to(ROOT)}: bus/ must not reference other parts of the repository")

# 2. patch/ uses only the public API
for p in files("patch"):
    t = text(p)
    for inc in re.findall(r'#include\s+[<"]([^>"]+)[>"]', t):
        if inc in {"bb_platform.h", "bleep_bus_layout.h"} or "bus/src" in inc:
            problems.append(f"{p.relative_to(ROOT)}: includes private bus header {inc}")
    if re.search(r"bus/src", t):
        problems.append(f"{p.relative_to(ROOT)}: references bus/src")

# 3. nothing depends on website/
for folder in ("bus", "patch"):
    for p in files(folder):
        if "website/" in text(p):
            problems.append(f"{p.relative_to(ROOT)}: must not depend on website/")

# 4. SPDX headers and LICENSE files
for folder in ("bus", "patch", "scripts", "website"):
    if not (ROOT / folder / "LICENSE").exists():
        problems.append(f"{folder}/LICENSE missing")
    for p in files(folder):
        name = p.name
        if p.suffix in SOURCE_SUFFIXES or name == "CMakeLists.txt" or p.suffix == ".html":
            if "SPDX-License-Identifier: MIT" not in text(p)[:400]:
                problems.append(f"{p.relative_to(ROOT)}: missing SPDX-License-Identifier: MIT")

for line in problems:
    print(line)
print("repository rules: " + ("OK" if not problems else f"{len(problems)} problem(s)"))
sys.exit(1 if problems else 0)
