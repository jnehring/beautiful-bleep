#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Packages board modules as .bleepmod files for the Bleep Library (website/content/developers/modules/library.md section 4.1).

    scripts/release/package-module.py                       every module that has a built .wasm
    scripts/release/package-module.py reverb filter         just these
    scripts/release/package-module.py --out DIR --web DIR   other folders (defaults: build/library/modules, build/web/modules, else build/web/site)
    scripts/release/package-module.py --install DATA [--version 0.1.0 | --dev]
                                                            also put each package into DATA/modules/local,
                                                            the folder the apps read modules copied by hand from (for tests and development);
                                                            --dev names each one after the next version of what the library has, e.g. 0.1.4-dev

A package is a zip of: module.json (the module folder's, plus `types`, `requires.engineAbi`, and the `summary` and `category` of the library's tile), module.wasm (built by
scripts/build/build-web.sh --modules-only), spec.json (the node types' descriptions, read from the .wasm with node: a host
lists a module's node types from it without compiling the module), the module's view scripts (ui/*.js; for a module written in Bleep Script
its UI as view.sandbox.js and its source as source.dsp.ts) and its docs
(doc/*.md, *.png), and its LICENSE when it has one. `license` (default MIT) and `origin` (the code it is ported from) stay in module.json.
The version is not in the package: the library counts it, so the content hash says whether the code changed.

Before packaging, the .wasm is checked against website/content/developers/modules/module-abi.md: only the allowed imports, and every export of the
ABI present. The zip is reproducible (sorted files, fixed dates), so packaging the same inputs twice gives the same bytes.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "website" / "api"))
# the ABI checks are shared with the library's community upload (website/api/app/community.py), so both apply the same rules
from app.community import ALLOWED_IMPORTS, REQUIRED_EXPORTS, check_abi, read_wasm  # noqa: E402,F401

ENGINE_ABI = 1

ZIP_DATE = (2020, 1, 1, 0, 0, 0)


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
    # What the library's tile shows: the module's tagline and category, else those of its first node type.
    meta["summary"] = meta.get("tagline") or described[0].get("description", "")
    meta.setdefault("category", described[0].get("category", ""))
    meta["requires"] = {"engineAbi": ENGINE_ABI}
    # Licence and provenance travel with the package (website/content/developers/modules/writing-a-module.md, "Ported code and licences").
    meta.setdefault("license", "MIT")
    origin = meta.get("origin")
    if origin:
        meta["summary"] = f"{meta['summary'].rstrip()} Based on {origin['name']} by {origin['author']} ({origin['license']})."
    files = {"module.json": (json.dumps(meta, indent=1, ensure_ascii=False) + "\n").encode(), "module.wasm": wasm, "spec.json": (spec + "\n").encode()}
    if (folder / "LICENSE").is_file() and not (folder / "LICENSE").is_symlink():
        files["LICENSE"] = (folder / "LICENSE").read_bytes()
    if meta.get("language") == "bleep-script":
        # A module written in Bleep Script brings its own UI (it runs only in the sandboxed worker frame, never in the page) and its source, which
        # anyone can open in a Code node ("Convert to code").
        for name, packaged in ((f"{folder.name}.view.js", "view.sandbox.js"), (f"{folder.name}.dsp.ts", "source.dsp.ts")):
            f = folder / name
            if f.is_file() and not f.is_symlink():
                files[packaged] = f.read_bytes()
    for sub, suffixes in (("ui", (".js",)), ("doc", (".md", ".png"))):
        for f in sorted((folder / sub).glob("*")) if (folder / sub).is_dir() else []:
            if f.suffix in suffixes and f.is_file() and not f.is_symlink():  # a link could pull a file from elsewhere into the package
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


DEFAULT_WEB = ROOT / "build" / "web" / "modules"  # build-web.sh --modules-only
DEFAULT_SITE = ROOT / "build" / "web" / "site"    # build-web.sh


def package(slug: str, web: Path, out: Path) -> tuple[Path, str]:
    """Writes out/<slug>.bleepmod; returns it and its sha256 (hex). Raises ValueError with the reason if it cannot."""
    folder = ROOT / "patch" / "modules" / slug
    if not (folder / "module.json").exists():
        raise ValueError("no such module folder")
    wasm_file = web / "modules" / f"{slug}.wasm"
    if not wasm_file.exists() and web == DEFAULT_WEB:  # a full build-web.sh keeps its .wasm files in the site folder
        wasm_file = DEFAULT_SITE / "modules" / f"{slug}.wasm"
    if not wasm_file.exists():
        raise ValueError(f"no built {wasm_file.relative_to(ROOT) if wasm_file.is_relative_to(ROOT) else wasm_file} (scripts/build/build-web.sh --modules-only)")
    wasm = wasm_file.read_bytes()
    problems = check_abi(wasm)
    if problems:
        raise ValueError("; ".join(problems))
    files = collect(folder, wasm, spec_json(wasm_file))
    target = out / f"{slug}.bleepmod"
    write_zip(files, target)
    return target, hashlib.sha256(target.read_bytes()).hexdigest()


def stamp_doc(md: str, version: str, built: str) -> str:
    """The doc with "Version V · built DATE" under its title (at the top when it has none)."""
    line = f"*Version {version} · built {built}*"
    title, _, rest = md.partition("\n") if md.startswith("# ") else ("", "", md)
    body = f"\n\n{rest.lstrip(chr(10))}" if rest.strip() else "\n"
    return f"{title}\n\n{line}{body}" if title else f"{line}{body}"


def install_local(package: Path, slug: str, data: Path, version: str) -> Path:
    """DATA/modules/local/<slug>-<version>.bleepmod, the way a developer would copy a module by hand. The copy's docs say which version it is and
    when it was built; the package in the output folder stays reproducible, without either."""
    import datetime
    target = data / "modules" / "local" / f"{slug}-{version}.bleepmod"
    target.parent.mkdir(parents=True, exist_ok=True)
    built = datetime.date.today().isoformat()
    with zipfile.ZipFile(package) as z:
        files = {n: z.read(n) for n in z.namelist()}
    for n in files:
        if n.startswith("doc/") and n.endswith(".md"):
            files[n] = stamp_doc(files[n].decode(), version, built).encode()
    write_zip(files, target)
    return target


def published_version(slug: str, data: Path) -> tuple:
    """The highest version of the module the library offers or this machine installed from it, as a tuple (0, 0, 0) when neither."""
    found = [(0, 0, 0)]
    def add(v):
        if "-dev" in str(v):  # a development build is not what a development build is counted from
            return
        parts = str(v).split("-")[0].split(".")
        if len(parts) == 3 and all(p.isdigit() for p in parts):
            found.append(tuple(int(p) for p in parts))
    for d in (data / "modules" / "registry" / slug).glob("*"):
        add(d.name)
    try:
        for channel in json.loads((data / "cache" / "index.json").read_text())["index"]["channels"].values():
            add(channel["modules"][slug]["version"])
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return max(found)


def dev_version(slug: str, data: Path) -> str:
    """The next version after the published one, marked as a development build made now: 0.1.3 becomes 0.1.4-dev.202610271432, the time
    it was made (a module the library does not have: 0.1.0-dev.…). The CI's builds of the dev channel are numbered the same way, so the
    later build is the newer."""
    import datetime
    a, b, c = published_version(slug, data)
    built = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M")
    return f"0.1.0-dev.{built}" if (a, b, c) == (0, 0, 0) else f"{a}.{b}.{c + 1}-dev.{built}"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("modules", nargs="*", metavar="SLUG", help="module folders (default: every one with a built .wasm)")
    ap.add_argument("--out", type=Path, default=ROOT / "build" / "library" / "modules")
    ap.add_argument("--web", type=Path, default=DEFAULT_WEB, help="the output of build-web.sh --modules-only (default: build/web/modules, else the full build's build/web/site)")
    ap.add_argument("--install", type=Path, metavar="DATA", help="also install the packages into DATA/modules/local")
    ap.add_argument("--version", default="0.1.0", help="the version --install names the file with")
    ap.add_argument("--dev", action="store_true", help="with --install: the next version after the library's, as a development build made now (0.1.4-dev.202610271432); older -dev copies of the module are removed")
    a = ap.parse_args(argv)
    slugs = a.modules or sorted(p.parent.name for p in (ROOT / "patch" / "modules").glob("*/module.json"))
    failed = 0
    version = ""
    print(f"{'module':22} {'KB':>6}  types  sha256            version")
    for slug in slugs:
        try:
            target, digest = package(slug, a.web, a.out)
        except ValueError as e:
            print(f"{slug:22} FAILED: {e}", file=sys.stderr)
            failed += 1
            continue
        if a.install:
            try:
                version = dev_version(slug, a.install) if a.dev else a.version
                if a.dev:
                    for old in (a.install / "modules" / "local").glob(f"{slug}-*-dev*.bleepmod"):
                        if re.fullmatch(re.escape(slug) + r"-\d+\.\d+\.\d+-dev(\.\d{12})?\.bleepmod", old.name):
                            old.unlink()
                install_local(target, slug, a.install, version)
            except (ValueError, OSError) as e:
                print(f"{slug:22} NOT INSTALLED: {e}", file=sys.stderr)
                failed += 1
                continue
        n = len(json.loads(zipfile.ZipFile(target).read("module.json"))["types"])
        print(f"{slug:22} {target.stat().st_size / 1024:6.1f}  {n:5}  {digest[:16]}  {version if a.install else ''}")
    print(f"{len(slugs) - failed} packaged into {a.out}" + (f", {failed} failed" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
