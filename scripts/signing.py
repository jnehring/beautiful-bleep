#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Command line for package signing (the library and the rules are in website/api/app/signing.py, doc/specs/signing.md).

Admin, once:
    scripts/signing.py init-registry DIR                   root.key (take it offline), root.pub, issuer.key, issuer.cert
Admin, per developer (or inside the registry: docker compose exec api python -m app.cli developer-create):
    scripts/signing.py issue-kit DIR --publisher acme [--scopes module,plugin] [--first-party] [--days 365]
                                                           acme.kit.json: the developer's private key and certificate
Developer:
    scripts/signing.py sign PACKAGE --kit acme.kit.json --kind module --id acme/fuzz --version 1.0.0
    scripts/signing.py verify PACKAGE --root root.pub --kind module --id acme/fuzz --version 1.0.0
Developer with their own key (the request flow, for later):
    scripts/signing.py keygen NAME | request NAME --publisher P | issue NAME.csr --issuer-key K --issuer-cert C
    scripts/signing.py vector                              the test vector in the spec
"""
import argparse
import base64
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "website" / "api"))
from app.signing import *  # noqa: E402,F401,F403
from app.signing import (CERT_DOMAIN, KINDS, SIGNATURE_PATH, Ed25519PrivateKey, _verify_sig, b64, canonical, decide,  # noqa: E402,F401
                         issue_kit, key_id, load_key, make_cert, new_tbs, public_bytes, read_doc, read_entries, save_key,
                         sign, sign_with_kit, test_vector, verify, write_doc)


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
    sub.add_parser("vector")
    a = ap.parse_args(argv)

    if a.cmd == "init-registry":  # the registry's one-time setup: the root (keep it offline) and an issuer under it
        d = Path(a.dir)
        d.mkdir(parents=True, exist_ok=True)
        root, issuer = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
        now = int(time.time())
        save_key(root, d / "root.key")
        save_key(issuer, d / "issuer.key")
        (d / "root.pub").write_text(public_bytes(root).hex() + "\n")
        tbs = new_tbs("issuer", public_bytes(issuer), publisher="bleep", name="Bleep registry issuer", scopes=["issue"],
                      not_before=now, not_after=now + a.days * 86400)
        (d / "issuer.cert").write_text(json.dumps(make_cert(root, None, tbs), indent=1))
        env = (f"BLEEP_ROOT_PUBLIC_KEYS={(d / 'root.pub').read_text().strip()}\n"
               f"BLEEP_ISSUER_KEY={(d / 'issuer.key').read_text().strip().replace(chr(10), chr(92) + 'n')}\n"
               f"BLEEP_ISSUER_CERT={json.dumps(json.loads((d / 'issuer.cert').read_text()), separators=(',', ':'))}\n")
        (d / "registry.env").write_text(env)
        (d / "registry.env").chmod(0o600)
        print(f"{d}/root.key: move it offline (your keystore) and delete this copy; the registry never needs it.\n"
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
        print(f"{a.name}.csr: send it to the registry")
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
    else:
        print(json.dumps(test_vector(), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
