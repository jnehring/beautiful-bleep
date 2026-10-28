#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
"""Compiles every board module to its own standalone .wasm and writes the
manifest the browser loads them by.

    python3 patch/web/build_modules.py --out build/web [--only oscillator,filter] [-j 8] [--force]

A module is rebuilt only when something it compiles changed (its own files, the engine and
common headers it includes, the shim) or its compiler flags did; <out>/.cache/<slug>.json
records the files (the compiler's own dependency list) and their hashes. --force rebuilds all.
With --only, the other modules already in <out> stay in the manifest.

Modules written in Bleep Script (module.json: "language": "bleep-script") are compiled with node (patch/script: npm install first), not emcc.
Needs emcc on PATH (source emsdk_env.sh) for the C++ modules. About a third of the modules use
juce_core (juce::var / String / JSON for their node data): with --juce <JUCE
checkout> (8.x) juce_core is compiled once for WebAssembly (patched copy, two
small fixes JUCE 8.0.9 lacks for its wasm platform) and linked into those
modules. Without it they are listed under "unavailable" in the manifest; the
board shows them but cannot run them.

Output:
  <out>/modules/<slug>.wasm
  <out>/manifest.json   {"modules": {slug: {"file", "bytes", "built" (when it was compiled), "types": [type ids], "spec": [node type descriptions], "script": {view, source, help}}},   (script: script modules only)
                         "types":   {type id: slug},
                         "unavailable": {slug: reason}}
"""
import argparse
import concurrent.futures
import functools
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
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


