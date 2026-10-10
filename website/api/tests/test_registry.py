# SPDX-License-Identifier: MIT
import hashlib
import io
import json
import types
import zipfile

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app import signing
from app.config import settings
from app.storage import MemoryStorage, get_storage
from tests.test_api import login_as_admin, register


@pytest.fixture
def storage():
    return get_storage()


@pytest.fixture(autouse=True)
def clean_storage(storage):
    assert isinstance(storage, MemoryStorage)
    storage.objects.clear()


NOW = None  # set by the pki fixture


@pytest.fixture(autouse=True)
def pki(monkeypatch):
    """A registry's root and issuer; the settings trust the root. Releases below are signed by a kit made from them."""
    root, issuer = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    t = int(__import__("time").time())
    issuer_cert = signing.make_cert(root, None, signing.new_tbs("issuer", signing.public_bytes(issuer), publisher="bleep",
                                                                scopes=["issue"], not_before=t - 60, not_after=t + 10 * 86400))
    monkeypatch.setattr(settings, "root_public_keys", signing.public_bytes(root).hex())
    monkeypatch.setattr(settings, "require_signatures", True)
    monkeypatch.setattr(settings, "issuer_key", issuer.private_bytes(
        signing.serialization.Encoding.PEM, signing.serialization.PrivateFormat.PKCS8, signing.serialization.NoEncryption()).decode())
    monkeypatch.setattr(settings, "issuer_cert", json.dumps(issuer_cert))
    p = types.SimpleNamespace(root=root, issuer=issuer, issuer_cert=issuer_cert)
    p.kit = lambda publisher="bleep", scopes=("module", "plugin"), first_party=None: signing.issue_kit(
        issuer, issuer_cert, publisher, scopes=scopes, first_party=(publisher == "bleep") if first_party is None else first_party, now=t - 30)
    p.first_party = p.kit()
    globals()["PKI"] = p
    return p


def declare(path, data, *, slug="bleep-patch", version="0.1.0", platform="macos-arm64", kit=None, kind="plugin"):
    """A file declaration for a release, signed like scripts/release/release.py does."""
    kit = kit or PKI.first_party
    sha = hashlib.sha256(data).digest()
    sig = signing.sign_with_kit(signing.entries_for_file(path, sha), kit, kind, slug.replace(".", "/", 1), version, platform)
    return {"path": path, "sha256": sha.hex(), "bytes": len(data), "platform": platform, "signature": sig}


def module_files(types, abi=1, wasm=b"\x00asm\x01\x00\x00\x00"):
    """The files of a module package with a module.json that declares these node types."""
    meta = {"name": "Fuzz", "types": types, "requires": {"engineAbi": abi}}
    return {"module.json": json.dumps(meta).encode(), "module.wasm": wasm}


def module_zip(files, kit, slug, version, tamper=False):
    """A .bleepmod and its declaration: files {path: bytes}; tamper changes a file after signing."""
    entries = {p: (hashlib.sha256(c).digest(), False) for p, c in files.items()}
    sig = signing.sign_with_kit(entries, kit, "module", slug.replace(".", "/", 1), version, "any")
    if tamper:
        files = {**files, "module.wasm": files["module.wasm"] + b"x"}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for p, c in files.items():
            z.writestr(p, c)
    data = buf.getvalue()
    path = f"{slug}-{version}.bleepmod"
    return data, {"path": path, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "platform": "any",
                  "contentDigest": signing.content_digest(entries).hex(), "signature": sig}


def make_token(client, make_admin):
    login_as_admin(client, make_admin)
    r = client.post("/api/admin/tokens", json={"name": "ci"})
    assert r.status_code == 201
    client.post("/api/auth/logout")
    return r.json()["token"]


