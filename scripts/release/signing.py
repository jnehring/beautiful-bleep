#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Command line for package signing (the library and the rules are in website/api/app/signing.py, website/content/developers/modules/signing.md).

Admin, once:
    scripts/release/signing.py init-registry DIR                   root.key (take it offline), root.pub, issuer.key, issuer.cert
Admin, per developer (or inside the registry: docker compose exec api python -m app.cli developer-create):
    scripts/release/signing.py issue-kit DIR --publisher acme [--scopes module,plugin] [--first-party] [--days 365]
                                                           acme.kit.json: the developer's private key and certificate
Developer:
    scripts/release/signing.py sign PACKAGE --kit acme.kit.json --kind module --id acme/fuzz --version 1.0.0
    scripts/release/signing.py verify PACKAGE --root root.pub --kind module --id acme/fuzz --version 1.0.0
Developer with their own key (the request flow, for later):
    scripts/release/signing.py keygen NAME | request NAME --publisher P | issue NAME.csr --issuer-key K --issuer-cert C
    scripts/release/signing.py vector                              the test vector in the spec
"""
import argparse
import base64
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "website" / "api"))
from app.signing import *  # noqa: E402,F401,F403
from app.signing import (CERT_DOMAIN, KINDS, SIGNATURE_PATH, Ed25519PrivateKey, _verify_sig, b64, canonical, decide,  # noqa: E402,F401
                         issue_kit, key_id, load_key, make_cert, new_tbs, public_bytes, read_doc, read_entries, save_key,
                         make_crl, sign, sign_with_kit, test_vector, verify, write_doc)
from app import signing  # noqa: E402


def make_fixtures(out: Path) -> None:
    """Deterministic packages with the verdict each must get: the same files test the Python, JavaScript and C++ implementations
    (patch/tests/library-fixtures/, cases.json). Fixed keys and dates, so regenerating changes nothing."""
    import hashlib
    import zipfile
    t0 = 1_760_000_000
    t1 = t0 + 365 * 86400
    key = lambda n: Ed25519PrivateKey.from_private_bytes(bytes([n]) * 32)  # noqa: E731
    root, issuer, acme, bleep, other = (key(n) for n in (1, 2, 3, 4, 5))
    issuer_cert = make_cert(root, None, new_tbs("issuer", public_bytes(issuer), publisher="bleep", name="Fixture issuer", scopes=["issue"], not_before=t0, not_after=t1))
    chain = lambda k, **kw: [issuer_cert, make_cert(issuer, issuer_cert, new_tbs("developer", public_bytes(k), not_before=t0, not_after=t1, **kw))]  # noqa: E731
    acme_chain = chain(acme, publisher="acme", name="Acme Audio", scopes=["module"])
    bleep_chain = chain(bleep, publisher="bleep", name="Bleep", scopes=["module", "plugin"], first_party=True)
    files = {"module.json": b'{"name":"Fuzz","types":["acme/fuzz"],"requires":{"engineAbi":1}}\n', "module.wasm": b"\x00asm\x01\x00\x00\x00", "ui/fuzz.js": b"// view\n"}
    entries = lambda f: {p: (hashlib.sha256(c).digest(), False) for p, c in f.items()}  # noqa: E731

    def make_zip(path: Path, f: dict, doc=None, stored=False, extra=None, raw_signature=None):
        method = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
        with zipfile.ZipFile(path, "w", method) as z:
            members = dict(f)
            if doc is not None:
                members["META/signature.json"] = (json.dumps(doc, indent=1, sort_keys=True) + "\n").encode()
            if raw_signature is not None:
                members["META/signature.json"] = raw_signature
            for name in sorted(members):
                info = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0))
                info.compress_type = method
                info.external_attr = 0o100644 << 16
                z.writestr(info, members[name])
            for info, data in (extra or []):
                z.writestr(info, data)

    import shutil
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True, exist_ok=True)
    good = sign(entries(files), acme, acme_chain, "module", "acme/fuzz", "1.0.0")
    cases = []

    def case(name, expect, *, doc=None, f=None, stored=False, extra=None, raw=None, kind="module", id="acme/fuzz", version="1.0.0", platform="any",
             now=t0 + 100, roots="main", crl=None, publisher=None, signed_doc=True):
        make_zip(out / f"{name}.bleepmod", f if f is not None else files, doc if doc is not None else (good if signed_doc and raw is None else None),
                 stored=stored, extra=extra, raw_signature=raw)
        cases.append({"name": name, "file": f"{name}.bleepmod", "kind": kind, "id": id, "version": version, "platform": platform, "now": now,
                      "roots": roots, "crl": crl, "expect": expect, "publisher": publisher})

    case("signed", "signed", publisher="acme")
    case("signed-stored", "signed", stored=True, publisher="acme")
    case("unsigned", "unsigned", signed_doc=False)
    case("tampered-wasm", "invalid", f={**files, "module.wasm": files["module.wasm"] + b"\x00"})
    case("extra-file", "invalid", f={**files, "ui/evil.js": b"x"})
    case("missing-file", "invalid", f={k: v for k, v in files.items() if k != "ui/fuzz.js"})
    case("wrong-id", "invalid", id="acme/other")
    case("wrong-version", "invalid", version="1.0.1")
    case("wrong-platform", "invalid", platform="macos-arm64")
    case("wrong-kind", "invalid", kind="plugin")
    case("expired", "expired", now=t1 + 1)
    case("not-yet-valid", "expired", now=t0 - 1)
    case("other-root", "invalid", roots="other")
    case("no-root", "invalid", roots="none")
    case("revoked-key", "revoked", crl={"revokedKeys": [{"keyId": key_id(public_bytes(acme))}], "revokedArtifacts": []})
    case("revoked-issuer", "revoked", crl={"revokedKeys": [{"keyId": key_id(public_bytes(issuer))}], "revokedArtifacts": []})
    case("revoked-release", "revoked", crl={"revokedKeys": [], "revokedArtifacts": [
        {"kind": "module", "id": "acme/fuzz", "version": "1.0.0", "digest": content_digest(entries(files)).hex()}]})
    # a developer outside their namespace, and the first-party exception
    bare = sign(entries(files), acme, acme_chain, "module", "fuzz", "1.0.0")
    case("bare-id-by-third-party", "invalid", doc=bare, id="fuzz")
    first = sign(entries(files), bleep, bleep_chain, "module", "reverb", "1.0.0")
    case("bare-id-first-party", "signed", doc=first, id="reverb", publisher="bleep")
    plugin_file = {"installer.pkg": b"pretend installer"}
    plugin_doc = sign(entries(plugin_file), bleep, bleep_chain, "plugin", "bleep-board", "1.2.3", "macos-arm64")
    case("plugin-signed", "signed", f=plugin_file, doc=plugin_doc, kind="plugin", id="bleep-board", version="1.2.3", platform="macos-arm64", publisher="bleep")
    case("plugin-by-module-only-key", "invalid", f=plugin_file, doc=sign(entries(plugin_file), acme, acme_chain, "plugin", "acme/p", "1.0.0"), kind="plugin", id="acme/p")
    forged = json.loads(json.dumps(good))
    forged["chain"][1]["tbs"]["scopes"] = ["module", "plugin"]
    case("forged-certificate", "invalid", doc=forged)
    case("garbage-signature", "invalid", raw=b"this is not json")
    case("empty-signature", "invalid", doc={})
    # packages the reader must refuse before any signature is looked at
    link = zipfile.ZipInfo("link", (2020, 1, 1, 0, 0, 0))
    link.create_system = 3
    link.external_attr = 0o120777 << 16
    case("symlink", "refused", extra=[(link, b"module.wasm")])
    case("unsafe-path", "refused", f={**files, "../evil": b"x"})
    # a static library (what Caddy serves under /registry/v1/) for the clients' install tests: read through file:// URLs
    other_issuer = key(6)
    other_issuer_cert = make_cert(other, None, new_tbs("issuer", public_bytes(other_issuer), publisher="bleep", name="Other issuer", scopes=["issue"], not_before=t0, not_after=t1))
    other_chain = [other_issuer_cert, make_cert(other_issuer, other_issuer_cert, new_tbs("developer", public_bytes(bleep), publisher="bleep", name="Forger",
                                                                                         scopes=["module"], first_party=True, not_before=t0, not_after=t1))]

    # revocation lists (signing.md section 8), for the clients' tests: one that revokes acme's key, an older empty one (a rollback),
    # and one signed by an issuer of another root (not to be believed, though its serial is the highest)
    crl_dir = out / "crl"
    crl_dir.mkdir(parents=True, exist_ok=True)
    for name, doc in (("revokes-acme", make_crl(issuer, issuer_cert, serial=7, issued=t0 + 50, revoked_keys=[key_id(public_bytes(acme))])),
                      ("older-empty", make_crl(issuer, issuer_cert, serial=3, issued=t0 + 10)),
                      ("forged", make_crl(other_issuer, other_issuer_cert, serial=99, issued=t0 + 60, revoked_keys=[key_id(public_bytes(bleep))]))):
        (crl_dir / f"{name}.json").write_text(json.dumps(doc, indent=1, sort_keys=True) + "\n")

    def module_files(slug: str, types: list[str], note: str = "") -> dict:
        meta = {"name": slug, "slug": slug, "types": types, "requires": {"engineAbi": 1}}
        return {"module.json": (json.dumps(meta) + "\n").encode(), "module.wasm": b"\x00asm\x01\x00\x00\x00" + note.encode(), "ui/view.js": b"// view\n"}

    def site(root_dir: Path, modules: list[dict], plugins: list[dict] = ()) -> None:
        v1 = root_dir / "registry" / "v1"
        mods = {}
        for m in modules:
            slug, version = m["slug"], m["version"]
            f = m.get("files") or module_files(slug, m["types"])
            d = v1 / "modules" / slug / version
            d.mkdir(parents=True, exist_ok=True)
            path = f"{slug}-{version}.bleepmod"
            make_zip(d / path, f)
            data = (d / path).read_bytes()
            sid = slug.replace(".", "/", 1)
            doc = None
            if m.get("sign", "bleep") is not None:
                signer = {"bleep": (bleep, bleep_chain), "acme": (acme, acme_chain), "forger": (bleep, other_chain)}[m.get("sign", "bleep")]
                signed_files = m.get("signed_files") or f
                doc = sign(entries(signed_files), signer[0], signer[1], "module", sid, version, "any")
            digest = content_digest(entries(f)).hex()
            entry_file = {"path": path, "sha256": hashlib.sha256(data).hexdigest() if not m.get("bad_sha") else "0" * 64, "bytes": len(data), "platform": "any", "contentDigest": digest}
            if doc:
                entry_file["signature"] = doc
                entry_file["signer"] = {"publisher": doc["chain"][1]["tbs"]["publisher"], "keyId": doc["keyId"]}
            (d / "entry.json").write_text(json.dumps({"kind": "module", "id": slug, "version": version, "channel": "stable", "title": slug, "notes": "",
                                                       "requires": {"engineAbi": 1}, "types": sorted(m["types"]), "files": [entry_file]}, indent=1, sort_keys=True) + "\n")
            mods[slug] = {"version": version, "entry": f"modules/{slug}/{version}/entry.json", "types": sorted(m["types"])}
        plugs = {}
        for pl in plugins:  # a plugin: one zip per platform holding the .vst3 bundle, signed as a single file (signing.md section 4)
            slug, version = pl["slug"], pl["version"]
            d = v1 / "plugins" / slug / version
            d.mkdir(parents=True, exist_ok=True)
            entry_files = []
            for plat in ("macos-arm64", "macos-x86_64", "windows-x86_64", "linux-x86_64"):
                path = f"{slug}-{version}-{plat}.zip"
                make_zip(d / path, {f"{pl['bundle']}/Contents/MacOS/{pl['bundle'][:-5]}": b"pretend plugin code", f"{pl['bundle']}/Contents/Info.plist": b"<plist/>"})
                data = (d / path).read_bytes()
                sha = hashlib.sha256(data).digest()
                f = {"path": path, "sha256": sha.hex(), "bytes": len(data), "platform": plat}
                if pl.get("sign", "bleep") is not None:
                    other_sha = hashlib.sha256(b"something else").digest()
                    doc = sign(entries_for_file(path, other_sha if pl.get("tampered") else sha), bleep, bleep_chain, "plugin", slug, version, plat)
                    f["signature"] = doc
                    f["signer"] = {"publisher": doc["chain"][1]["tbs"]["publisher"], "keyId": doc["keyId"]}
                entry_files.append(f)
            (d / "entry.json").write_text(json.dumps({"kind": "plugin", "id": slug, "version": version, "channel": "stable", "title": slug, "notes": "",
                                                       "requires": {}, "types": [], "files": entry_files}, indent=1, sort_keys=True) + "\n")
            plugs[slug] = {"version": version, "entry": f"plugins/{slug}/{version}/entry.json"}
        (v1 / "index.json").write_text(json.dumps({"format": 1, "generated": "2025-10-09T00:00:00+00:00", "channels": {
            "stable": {"plugins": plugs, "modules": mods}, "beta": {"plugins": plugs, "modules": mods}}}, indent=1, sort_keys=True) + "\n")

    site(out / "site", [
        {"slug": "good", "version": "1.2.0", "types": ["good"]},
        {"slug": "acme.fuzz", "version": "1.0.0", "types": ["acme/fuzz"], "sign": "acme"},
        {"slug": "unsigned-one", "version": "0.1.0", "types": ["unsigned-one"], "sign": None},
        {"slug": "bad-download", "version": "0.1.0", "types": ["bad-download"], "bad_sha": True},
        {"slug": "tampered", "version": "0.1.0", "types": ["tampered"], "signed_files": module_files("tampered", ["tampered"], "other code")},
        {"slug": "forged", "version": "0.1.0", "types": ["forged"], "sign": "forger"},
    ], plugins=[
        {"slug": "test-plugin", "version": "0.4.0", "bundle": "Test Plugin.vst3"},
        {"slug": "test-plugin-unsigned", "version": "0.4.0", "bundle": "Unsigned Plugin.vst3", "sign": None},
        {"slug": "test-plugin-tampered", "version": "0.4.0", "bundle": "Tampered Plugin.vst3", "tampered": True},
    ])
    site(out / "site2", [{"slug": "good", "version": "1.3.0", "types": ["good", "good-extra"]}])  # the same library a release later
    (out / "cases.json").write_text(json.dumps({
        "about": "generated by scripts/release/signing.py fixture; every implementation must give each package its verdict",
        "roots": {"main": public_bytes(root).hex(), "other": public_bytes(other).hex()}, "siteNow": t0 + 100, "cases": cases}, indent=1) + "\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("init-registry"); p.add_argument("dir"); p.add_argument("--days", type=int, default=3650)
    p = sub.add_parser("issue-kit"); p.add_argument("dir", help="a folder with issuer.key and issuer.cert")
    p.add_argument("--publisher", required=True); p.add_argument("--scopes", default="module"); p.add_argument("--first-party", action="store_true")
    p.add_argument("--days", type=int, default=365); p.add_argument("--name", default="")
    p = sub.add_parser("keygen"); p.add_argument("name")
    p = sub.add_parser("request"); p.add_argument("name"); p.add_argument("--publisher", required=True); p.add_argument("--display-name", default="")
    p = sub.add_parser("issue"); p.add_argument("csr"); p.add_argument("--issuer-key", required=True); p.add_argument("--issuer-cert", required=True)
    p.add_argument("--scopes", default="module"); p.add_argument("--first-party", action="store_true"); p.add_argument("--days", type=int, default=365)
    p = sub.add_parser("sign"); p.add_argument("package"); p.add_argument("--kit"); p.add_argument("--key"); p.add_argument("--cert")
    for a in ("--kind", "--id", "--version"):
        p.add_argument(a, required=True)
    p.add_argument("--platform", default="any")
    p = sub.add_parser("verify"); p.add_argument("package"); p.add_argument("--root", action="append", required=True)
    for a in ("--kind", "--id", "--version"):
        p.add_argument(a, required=True)
    p.add_argument("--platform", default="any"); p.add_argument("--allow-unsigned", action="store_true")
    p = sub.add_parser("digest"); p.add_argument("package")
    p = sub.add_parser("fixture"); p.add_argument("dir", nargs="?", default=str(ROOT / "patch" / "tests" / "library-fixtures"))
    sub.add_parser("vector")
    a = ap.parse_args(argv)

    if a.cmd == "init-registry":  # the library's one-time setup: the root (keep it offline) and an issuer under it
        d = Path(a.dir)
        d.mkdir(parents=True, exist_ok=True)
        root, issuer = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
        now = int(time.time())
        save_key(root, d / "root.key")
        save_key(issuer, d / "issuer.key")
        (d / "root.pub").write_text(public_bytes(root).hex() + "\n")
        tbs = new_tbs("issuer", public_bytes(issuer), publisher="bleep", name="Bleep library issuer", scopes=["issue"],
                      not_before=now, not_after=now + a.days * 86400)
        (d / "issuer.cert").write_text(json.dumps(make_cert(root, None, tbs), indent=1))
        env = (f"BLEEP_ROOT_PUBLIC_KEYS={(d / 'root.pub').read_text().strip()}\n"
               f"BLEEP_ISSUER_KEY={(d / 'issuer.key').read_text().strip().replace(chr(10), chr(92) + 'n')}\n"
               f"BLEEP_ISSUER_CERT={json.dumps(json.loads((d / 'issuer.cert').read_text()), separators=(',', ':'))}\n")
        (d / "registry.env").write_text(env)
        (d / "registry.env").chmod(0o600)
        print(f"{d}/root.key: move it offline (your keystore) and delete this copy; the library never needs it.\n"
              f"{d}/root.pub: goes into the apps and plugins too.\n"
              f"{d}/registry.env: the three lines for website/.env (root PUBLIC key, issuer key and certificate).")
    elif a.cmd == "issue-kit":
        d = Path(a.dir)
        kit = issue_kit(load_key(str(d / "issuer.key")), json.loads((d / "issuer.cert").read_text()), a.publisher,
                        scopes=a.scopes.split(","), first_party=a.first_party, days=a.days, name=a.name)
        out = d / f"{a.publisher}.kit.json"
        out.write_text(json.dumps(kit, indent=1))
        out.chmod(0o600)
        print(f"{out}: the developer's private key and certificate. Hand it over privately; it is a secret.")
    elif a.cmd == "keygen":
        key = Ed25519PrivateKey.generate()
        save_key(key, Path(a.name + ".key"))
        Path(a.name + ".pub").write_text(public_bytes(key).hex() + "\n")
        print(f"{a.name}.key (private: keep it safe, never upload it), {a.name}.pub; key id {key_id(public_bytes(key))}")
    elif a.cmd == "request":  # the public key, who you are, and a signature by the key itself (proof you hold it)
        key = load_key(a.name + ".key")
        body = {"format": 1, "publisher": a.publisher, "name": a.display_name or a.publisher, "publicKey": b64(public_bytes(key))}
        Path(a.name + ".csr").write_text(json.dumps({"request": body, "signature": b64(key.sign(CERT_DOMAIN + b"request\n" + canonical(body)))}, indent=1))
        print(f"{a.name}.csr: send it to the library")
    elif a.cmd == "issue":
        csr = json.loads(Path(a.csr).read_text())
        pub = base64.b64decode(csr["request"]["publicKey"])
        if not _verify_sig(pub, base64.b64decode(csr["signature"]), CERT_DOMAIN + b"request\n" + canonical(csr["request"])):
            sys.exit("the request is not signed by its own key")
        now = int(time.time())
        tbs = new_tbs("developer", pub, publisher=csr["request"]["publisher"], name=csr["request"]["name"], scopes=a.scopes.split(","),
                      first_party=a.first_party, not_before=now, not_after=now + a.days * 86400)
        issuer_cert = json.loads(Path(a.issuer_cert).read_text())
        cert = make_cert(load_key(a.issuer_key), issuer_cert, tbs)
        out = a.csr.removesuffix(".csr") + ".cert"
        Path(out).write_text(json.dumps({"chain": [issuer_cert, cert]}, indent=1))
        print(f"{out}: valid for {a.days} days")
    elif a.cmd == "sign":
        pkg = Path(a.package)
        if a.kit:
            doc = sign_with_kit(read_entries(pkg), json.loads(Path(a.kit).read_text()), a.kind, a.id, a.version, a.platform)
        elif a.key and a.cert:
            doc = sign(read_entries(pkg), load_key(a.key), json.loads(Path(a.cert).read_text())["chain"], a.kind, a.id, a.version, a.platform)
        else:
            sys.exit("give --kit, or --key and --cert")
        write_doc(pkg, doc)
        print(f"signed {pkg}")
    elif a.cmd == "verify":
        pkg = Path(a.package)
        roots = [bytes.fromhex(Path(r).read_text().strip()) for r in a.root]
        res = verify(read_entries(pkg), read_doc(pkg), kind=a.kind, id_=a.id, version=a.version, platform=a.platform, roots=roots)
        ok, why = decide(res, a.kind, {a.kind: a.allow_unsigned})
        print(("OK: " if ok else "REFUSED: ") + why)
        return 0 if ok else 1
    elif a.cmd == "fixture":
        make_fixtures(Path(a.dir))
        print(f"fixtures written to {a.dir}")
    elif a.cmd == "digest":  # the content hash of a package, as signed (signing.md section 4)
        print(signing.content_digest(read_entries(Path(a.package))).hex())
    else:
        print(json.dumps(test_vector(), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
