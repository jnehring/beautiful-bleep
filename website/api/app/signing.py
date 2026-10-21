# SPDX-License-Identifier: MIT
"""Package signing for modules and plugins: the reference implementation of website/content/developers/modules/signing.md.

This library is used by the library (website/api: it checks every release), by scripts/release/signing.py
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
PUBLICATION_DOMAIN = b"BLEEP-PUB-1\n"
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


MAX_MEMBER_BYTES = 512 * 1024 * 1024    # one file inside a package (plugin packages carry big binaries)
MAX_TOTAL_BYTES = 1024 * 1024 * 1024    # all files of a package together
MAX_RATIO = 1000                        # uncompressed / compressed, for members above RATIO_FROM (a zip bomb is far above)
RATIO_FROM = 16 * 1024 * 1024
MAX_META_BYTES = 1024 * 1024            # module.json, signature.json


def check_member(info: zipfile.ZipInfo, total: int = 0, *, max_member: int | None = None, max_total: int | None = None) -> int:
    """Refuses an oversize or bomb-like zip member before anything is decompressed; returns the running total."""
    max_member = MAX_MEMBER_BYTES if max_member is None else max_member
    max_total = MAX_TOTAL_BYTES if max_total is None else max_total
    if info.file_size > max_member:
        raise ValueError(f"{info.filename}: {info.file_size} bytes uncompressed, more than the limit of {max_member}")
    if info.file_size > RATIO_FROM and info.file_size > MAX_RATIO * max(info.compress_size, 1):
        raise ValueError(f"{info.filename}: compression ratio is implausibly high")
    if total + info.file_size > max_total:
        raise ValueError(f"package is larger than {max_total} bytes uncompressed")
    return total + info.file_size


def read_member(z: zipfile.ZipFile, name: str, limit: int = MAX_META_BYTES) -> bytes:
    """One (small) member's bytes, refused when it is larger than `limit`."""
    check_member(z.getinfo(name), max_member=limit)
    return z.read(name)


def _sha256_member(z: zipfile.ZipFile, info: zipfile.ZipInfo) -> bytes:
    h = hashlib.sha256()
    with z.open(info) as f:  # streamed: a big file is never held in memory
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.digest()


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
        total = 0
        for info in z.infolist():
            if info.is_dir() or info.filename == SIGNATURE_PATH:
                continue
            total = check_member(info, total)
            if (info.external_attr >> 28) == 0xA:  # a symlink
                raise ValueError(f"symlink in package: {info.filename}")
            if info.filename in entries:
                raise ValueError(f"duplicate file in package: {info.filename}")
            mode = info.external_attr >> 16
            entries[info.filename] = (_sha256_member(z, info), bool(mode & 0o111))
    return entries


# ---- certificates -----------------------------------------------------------------------

def make_cert(parent: Ed25519PrivateKey, parent_cert: dict | None, tbs: dict) -> dict:
    """A certificate: `tbs` ("to be signed") and the issuer's signature over it. Root certificates have no parent_cert."""
    issuer = key_id(public_bytes(parent))
    return {"tbs": tbs, "issuer": issuer, "signature": b64(parent.sign(CERT_DOMAIN + canonical(tbs)))}


COMMUNITY_PUBLISHER = "community"


def new_tbs(kind: str, public: bytes, *, publisher: str = "", name: str = "", scopes=(), first_party=False, community=False,
            not_before: int, not_after: int, serial: int = 1) -> dict:
    """`community` marks the library's own key for community modules (signing.md section 2a). It is only written when true, so
    certificates without it keep their exact bytes."""
    assert kind in ("issuer", "developer")
    tbs = {"format": 1, "type": kind, "keyId": key_id(public), "publicKey": b64(public), "publisher": publisher,
           "name": name, "scopes": sorted(scopes), "firstParty": bool(first_party),
           "notBefore": not_before, "notAfter": not_after, "serial": serial}
    if community:
        tbs["community"] = True
    return tbs


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


# ---- publication receipts (signing.md section 6a) ---------------------------------------------

class ClockError(ValueError):
    """The server clock is earlier than a receipt already issued (signing.md section 6a): publishing waits until it has caught up."""


def publication_message(kind: str, id_: str, version: str, platform: str, signer_key_id: str, digest: bytes, published_at: int) -> bytes:
    return (PUBLICATION_DOMAIN + lp(kind.encode()) + lp(id_.encode()) + lp(version.encode()) + lp(platform.encode())
            + lp(signer_key_id.encode()) + lp(digest) + struct.pack(">Q", published_at))


