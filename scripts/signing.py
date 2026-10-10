#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Package signing for modules and plugins: the reference implementation of doc/specs/signing.md.

    scripts/signing.py keygen NAME                         NAME.key (private, keep it) and NAME.pub
    scripts/signing.py request NAME --publisher acme       NAME.csr: what a developer sends to the registry
    scripts/signing.py issue CSR --issuer-key K --issuer-cert C [--first-party] [--days 365]
                                                           the registry's side: a developer certificate
    scripts/signing.py sign PACKAGE --key K --cert C --kind module --id acme/fuzz --version 1.0.0
    scripts/signing.py verify PACKAGE --root ROOT.pub --kind module --id acme/fuzz --version 1.0.0
    scripts/signing.py vector                              the test vector in the spec

A PACKAGE is a .bleepmod / .zip or a folder; the signature is META/signature.json inside it. The
signature covers every other file (see content_digest), the kind, id, version and platform, so
it breaks when a byte changes, and cannot be moved to another module or version.
Needs the `cryptography` package.
"""
import argparse
import base64
import hashlib
import json
import os
import struct
import sys
import time
import zipfile
from pathlib import Path
from typing import NamedTuple

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

CONTENT_DOMAIN = b"BLEEP-CONTENT-1\n"
SIGNATURE_DOMAIN = b"BLEEP-SIG-1\n"
CERT_DOMAIN = b"BLEEP-CERT-1\n"
CRL_DOMAIN = b"BLEEP-CRL-1\n"
SIGNATURE_PATH = "META/signature.json"
KINDS = ("module", "plugin")


# ---- encoding -------------------------------------------------------------------------

def lp(data: bytes) -> bytes:
    """Length-prefixed: u32 big endian, then the bytes. Makes every message unambiguous."""
    return struct.pack(">I", len(data)) + data


def canonical(obj) -> bytes:
    """The one JSON text a signed object is turned into: sorted keys, no spaces, UTF-8."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def key_id(public: bytes) -> str:
    return hashlib.sha256(public).hexdigest()[:32]


def public_bytes(key: Ed25519PrivateKey) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def safe_path(path: str) -> str:
    parts = path.split("/")
    if not path or path.startswith("/") or "\\" in path or "\0" in path or any(p in ("", ".", "..") for p in parts):
        raise ValueError(f"bad path in package: {path!r}")
    return path


# ---- the content hash -----------------------------------------------------------------

def content_digest(entries: dict[str, tuple[bytes, bool]]) -> bytes:
    """SHA-256 over the package's files: {path: (sha256 of the content, executable)}.

    "BLEEP-CONTENT-1\\n", then u32 file count, then per file sorted by the UTF-8 bytes of the path:
    lp(path), the 32-byte content hash and one byte, 1 if the file is executable.
    META/signature.json is never part of it.
    """
    for path in entries:
        safe_path(path)
    ordered = sorted(entries.items(), key=lambda kv: kv[0].encode())
    out = hashlib.sha256()
    out.update(CONTENT_DOMAIN + struct.pack(">I", len(ordered)))
    for path, (sha, executable) in ordered:
        assert len(sha) == 32
        out.update(lp(path.encode()) + sha + (b"\x01" if executable else b"\x00"))
    return out.digest()


def read_entries(package: Path) -> dict[str, tuple[bytes, bool]]:
    entries: dict[str, tuple[bytes, bool]] = {}
    if package.is_dir():
        for f in sorted(package.rglob("*")):
            if f.is_file() and not f.is_symlink():
                rel = f.relative_to(package).as_posix()
                if rel != SIGNATURE_PATH:
                    entries[rel] = (hashlib.sha256(f.read_bytes()).digest(), os.access(f, os.X_OK))
        return entries
    with zipfile.ZipFile(package) as z:
        for info in z.infolist():
            if info.is_dir() or info.filename == SIGNATURE_PATH:
                continue
            if (info.external_attr >> 28) == 0xA:  # a symlink
                raise ValueError(f"symlink in package: {info.filename}")
            if info.filename in entries:
                raise ValueError(f"duplicate file in package: {info.filename}")
            mode = info.external_attr >> 16
            entries[info.filename] = (hashlib.sha256(z.read(info)).digest(), bool(mode & 0o111))
    return entries