def release(client, token, slug="bleep-patch", version="0.1.0", data=b"zipdata", publish=True, channel="stable"):
    h = {"Authorization": f"Bearer {token}"}
    body = {"version": version, "channel": channel, "files": [declare(f"{slug}-{version}.zip", data, slug=slug, version=version)]}
    r = client.post(f"/api/registry/plugin/{slug}/releases", json=body, headers=h)
    if r.status_code != 201:
        return r
    up = client.put(f"/api/registry/plugin/{slug}/releases/{version}/files/{slug}-{version}.zip", content=data, headers=h)
    assert up.status_code == 204, up.text
    return client.post(f"/api/registry/plugin/{slug}/releases/{version}/publish", headers=h) if publish else r


def test_only_admins_create_tokens(client, make_admin):
    assert client.post("/api/admin/tokens", json={"name": "x"}).status_code == 401
    register(client)
    assert client.post("/api/admin/tokens", json={"name": "x"}).status_code == 403
    client.post("/api/auth/logout")
    login_as_admin(client, make_admin)
    r = client.post("/api/admin/tokens", json={"name": "laptop"})
    token = r.json()["token"]
    assert token.startswith("blp_") and r.json()["prefix"] == token[:8]
    listed = client.get("/api/admin/tokens").json()
    assert len(listed) == 1 and "token" not in listed[0] and token not in json.dumps(listed)
    assert client.delete(f"/api/admin/tokens/{listed[0]['id']}").status_code == 204


def test_release_needs_a_token(client, make_admin):
    body = {"version": "0.1.0", "files": [{"path": "a.zip", "sha256": "0" * 64, "bytes": 1}]}
    assert client.post("/api/registry/plugin/bleep-patch/releases", json=body).status_code == 401
    assert client.post("/api/registry/plugin/bleep-patch/releases", json=body, headers={"Authorization": "Bearer nope"}).status_code == 401
    login_as_admin(client, make_admin)  # a login cookie is not enough
    assert client.post("/api/registry/plugin/bleep-patch/releases", json=body).status_code == 401


def test_revoked_token_stops_working(client, make_admin):
    token = make_token(client, make_admin)
    assert release(client, token).status_code == 200
    client.post("/api/auth/login", json={"email": "admin@example.com", "password": "admin-password-1"})
    client.delete(f"/api/admin/tokens/{client.get('/api/admin/tokens').json()[0]['id']}")
    client.post("/api/auth/logout")
    assert release(client, token, version="0.2.0").status_code == 401


def test_release_flow_writes_files_entry_and_index(client, make_admin, storage):
    token = make_token(client, make_admin)
    r = release(client, token)
    assert r.status_code == 200 and r.json()["status"] == "published"
    assert storage.objects["v1/plugins/bleep-patch/0.1.0/bleep-patch-0.1.0.zip"] == b"zipdata"
    entry = json.loads(storage.objects["v1/plugins/bleep-patch/0.1.0/entry.json"])
    assert entry["version"] == "0.1.0" and entry["files"][0]["platform"] == "macos-arm64"
    index = json.loads(storage.objects["v1/index.json"])
    assert index["channels"]["stable"]["plugins"]["bleep-patch"]["version"] == "0.1.0"
    assert client.get("/api/registry/plugin/bleep-patch/versions").json()[0]["version"] == "0.1.0"  # anonymous


def test_versions_must_increase(client, make_admin):
    token = make_token(client, make_admin)
    assert release(client, token, version="1.2.0").status_code == 200
    assert release(client, token, version="1.2.0").status_code == 409
    assert release(client, token, version="1.1.9").status_code == 409
    assert release(client, token, version="1.2.1").status_code == 200
    assert [v["version"] for v in client.get("/api/registry/plugin/bleep-patch/versions").json()] == ["1.2.0", "1.2.1"]


