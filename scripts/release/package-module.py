#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Packages board modules as .bleepmod files for the Bleep Store (doc/specs/store.md section 4.1).

    scripts/release/package-module.py                       every module that has a built .wasm
    scripts/release/package-module.py reverb filter         just these
    scripts/release/package-module.py --out DIR --web DIR   other folders (defaults: build/store/modules, build/web/modules)
    scripts/release/package-module.py --install DATA --kit KIT [--version 0.1.0]
                                                            also sign each package with the kit and put it into DATA/modules/local,
                                                            the folder the apps read modules copied by hand from (for tests and development)

A package is a zip of: module.json (the module folder's, plus `types`, `requires.engineAbi`, and the `summary` and `category` of the store's tile), module.wasm (built by
scripts/build/build-web.sh --modules-only), spec.json (the node types' descriptions, read from the .wasm with node: a host
lists a module's node types from it without compiling the module), the module's view scripts (ui/*.js) and its docs
(doc/*.md, *.png), and its LICENSE when it has one. `license` (default MIT) and `origin` (the code it is ported from) stay in module.json.
The version is not in the package: the store counts it, so the content hash says whether the code changed.

Before packaging, the .wasm is checked against doc/specs/module-abi.md: only the allowed imports, and every export of the
ABI present. The zip is reproducible (sorted files, fixed dates), so packaging the same inputs twice gives the same bytes.
"""
import argparse
import json
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "website" / "api"))
from app import signing  # noqa: E402

ENGINE_ABI = 1

# doc/specs/module-abi.md, section 2 (imports) and 4 (exports)
ALLOWED_IMPORTS = {
    ("env", "emscripten_notify_memory_growth"),
    ("env", "bleep_media_info"), ("env", "bleep_media_read"),  # sample files, answered by the host (module-abi.md, "Media")
    *(("wasi_snapshot_preview1", n) for n in ("fd_close", "fd_read", "fd_seek", "fd_write", "environ_get", "environ_sizes_get", "clock_time_get")),
}
REQUIRED_EXPORTS = {
    "memory", "_initialize", "bleep_error", "bleep_spec_json", "bleep_spec_json_length", "bleep_type_count", "bleep_chunk", "bleep_create",
    "bleep_destroy", "bleep_reset", "bleep_params_ptr", "bleep_inputs_ptr", "bleep_outputs_ptr", "bleep_in_connected_ptr",
    "bleep_out_connected_ptr", "bleep_set_knob", "bleep_set_transport", "bleep_process", "bleep_notes_in_ptr", "bleep_notes_out_ptr",
    "bleep_note_event_size", "bleep_scratch", "bleep_text", "bleep_text_length", "bleep_set_data", "bleep_sanitise_data", "bleep_perform",
    "bleep_command", "bleep_live", "bleep_param_text", "bleep_output_display", "bleep_take_data",
}
ZIP_DATE = (2020, 1, 1, 0, 0, 0)


# ---- the .wasm file: just enough of the binary format to read imports and exports -------------

def _leb(data: bytes, pos: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        b = data[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, pos
        shift += 7


def _name(data: bytes, pos: int) -> tuple[str, int]:
    n, pos = _leb(data, pos)
    return data[pos:pos + n].decode(), pos + n


def read_wasm(data: bytes) -> tuple[list[tuple[str, str]], list[str]]:
    """(imports as (module, name), export names) of a WebAssembly binary. Raises ValueError for anything that is not one."""
    if data[:8] != b"\0asm\x01\0\0\0":
        raise ValueError("not a WebAssembly 1.0 binary")
    imports: list[tuple[str, str]] = []
    exports: list[str] = []
    pos = 8
    while pos < len(data):
        sid = data[pos]
        size, pos = _leb(data, pos + 1)
        end = pos + size
        if sid == 2:
            count, p = _leb(data, pos)
            for _ in range(count):
                mod, p = _name(data, p)
                name, p = _name(data, p)
                kind = data[p]
                p += 1
                if kind == 0:                      # function: type index
                    _, p = _leb(data, p)
                elif kind == 1:                    # table: element type, limits
                    p += 1
                    flags, p = _leb(data, p)
                    _, p = _leb(data, p)
                    if flags & 1:
                        _, p = _leb(data, p)
                elif kind == 2:                    # memory: limits
                    flags, p = _leb(data, p)
                    _, p = _leb(data, p)
                    if flags & 1:
                        _, p = _leb(data, p)
                elif kind == 3:                    # global: type, mutability
                    p += 2
                elif kind == 4:                    # tag: attribute, type index
                    p += 1
                    _, p = _leb(data, p)
                else:
                    raise ValueError(f"unknown import kind {kind}")
                imports.append((mod, name))
        elif sid == 7:
            count, p = _leb(data, pos)
            for _ in range(count):
                name, p = _name(data, p)
                p += 1
                _, p = _leb(data, p)
                exports.append(name)
        pos = end
    return imports, exports


def check_abi(data: bytes) -> list[str]:
    """What is wrong with this module file under doc/specs/module-abi.md (empty: nothing)."""
    try:
        imports, exports = read_wasm(data)
    except (ValueError, IndexError) as e:
        return [f"cannot read the file: {e}"]
    problems = [f"imports {m}.{n}, which the ABI does not allow" for m, n in imports if (m, n) not in ALLOWED_IMPORTS]
    problems += [f"does not export {n}" for n in sorted(REQUIRED_EXPORTS - set(exports))]
    return problems


# ---- the package ------------------------------------------------------------------------------

def spec_json(wasm_file: Path) -> str:
    """The module's own description of its node types, as one line of JSON (patch/web/test/spec-json.mjs)."""
    r = subprocess.run(["node", "--experimental-wasm-exnref", str(ROOT / "patch" / "web" / "test" / "spec-json.mjs"), str(wasm_file)], capture_output=True, text=True)
    if r.returncode != 0:
        raise ValueError("cannot read the node types out of the .wasm: " + (r.stderr.strip().splitlines() or ["node failed"])[-1])
    return r.stdout.strip()


def collect(folder: Path, wasm: bytes, spec: str) -> dict[str, bytes]:
    """The files of a module's package: {path inside the zip: bytes}. `spec` is spec_json()."""
    described = json.loads(spec)
    types = [t["type"] for t in described]
    meta = json.loads((folder / "module.json").read_text())
    meta["types"] = types
    # What the store's tile shows: the module's tagline and category, else those of its first node type.
    meta["summary"] = meta.get("tagline") or described[0].get("description", "")
    meta.setdefault("category", described[0].get("category", ""))
    meta["requires"] = {"engineAbi": ENGINE_ABI}
    # Licence and provenance travel with the package (patch/modules/README.md, "Ported code and licences").
    meta.setdefault("license", "MIT")
    origin = meta.get("origin")
    if origin:
        meta["summary"] = f"{meta['summary'].rstrip()} Based on {origin['name']} by {origin['author']} ({origin['license']})."
    files = {"module.json": (json.dumps(meta, indent=1, ensure_ascii=False) + "\n").encode(), "module.wasm": wasm, "spec.json": (spec + "\n").encode()}
    if (folder / "LICENSE").is_file():
        files["LICENSE"] = (folder / "LICENSE").read_bytes()
    for sub, suffixes in (("ui", (".js",)), ("doc", (".md", ".png"))):
        for f in sorted((folder / sub).glob("*")) if (folder / sub).is_dir() else []:
            if f.suffix in suffixes:
                files[f"{sub}/{f.name}"] = f.read_bytes()
    return files


def write_zip(files: dict[str, bytes], out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for path in sorted(files, key=lambda p: p.encode()):
            info = zipfile.ZipInfo(path, ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, files[path], compresslevel=9)


def entries_of(files: dict[str, bytes]) -> dict[str, tuple[bytes, bool]]:
    import hashlib
    return {p: (hashlib.sha256(c).digest(), False) for p, c in files.items()}


def package(slug: str, web: Path, out: Path) -> tuple[Path, str]:
    """Writes out/<slug>.bleepmod; returns it and its content hash (hex). Raises ValueError with the reason if it cannot."""
    folder = ROOT / "patch" / "modules" / slug
    if not (folder / "module.json").exists():
        raise ValueError("no such module folder")
    wasm_file = web / "modules" / f"{slug}.wasm"
    if not wasm_file.exists():
        raise ValueError(f"no built {wasm_file.relative_to(ROOT) if wasm_file.is_relative_to(ROOT) else wasm_file} (scripts/build/build-web.sh --modules-only)")
    wasm = wasm_file.read_bytes()
    problems = check_abi(wasm)
    if problems:
        raise ValueError("; ".join(problems))
    files = collect(folder, wasm, spec_json(wasm_file))
    target = out / f"{slug}.bleepmod"
    write_zip(files, target)
    return target, signing.content_digest(entries_of(files)).hex()


def install_local(package: Path, slug: str, data: Path, kit_file: Path | None, version: str) -> Path:
    """A signed copy of the package in DATA/modules/local/<slug>-<version>.bleepmod, the way a developer would copy a module by hand."""
    if kit_file is None:
        raise ValueError("--install needs --kit")
    import shutil
    kit = json.loads(kit_file.read_text())
    target = data / "modules" / "local" / f"{slug}-{version}.bleepmod"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(package, target)
    signing.write_doc(target, signing.sign_with_kit(signing.read_entries(target), kit, "module", slug, version))
    return target


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("modules", nargs="*", metavar="SLUG", help="module folders (default: every one with a built .wasm)")
    ap.add_argument("--out", type=Path, default=ROOT / "build" / "store" / "modules")
    ap.add_argument("--web", type=Path, default=ROOT / "build" / "web" / "modules", help="the output of build-web.sh --modules-only")
    ap.add_argument("--install", type=Path, metavar="DATA", help="also install the signed packages into DATA/modules/local")
    ap.add_argument("--kit", type=Path, help="the signing kit for --install")
    ap.add_argument("--version", default="0.1.0", help="the version --install signs for (it is part of the file name)")
    a = ap.parse_args(argv)
    slugs = a.modules or sorted(p.parent.name for p in (ROOT / "patch" / "modules").glob("*/module.json"))
    failed = 0
    print(f"{'module':22} {'KB':>6}  types  content hash")
    for slug in slugs:
        try:
            target, digest = package(slug, a.web, a.out)
        except ValueError as e:
            print(f"{slug:22} FAILED: {e}", file=sys.stderr)
            failed += 1
            continue
        if a.install:
            try:
                install_local(target, slug, a.install, a.kit, a.version)
            except (ValueError, OSError) as e:
                print(f"{slug:22} NOT INSTALLED: {e}", file=sys.stderr)
                failed += 1
                continue
        n = len(json.loads(zipfile.ZipFile(target).read("module.json"))["types"])
        print(f"{slug:22} {target.stat().st_size / 1024:6.1f}  {n:5}  {digest[:16]}")
    print(f"{len(slugs) - failed} packaged into {a.out}" + (f", {failed} failed" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
