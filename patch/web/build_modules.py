#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Compiles every board module to its own standalone .wasm and writes the
manifest the browser loads them by.

    python3 patch/web/build_modules.py --out build/web [--only oscillator,filter] [-j 8]

Needs emcc on PATH (source emsdk_env.sh). About a third of the modules use
juce_core (juce::var / String / JSON for their node data): with --juce <JUCE
checkout> (8.x) juce_core is compiled once for WebAssembly (patched copy, two
small fixes JUCE 8.0.9 lacks for its wasm platform) and linked into those
modules. Without it they are listed under "unavailable" in the manifest; the
board shows them but cannot run them.

Output:
  <out>/modules/<slug>.wasm
  <out>/manifest.json   {"modules": {slug: {"file", "bytes", "types": [type ids]}},
                         "types":   {type id: slug},
                         "unavailable": {slug: reason}}
"""
import argparse
import concurrent.futures
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

PATCH = Path(__file__).resolve().parent.parent
MODULES = PATCH / "modules"

FLAGS = [
    "-std=c++20", "-O2", "-fno-exceptions", "-Wno-unused-command-line-argument",
    "--no-entry", "-sSTANDALONE_WASM", "-sALLOW_MEMORY_GROWTH", "-sINITIAL_MEMORY=1MB",
    "-sSTACK_SIZE=64KB", "-sERROR_ON_UNDEFINED_SYMBOLS=1", "-sEXPORT_ALL=0",
]


def module_dirs(only):
    dirs = sorted(p.parent for p in MODULES.glob("*/module.json"))
    return [d for d in dirs if not only or d.name in only]


def register_functions(sources):
    names = []
    for s in sources:
        names += re.findall(r"^void\s+(register\w+)\s*\(\s*(?:bleep::engine::)?Registry\s*&", s.read_text(), re.M)
    return names


JUCE_DEFINES = ["-DJUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1", "-DJUCE_STANDALONE_APPLICATION=1", "-DJUCE_WEB_BROWSER=0",
                "-DJUCE_USE_CURL=0", "-DJUCE_DISABLE_JUCE_VERSION_PRINTING=1", "-DJUCE_MODULE_AVAILABLE_juce_core=1"]


def uses_juce(d):
    return any("juce" in f.read_text() for f in list(d.glob("*.cpp")) + list(d.glob("dsp/*.h")))


def build_juce_core(juce_dir, out):
    """juce_core as one object file for WebAssembly, from a patched copy of the module."""
    work = out / ".juce"
    obj = work / "juce_core.o"
    if obj.exists():
        return work, obj
    shutil.rmtree(work, ignore_errors=True)
    shutil.copytree(Path(juce_dir) / "modules" / "juce_core", work / "juce_core")
    prio = work / "juce_core/native/juce_ThreadPriorities_native.h"
    prio.write_text(prio.read_text().replace("#if JUCE_LINUX || JUCE_BSD", "#if JUCE_LINUX || JUCE_BSD || JUCE_WASM"))
    wasm = work / "juce_core/native/juce_SystemStats_wasm.cpp"
    wasm.write_text("#include <emscripten.h>\n" + wasm.read_text())
    unit = work / "juce_core_unit.cpp"
    unit.write_text("#include <juce_core/juce_core.cpp>\n")
    r = subprocess.run(["emcc", "-std=c++20", "-O2", "-fwasm-exceptions", "-c", str(unit), f"-I{work}", *JUCE_DEFINES, "-o", str(obj)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("juce_core for WebAssembly failed:\n" + r.stderr[-1500:])
    return work, obj


def build(d, out, include_dirs, juce=None):
    sources = sorted(d.glob("*Module.cpp"))
    if not sources:
        return d.name, None, "no *Module.cpp"
    fns = register_functions(sources)
    with tempfile.TemporaryDirectory() as tmp:
        header = Path(tmp) / "web_register.h"
        header.write_text(
            "#define BLEEP_WEB_DECLARE " + "".join(f"void {f}(Registry&); " for f in fns) + "\n"
            "#define BLEEP_WEB_REGISTER " + "".join(f"{f}(*this); " for f in fns) + "\n"
            if fns else "")
        target = out / "modules" / f"{d.name}.wasm"
        target.parent.mkdir(parents=True, exist_ok=True)
        flags, extra = FLAGS, []
        if uses_juce(d):
            if not juce:
                return d.name, None, "uses juce_core (pass --juce <JUCE checkout>)"
            flags = [f for f in FLAGS if f != "-fno-exceptions"] + ["-fwasm-exceptions", "-sINITIAL_MEMORY=2MB", "-sSTACK_SIZE=256KB"]
            extra = [f"-I{juce[0]}", *JUCE_DEFINES, str(juce[1])]
        if any("Media.h" in f.read_text() for f in sources + list(d.glob("dsp/*.h"))):
            extra.append(str(PATCH / "engine/Media.cpp"))  # no media folder in a browser yet: loads find nothing
        cmd = (["emcc"] + flags + [f"-I{tmp}"] + [f"-I{i}" for i in include_dirs] + extra
               + [str(PATCH / "web/src/WebShim.cpp")] + [str(s) for s in sources]
               + ["-o", str(target)])
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            target.unlink(missing_ok=True)
            lines = [l for l in r.stderr.splitlines() if "error" in l]
            return d.name, None, (lines[0] if lines else r.stderr[-300:]).strip()
        return d.name, target, ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="")
    ap.add_argument("--juce", default="", help="JUCE 8 checkout: builds the modules that use juce_core")
    ap.add_argument("-j", type=int, default=8)
    a = ap.parse_args()
    out = Path(a.out)
    only = set(filter(None, a.only.split(",")))
    dirs = module_dirs(only)
    include_dirs = [PATCH / "engine", PATCH / "common"] + [d / "dsp" for d in module_dirs(set()) if (d / "dsp").is_dir()]
    juce = build_juce_core(a.juce, out) if a.juce and any(uses_juce(d) for d in dirs) else None
    manifest = {"modules": {}, "types": {}, "unavailable": {}}
    with concurrent.futures.ThreadPoolExecutor(a.j) as pool:
        for slug, wasm, err in pool.map(lambda d: build(d, out, include_dirs, juce), dirs):
            if wasm is None:
                manifest["unavailable"][slug] = err
                print(f"  skip  {slug}: {err}")
                continue
            manifest["modules"][slug] = {"file": f"modules/{slug}.wasm", "bytes": wasm.stat().st_size, "types": []}
            print(f"  built {slug} ({wasm.stat().st_size // 1024} KB)")
    # The node types of each file come from the file itself.
    node = subprocess.run(["node", str(PATCH / "web/test/list-types.mjs"), str(out)], capture_output=True, text=True)
    if node.returncode != 0:
        sys.exit(node.stderr)
    for slug, types in json.loads(node.stdout).items():
        if slug not in manifest["modules"]:
            continue  # left over from an earlier, wider build
        manifest["modules"][slug]["types"] = types
        for t in types:
            manifest["types"][t] = slug
    manifest["modules"] = dict(sorted(manifest["modules"].items()))
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"{len(manifest['modules'])} built, {len(manifest['unavailable'])} unavailable")


if __name__ == "__main__":
    main()
