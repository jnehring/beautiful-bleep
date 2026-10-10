# SPDX-License-Identifier: MIT
"""Package signing for modules and plugins: the reference implementation of doc/specs/signing.md.

This library is used by the registry (website/api: it checks every release), by scripts/release/signing.py
(the command line for developers and admins) and by scripts/release.py. Needs the `cryptography` package.

A PACKAGE is a .bleepmod / .zip or a folder; the signature is META/signature.json inside it. The
signature covers every other file (see content_digest), the kind, id, version and platform, so
it breaks when a byte changes, and cannot be moved to another module or version.
"""
import base64
import hashlib
import json
import os
import re
import struct
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
PUBLISHER = re.compile(r"[a-z0-9][a-z0-9-]{0,38}")


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


def read_entries(package) -> dict[str, tuple[bytes, bool]]:
    entries: dict[str, tuple[bytes, bool]] = {}
    if isinstance(package, Path) and package.is_dir():
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


def verify(content, doc: dict | None, *, kind: str, id_: str, version: str, platform: str = "any",
           roots: list[bytes], now: int | None = None, crl: dict | None = None) -> Result:
    """Checks a package against the pinned root public keys. Never raises on bad input: it returns "invalid".

    `content` is the package's entries (see content_digest) or the 32-byte content digest itself.

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
        digest = content if isinstance(content, (bytes, bytearray)) else content_digest(content)
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

def key_from_pem(pem: str, passphrase: str | None = None) -> Ed25519PrivateKey:
    return serialization.load_pem_private_key(pem.encode(), passphrase.encode() if passphrase else None)


def issue_kit(issuer_key: Ed25519PrivateKey, issuer_cert: dict, publisher: str, *, scopes=("module",), first_party=False,
              days: int = 365, name: str = "", now: int | None = None) -> dict:
    """What an admin hands to a developer: a new key pair and its certificate chain, in one JSON document.

    The private key is in it (unencrypted PEM): the file is a secret, to be sent over a channel only the developer
    can read and kept like a password. {"format", "publisher", "keyId", "privateKey", "chain"}.
    """
    if not PUBLISHER.fullmatch(publisher):
        raise ValueError("a publisher is lower case letters, digits and -, up to 39 characters")
    key = Ed25519PrivateKey.generate()
    t = int(time.time()) if now is None else now
    tbs = new_tbs("developer", public_bytes(key), publisher=publisher, name=name or publisher, scopes=scopes,
                  first_party=first_party, not_before=t, not_after=t + days * 86400)
    cert = make_cert(issuer_key, issuer_cert, tbs)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    return {"format": 1, "publisher": publisher, "keyId": tbs["keyId"], "privateKey": pem, "chain": [issuer_cert, cert]}


def sign_with_kit(entries, kit: dict, kind: str, id_: str, version: str, platform: str = "any") -> dict:
    return sign(entries, key_from_pem(kit["privateKey"]), kit["chain"], kind, id_, version, platform)


def entries_for_file(name: str, sha256: bytes) -> dict[str, tuple[bytes, bool]]:
    """A package that is one file (a plugin installer): its content is the file, named by `name`."""
    return {name: (sha256, False)}


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
