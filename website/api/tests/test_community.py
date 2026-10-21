# SPDX-License-Identifier: MIT
"""Community modules (signing.md section 2a): an account uploads an unsigned package, the library checks and signs it."""
import hashlib
import io
import json
import zipfile

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app import community, signing
from app.config import settings
from app.db import SessionLocal
from app.models import Developer, Release, Report, User
from sqlalchemy import select
from tests import test_registry
from tests.test_api import register
from tests.test_registry import clean_storage, new_token, pki, post_release, storage  # noqa: F401  (fixtures)


def leb(n: int) -> bytes:
    out = b""
    while True:
        b = n & 0x7F
        n >>= 7
        out += bytes([b | (0x80 if n else 0)])
        if not n:
            return out


def name(s: str) -> bytes:
    return leb(len(s.encode())) + s.encode()


def section(sid: int, payload: bytes) -> bytes:
    return bytes([sid]) + leb(len(payload)) + payload


def fake_wasm(imports=(), exports=tuple(sorted(community.REQUIRED_EXPORTS))) -> bytes:
    """A binary the library's reader accepts: the header, the imports and the exports (bodies are not looked at)."""
    out = b"\0asm\x01\0\0\0"
    if imports:
        out += section(2, leb(len(imports)) + b"".join(name(m) + name(n) + b"\x00" + leb(0) for m, n in imports))
    out += section(7, leb(len(exports)) + b"".join(name(e) + (b"\x02" if e == "memory" else b"\x00") + leb(0) for e in exports))
    return out


def package(types=("zed/wobble",), *, wasm=None, extra=None, drop=(), meta=None) -> bytes:
    meta = meta if meta is not None else {"name": "Wobble", "types": list(types), "requires": {"engineAbi": 1}, "summary": "A wobble.", "license": "MIT"}
    files = {"module.json": json.dumps(meta).encode(), "module.wasm": wasm if wasm is not None else fake_wasm(), "spec.json": b"[]\n"}
    files.update(extra or {})
    for d in drop:
        files.pop(d, None)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for p, c in files.items():
            z.writestr(p, c)
    return buf.getvalue()


@pytest.fixture
def community_on(pki, monkeypatch):  # noqa: F811
    """The library's community key and certificate, as `community-init` makes them."""
    key = Ed25519PrivateKey.generate()
    t = int(__import__("time").time())
    cert = signing.issue_community_cert(pki.issuer, pki.issuer_cert, key, days=30, now=t - 30)
    monkeypatch.setattr(settings, "community_key", key.private_bytes(
        signing.serialization.Encoding.PEM, signing.serialization.PrivateFormat.PKCS8, signing.serialization.NoEncryption()).decode())
    monkeypatch.setattr(settings, "community_cert", json.dumps(cert))
    return types_ns(key=key, cert=cert)


def types_ns(**kw):
    import types
    return types.SimpleNamespace(**kw)


def author(client, email="zed@example.com", display="Zed"):
    register(client, email, display)
    return client


def put(client, data, name="wobble", version="1.0.0"):
    return client.put(f"/api/registry/community/modules/{name}/{version}", content=data)


def test_an_account_publishes_and_the_library_signs(client, community_on, storage):
    author(client)
    r = put(client, package())
    assert r.status_code == 201, r.text
    assert r.json()["id"] == "zed/wobble" and r.json()["trust"] == "community"

    entry = json.loads(storage.objects["v1/modules/zed.wobble/1.0.0/entry.json"])
    assert entry["trust"] == "community" and entry["types"] == ["zed/wobble"]
    f = entry["files"][0]
    assert f["signer"]["publisher"] == "community" and f["signer"]["author"] == "zed" and f["publication"]
    index = json.loads(storage.objects["v1/index.json"])
    assert index["channels"]["stable"]["modules"]["zed.wobble"]["trust"] == "community"

    # the stored package is the uploaded files plus the library's signature, and verifies against the root alone
    z = zipfile.ZipFile(io.BytesIO(storage.objects["v1/modules/zed.wobble/1.0.0/wobble.bleepmod"]))
    doc = json.loads(z.read("META/signature.json"))
    entries = signing.read_entries(io.BytesIO(storage.objects["v1/modules/zed.wobble/1.0.0/wobble.bleepmod"]))
    res = signing.verify(entries, doc, kind="module", id_="zed/wobble", version="1.0.0", roots=settings.roots, receipt=f["publication"])
    assert (res.status, res.trust, res.publisher) == ("signed", "community", "community")
    assert hashlib.sha256(storage.objects["v1/modules/zed.wobble/1.0.0/wobble.bleepmod"]).hexdigest() == f["sha256"]
    # the key signs this author's namespace only because the library said so: the same signature does not hold for another id
    other = signing.verify(entries, doc, kind="module", id_="alice/wobble", version="1.0.0", roots=settings.roots)
    assert other.status == "invalid"