def test_upload_is_checked_and_publish_needs_all_files(client, make_admin, storage):
    token = make_token(client, make_admin)
    h = {"Authorization": f"Bearer {token}"}
    data = b"abc"
    client.post("/api/registry/plugin/p/releases", headers=h, json={"version": "0.1.0", "files": [declare("p.zip", data, slug="p")]})
    url = "/api/registry/plugin/p/releases/0.1.0"
    assert client.post(f"{url}/publish", headers=h).status_code == 409  # nothing uploaded
    assert client.put(f"{url}/files/p.zip", content=b"abd", headers=h).status_code == 422  # wrong hash
    assert client.put(f"{url}/files/p.zip", content=b"abcd", headers=h).status_code == 413  # too long
    assert client.put(f"{url}/files/other.zip", content=data, headers=h).status_code == 404
    assert "v1/plugins/p/0.1.0/p.zip" not in storage.objects
    assert client.put(f"{url}/files/p.zip", content=data, headers=h).status_code == 204
    assert client.post(f"{url}/publish", headers=h).status_code == 200
    assert client.put(f"{url}/files/p.zip", content=data, headers=h).status_code == 409  # immutable


def test_beta_channel_is_only_in_the_beta_index(client, make_admin, storage):
    token = make_token(client, make_admin)
    release(client, token, version="1.0.0")
    release(client, token, version="1.1.0", channel="beta")
    ch = json.loads(storage.objects["v1/index.json"])["channels"]
    assert ch["stable"]["plugins"]["bleep-patch"]["version"] == "1.0.0"
    assert ch["beta"]["plugins"]["bleep-patch"]["version"] == "1.1.0"


def test_rejects_bad_paths(client, make_admin):
    token = make_token(client, make_admin)
    h = {"Authorization": f"Bearer {token}"}
    for path in ("../x.zip", "/abs.zip", "a/../b.zip", "a b.zip"):
        r = client.post("/api/registry/plugin/p/releases", headers=h, json={"version": "0.1.0", "files": [
            {"path": path, "sha256": "0" * 64, "bytes": 1}]})
        assert r.status_code == 422, path


def test_cli_token_roundtrip(client, capsys):
    from app import cli
    cli.main(["token-create", "laptop", "--days", "30"])
    token = capsys.readouterr().out.strip().splitlines()[-1]
    assert token.startswith("blp_")
    assert release(client, token).status_code == 200
    cli.main(["token-list"])
    out = capsys.readouterr().out
    assert "laptop" in out and token not in out
    cli.main(["token-revoke", "1"])
    assert release(client, token, version="0.2.0").status_code == 401


def test_token_check(client, make_admin):
    assert client.get("/api/registry/token").status_code == 401
    token = make_token(client, make_admin)
    assert client.get("/api/registry/token", headers={"Authorization": f"Bearer {token}"}).json() == {"name": "ci"}


def test_store_lists_published_without_login(client, make_admin):
    token = make_token(client, make_admin)
    assert release(client, token, "bleep-patch", "0.1.0").status_code == 200
    assert release(client, token, "bleep-patch", "0.2.0").status_code == 200
    assert release(client, token, "bleep-patch", "0.3.0", publish=False).status_code == 201
    assert release(client, token, "other-fx", "1.0.0").status_code == 200
    r = client.get("/api/store")  # public: no login
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2 and [(i["slug"], i["version"]) for i in body["items"]] == [("bleep-patch", "0.2.0"), ("other-fx", "1.0.0")]
    assert client.get("/api/store?kind=module").json()["total"] == 0
    assert client.get("/api/store?kind=preset").json()["items"] == []
    assert [i["slug"] for i in client.get("/api/store?q=OTHER").json()["items"]] == ["other-fx"]
    page = client.get("/api/store?page=2&page_size=1").json()
    assert page["total"] == 2 and [i["slug"] for i in page["items"]] == ["other-fx"]
    assert client.get("/api/store?page=0").status_code == 422