def make_receipt(issuer: Ed25519PrivateKey, *, kind: str, id_: str, version: str, platform: str, signer_key_id: str,
                 digest: bytes, published_at: int) -> dict:
    """A publication receipt: the issuer's statement that this exact signed content was published at `published_at`."""
    sig = issuer.sign(publication_message(kind, id_, version, platform, signer_key_id, digest, published_at))
    return {"format": 1, "algorithm": "ed25519", "issuerKeyId": key_id(public_bytes(issuer)),
            "publishedAt": published_at, "signature": b64(sig)}


def issue_receipt(issuer: Ed25519PrivateKey, content, doc: dict | None, *, kind: str, id_: str, version: str, platform: str = "any",
                  roots: list[bytes], now: int | None = None, crl: dict | None = None, newest: int = 0) -> dict:
    """What the library does when it accepts a file: verify it as of the server's clock, then date it.

    Raises ValueError if the file is not `signed` right now (so a lapsed certificate, a revoked key or a bad signature gets no receipt),
    if the signing issuer is not this one, or if `now` is earlier than `newest`, the latest `publishedAt` already issued: a clock that
    jumped back must not date a release into the past. `content` is the entries or the content digest.
    """
    now = int(time.time()) if now is None else now
    res = verify(content, doc, kind=kind, id_=id_, version=version, platform=platform, roots=roots, now=now, crl=crl)
    if res.status != "signed":
        raise ValueError(f"no receipt for a release that is {res.status}" + (f": {res.reason}" if res.reason else ""))
    if doc["chain"][0]["tbs"]["keyId"] != key_id(public_bytes(issuer)):
        raise ValueError("the release was certified by another issuer")
    if now < newest:
        raise ClockError("the clock is earlier than the newest receipt: refusing to date a release into the past")
    digest = content if isinstance(content, (bytes, bytearray)) else content_digest(content)
    return make_receipt(issuer, kind=kind, id_=id_, version=version, platform=platform, signer_key_id=doc["keyId"],
                        digest=bytes(digest), published_at=now)


# ---- verify -----------------------------------------------------------------------------

class Result(NamedTuple):
    status: str            # signed | unsigned | expired | revoked | invalid
    publisher: str = ""    # "community" for a module the library signed for a community author (trust below)
    key_id: str = ""
    root: str = ""         # key id of the root that vouched for it
    reason: str = ""
    published_at: int = 0  # when the library published it, if a publication receipt dated the release (signing.md section 6a)
    trust: str = ""        # official (first-party key) | community (the library's community key) | developer (a developer's own key)


# ---- revocation list (signing.md section 8) -------------------------------------------------

def make_crl(issuer: Ed25519PrivateKey, issuer_cert: dict, *, serial: int, issued: int, revoked_keys=(), revoked_artifacts=()) -> dict:
    """The signed revocation list: the issuer's Ed25519 over CRL_DOMAIN + canonical(body), with the issuer certificate attached so
    a client can check it against its pinned root and nothing else. `serial` rises with every list."""
    body = {"format": 1, "serial": serial, "issued": issued,
            "revokedKeys": [{"keyId": k} for k in sorted(set(revoked_keys))],
            "revokedArtifacts": sorted(revoked_artifacts, key=lambda a: (a["kind"], a["id"], a["version"], a["digest"]))}
    return {**body, "issuer": issuer_cert, "signature": b64(issuer.sign(CRL_DOMAIN + canonical(body)))}


def verify_crl(doc: dict, roots: list[bytes]) -> dict | None:
    """The body of a revocation list if the issuer's signature holds and the issuer certificate is one of a pinned root's, else None.
    Validity dates are not checked: a list can only take trust away, so one from a lapsed issuer is still worth applying."""
    try:
        cert = doc["issuer"]
        tbs = cert["tbs"]
        issuer_pub = base64.b64decode(tbs["publicKey"])
        if tbs["type"] != "issuer" or "issue" not in tbs["scopes"] or tbs["keyId"] != key_id(issuer_pub):
            return None
        if not any(cert["issuer"] == key_id(r) and _check_cert(cert, r) for r in roots):
            return None
        body = {k: doc[k] for k in ("format", "serial", "issued", "revokedKeys", "revokedArtifacts")}
        if body["format"] != 1 or not isinstance(body["serial"], int) or not _verify_sig(issuer_pub, base64.b64decode(doc["signature"]), CRL_DOMAIN + canonical(body)):
            return None
        return body
    except (KeyError, TypeError, ValueError):
        return None