def test_the_library_list_shows_who_vouches(client, community_on):
    author(client)
    assert put(client, package()).status_code == 201
    items = client.get("/api/library").json()["items"]
    assert [(i["slug"], i["trust"]) for i in items if i["kind"] == "module"] == [("zed.wobble", "community")]


def test_login_is_required_and_the_library_must_be_set_up(client, community_on, monkeypatch):
    assert put(client, package()).status_code == 401
    author(client)
    monkeypatch.setattr(settings, "community_key", None)
    monkeypatch.setattr(settings, "community_key_file", None)
    assert put(client, package()).status_code == 503


@pytest.mark.parametrize("data,why", ids=lambda v: v if isinstance(v, str) and len(v) < 60 else "package", argvalues=[
    (b"not a zip", "not a .bleepmod"),
    (package(extra={"ui/view.js": b"alert(1)"}), "cannot bring its own JavaScript"),
    (package(extra={"META/signature.json": b"{}"}), "upload the package unsigned"),
    (package(extra={"evil.exe": b"MZ"}), "not allowed in a community package"),
    (package(extra={"doc/pic.png": b"not a png"}), "not a PNG"),
    (package(drop=("spec.json",)), "Missing from the package"),
    (package(wasm=fake_wasm(imports=[("env", "fetch")])), "imports env.fetch"),
    (package(wasm=fake_wasm(imports=[("wasi_snapshot_preview1", "path_open")])), "path_open"),
    (package(wasm=fake_wasm(exports=("memory",))), "does not export"),
    (package(wasm=b"\0asm\x02\0\0\0"), "cannot read the file"),
    (package(types=("oscillator",)), "must start with 'zed/'"),
    (package(types=("alice/wobble",)), "must start with 'zed/'"),
    (package(meta={"types": ["zed/w"], "requires": {"engineAbi": 99}}), "engineAbi"),
    (package(meta={"types": ["zed/w"], "requires": {"engineAbi": 1}, "license": "<script>"}), "license"),
])
def test_a_package_that_breaks_a_rule_is_refused(client, community_on, data, why):
    author(client)
    r = put(client, data)
    assert r.status_code == 422 and why in r.json()["detail"], r.text
    assert client.get("/api/library").json()["items"] == []


def test_versions_rise_and_types_are_not_shared(client, community_on):
    author(client)
    assert put(client, package()).status_code == 201
    assert put(client, package()).status_code == 409  # the same version
    assert put(client, package(), version="1.0.1").status_code == 201
    assert put(client, package(), name="other", version="1.0.0").status_code == 409  # "zed/wobble" belongs to the module wobble
    assert put(client, package(types=("zed/other",)), name="other").status_code == 201


def test_a_namespace_a_developer_holds_is_not_for_authors(client, community_on):
    with SessionLocal() as db:
        db.add(Developer(publisher="acme", key_id="0" * 32, scopes=["module"], not_after=__import__("app.models", fromlist=["now"]).now()))
        db.commit()
    author(client, "acme@example.com", "Acme")
    r = put(client, package(types=("acme/wobble",)))
    assert r.status_code == 409 and "reserved" in r.json()["detail"]
    author(client, "bleep@example.com", "Bleep")
    assert put(client, package(types=("bleep/wobble",))).status_code == 409


def test_only_the_author_or_an_admin_takes_a_release_down(client, community_on, make_admin, storage):
    from tests.test_api import login_as_admin
    author(client)
    assert put(client, package()).status_code == 201
    url = "/api/registry/community/modules/zed.wobble/1.0.0/takedown"

    client.cookies.clear()
    author(client, "mallory@example.com", "Mallory")
    assert client.post(url).status_code == 404  # not hers: it looks like there is no such module

    client.cookies.clear()
    login_as_admin(client, make_admin)
    assert client.post(url).status_code == 204
    crl = signing.verify_crl(json.loads(storage.objects["v1/revocations.json"]), settings.roots)
    assert [a["id"] for a in crl["revokedArtifacts"]] == ["zed/wobble"]
    assert client.post(url).status_code == 204  # again: nothing changes


def test_the_author_withdraws_their_own_release(client, community_on, storage):
    author(client)
    assert put(client, package()).status_code == 201
    assert client.post("/api/registry/community/modules/zed.wobble/1.0.0/takedown").status_code == 204
    assert "zed.wobble" not in json.loads(storage.objects["v1/index.json"])["channels"]["stable"]["modules"]