def test_store_detail_is_public_and_hides_drafts(client, make_admin):
    token = make_token(client, make_admin)
    assert release(client, token, "bleep-patch", "0.1.0").status_code == 200
    assert release(client, token, "bleep-patch", "0.2.0", publish=False).status_code == 201
    r = client.get("/api/store/plugin/bleep-patch")
    assert r.status_code == 200
    assert [x["version"] for x in r.json()["releases"]] == ["0.1.0"]
    f = r.json()["releases"][0]["file_list"][0]
    assert f["uploaded"] is True and f["signer"]["publisher"] == "bleep" and "uploaded_by" not in f
    assert client.get("/api/store/module/bleep-patch").status_code == 404
    assert client.get("/api/store/bogus/x").status_code == 422


def test_platform_can_be_added_to_a_published_release(client, make_admin, storage):
    token = make_token(client, make_admin)
    h = {"Authorization": f"Bearer {token}"}
    assert release(client, token).status_code == 200
    url = "/api/registry/plugin/bleep-patch/releases/0.1.0"
    data = b"linuxzip"
    f = declare("bleep-patch-0.1.0-linux-x86_64.zip", data, platform="linux-x86_64")
    assert client.post(url + "/platforms", json={"files": [declare(f["path"], data, platform="macos-arm64")]}, headers=h).status_code == 409
    assert client.post(url + "/platforms", json={"files": [f]}, headers=h).status_code == 200
    entry_key = "v1/plugins/bleep-patch/0.1.0/entry.json"
    assert [x["platform"] for x in json.loads(storage.objects[entry_key])["files"]] == ["macos-arm64"]  # not until uploaded
    assert client.put(url + "/files/" + f["path"], content=data, headers=h).status_code == 204
    assert [x["platform"] for x in json.loads(storage.objects[entry_key])["files"]] == ["macos-arm64", "linux-x86_64"]
    assert client.put(url + "/files/" + f["path"], content=data, headers=h).status_code == 409  # uploaded files never change
    assert client.put(url + "/files/bleep-patch-0.1.0.zip", content=b"other", headers=h).status_code == 409
    assert client.post(url + "/platforms", json={"files": [f]}, headers=h).status_code == 409
    assert client.post("/api/registry/plugin/bleep-patch/releases/9.9.9/platforms", json={"files": [f]}, headers=h).status_code == 404


# ---- signing (doc/specs/signing.md): the registry refuses releases without a valid developer signature

def new_token(capsys, publisher=None):
    from app import cli
    cli.main(["token-create", "dev"] + (["--publisher", publisher] if publisher else []))
    return capsys.readouterr().out.strip().splitlines()[-1]


def post_release(client, token, slug, version, files, kind="plugin"):
    return client.post(f"/api/registry/{kind}/{slug}/releases", json={"version": version, "files": files},
                       headers={"Authorization": f"Bearer {token}"})


def test_unsigned_release_is_refused(client, make_admin):
    token = make_token(client, make_admin)
    data = b"zipdata"
    f = declare("bleep-patch-0.1.0.zip", data)
    del f["signature"]
    r = post_release(client, token, "bleep-patch", "0.1.0", [f])
    assert r.status_code == 422 and "signature is required" in r.json()["detail"]
    assert client.get("/api/registry/plugin/bleep-patch/versions").json() == []


def test_a_signature_is_only_good_for_what_it_signed(client, make_admin):
    token = make_token(client, make_admin)
    data = b"zipdata"
    ok = declare("bleep-patch-0.1.0.zip", data)
    for name, f, slug, version in (
        ("other version", ok, "bleep-patch", "0.2.0"),
        ("other plugin", ok, "bleep-audio-bridge", "0.1.0"),
        ("other platform", {**ok, "platform": "windows-x86_64"}, "bleep-patch", "0.1.0"),
        ("other bytes", {**ok, "sha256": hashlib.sha256(b"different").hexdigest()}, "bleep-patch", "0.1.0"),
    ):
        r = post_release(client, token, slug, version, [f])
        assert r.status_code == 422 and "invalid" in r.json()["detail"], name
    assert post_release(client, token, "bleep-patch", "0.1.0", [ok]).status_code == 201


