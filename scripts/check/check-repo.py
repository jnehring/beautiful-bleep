#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Repository rules (spec §17), enforced in CI:

1. bus/ depends on nothing else in the repository.
2. patch/ uses the bus only through its public API: bus/include and
   bus/wrappers (no bus/src, no layout header).
3. Nothing depends on website/.
4. Every source file carries an SPDX license identifier; every top-level
   part has a LICENSE file. A module's files carry the licence its module.json
   declares (MIT when it declares none).
5. Module provenance (patch/modules/README.md, "Ported code and licences"): a
   module that is ported from other code names it in `origin`, keeps the
   original licence (copyleft stays copyleft), ships the licence text and
   credits the source in its doc.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SOURCE_SUFFIXES = {".c", ".h", ".cpp", ".hpp", ".js", ".ts", ".tsx", ".css", ".py", ".cmake", ".sh"}
SKIP_DIRS = {"build", ".venv", "node_modules", ".next", "out", ".git", "public", "third_party"}  # third_party: code with its own licence
GENERATED = {"next-env.d.ts"}
problems: list[str] = []

PERMISSIVE = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Apache-2.0", "Zlib", "0BSD", "Unlicense", "CC0-1.0"}
COPYLEFT = {"GPL-2.0-only", "GPL-2.0-or-later", "GPL-3.0-only", "GPL-3.0-or-later", "LGPL-2.1-only", "LGPL-2.1-or-later",
            "LGPL-3.0-only", "LGPL-3.0-or-later", "AGPL-3.0-only", "AGPL-3.0-or-later", "MPL-2.0"}
LICENSES = PERMISSIVE | COPYLEFT
MODULES = ROOT / "patch" / "modules"


def module_info(folder: Path) -> dict:
    try:
        return json.loads((folder / "module.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def expected_license(p: Path) -> str:
    """The SPDX id a source file must carry: its module's, else MIT."""
    rel = p.relative_to(ROOT).parts
    if len(rel) > 3 and rel[:2] == ("patch", "modules"):
        return module_info(MODULES / rel[2]).get("license", "MIT")
    return "MIT"


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
            want = expected_license(p)
            if f"SPDX-License-Identifier: {want}" not in text(p)[:400]:
                problems.append(f"{p.relative_to(ROOT)}: missing SPDX-License-Identifier: {want}")

# 5. module licences and origins
for meta in sorted(MODULES.glob("*/module.json")):
    folder, info = meta.parent, module_info(meta.parent)
    where = f"patch/modules/{folder.name}/module.json"
    lic, origin = info.get("license", "MIT"), info.get("origin")
    if lic not in LICENSES:
        problems.append(f"{where}: license {lic!r} is not a known SPDX id (add it to check-repo.py once its terms are reviewed)")
    if origin is None and lic == "MIT":
        continue
    if not (folder / "LICENSE").is_file():
        problems.append(f"patch/modules/{folder.name}/LICENSE missing (the full licence text and copyright notice of "
                        + ("the original" if origin else lic) + ")")
    if origin is None:
        continue
    for key in ("name", "author", "url", "license", "copyright"):
        if not origin.get(key):
            problems.append(f"{where}: origin.{key} missing")
    olic = origin.get("license")
    if olic not in LICENSES:
        problems.append(f"{where}: origin.license {olic!r} is not a known SPDX id")
    elif olic in COPYLEFT and lic != olic:
        problems.append(f"{where}: ported from {olic} code, so the module must stay {olic} (license is {lic})")
    elif olic in PERMISSIVE and lic not in PERMISSIVE | COPYLEFT:
        problems.append(f"{where}: license {lic!r} is not usable here")
    doc = folder / info.get("doc", f"doc/{folder.name}.md")
    section = re.search(r"^## Origin\s*$(.*?)(?=^## |\Z)", text(doc), flags=re.M | re.S) if doc.is_file() else None
    if not section:
        problems.append(f"{doc.relative_to(ROOT)}: needs an '## Origin' section crediting {origin.get('name', 'the source')}")
    elif origin.get("name") and (origin["name"] not in section.group(1) or origin.get("url", "") not in section.group(1)):
        problems.append(f"{doc.relative_to(ROOT)}: the Origin section must name {origin['name']!r} and link {origin.get('url')}")

for line in problems:
    print(line)
print("repository rules: " + ("OK" if not problems else f"{len(problems)} problem(s)"))
sys.exit(1 if problems else 0)