def test_takedown_by_the_cli_and_the_signed_list(client, community_on, storage, capsys):
    from app import cli
    author(client)
    assert put(client, package()).status_code == 201
    entry = json.loads(storage.objects["v1/modules/zed.wobble/1.0.0/entry.json"])
    f = entry["files"][0]
    cli.main(["community-takedown", "zed/wobble", "1.0.0"])
    crl = signing.verify_crl(json.loads(storage.objects["v1/revocations.json"]), settings.roots)
    assert crl["revokedArtifacts"] == [{"kind": "module", "id": "zed/wobble", "version": "1.0.0", "digest": f["contentDigest"]}]
    assert "zed.wobble" not in json.loads(storage.objects["v1/index.json"])["channels"]["stable"]["modules"]
    # a client that still has the package refuses it
    z = zipfile.ZipFile(io.BytesIO(storage.objects["v1/modules/zed.wobble/1.0.0/wobble.bleepmod"]))
    entries = signing.read_entries(io.BytesIO(storage.objects["v1/modules/zed.wobble/1.0.0/wobble.bleepmod"]))
    res = signing.verify(entries, json.loads(z.read("META/signature.json")), kind="module", id_="zed/wobble", version="1.0.0",
                         roots=settings.roots, crl=crl, receipt=f["publication"])
    assert res.status == "revoked"
    # the version number is used up
    assert put(client, package()).status_code == 409
    with pytest.raises(SystemExit):
        cli.main(["community-takedown", "zed/nothing", "1.0.0"])


def test_ban_takes_down_everything_and_signs_the_author_out(client, community_on, storage):
    from app import cli
    author(client)
    assert put(client, package()).status_code == 201
    cli.main(["community-ban", "zed"])
    assert put(client, package(), version="2.0.0").status_code == 401
    with SessionLocal() as db:
        assert db.scalar(select(Release.status).where(Release.slug == "zed.wobble")) == "taken_down"
        assert db.scalar(select(User.is_active).where(User.handle == "zed")) is False


def test_a_report_reaches_the_admin_list(client, community_on, make_admin):
    author(client)
    assert put(client, package()).status_code == 201
    client.cookies.clear()
    author(client, "reader@example.com", "Reader")
    assert client.post("/api/registry/community/modules/zed.wobble/1.0.0/report", json={"reason": "makes my ears bleed"}).status_code == 204
    with SessionLocal() as db:
        rep = db.scalar(select(Report))
        assert (rep.target, rep.reason) == ("module", "makes my ears bleed")


def test_a_developer_cannot_hand_the_library_a_community_signature(client, community_on, capsys):
    token = new_token(capsys, "community")
    files = {"module.json": json.dumps({"types": ["zed/x"], "requires": {"engineAbi": 1}}).encode(), "module.wasm": b"\0asm\x01\0\0\0"}
    entries = community.entries_of(files)
    doc = signing.sign(entries, community_on.key, [json.loads(settings.issuer_cert), community_on.cert], "module", "zed/x", "1.0.0")
    decl = {"path": "x.bleepmod", "sha256": "0" * 64, "bytes": 1, "platform": "any", "contentDigest": signing.content_digest(entries).hex(), "signature": doc}
    r = post_release(client, token, "zed.x", "1.0.0", [decl], kind="module")
    assert r.status_code == 403 and "made by the library itself" in r.json()["detail"]


def test_the_community_name_is_the_librarys(client, community_on, capsys, pki):  # noqa: F811
    from app import cli
    with pytest.raises(ValueError):
        signing.issue_kit(pki.issuer, pki.issuer_cert, "community")
    author(client)
    assert put(client, package()).status_code == 201
    with pytest.raises(SystemExit) as e:
        cli.main(["developer-create", "zed"])
    assert "community author" in str(e.value)


def test_community_init_makes_a_usable_key(client, pki, tmp_path, monkeypatch, capsys):  # noqa: F811
    from app import cli
    out = tmp_path / "community.env"
    cli.main(["community-init", "--out", str(out)])
    lines = dict(l.split("=", 1) for l in out.read_text().splitlines())
    monkeypatch.setattr(settings, "community_key", lines["BLEEP_COMMUNITY_KEY"])
    monkeypatch.setattr(settings, "community_cert", lines["BLEEP_COMMUNITY_CERT"])
    assert settings.community_enabled
    author(client)
    assert put(client, package()).status_code == 201
    with SessionLocal() as db:
        assert db.scalar(select(Developer.publisher).where(Developer.publisher == "community")) == "community"


def test_a_lapsed_community_certificate_publishes_nothing(client, pki, monkeypatch):  # noqa: F811
    key = Ed25519PrivateKey.generate()
    cert = signing.issue_community_cert(pki.issuer, pki.issuer_cert, key, days=1, now=int(__import__("time").time()) - 3 * 86400)
    monkeypatch.setattr(settings, "community_key", key.private_bytes(
        signing.serialization.Encoding.PEM, signing.serialization.PrivateFormat.PKCS8, signing.serialization.NoEncryption()).decode())
    monkeypatch.setattr(settings, "community_cert", json.dumps(cert))
    author(client)
    r = put(client, package())
    assert r.status_code == 503 and "expired" in r.json()["detail"]