def test_a_signature_from_another_registry_is_refused(client, make_admin):
    token = make_token(client, make_admin)
    root, issuer = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    cert = signing.make_cert(root, None, signing.new_tbs("issuer", signing.public_bytes(issuer), publisher="bleep", scopes=["issue"],
                                                         not_before=0, not_after=2**33))
    evil = signing.issue_kit(issuer, cert, "bleep", scopes=("module", "plugin"), first_party=True)
    r = post_release(client, token, "bleep-patch", "0.1.0", [declare("bleep-patch-0.1.0.zip", b"x", kit=evil)])
    assert r.status_code == 422


def test_no_root_key_means_no_releases(client, make_admin, monkeypatch):
    token = make_token(client, make_admin)
    monkeypatch.setattr(settings, "root_public_keys", "")
    assert post_release(client, token, "bleep-patch", "0.1.0", [declare("bleep-patch-0.1.0.zip", b"x")]).status_code == 503


def test_token_may_only_release_for_its_publisher(client, make_admin, capsys):
    login_as_admin(client, make_admin)
    client.post("/api/auth/logout")
    from app import cli
    acme_kit = PKI.kit("acme", scopes=("module", "plugin"))
    plain = new_token(capsys)                       # no publisher: ours (bleep) only
    acme = new_token(capsys, "acme")
    data = b"zipdata"
    mine = [declare("bleep-patch-0.1.0.zip", data)]
    theirs = [declare("acme.fuzz-0.1.0.zip", data, slug="acme.fuzz", kit=acme_kit)]
    assert post_release(client, plain, "bleep-patch", "0.1.0", mine).status_code == 201
    assert post_release(client, plain, "acme.fuzz", "0.1.0", theirs).status_code == 403   # a bleep token cannot publish for acme
    assert post_release(client, acme, "bleep-patch", "0.2.0", [declare("bleep-patch-0.2.0.zip", data, version="0.2.0")]).status_code == 403
    assert post_release(client, acme, "acme.fuzz", "0.1.0", theirs).status_code == 201
    # and acme cannot sign a bare id, or an id in another namespace
    other = declare("evil-0.1.0.zip", data, slug="evil.fuzz", kit=acme_kit)
    assert post_release(client, acme, "evil.fuzz", "0.1.0", [other]).status_code == 422
    assert post_release(client, acme, "reverb", "0.1.0", [declare("reverb-0.1.0.zip", data, slug="reverb", kit=acme_kit)]).status_code == 422


def test_developer_scope_decides_what_may_be_signed(client, make_admin, capsys):
    login_as_admin(client, make_admin)
    client.post("/api/auth/logout")
    token = new_token(capsys, "acme")
    only_modules = PKI.kit("acme", scopes=("module",))
    r = post_release(client, token, "acme.fuzz", "0.1.0", [declare("acme.fuzz-0.1.0.zip", b"x", slug="acme.fuzz", kit=only_modules)])
    assert r.status_code == 422 and "does not allow" in r.json()["detail"]   # a plugin needs the plugin scope


def test_signed_module_package_flow_and_entry(client, make_admin, capsys, storage):
    token = new_token(capsys, "acme")
    kit = PKI.kit("acme", scopes=("module",))
    files = module_files(["acme/fuzz"])
    data, decl = module_zip(files, kit, "acme.fuzz", "1.0.0")
    h = {"Authorization": f"Bearer {token}"}
    assert post_release(client, token, "acme.fuzz", "1.0.0", [decl], kind="module").status_code == 201
    url = "/api/registry/module/acme.fuzz/releases/1.0.0"
    assert client.put(f"{url}/files/{decl['path']}", content=data, headers=h).status_code == 204
    assert client.post(f"{url}/publish", headers=h).status_code == 200
    entry = json.loads(storage.objects["v1/modules/acme.fuzz/1.0.0/entry.json"])
    f = entry["files"][0]
    assert f["signer"]["publisher"] == "acme" and f["contentDigest"] == decl["contentDigest"] and f["signature"]["chain"]
    assert entry["types"] == ["acme/fuzz"] and entry["requires"]["engineAbi"] == 1
    index = json.loads(storage.objects["v1/index.json"])["channels"]["stable"]["modules"]["acme.fuzz"]
    assert index["types"] == ["acme/fuzz"]  # a client finds the package of a node type from the index alone
    assert "token" not in json.dumps(entry)  # who uploaded stays in the database
    # what a client does with the entry and the downloaded file
    res = signing.verify(signing.read_entries(io.BytesIO(data)), f["signature"], kind="module", id_="acme/fuzz", version="1.0.0",
                         roots=settings.roots)
    assert res.status == "signed" and res.publisher == "acme"