# ---- certificates -----------------------------------------------------------------------

def make_cert(parent: Ed25519PrivateKey, parent_cert: dict | None, tbs: dict) -> dict:
    """A certificate: `tbs` ("to be signed") and the issuer's signature over it. Root certificates have no parent_cert."""
    issuer = key_id(public_bytes(parent))
    return {"tbs": tbs, "issuer": issuer, "signature": b64(parent.sign(CERT_DOMAIN + canonical(tbs)))}


def new_tbs(kind: str, public: bytes, *, publisher: str = "", name: str = "", scopes=(), first_party=False,
            not_before: int, not_after: int, serial: int = 1) -> dict:
    assert kind in ("issuer", "developer")
    return {"format": 1, "type": kind, "keyId": key_id(public), "publicKey": b64(public), "publisher": publisher,
            "name": name, "scopes": sorted(scopes), "firstParty": bool(first_party),
            "notBefore": not_before, "notAfter": not_after, "serial": serial}


# ---- sign ---------------------------------------------------------------------------------

def signing_message(kind: str, id_: str, version: str, platform: str, signer_key_id: str, digest: bytes) -> bytes:
    return (SIGNATURE_DOMAIN + lp(kind.encode()) + lp(id_.encode()) + lp(version.encode()) + lp(platform.encode())
            + lp(signer_key_id.encode()) + lp(digest))


def sign(entries, key: Ed25519PrivateKey, chain: list[dict], kind: str, id_: str, version: str, platform: str = "any") -> dict:
    """The signature document for a package. `chain` is [issuer certificate, developer certificate]."""
    signer = key_id(public_bytes(key))
    digest = content_digest(entries)
    sig = key.sign(signing_message(kind, id_, version, platform, signer, digest))
    return {"format": 1, "algorithm": "ed25519", "keyId": signer, "chain": chain, "signature": b64(sig)}


# ---- verify -----------------------------------------------------------------------------

class Result(NamedTuple):
    status: str            # signed | unsigned | expired | revoked | invalid
    publisher: str = ""
    key_id: str = ""
    root: str = ""         # key id of the root that vouched for it
    reason: str = ""


def _verify_sig(public: bytes, signature: bytes, message: bytes) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(public).verify(signature, message)
        return True
    except (InvalidSignature, ValueError):
        return False


def _check_cert(cert: dict, signer_public: bytes) -> bool:
    return _verify_sig(signer_public, base64.b64decode(cert["signature"]), CERT_DOMAIN + canonical(cert["tbs"]))