def _verify_sig(public: bytes, signature: bytes, message: bytes) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(public).verify(signature, message)
        return True
    except (InvalidSignature, ValueError):
        return False


def _check_cert(cert: dict, signer_public: bytes) -> bool:
    return _verify_sig(signer_public, base64.b64decode(cert["signature"]), CERT_DOMAIN + canonical(cert["tbs"]))


def verify(content, doc: dict | None, *, kind: str, id_: str, version: str, platform: str = "any",
           roots: list[bytes], now: int | None = None, crl: dict | None = None, receipt: dict | None = None) -> Result:
    """Checks a package against the pinned root public keys. Never raises on bad input: it returns "invalid".

    `content` is the package's entries (see content_digest) or the 32-byte content digest itself.

    Order: the signature's shape, the certificate chain (root > issuer > developer), revocation, the developer's
    right to this kind and id, the signature over the content, then validity: at `now`, or, with a publication
    `receipt` from the library, at the time it says (the device clock then plays no part).
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
        community = dev_tbs.get("community") is True
        if community and (dev_tbs["scopes"] != ["module"] or dev_tbs["firstParty"] or dev_tbs["publisher"] != COMMUNITY_PUBLISHER):
            return Result("invalid", reason="a community certificate may only sign modules, as the 'community' publisher")
        who = Result("signed", dev_tbs["publisher"], dev_tbs["keyId"], key_id(root),
                     trust="community" if community else "official" if dev_tbs["firstParty"] else "developer")

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
        # a publisher signs "<publisher>/<name>"; only a first-party certificate signs bare ids; the library's community key signs
        # any "<author>/<name>" (the library has checked that the author owns the namespace), never a bare id
        if community:
            in_namespace = "/" in id_
        else:
            in_namespace = (dev_tbs["firstParty"] and "/" not in id_) or id_.startswith(dev_tbs["publisher"] + "/")
        if not in_namespace:
            return Result("invalid", reason=f"{id_!r} is not in the publisher's namespace")
        if not _verify_sig(dev_pub, base64.b64decode(doc["signature"]),
                           signing_message(kind, id_, version, platform, dev_tbs["keyId"], digest)):
            return Result("invalid", reason="the signature does not match the content")
        # validity comes last: an expired signer is not an attack, just old. A receipt moves the moment that counts from now to publishedAt.
        at, dated = now, 0
        if receipt is not None:
            published = receipt["publishedAt"]
            if (receipt["format"] != 1 or receipt["algorithm"] != "ed25519" or receipt["issuerKeyId"] != issuer_tbs["keyId"]
                    or type(published) is not int or not 0 <= published < 2 ** 64):
                return Result("invalid", reason="bad publication receipt")
            if not _verify_sig(issuer_pub, base64.b64decode(receipt["signature"]),
                               publication_message(kind, id_, version, platform, dev_tbs["keyId"], digest, published)):
                return Result("invalid", reason="the publication receipt does not match the release")
            at, dated = published, published
        for t in (issuer_tbs, dev_tbs):
            if not t["notBefore"] <= at <= t["notAfter"]:
                if receipt is not None:  # the library dated it outside the certificate: a bug or a leaked issuer key, not a lapsed developer
                    return Result("invalid", reason="the publication receipt dates the release outside the certificate's validity period")
                return Result("expired", who.publisher, who.key_id, who.root, "the certificate is outside its validity period")
        return who._replace(published_at=dated)
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
    if publisher == COMMUNITY_PUBLISHER:
        raise ValueError("'community' is the library's own publisher: it is made with `python -m app.cli community-init`")
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


def write_secret(path, data: bytes | str) -> None:
    """Writes a secret file that is 0600 from its first byte (no moment with default permissions); an existing file is replaced."""
    if isinstance(data, str):
        data = data.encode()
    path = Path(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        os.fchmod(fd, 0o600)  # an older file keeps its mode through O_CREAT; fix it before the new content goes in
        with os.fdopen(fd, "wb") as f:
            fd = -1
            f.write(data)
    finally:
        if fd >= 0:
            os.close(fd)


def save_key(key: Ed25519PrivateKey, path: Path) -> None:
    pw = os.environ.get("BLEEP_KEY_PASSPHRASE")
    enc = serialization.BestAvailableEncryption(pw.encode()) if pw else serialization.NoEncryption()
    write_secret(path, key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, enc))


def issuer_key_pem() -> str | None:
    """The store's issuer key as PEM: from BLEEP_ISSUER_KEY_FILE when set (a Docker secret), else BLEEP_ISSUER_KEY (with \\n for newlines)."""
    from .config import settings
    if settings.issuer_key_file:
        try:
            return Path(settings.issuer_key_file).read_text()
        except OSError as e:
            if not settings.issuer_key:
                raise ValueError(f"Cannot read the issuer key file {settings.issuer_key_file}: {e}") from e
    return settings.issuer_key.replace("\\n", "\n") if settings.issuer_key else None