def test_package_that_is_not_what_was_signed_is_refused(client, make_admin, capsys):
    token = new_token(capsys, "acme")
    kit = PKI.kit("acme", scopes=("module",))
    data, decl = module_zip(module_files(["acme/fuzz"], wasm=b"\x00asm"), kit, "acme.fuzz", "1.0.0", tamper=True)
    h = {"Authorization": f"Bearer {token}"}
    assert post_release(client, token, "acme.fuzz", "1.0.0", [decl], kind="module").status_code == 201  # the declaration is fine …
    r = client.put(f"/api/registry/module/acme.fuzz/releases/1.0.0/files/{decl['path']}", content=data, headers=h)
    assert r.status_code == 422 and "not the ones that were signed" in r.json()["detail"]   # … the bytes are not
    r = client.put(f"/api/registry/module/acme.fuzz/releases/1.0.0/files/{decl['path']}", content=b"not a zip", headers=h)
    assert r.status_code == 422


def test_revoked_developer_key_is_refused(client, make_admin, capsys):
    from app import cli
    token = new_token(capsys, "acme")
    kit = PKI.kit("acme", scopes=("plugin",))
    cli.main(["developer-create", "other"])  # something else in the table
    capsys.readouterr()
    from app.db import SessionLocal
    from app.models import Developer, now
    with SessionLocal() as db:
        db.add(Developer(publisher="acme", key_id=kit["keyId"], scopes=["plugin"], not_after=now()))
        db.commit()
    f = declare("acme.fuzz-0.1.0.zip", b"x", slug="acme.fuzz", kit=kit)
    assert post_release(client, token, "acme.fuzz", "0.1.0", [f]).status_code == 201
    cli.main(["developer-revoke", kit["keyId"]])
    r = post_release(client, token, "acme.fuzz", "0.2.0", [declare("acme.fuzz-0.2.0.zip", b"x", slug="acme.fuzz", version="0.2.0", kit=kit)])
    assert r.status_code == 422 and "revoked" in r.json()["detail"]


def test_only_the_uploading_token_continues_a_draft(client, make_admin, capsys):
    a, b = new_token(capsys), new_token(capsys)
    data = b"zipdata"
    f = declare("bleep-patch-0.1.0.zip", data)
    assert post_release(client, a, "bleep-patch", "0.1.0", [f]).status_code == 201
    hb = {"Authorization": f"Bearer {b}"}
    url = "/api/registry/plugin/bleep-patch/releases/0.1.0"
    assert client.put(f"{url}/files/{f['path']}", content=data, headers=hb).status_code == 403
    assert post_release(client, b, "bleep-patch", "0.1.0", [f]).status_code == 403   # nor replace it
    assert client.post(f"{url}/publish", headers=hb).status_code == 403
    ha = {"Authorization": f"Bearer {a}"}
    assert client.put(f"{url}/files/{f['path']}", content=data, headers=ha).status_code == 204
    assert client.post(f"{url}/publish", headers=ha).status_code == 200