def verify(entries, doc: dict | None, *, kind: str, id_: str, version: str, platform: str = "any",
           roots: list[bytes], now: int | None = None, crl: dict | None = None) -> Result:
    """Checks a package against the pinned root public keys. Never raises on bad input: it returns "invalid".

    Order: the signature's shape, the certificate chain (root > issuer > developer), validity period,
    revocation, the developer's right to this kind and id, then the signature over the content.
    """
    now = int(time.time()) if now is None else now
    if doc is None:
        return Result("unsigned")
    try:
        if doc["format"] != 1 or doc["algorithm"] != "ed25519":
            return Result("invalid", reason="unknown signature format")
        issuer_cert, dev_cert = doc["chain"]
        issuer_tbs, dev_tbs = issuer_cert["tbs"], dev_cert["tbs"]
        issuer_pub, dev_pub = base64.b64decode(issuer_tbs["publicKey"]), base64.b64decode(dev_tbs["publicKey"])
        root = next((r for r in roots if key_id(r) == issuer_cert["issuer"]), None)
        if root is None or not _check_cert(issuer_cert, root):
            return Result("invalid", reason="the issuer certificate is not signed by a trusted root")
        if issuer_tbs["type"] != "issuer" or issuer_tbs["keyId"] != key_id(issuer_pub) or "issue" not in issuer_tbs["scopes"]:
            return Result("invalid", reason="bad issuer certificate")
        if dev_cert["issuer"] != issuer_tbs["keyId"] or not _check_cert(dev_cert, issuer_pub):
            return Result("invalid", reason="the developer certificate is not signed by the issuer")
        if dev_tbs["type"] != "developer" or dev_tbs["keyId"] != key_id(dev_pub) or doc["keyId"] != dev_tbs["keyId"]:
            return Result("invalid", reason="bad developer certificate")
        who = Result("signed", dev_tbs["publisher"], dev_tbs["keyId"], key_id(root))

        # revocation outranks everything except a broken signature
        for cert in (issuer_tbs, dev_tbs):
            for rev in (crl or {}).get("revokedKeys", []):
                if rev["keyId"] == cert["keyId"]:
                    return Result("revoked", who.publisher, who.key_id, who.root, "the signing key was revoked")
        digest = content_digest(entries)
        for rev in (crl or {}).get("revokedArtifacts", []):
            if (rev["kind"], rev["id"], rev["version"], rev["digest"]) == (kind, id_, version, digest.hex()):
                return Result("revoked", who.publisher, who.key_id, who.root, "this release was revoked")

        if kind not in KINDS or kind not in dev_tbs["scopes"]:
            return Result("invalid", reason=f"the certificate does not allow signing a {kind}")
        # a publisher signs "<publisher>/<name>"; only a first-party certificate signs bare ids
        if not (dev_tbs["firstParty"] and "/" not in id_) and not id_.startswith(dev_tbs["publisher"] + "/"):
            return Result("invalid", reason=f"{id_!r} is not in the publisher's namespace")
        if not _verify_sig(dev_pub, base64.b64decode(doc["signature"]),
                           signing_message(kind, id_, version, platform, dev_tbs["keyId"], digest)):
            return Result("invalid", reason="the signature does not match the content")
        for t in (issuer_tbs, dev_tbs):  # after the checks above: an expired signer is not an attack, just old
            if not t["notBefore"] <= now <= t["notAfter"]:
                return Result("expired", who.publisher, who.key_id, who.root, "the certificate is outside its validity period")
        return who
    except (KeyError, TypeError, ValueError, AttributeError, IndexError) as e:
        return Result("invalid", reason=f"malformed signature: {e}")


def decide(result: Result, kind: str, allow_unsigned: dict[str, bool]) -> tuple[bool, str]:
    """May the host load it? `allow_unsigned` is the settings: {"module": bool, "plugin": bool}.

    Invalid and revoked are never loaded, whatever the settings say. Unsigned and expired need the setting.
    """
    if result.status == "signed":
        return True, f"signed by {result.publisher}"
    if result.status in ("invalid", "revoked"):
        return False, f"{result.status}: {result.reason}"
    if allow_unsigned.get(kind, False):
        return True, "unsigned (allowed in the settings)" if result.status == "unsigned" else f"{result.reason} (unsigned loading allowed)"
    return False, f"{result.status}: enable 'Allow unsigned {kind}s' in the settings to load it"


# ---- command line -------------------------------------------------------------------------

def load_key(path: str) -> Ed25519PrivateKey:
    pw = os.environ.get("BLEEP_KEY_PASSPHRASE")
    return serialization.load_pem_private_key(Path(path).read_bytes(), pw.encode() if pw else None)


def save_key(key: Ed25519PrivateKey, path: Path) -> None:
    pw = os.environ.get("BLEEP_KEY_PASSPHRASE")
    enc = serialization.BestAvailableEncryption(pw.encode()) if pw else serialization.NoEncryption()
    path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, enc))
    path.chmod(0o600)


def read_doc(package: Path) -> dict | None:
    if package.is_dir():
        f = package / SIGNATURE_PATH
        return json.loads(f.read_text()) if f.exists() else None
    with zipfile.ZipFile(package) as z:
        return json.loads(z.read(SIGNATURE_PATH)) if SIGNATURE_PATH in z.namelist() else None


def write_doc(package: Path, doc: dict) -> None:
    text = json.dumps(doc, indent=1)
    if package.is_dir():
        (package / "META").mkdir(exist_ok=True)
        (package / SIGNATURE_PATH).write_text(text)
        return
    with zipfile.ZipFile(package) as z:  # rewrite without an older signature
        keep = [(i, z.read(i)) for i in z.infolist() if i.filename != SIGNATURE_PATH]
    with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED) as z:
        for info, data in keep:
            z.writestr(info, data)
        z.writestr(SIGNATURE_PATH, text)