def community_key_pem() -> str | None:
    """The library's community key as PEM: from BLEEP_COMMUNITY_KEY_FILE when set (a Docker secret), else BLEEP_COMMUNITY_KEY (with \\n for newlines)."""
    from .config import settings
    if settings.community_key_file:
        try:
            return Path(settings.community_key_file).read_text()
        except OSError as e:
            if not settings.community_key:
                raise ValueError(f"Cannot read the community key file {settings.community_key_file}: {e}") from e
    return settings.community_key.replace("\\n", "\n") if settings.community_key else None


def issue_community_cert(issuer_key: Ed25519PrivateKey, issuer_cert: dict, community_key: Ed25519PrivateKey, *, days: int = 365,
                         now: int | None = None, serial: int = 1) -> dict:
    """The certificate of the library's community key: issued by the issuer, modules only, publisher "community"."""
    t = int(time.time()) if now is None else now
    tbs = new_tbs("developer", public_bytes(community_key), publisher=COMMUNITY_PUBLISHER, name="Bleep community modules", scopes=["module"],
                  community=True, not_before=t, not_after=t + days * 86400, serial=serial)
    return make_cert(issuer_key, issuer_cert, tbs)


def read_doc(package: Path) -> dict | None:
    if package.is_dir():
        f = package / SIGNATURE_PATH
        return json.loads(f.read_text()) if f.exists() else None
    with zipfile.ZipFile(package) as z:
        return json.loads(read_member(z, SIGNATURE_PATH)) if SIGNATURE_PATH in z.namelist() else None


def write_doc(package: Path, doc: dict) -> None:
    text = json.dumps(doc, indent=1)
    if package.is_dir():
        (package / "META").mkdir(exist_ok=True)
        (package / SIGNATURE_PATH).write_text(text)
        return
    with zipfile.ZipFile(package) as z:  # rewrite without an older signature
        total = 0
        for i in z.infolist():
            if i.filename != SIGNATURE_PATH:
                total = check_member(i, total)
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
    issuer_cert = make_cert(root, None, new_tbs("issuer", public_bytes(issuer), publisher="bleep", name="Bleep library issuer",
                                                scopes=["issue"], not_before=t0, not_after=t1))
    dev_cert = make_cert(issuer, issuer_cert, new_tbs("developer", public_bytes(dev), publisher="acme", name="Acme Audio",
                                                      scopes=["module"], not_before=t0, not_after=t1))
    files = {"module.json": b'{"name":"Fuzz"}\n', "module.wasm": b"\x00asm\x01\x00\x00\x00", "ui/fuzz.js": b"// view\n"}
    entries = {p: (hashlib.sha256(c).digest(), False) for p, c in files.items()}
    doc = sign(entries, dev, [issuer_cert, dev_cert], "module", "acme/fuzz", "1.0.0")
    digest, dev_id, published = content_digest(entries), key_id(public_bytes(dev)), 1_765_000_000
    receipt = make_receipt(issuer, kind="module", id_="acme/fuzz", version="1.0.0", platform="any", signer_key_id=dev_id,
                           digest=digest, published_at=published)
    return {"publishedAt": published,
            "publicationMessage": publication_message("module", "acme/fuzz", "1.0.0", "any", dev_id, digest, published).hex(),
            "publicationSignature": base64.b64decode(receipt["signature"]).hex(),
            "root": public_bytes(root).hex(), "issuer": public_bytes(issuer).hex(), "developer": public_bytes(dev).hex(),
            "contentDigest": content_digest(entries).hex(),
            "message": signing_message("module", "acme/fuzz", "1.0.0", "any", key_id(public_bytes(dev)), content_digest(entries)).hex(),
            "signature": base64.b64decode(doc["signature"]).hex(), "developerKeyId": key_id(public_bytes(dev))}
