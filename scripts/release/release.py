#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Releases plugins to the Bleep registry.

    scripts/release/release.py bleep-board --level 1.x --registry http://localhost:8080
    scripts/release/release.py --all --level patch --registry https://registry.example --dry-run
    scripts/release/release.py --list

What it does, per plugin: finds the build in build/patch (run scripts/build/build-patch.sh first, or
pass --build), asks the store for the published versions, counts the next version at the
level you ask for, zips the build, uploads it and publishes it. A release is one machine's
build: the zip is named for this platform. Versions are immutable, but a published version can gain
builds for platforms it lacks: build on the other machine and run
    scripts/release/release.py --all --add-platform 0.1.0 --registry ...   (or "latest": each plugin's newest version)
The store refuses a platform the version already has; existing files never change.

Levels (what is counted up; the rest of the number is kept):
    x      next major                  1.4.2 -> 2.0.0
    1.x    next minor within major 1   1.4.2 -> 1.5.0
    1.4.x  next patch within 1.4       1.4.2 -> 1.4.3
    major | minor | patch              the same, counted from the newest published version
With nothing published yet, x, 0.x and 0.0.x all give 0.1.0; 1.x gives 1.0.0.

Registry URL: --registry or $BLEEP_REGISTRY_URL (the website's address; the API is under /api).
Modules: `release.py --modules --level patch` releases the packaged modules (build/store/modules, made by
package-module.py; `--package` makes them first). Each module counts its own version; one whose content did not change
since its newest published version is skipped, so only what changed is released.

Signing: every release file is signed with the developer's signing kit (--kit, or $BLEEP_SIGNING_KIT; website/content/developers/modules/signing.md;
an admin makes one with `python -m app.cli developer-create`). The kit is checked against the store's root keys before anything
is uploaded, and the store checks every signature again: without a valid key the release fails.
Token: a release token an admin created with
    docker compose exec api python -m app.cli token-create NAME
read from $BLEEP_RELEASE_TOKEN or --token-file. It is never accepted as an argument, which would
land in the shell history. --dry-run needs no token.
"""
import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "website" / "api"))
from app import signing  # noqa: E402

def store_config() -> dict:
    """config/store.json: where the store is and whom it trusts, the one place the apps' build and these scripts read."""
    try:
        return json.loads((ROOT / "config" / "store.json").read_text())
    except (OSError, ValueError):
        return {}


def pinned_roots() -> list[bytes]:
    """The root keys this release trusts: rootKeys of config/store.json (plus $BLEEP_STORE_ROOTS, hex, comma separated), the same
    ones the apps are built with. They are never taken from the registry being published to: a registry that names its own root
    could accept anything."""
    keys = list(store_config().get("rootKeys") or [])
    keys += [k.strip() for k in os.environ.get("BLEEP_STORE_ROOTS", "").split(",") if k.strip()]
    try:
        roots = [bytes.fromhex(k) for k in keys]
    except ValueError:
        raise SystemExit("release: a root key in config/store.json or $BLEEP_STORE_ROOTS is not hex")
    if not roots or any(len(r) != 32 for r in roots):
        raise SystemExit("release: no (valid) rootKeys in config/store.json; the signing kit cannot be checked without pinned roots")
    return roots


# slug -> (title, artefact path under the build dir; {cfg} = build configuration)
PLUGINS = {
    "bleep-board": ("Bleep Board (VST3)", "BleepBoard_artefacts/{cfg}/VST3/Bleep Board.vst3"),
    "bleep-midi-in": ("Bleep MIDI In (VST3)", "BleepMidiIn_artefacts/{cfg}/VST3/Bleep MIDI In.vst3"),
    "bleep-midi-out": ("Bleep MIDI Out (VST3)", "BleepMidiOut_artefacts/{cfg}/VST3/Bleep MIDI Out.vst3"),
    "bleep-audio-in": ("Bleep Audio In (VST3)", "BleepAudioIn_artefacts/{cfg}/VST3/Bleep Audio In.vst3"),
    "bleep-audio-out": ("Bleep Audio Out (VST3)", "BleepAudioOut_artefacts/{cfg}/VST3/Bleep Audio Out.vst3"),
    "bleep-instrument": ("Bleep Instrument (VST3)", "BleepInstrument_artefacts/{cfg}/VST3/Bleep Instrument.vst3"),
    "bleep-fx": ("Bleep FX (VST3)", "BleepFx_artefacts/{cfg}/VST3/Bleep FX.vst3"),
    "bleep-app": ("Bleep App (standalone app)", "BleepApp_artefacts/{cfg}/Bleep App.app"),
}


# slug -> (what the store's tile says, its category); the plugins' screenshots are doc/store/<slug>.png when there is one
PLUGIN_TILES = {
    "bleep-board": ("The Beautiful Bleep board as a plugin: build instruments and effects from modules, inside your DAW.", "Plugins"),
    "bleep-midi-in": ("Brings MIDI from your DAW onto a Bleep board, as a port.", "Ports"),
    "bleep-midi-out": ("Sends MIDI from a Bleep board back to your DAW, as a port.", "Ports"),
    "bleep-audio-in": ("Brings audio from a DAW track onto a Bleep board, as a port.", "Ports"),
    "bleep-audio-out": ("Sends audio from a Bleep board back to a DAW track, as a port.", "Ports"),
    "bleep-instrument": ("A Bleep board played as an instrument: MIDI in, audio out.", "Plugins"),
    "bleep-fx": ("A Bleep board as an effect: audio in, audio out.", "Plugins"),
    "bleep-app": ("Bleep App is the standalone app, with the Bleep Store to install modules and plugins.", "Apps"),
}


# What the store's detail view says about a plugin's licence: the sources are MIT, but the binaries are built with JUCE
# (AGPLv3, or a commercial JUCE licence: change this if you hold one), and the app includes Ableton Link (GPL), doc/operations/release.md.
PLUGIN_LICENSES = {"bleep-app": "GPL-3.0-or-later AND AGPL-3.0-only"}
PLUGIN_LICENSE_DEFAULT = "AGPL-3.0-only"


def image_type(data: bytes) -> str:
    return "image/png" if data.startswith(b"\x89PNG") else "image/jpeg" if data.startswith(b"\xff\xd8") else "image/webp"


def plugin_image(slug: str) -> bytes | None:
    f = ROOT / "doc" / "store" / f"{slug}.png"
    return f.read_bytes() if f.exists() else None


def module_image(pkg: Path, slug: str) -> bytes | None:
    """The screenshot in a module package: doc/<slug>.png, else the first doc/*.png."""
    with zipfile.ZipFile(pkg) as z:
        pngs = sorted(n for n in z.namelist() if n.startswith("doc/") and n.endswith(".png"))
        pick = f"doc/{slug}.png" if f"doc/{slug}.png" in pngs else (pngs[0] if pngs else None)
        return z.read(pick) if pick else None


# ---- versions -----------------------------------------------------------------

def parse_version(v: str) -> tuple[int, int, int]:
    m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", v)
    if not m:
        raise ValueError(f"not a version: {v!r}")
    return int(m[1]), int(m[2]), int(m[3])


def next_version(level: str, published: list[str]) -> str:
    """The next version at `level` (see the module doc) given the published versions."""
    have = sorted(parse_version(v) for v in published)
    if level in ("major", "minor", "patch"):
        if not have:
            return "0.1.0"
        top = have[-1]
        level = {"major": "x", "minor": f"{top[0]}.x", "patch": f"{top[0]}.{top[1]}.x"}[level]
    parts = level.split(".")
    if not 1 <= len(parts) <= 3 or parts[-1] != "x" or not all(p.isdigit() for p in parts[:-1]):
        raise ValueError(f"bad level {level!r}: use x, 1.x, 1.4.x, major, minor or patch")
    prefix = tuple(int(p) for p in parts[:-1])
    matching = [v for v in have if v[: len(prefix)] == prefix]
    counted = max(v[len(prefix)] for v in matching) + 1 if matching else 0
    version = (prefix + (counted,) + (0, 0))[:3]
    return "0.1.0" if version == (0, 0, 0) else ".".join(map(str, version))


# ---- store API -------------------------------------------------------------

class RegistryError(Exception):
    pass


class Registry:
    def __init__(self, url: str, token: str | None):
        parts = urllib.parse.urlsplit(url)
        if parts.scheme != "https" and not (parts.scheme == "http" and parts.hostname in ("localhost", "127.0.0.1", "::1")):
            raise RegistryError(f"{url}: the registry must be https (plain http only for localhost): the token would travel in the clear")
        self.site = url.rstrip("/")
        self.base = self.site + "/api/registry"
        self.token = token

    def _request(self, method: str, path: str, body=None, data=None, length=None, content_type=None):
        headers = {}
        if content_type:
            headers["Content-Type"] = content_type
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if body is not None:
            data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
        if length is not None:
            headers["Content-Length"] = str(length)
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            try:
                detail = json.loads(detail)["detail"]
            except (ValueError, KeyError, TypeError):
                pass
            raise RegistryError(f"{method} {path}: {e.code} {detail}") from None
        except urllib.error.URLError as e:
            raise RegistryError(f"cannot reach {self.base}: {e.reason}") from None

    def check_token(self) -> None:
        self._request("GET", "/token")

    def versions(self, slug: str, kind: str = "plugin") -> list[str]:
        return [v["version"] for v in self._request("GET", f"/{kind}/{slug}/versions")]

    def entry(self, slug: str, version: str, kind: str = "plugin") -> dict | None:
        """The published entry.json of a release (what clients read), or None if there is none."""
        try:
            with urllib.request.urlopen(f"{self.site}/registry/v1/{kind}s/{slug}/{version}/entry.json") as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise RegistryError(f"GET entry.json of {slug} {version}: {e.code}") from None
        except urllib.error.URLError as e:
            raise RegistryError(f"cannot reach {self.site}: {e.reason}") from None

    def release(self, slug: str, version: str, channel: str, title: str, notes: str, files: list[dict], kind: str = "plugin",
                summary: str = "", category: str = "", image: bytes | None = None,
                license: str = "", origin: dict | None = None) -> None:
        """`summary`, `category` and `image` (a PNG, JPEG or WebP, up to 1 MB) are what the store's tile shows."""
        base = f"/{kind}/{slug}/releases"
        self._request("POST", base, {"version": version, "channel": channel, "title": title, "notes": notes, "summary": summary,
                                     "category": category, "license": license, "origin": origin or None,
                                     "files": [f["declaration"] for f in files]})
        self._upload(base, version, files)
        if image:
            self._request("PUT", f"{base}/{version}/image", data=image, length=len(image), content_type=image_type(image))
        self._request("POST", f"{base}/{version}/publish")

    def add_platform(self, slug: str, version: str, files: list[dict]) -> None:
        """Adds this machine's build to a published release (the store refuses a platform it already has)."""
        base = f"/plugin/{slug}/releases/{version}"
        self._request("POST", f"{base}/platforms", {"files": [f["declaration"] for f in files]})
        self._upload(f"/plugin/{slug}/releases", version, files)

    def _upload(self, base: str, version: str, files: list[dict]) -> None:
        for f in files:
            z = f["path"]
            with z.open("rb") as fh:
                self._request("PUT", f"{base}/{version}/files/{f['declaration']['path']}", data=fh, length=z.stat().st_size)


# ---- packaging ----------------------------------------------------------------

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def platform_id() -> str:
    os_name = {"Darwin": "macos", "Windows": "windows", "Linux": "linux"}.get(platform.system(), platform.system().lower())
    arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x86_64", "AMD64": "x86_64"}.get(platform.machine(), platform.machine())
    return f"{os_name}-{arch}"


def find_artefact(slug: str, build_dir: Path, cfg: str) -> Path | None:
    path = build_dir / PLUGINS[slug][1].format(cfg=cfg)
    if path.exists():
        return path
    if slug == "bleep-app":  # Windows and Linux standalone builds have no .app
        for name in ("Bleep App.exe", "Bleep App"):
            alt = path.with_name(name)
            if alt.exists():
                return alt
    return None


def make_zip(src: Path, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.unlink(missing_ok=True)
    if platform.system() == "Darwin":  # keeps symlinks, permissions and code signatures inside bundles
        subprocess.run(["ditto", "-c", "-k", "--keepParent", str(src), str(out)], check=True)
        return
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        if src.is_dir():
            for f in sorted(src.rglob("*")):
                z.write(f, Path(src.name) / f.relative_to(src))
        else:
            z.write(src, src.name)


def load_kit(path: str | None) -> dict | None:
    path = path or os.environ.get("BLEEP_SIGNING_KIT")
    return json.loads(Path(path).expanduser().read_text()) if path else None


def sign_file(zip_path: Path, slug: str, version: str, plat: str, kit: dict, roots: list[bytes]) -> dict:
    """The file's declaration for the store, signed with the kit and checked against the store's roots first."""
    sha = bytes.fromhex(sha256(zip_path))
    entries = signing.entries_for_file(zip_path.name, sha)
    doc = signing.sign_with_kit(entries, kit, "plugin", slug, version, plat)
    result = signing.verify(entries, doc, kind="plugin", id_=slug, version=version, platform=plat, roots=roots)
    if result.status != "signed":
        sys.exit(f"{slug}: the signing kit is not valid for this release: {result.status}: {result.reason or 'see website/content/developers/modules/signing.md'}")
    return {"path": zip_path, "declaration": {"path": zip_path.name, "sha256": sha.hex(), "bytes": zip_path.stat().st_size,
                                              "platform": plat, "signature": doc}}


def sign_package(pkg: Path, slug: str, version: str, kit: dict, roots: list[bytes]) -> dict:
    """The declaration of a module package: signed over the files inside it (the zip itself may be repacked)."""
    entries = signing.read_entries(pkg)
    doc = signing.sign_with_kit(entries, kit, "module", slug, version, "any")
    result = signing.verify(entries, doc, kind="module", id_=slug, version=version, platform="any", roots=roots)
    if result.status != "signed":
        sys.exit(f"{slug}: the signing kit is not valid for modules: {result.status}: {result.reason or 'see website/content/developers/modules/signing.md'}")
    return {"path": pkg, "declaration": {"path": f"{slug}-{version}.bleepmod", "sha256": sha256(pkg), "bytes": pkg.stat().st_size,
                                         "platform": "any", "contentDigest": signing.content_digest(entries).hex(), "signature": doc}}


def release_modules(args, registry: "Registry", kit: dict | None) -> int:
    pdir = args.packages
    if args.package:
        r = subprocess.run([sys.executable, str(ROOT / "scripts" / "release" / "package-module.py"), "--out", str(pdir), *args.plugins])
        if r.returncode != 0:
            return r.returncode
    available = sorted(p.stem for p in pdir.glob("*.bleepmod"))
    names = args.plugins or available
    missing = [n for n in names if n not in available]
    if missing or not names:
        sys.exit(f"no package for {', '.join(missing) or 'any module'} in {pdir} (scripts/release/package-module.py, or --package)")
    plan = []  # (slug, package, newest published, new version or None when unchanged)
    try:
        if registry.token:
            registry.check_token()
        roots = pinned_roots() if kit is not None else []
        for slug in names:
            pkg = pdir / f"{slug}.bleepmod"
            digest = signing.content_digest(signing.read_entries(pkg)).hex()
            published = sorted(registry.versions(slug, "module"), key=parse_version)
            newest = registry.entry(slug, published[-1], "module") if published else None
            same = newest is not None and any(f.get("contentDigest") == digest for f in newest["files"])
            plan.append((slug, pkg, published[-1] if published else None, None if same and not args.force else next_version(args.level, published)))
    except RegistryError as e:
        sys.exit(str(e))
    if kit is not None:
        probe = signing.entries_for_file("probe", b"\0" * 32)
        who = signing.verify(probe, signing.sign_with_kit(probe, kit, "module", names[0], "0.0.1", "any"), kind="module",
                             id_=names[0], version="0.0.1", platform="any", roots=roots)
        if who.status != "signed":
            sys.exit(f"The signing kit is not valid for modules: {who.status}: {who.reason or 'see website/content/developers/modules/signing.md'}")
        print(f"Signing as {who.publisher} (key {who.key_id})")
    todo = [p for p in plan if p[3]]
    print(f"Store {args.registry}, modules, channel {args.channel}, level {args.level}: {len(todo)} to release, {len(plan) - len(todo)} unchanged")
    for slug, pkg, old, new in plan:
        print(f"  {slug:22} {(old or 'none'):>8} -> {new or 'unchanged'}")
    if args.dry_run or not todo:
        print("Dry run: nothing uploaded." if args.dry_run else "Nothing to release.")
        return 0
    if not args.yes and input("Release these? [y/N] ").strip().lower() != "y":
        print("Cancelled.")
        return 1
    done = 0
    for slug, pkg, old, version in todo:
        try:
            meta = json.loads(zipfile.ZipFile(pkg).read("module.json"))
            registry.release(slug, version, args.channel, meta.get("name", slug), args.notes, [sign_package(pkg, slug, version, kit, roots)],
                             kind="module", summary=meta.get("summary", ""), category=meta.get("category", ""), image=module_image(pkg, slug),
                             license=meta.get("license", "MIT"), origin=meta.get("origin"))
        except RegistryError as e:
            print(f"  {slug} {version}: FAILED: {e}", file=sys.stderr)
            if done:
                print(f"  ({done} released before the failure; versions are immutable, so run again to release the rest)", file=sys.stderr)
            return 1
        done += 1
        print(f"  {slug} {old or 'none'} -> {version}: published ({pkg.stat().st_size / 1024:.0f} KB)")
    print(f"Index: {args.registry.rstrip('/')}/registry/v1/index.json")
    return 0


# ---- main ---------------------------------------------------------------------

def read_token(args: argparse.Namespace) -> str:
    if args.token_file:
        text = Path(args.token_file).expanduser().read_text()
        # token-create prints a sentence before the token; accept the raw output as saved.
        m = re.search(r"\bblp_\S+", text)
        return m.group(0) if m else text.strip()
    token = os.environ.get("BLEEP_RELEASE_TOKEN", "").strip()
    if not token:
        sys.exit("A release token is required: set BLEEP_RELEASE_TOKEN or pass --token-file "
                 "(an admin creates one with: docker compose exec api python -m app.cli token-create NAME)")
    return token


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0], epilog=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("plugins", nargs="*", metavar="PLUGIN", help="plugin ids: " + ", ".join(PLUGINS))
    ap.add_argument("--all", action="store_true", help="release every plugin")
    ap.add_argument("--list", action="store_true", help="list the plugins and exit")
    ap.add_argument("--modules", action="store_true", help="release packaged modules instead of plugins (names: module slugs; default: all)")
    ap.add_argument("--package", action="store_true", help="with --modules: run package-module.py first")
    ap.add_argument("--packages", type=Path, default=ROOT / "build" / "store" / "modules", help="where the .bleepmod packages are")
    ap.add_argument("--force", action="store_true", help="with --modules: release even if the content did not change")
    ap.add_argument("--level", help="x, 1.x, 1.4.x, major, minor or patch (required unless --add-platform)")
    ap.add_argument("--add-platform", metavar="VERSION|latest", help="add this machine's build to the published VERSION instead of releasing a new one")
    ap.add_argument("--registry", default=os.environ.get("BLEEP_REGISTRY_URL") or store_config().get("storeUrl"),
                    help="the website's URL (or $BLEEP_REGISTRY_URL; default: storeUrl of config/store.json)")
    ap.add_argument("--token-file", help="file holding the release token (or $BLEEP_RELEASE_TOKEN)")
    ap.add_argument("--kit", help="the developer's signing kit (or $BLEEP_SIGNING_KIT)")
    ap.add_argument("--channel", choices=("stable", "beta"), default="stable")
    ap.add_argument("--notes", default="", help="release notes")
    ap.add_argument("--build-dir", type=Path, default=ROOT / "build" / "patch")
    ap.add_argument("--config", default="Release", help="build configuration of the artefacts (default Release)")
    ap.add_argument("--build", action="store_true", help="run scripts/build/build-patch.sh --plugins-only first (no tests: the test targets compile every module in)")
    ap.add_argument("--dry-run", action="store_true", help="show what would be released; change nothing")
    ap.add_argument("-y", "--yes", action="store_true", help="do not ask for confirmation")
    args = ap.parse_args(argv)

    if args.list:
        for slug, (title, _) in PLUGINS.items():
            print(f"{slug:22} {title}")
        print(f"modules: {len(list(args.packages.glob('*.bleepmod')))} packaged in {args.packages} (--modules)")
        return 0
    if args.modules:
        if args.all:
            ap.error("--modules releases every packaged module unless you name some; --all is for plugins")
        if not args.level:
            ap.error("--level is required: x, 1.x, 1.4.x, major, minor or patch")
        if not args.registry:
            ap.error("--registry (or $BLEEP_REGISTRY_URL) is required")
        try:
            next_version(args.level, [])
        except ValueError as e:
            ap.error(str(e))
        registry = Registry(args.registry, None if args.dry_run else read_token(args))
        kit = load_kit(args.kit)
        if kit is None and not args.dry_run:
            sys.exit("A signing kit is required: pass --kit FILE or set $BLEEP_SIGNING_KIT (an admin makes one: python -m app.cli developer-create)")
        return release_modules(args, registry, kit)
    names = list(PLUGINS) if args.all else args.plugins
    if not names or (args.all and args.plugins):
        ap.error("name the plugins to release, or use --all")
    unknown = [n for n in names if n not in PLUGINS]
    if unknown:
        ap.error(f"unknown plugin(s): {', '.join(unknown)} (see --list)")
    if args.add_platform:
        if args.level:
            ap.error("--level and --add-platform are exclusive")
        try:
            if args.add_platform != "latest":
                parse_version(args.add_platform)
        except ValueError as e:
            ap.error(str(e))
    elif not args.level:
        ap.error("--level is required: x, 1.x, 1.4.x, major, minor or patch")
    if not args.registry:
        ap.error("--registry (or $BLEEP_REGISTRY_URL) is required")
    if args.level:
        try:
            next_version(args.level, [])
        except ValueError as e:
            ap.error(str(e))

    if args.build:
        subprocess.run([str(ROOT / "scripts" / "build" / "build-patch.sh"), "--plugins-only"], check=True)
    registry = Registry(args.registry, None if args.dry_run else read_token(args))
    kit = load_kit(args.kit)
    if kit is None and not args.dry_run:
        sys.exit("A signing kit is required: pass --kit FILE or set $BLEEP_SIGNING_KIT (an admin makes one: python -m app.cli developer-create)")

    plan = []
    try:
        if registry.token:
            registry.check_token()
        for slug in names:
            artefact = find_artefact(slug, args.build_dir, args.config)
            if artefact is None:
                sys.exit(f"{slug}: no build at {args.build_dir / PLUGINS[slug][1].format(cfg=args.config)} (run scripts/build/build-patch.sh, or pass --build)")
            published = registry.versions(slug)
            if args.add_platform:
                target = max(published, key=parse_version) if args.add_platform == "latest" and published else args.add_platform
                if target not in published:
                    sys.exit(f"{slug}: {target} is not published (published: {', '.join(published) or 'none'})")
                plan.append((slug, artefact, published, target))
            else:
                plan.append((slug, artefact, published, next_version(args.level, published)))
        roots = pinned_roots() if kit is not None else []
    except RegistryError as e:
        sys.exit(str(e))
    if kit is not None:  # fail before anything is built or uploaded: is this kit valid, and for plugins?
        probe = signing.entries_for_file("probe", b"\0" * 32)
        who = signing.verify(probe, signing.sign_with_kit(probe, kit, "plugin", names[0], "0.0.1", "any"), kind="plugin",
                             id_=names[0], version="0.0.1", platform="any", roots=roots)
        if who.status != "signed":
            sys.exit(f"The signing kit is not valid for plugins: {who.status}: {who.reason or 'see website/content/developers/modules/signing.md'}")
        print(f"Signing as {who.publisher} (key {who.key_id})")

    plat = platform_id()
    print(f"Registry {args.registry}, " + (f"adding platform {plat} to {args.add_platform}" if args.add_platform
          else f"channel {args.channel}, level {args.level}, platform {plat}"))
    for slug, artefact, published, version in plan:
        print(f"  {slug:22} {(published[-1] if published else 'none'):>8} -> {version}   {artefact.relative_to(ROOT) if artefact.is_relative_to(ROOT) else artefact}")
    if args.dry_run:
        print("Dry run: nothing uploaded.")
        return 0
    if not args.yes and input("Release these? [y/N] ").strip().lower() != "y":
        print("Cancelled.")
        return 1

    out_dir = ROOT / "build" / "release"
    done = 0
    for slug, artefact, published, version in plan:
        old = published[-1] if published else "none"
        zip_path = out_dir / f"{slug}-{version}-{plat}.zip"
        try:
            make_zip(artefact, zip_path)
            files = [sign_file(zip_path, slug, version, plat, kit, roots)]
            if args.add_platform:
                registry.add_platform(slug, version, files)
            else:
                summary, category = PLUGIN_TILES.get(slug, ("", ""))
                registry.release(slug, version, args.channel, PLUGINS[slug][0], args.notes, files, summary=summary, category=category,
                                 image=plugin_image(slug), license=PLUGIN_LICENSES.get(slug, PLUGIN_LICENSE_DEFAULT))
        except (RegistryError, subprocess.CalledProcessError) as e:
            print(f"  {slug} {version}: FAILED: {e}", file=sys.stderr)
            if done:
                print(f"  ({done} released before the failure; versions are immutable, so run again to release the rest)", file=sys.stderr)
            return 1
        done += 1
        print(f"  {slug} {old} -> {version}: published ({zip_path.stat().st_size / 1e6:.1f} MB)")
    print(f"Index: {args.registry.rstrip('/')}/registry/v1/index.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
