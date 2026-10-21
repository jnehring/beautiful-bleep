#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Shares a module with the Bleep Library as a community module (website/content/developers/modules/signing.md section 2a).

    scripts/release/community-publish.py PACKAGE --name wobble --version 1.0.0 --registry https://library.example --token-file my.token
    scripts/release/community-publish.py PACKAGE --name wobble --version 1.0.0 --check      only the library's checks, nothing is sent

PACKAGE is an unsigned .bleepmod, or a folder with module.json, module.wasm, spec.json and optionally LICENSE and doc/*.md, doc/*.png (it is
zipped the way the library stores packages). No signing key is needed: the library checks the package, signs it and publishes it as
<your name>/<name>. The same checks run here first, so a refusal does not cost an upload. The token is a personal access token of your account
(the website's account page), from --token-file or $BLEEP_TOKEN.
"""
import argparse
import io
import os
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "website" / "api"))
from app import community  # noqa: E402  (the library's own checks)


def package_bytes(source: Path) -> bytes:
    """The .bleepmod to upload: the file itself, or a folder zipped with only the files a community module may bring."""
    if source.is_file():
        return source.read_bytes()
    if not source.is_dir():
        raise SystemExit(f"community-publish: {source} is neither a .bleepmod nor a folder")
    files = {}
    for path in sorted(source.rglob("*")):
        rel = path.relative_to(source).as_posix()
        if path.is_file() and not path.is_symlink() and community.ALLOWED_FILES.match(rel):
            files[rel] = path.read_bytes()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for rel, data in files.items():
            info = zipfile.ZipInfo(rel, community.ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, data)
    return buf.getvalue()


def read_token(args: argparse.Namespace) -> str:
    if args.token_file:
        return Path(args.token_file).expanduser().read_text().strip().split()[-1]
    token = os.environ.get("BLEEP_TOKEN", "").strip()
    if not token:
        raise SystemExit("community-publish: a personal access token is required: --token-file or $BLEEP_TOKEN (create one on your account page)")
    return token


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0], epilog=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("package", type=Path)
    ap.add_argument("--name", required=True, help="the module's name in your namespace: lower case letters, digits and -")
    ap.add_argument("--version", required=True, help="x.y.z, higher than the last one you published")
    ap.add_argument("--registry", default=os.environ.get("BLEEP_REGISTRY_URL"), help="the website's address (or $BLEEP_REGISTRY_URL)")
    ap.add_argument("--token-file")
    ap.add_argument("--check", action="store_true", help="run the library's checks on the package and stop")
    args = ap.parse_args(argv)

    data = package_bytes(args.package)
    try:
        files, meta = community.inspect(data)
    except community.Rejected as e:
        print(f"community-publish: the library would refuse this package: {e}", file=sys.stderr)
        return 1
    print(f"{args.name} {args.version}: {len(files)} files, node types {', '.join(meta.get('types', []))}: passes the library's checks")
    if args.check:
        return 0
    if not args.registry:
        raise SystemExit("community-publish: the library's address is required: --registry or $BLEEP_REGISTRY_URL")
    req = urllib.request.Request(f"{args.registry.rstrip('/')}/api/registry/community/modules/{args.name}/{args.version}", data=data, method="PUT",
                                 headers={"Authorization": f"Bearer {read_token(args)}", "Content-Type": "application/octet-stream"})
    try:
        with urllib.request.urlopen(req) as r:
            print(r.read().decode())
    except urllib.error.HTTPError as e:
        print(f"community-publish: {e.code}: {e.read().decode()}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