def test_added_platform_must_be_signed_by_the_same_publisher(client, make_admin, capsys):
    token = new_token(capsys)
    h = {"Authorization": f"Bearer {token}"}
    assert release(client, token).status_code == 200
    other = PKI.kit("bleep2", scopes=("plugin",), first_party=True)  # may sign bare ids, but is not "bleep"
    r = client.post("/api/registry/plugin/bleep-patch/releases/0.1.0/platforms", headers=h,
                    json={"files": [declare("x-linux.zip", b"y", platform="linux-x86_64", kit=other)]})
    assert r.status_code == 403  # a token for bleep, a signature by another


def test_developer_create_prints_a_kit_that_signs(client, capsys, make_admin):
    from app import cli
    cli.main(["developer-create", "acme", "--scopes", "module"])
    out = capsys.readouterr()
    kit = json.loads(out.out)
    assert kit["publisher"] == "acme" and "BEGIN PRIVATE KEY" in kit["privateKey"] and "secret" in out.err
    cli.main(["developer-list"])
    assert "acme" in capsys.readouterr().out
    entries = {"a": (hashlib.sha256(b"1").digest(), False)}
    doc = signing.sign_with_kit(entries, kit, "module", "acme/x", "1.0.0")
    assert signing.verify(entries, doc, kind="module", id_="acme/x", version="1.0.0", roots=settings.roots).status == "signed"
    with pytest.raises(SystemExit):
        cli.main(["developer-create", "Bad Name"])


def release_module(client, token, kit, slug, version, files):
    """Declares, uploads and publishes a module package; returns the upload response (the step the store checks the package at)."""
    h = {"Authorization": f"Bearer {token}"}
    data, decl = module_zip(files, kit, slug, version)
    assert post_release(client, token, slug, version, [decl], kind="module").status_code == 201
    up = client.put(f"/api/registry/module/{slug}/releases/{version}/files/{decl['path']}", content=data, headers=h)
    if up.status_code == 204:
        assert client.post(f"/api/registry/module/{slug}/releases/{version}/publish", headers=h).status_code == 200
    return up


def test_module_types_are_published_and_cannot_be_taken_over(client, make_admin, capsys):
    ours = new_token(capsys)  # bleep
    theirs = new_token(capsys, "acme")
    bleep_kit, acme_kit = PKI.first_party, PKI.kit("acme", scopes=("module",))
    assert release_module(client, ours, bleep_kit, "oscillator", "1.0.0", module_files(["oscillator"])).status_code == 204
    # a third party may not provide a type that exists, nor one outside its namespace
    up = release_module(client, theirs, acme_kit, "acme.copy", "1.0.0", module_files(["oscillator"]))
    assert up.status_code == 422 and "must start with 'acme/'" in up.json()["detail"]
    up = release_module(client, theirs, acme_kit, "acme.copy", "1.0.1", module_files(["acme/oscillator"]))
    assert up.status_code == 204
    # nor may another of our modules provide the same type name
    up = release_module(client, ours, bleep_kit, "oscillator2", "1.0.0", module_files(["oscillator"]))
    assert up.status_code == 409 and "already provided" in up.json()["detail"]
    # a new version of the module itself may keep its own types
    assert release_module(client, ours, bleep_kit, "oscillator", "1.0.1", module_files(["oscillator", "oscillator-sub"])).status_code == 204


def test_module_json_must_declare_types_and_abi(client, make_admin, capsys):
    token = new_token(capsys)
    for bad in ({"name": "x"}, {"types": [], "requires": {"engineAbi": 1}}, {"types": ["Bad Name"], "requires": {"engineAbi": 1}},
                {"types": ["a", "a"], "requires": {"engineAbi": 1}}, {"types": ["a"], "requires": {"engineAbi": "1"}}, {"types": "a", "requires": {"engineAbi": 1}}):
        files = {"module.json": json.dumps(bad).encode(), "module.wasm": b"\x00asm"}
        up = release_module(client, token, PKI.first_party, "mod-" + str(abs(hash(json.dumps(bad)))), "1.0.0", files)
        assert up.status_code == 422, bad