def test_vector() -> dict:
    """Fixed keys and package: every implementation must produce exactly these values."""
    root = Ed25519PrivateKey.from_private_bytes(bytes([1]) * 32)
    issuer = Ed25519PrivateKey.from_private_bytes(bytes([2]) * 32)
    dev = Ed25519PrivateKey.from_private_bytes(bytes([3]) * 32)
    t0, t1 = 1_760_000_000, 1_760_000_000 + 365 * 86400
    issuer_cert = make_cert(root, None, new_tbs("issuer", public_bytes(issuer), publisher="bleep", name="Bleep registry issuer",
                                                scopes=["issue"], not_before=t0, not_after=t1))
    dev_cert = make_cert(issuer, issuer_cert, new_tbs("developer", public_bytes(dev), publisher="acme", name="Acme Audio",
                                                      scopes=["module"], not_before=t0, not_after=t1))
    files = {"module.json": b'{"name":"Fuzz"}\n', "module.wasm": b"\x00asm\x01\x00\x00\x00", "ui/fuzz.js": b"// view\n"}
    entries = {p: (hashlib.sha256(c).digest(), False) for p, c in files.items()}
    doc = sign(entries, dev, [issuer_cert, dev_cert], "module", "acme/fuzz", "1.0.0")
    return {"root": public_bytes(root).hex(), "issuer": public_bytes(issuer).hex(), "developer": public_bytes(dev).hex(),
            "contentDigest": content_digest(entries).hex(),
            "message": signing_message("module", "acme/fuzz", "1.0.0", "any", key_id(public_bytes(dev)), content_digest(entries)).hex(),
            "signature": base64.b64decode(doc["signature"]).hex(), "developerKeyId": key_id(public_bytes(dev))}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("keygen"); p.add_argument("name")
    p = sub.add_parser("request"); p.add_argument("name"); p.add_argument("--publisher", required=True); p.add_argument("--display-name", default="")
    p = sub.add_parser("issue"); p.add_argument("csr"); p.add_argument("--issuer-key", required=True); p.add_argument("--issuer-cert", required=True)
    p.add_argument("--scopes", default="module"); p.add_argument("--first-party", action="store_true"); p.add_argument("--days", type=int, default=365)
    p = sub.add_parser("sign"); p.add_argument("package"); p.add_argument("--key", required=True); p.add_argument("--cert", required=True)
    for a in ("--kind", "--id", "--version"):
        p.add_argument(a, required=True)
    p.add_argument("--platform", default="any")
    p = sub.add_parser("verify"); p.add_argument("package"); p.add_argument("--root", action="append", required=True)
    for a in ("--kind", "--id", "--version"):
        p.add_argument(a, required=True)
    p.add_argument("--platform", default="any"); p.add_argument("--allow-unsigned", action="store_true")
    p = sub.add_parser("init-registry"); p.add_argument("dir"); p.add_argument("--days", type=int, default=3650)
    sub.add_parser("vector")
    a = ap.parse_args(argv)

    if a.cmd == "keygen":
        key = Ed25519PrivateKey.generate()
        save_key(key, Path(a.name + ".key"))
        Path(a.name + ".pub").write_text(public_bytes(key).hex() + "\n")
        print(f"{a.name}.key (private: keep it safe, never upload it), {a.name}.pub; key id {key_id(public_bytes(key))}")
    elif a.cmd == "init-registry":  # the registry's one-time setup: the root (keep it offline) and an issuer under it
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
        print(f"{d}/root.key (offline!), root.pub (ship it in the app and plugins), issuer.key + issuer.cert (the registry's)")
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
        cert = make_cert(load_key(a.issuer_key), json.loads(Path(a.issuer_cert).read_text()), tbs)
        out = {"chain": [json.loads(Path(a.issuer_cert).read_text()), cert]}
        Path(csr_path := a.csr.removesuffix(".csr") + ".cert").write_text(json.dumps(out, indent=1))
        print(f"{csr_path}: valid for {a.days} days")
    elif a.cmd == "sign":
        pkg = Path(a.package)
        chain = json.loads(Path(a.cert).read_text())["chain"]
        write_doc(pkg, sign(read_entries(pkg), load_key(a.key), chain, a.kind, a.id, a.version, a.platform))
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