# Exceptions in the modules that use juce_core: the exception handling proposal as it was standardised (try_table), not
# Emscripten's older default (try/catch). Wasmtime only compiles the standard one (patch/engine/wasm); browsers have it
# since 2025 (Chrome 137, Firefox 131, Safari 18.4).
EH_FLAGS = ["-sWASM_LEGACY_EXCEPTIONS=0"]

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
    r = subprocess.run(["emcc", "-std=c++20", "-O2", "-fwasm-exceptions", *EH_FLAGS, "-c", str(unit), f"-I{work}", *JUCE_DEFINES, "-o", str(obj)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("juce_core for WebAssembly failed:\n" + r.stderr[-1500:])
    return work, obj


ROOT = PATCH.parent


@functools.cache
def _emcc_version():
    return subprocess.run(["emcc", "--version"], capture_output=True, text=True).stdout.splitlines()[:1]


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _up_to_date(cache_file, key, target):
    """True when the target exists, was built with the same key and none of its source files changed."""
    try:
        rec = json.loads(cache_file.read_text())
        # The cache is data in the output folder: a path that leaves the repository makes it stale, it is never read.
        for rel in rec["deps"]:
            if not isinstance(rel, str) or Path(rel).is_absolute() or ".." in Path(rel).parts:
                return False
        return (target.exists() and rec["key"] == key
                and all((ROOT / rel).is_file() and _sha(ROOT / rel) == h for rel, h in rec["deps"].items()))
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False


def _write_cache(cache_file, key, depfile):
    # The depfile is Makefile syntax: "target: dep dep \\\n dep". Keep only files of this repository (patch/).
    text = depfile.read_text().replace("\\\n", " ")
    deps = {}
    for tok in text.split(":", 1)[1].split():
        p = Path(tok.replace("\\ ", " "))
        if p.is_absolute() and p.is_relative_to(ROOT) and p.is_file():
            deps[str(p.relative_to(ROOT))] = _sha(p)
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps({"key": key, "deps": deps}))


def is_script(d):
    """A module written in Bleep Script (module.json: "language": "bleep-script"): <slug>.dsp.ts, compiled with node, not emcc."""
    try:
        return json.loads((d / "module.json").read_text()).get("language") == "bleep-script"
    except (OSError, ValueError):
        return False


def build_script(d, out, force=False):
    """Compiles a script module (patch/script/build-module.mjs) to <out>/modules/<slug>.wasm. The files next to it that the board needs
    (<slug>.view.js: its own UI, <slug>.dsp.ts: its source, <slug>.md: its help page) are copied beside it, and its node type descriptions are
    kept in <out>/.cache/<slug>.spec.json for the manifest."""
    slug, script = d.name, PATCH / "script"
    if not (script / "node_modules").is_dir():
        return slug, None, "a script module: run npm install in patch/script"
    source = d / f"{slug}.dsp.ts"
    if not source.is_file():
        return slug, None, f"no {slug}.dsp.ts"
    target = out / "modules" / f"{slug}.wasm"
    spec_file = out / ".cache" / f"{slug}.spec.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    spec_file.parent.mkdir(parents=True, exist_ok=True)
    # what the result depends on: the module's source, the library it imports and the compiler's own files
    deps = [source, *sorted((script / "src" / "bleep").glob("*.ts")), script / "transform" / "bleep.mjs", script / "transform" / "subset.mjs", script / "compiler" / "compile.mjs",
            script / "modules.mjs", script / "build-module.mjs"]
    key = hashlib.sha256(json.dumps([str(source.relative_to(ROOT)), "bleep-script-1"]).encode()).hexdigest()
    cache_file = out / ".cache" / f"{slug}.json"
    fresh = not force and spec_file.exists() and _up_to_date(cache_file, key, target)
    if not fresh:
        r = subprocess.run(["node", str(script / "build-module.mjs"), slug, str(target), str(spec_file)], capture_output=True, text=True)
        if r.returncode != 0:
            target.unlink(missing_ok=True)
            cache_file.unlink(missing_ok=True)
            return slug, None, (r.stderr.strip().splitlines() or ["node failed"])[-1]
        cache_file.write_text(json.dumps({"key": key, "deps": {str(p.relative_to(ROOT)): _sha(p) for p in deps if p.is_file()}}))
    for name, src in ((f"{slug}.view.js", d / f"{slug}.view.js"), (f"{slug}.dsp.ts", source), (f"{slug}.md", d / "doc" / f"{slug}.md")):
        if src.is_file():
            shutil.copyfile(src, out / "modules" / name)
        else:
            (out / "modules" / name).unlink(missing_ok=True)
    return slug, target, "up to date" if fresh else ""


def build(d, out, include_dirs, juce=None, force=False):
    if is_script(d):
        return build_script(d, out, force)
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
            flags = [f for f in FLAGS if f != "-fno-exceptions"] + ["-fwasm-exceptions", *EH_FLAGS, "-sINITIAL_MEMORY=2MB", "-sSTACK_SIZE=256KB"]
            extra = [f"-I{juce[0]}", *JUCE_DEFINES, str(juce[1])]
        if any("Media.h" in f.read_text() for f in sources + list(d.glob("dsp/*.h"))):
            extra.append(str(PATCH / "engine/Media.cpp"))  # no media folder in a browser yet: loads find nothing
        if any("Recording.h" in f.read_text() for f in sources + list(d.glob("dsp/*.h"))):
            extra.append(str(PATCH / "engine/Recording.cpp"))  # the client over the bleep_record_* imports (module-abi.md 5b)
        cmd = (["emcc"] + flags + [f"-I{tmp}"] + [f"-I{i}" for i in include_dirs] + extra
               + [str(PATCH / "web/src/WebShim.cpp")] + [str(s) for s in sources]
               + ["-o", str(target)])
        # What the result depends on besides file contents: flags, sources, the generated header.
        # The checkout's path is left out and the compiler's version is in: a cached build is reused in another checkout
        # (the dev build keeps the output between runs), but not after an update of Emscripten.
        key = hashlib.sha256(json.dumps([[c.replace(str(ROOT), "") for c in cmd if c != f"-I{tmp}"], header.read_text() if fns else "",
                                         _emcc_version()], default=str).encode()).hexdigest()
        cache_file = out / ".cache" / f"{d.name}.json"
        if not force and _up_to_date(cache_file, key, target):
            return d.name, target, "up to date"
        depfile = Path(tmp) / "deps.d"
        r = subprocess.run(cmd + ["-MMD", "-MF", str(depfile)], capture_output=True, text=True)
        if r.returncode != 0:
            target.unlink(missing_ok=True)
            cache_file.unlink(missing_ok=True)
            lines = [l for l in r.stderr.splitlines() if "error" in l]
            return d.name, None, (lines[0] if lines else r.stderr[-300:]).strip()
        _write_cache(cache_file, key, depfile)
        return d.name, target, ""


class Progress:
    """`[#####-----] 12/40 name` on one line when attached to a terminal, a log line per module otherwise.
    Modules that were up to date only advance the bar."""

    def __init__(self, total):
        self.total, self.n, self.tty = total, 0, sys.stdout.isatty()
        self.t0 = time.monotonic()
        self.skipped = 0
        self._draw("")

    def _draw(self, name):
        if self.tty:
            width = shutil.get_terminal_size().columns
            fill = round(24 * self.n / max(self.total, 1))
            line = f"[{'#' * fill}{'-' * (24 - fill)}] {self.n}/{self.total} {int(time.monotonic() - self.t0)}s {name}"
            print("\r\033[K" + line[: width - 1], end="", flush=True)

    def done(self, name, message):
        self.n += 1
        if message is None:
            self.skipped += 1
        elif self.tty:
            print("\r\033[K" + message)
        else:
            print(message, flush=True)
        self._draw(name)

    def finish(self):
        if self.tty:
            print("\r\033[K", end="")
        print(f"{self.total} modules in {int(time.monotonic() - self.t0)}s ({self.skipped} up to date)", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="")
    ap.add_argument("--juce", default="", help="JUCE 8 checkout: builds the modules that use juce_core")
    ap.add_argument("--force", action="store_true", help="rebuild every module")
    ap.add_argument("-j", type=int, default=8)
    a = ap.parse_args()
    out = Path(a.out)
    only = set(filter(None, a.only.split(",")))
    dirs = module_dirs(only)
    include_dirs = [PATCH / "engine", PATCH / "common"] + [d / "dsp" for d in module_dirs(set()) if (d / "dsp").is_dir()]
    if a.juce and any(uses_juce(d) for d in dirs) and not (out / ".juce" / "juce_core.o").exists():
        print("Compiling juce_core for WebAssembly (once)...", flush=True)
    juce = build_juce_core(a.juce, out) if a.juce and any(uses_juce(d) for d in dirs) else None
    manifest = {"modules": {}, "types": {}, "unavailable": {}}
    progress = Progress(len(dirs))
    with concurrent.futures.ThreadPoolExecutor(a.j) as pool:
        futures = [pool.submit(build, d, out, include_dirs, juce, a.force) for d in dirs]
        for f in concurrent.futures.as_completed(futures):
            slug, wasm, err = f.result()
            if wasm is None:
                manifest["unavailable"][slug] = err
                progress.done(slug, f"  skip  {slug}: {err}")
                continue
            manifest["modules"][slug] = {"file": f"modules/{slug}.wasm", "bytes": wasm.stat().st_size, "types": [],
                                         "built": time.strftime("%Y-%m-%d %H:%M", time.localtime(wasm.stat().st_mtime))}   # when it was last compiled
            if is_script(MODULES / slug):   # the board lists its node types from this (no demo-types.json entry), and shows its UI, help and source
                entry = manifest["modules"][slug]
                entry["spec"] = json.loads((out / ".cache" / f"{slug}.spec.json").read_text())
                entry["script"] = {k: f"modules/{slug}.{ext}" for k, ext in (("view", "view.js"), ("source", "dsp.ts"), ("help", "md")) if (out / "modules" / f"{slug}.{ext}").is_file()}
            progress.done(slug, None if err else f"  built {slug} ({wasm.stat().st_size // 1024} KB)")
    progress.finish()
    old = out / "manifest.json"
    if only and old.exists():  # keep the modules this run did not touch
        prev = json.loads(old.read_text())
        for slug, entry in prev.get("modules", {}).items():
            if slug not in manifest["modules"] and slug not in only and (out / entry["file"]).exists():
                manifest["modules"][slug] = entry
        for slug, why in prev.get("unavailable", {}).items():
            if slug not in only and slug not in manifest["unavailable"] and slug not in manifest["modules"]:
                manifest["unavailable"][slug] = why
    # The node types of each file come from the file itself.
    node = subprocess.run(["node", "--experimental-wasm-exnref", str(PATCH / "web/test/list-types.mjs"), str(out)], capture_output=True, text=True)
    if node.returncode != 0:
        sys.exit(node.stderr or f"list-types.mjs failed with exit {node.returncode}" + (" (killed: out of memory, give Docker more)" if node.returncode in (-9, 137) else ""))
    for slug, specs in json.loads(node.stdout).items():
        if slug not in manifest["modules"]:
            continue  # left over from an earlier, wider build
        types = [s["type"] for s in specs]
        manifest["modules"][slug]["types"] = types
        manifest["modules"][slug]["spec"] = specs  # the board lists its node types from the modules it loads, not from a file that can go stale
        for t in types:
            manifest["types"][t] = slug
    manifest["modules"] = dict(sorted(manifest["modules"].items()))
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"{len(manifest['modules'])} built, {len(manifest['unavailable'])} unavailable")


if __name__ == "__main__":
    main()
