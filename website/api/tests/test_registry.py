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


def declare(path, data, *, slug="bleep-board", version="0.1.0", platform="macos-arm64", kit=None, kind="plugin"):
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


def release(client, token, slug="bleep-board", version="0.1.0", data=b"zipdata", publish=True, channel="stable"):
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
    assert client.post("/api/registry/plugin/bleep-board/releases", json=body).status_code == 401
    assert client.post("/api/registry/plugin/bleep-board/releases", json=body, headers={"Authorization": "Bearer nope"}).status_code == 401
    login_as_admin(client, make_admin)  # a login cookie is not enough
    assert client.post("/api/registry/plugin/bleep-board/releases", json=body).status_code == 401


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
    assert storage.objects["v1/plugins/bleep-board/0.1.0/bleep-board-0.1.0.zip"] == b"zipdata"
    entry = json.loads(storage.objects["v1/plugins/bleep-board/0.1.0/entry.json"])
    assert entry["version"] == "0.1.0" and entry["files"][0]["platform"] == "macos-arm64"
    index = json.loads(storage.objects["v1/index.json"])
    assert index["channels"]["stable"]["plugins"]["bleep-board"]["version"] == "0.1.0"
    assert client.get("/api/registry/plugin/bleep-board/versions").json()[0]["version"] == "0.1.0"  # anonymous


def test_versions_must_increase(client, make_admin):
    token = make_token(client, make_admin)
    assert release(client, token, version="1.2.0").status_code == 200
    assert release(client, token, version="1.2.0").status_code == 409
    assert release(client, token, version="1.1.9").status_code == 409
    assert release(client, token, version="1.2.1").status_code == 200
    assert [v["version"] for v in client.get("/api/registry/plugin/bleep-board/versions").json()] == ["1.2.0", "1.2.1"]


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
    assert ch["stable"]["plugins"]["bleep-board"]["version"] == "1.0.0"
    assert ch["beta"]["plugins"]["bleep-board"]["version"] == "1.1.0"


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


def test_library_lists_published_without_login(client, make_admin):
    token = make_token(client, make_admin)
    assert release(client, token, "bleep-board", "0.1.0").status_code == 200
    assert release(client, token, "bleep-board", "0.2.0").status_code == 200
    assert release(client, token, "bleep-board", "0.3.0", publish=False).status_code == 201
    assert release(client, token, "other-fx", "1.0.0").status_code == 200
    r = client.get("/api/library")  # public: no login
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2 and [(i["slug"], i["version"]) for i in body["items"]] == [("bleep-board", "0.2.0"), ("other-fx", "1.0.0")]
    assert client.get("/api/library?kind=module").json()["total"] == 0
    assert client.get("/api/library?kind=preset").json()["items"] == []
    assert [i["slug"] for i in client.get("/api/library?q=OTHER").json()["items"]] == ["other-fx"]
    page = client.get("/api/library?page=2&page_size=1").json()
    assert page["total"] == 2 and [i["slug"] for i in page["items"]] == ["other-fx"]
    assert client.get("/api/library?page=0").status_code == 422


PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 16


def test_library_tile_metadata_and_image(client, make_admin, storage):
    token = make_token(client, make_admin)
    h = {"Authorization": f"Bearer {token}"}
    data = b"zipdata"
    body = {"version": "0.1.0", "summary": "Slow waves for everything that moves.", "category": "Modulation",
            "files": [declare("lfo-0.1.0.zip", data, slug="lfo", version="0.1.0")]}
    assert client.post("/api/registry/plugin/lfo/releases", json=body, headers=h).status_code == 201
    client.put("/api/registry/plugin/lfo/releases/0.1.0/files/lfo-0.1.0.zip", content=data, headers=h)
    image = "/api/registry/plugin/lfo/releases/0.1.0/image"
    assert client.put(image, content=PNG, headers={**h, "Content-Type": "image/png"}).status_code == 204
    assert client.put(image, content=b"nope", headers={**h, "Content-Type": "image/png"}).status_code == 422
    assert client.put(image, content=PNG, headers={**h, "Content-Type": "text/html"}).status_code == 415
    assert client.put(image, content=PNG + b"\0" * (1024 * 1024), headers={**h, "Content-Type": "image/png"}).status_code == 413
    assert client.post("/api/registry/plugin/lfo/releases/0.1.0/publish", headers=h).status_code == 200
    assert storage.objects["v1/plugins/lfo/0.1.0/image.png"] == PNG
    entry = json.loads(storage.objects["v1/plugins/lfo/0.1.0/entry.json"])
    assert (entry["summary"], entry["category"], entry["image"]) == ("Slow waves for everything that moves.", "Modulation", "image.png")
    item = client.get("/api/library").json()["items"][0]
    assert item["image_url"] == "/registry/v1/plugins/lfo/0.1.0/image.png" and item["category"] == "Modulation"
    assert client.get("/api/library/plugin/lfo").json()["image_url"] == item["image_url"]
    tile = json.loads(storage.objects["v1/index.json"])["channels"]["stable"]["plugins"]["lfo"]  # the apps read their tiles from the index
    assert (tile["summary"], tile["category"], tile["image"]) == ("Slow waves for everything that moves.", "Modulation", "plugins/lfo/0.1.0/image.png")


def test_library_detail_shows_licence_and_origin(client, make_admin, storage):
    token = make_token(client, make_admin)
    h = {"Authorization": f"Bearer {token}"}
    origin = {"name": "Foo", "author": "A. Author", "url": "https://example.org/foo", "license": "GPL-3.0-or-later", "copyright": "(c) A"}
    body = {"version": "0.1.0", "license": "GPL-3.0-or-later", "origin": origin, "files": [declare("fuzz.zip", b"x", slug="fuzz", version="0.1.0")]}
    assert client.post("/api/registry/plugin/fuzz/releases", json=body, headers=h).status_code == 201
    client.put("/api/registry/plugin/fuzz/releases/0.1.0/files/fuzz.zip", content=b"x", headers=h)
    assert client.post("/api/registry/plugin/fuzz/releases/0.1.0/publish", headers=h).status_code == 200
    detail = client.get("/api/library/plugin/fuzz").json()
    assert (detail["license"], detail["origin"]["name"], detail["releases"][0]["license"]) == ("GPL-3.0-or-later", "Foo", "GPL-3.0-or-later")
    entry = json.loads(storage.objects["v1/plugins/fuzz/0.1.0/entry.json"])
    assert (entry["license"], entry["origin"]["url"]) == ("GPL-3.0-or-later", "https://example.org/foo")
    assert "license" not in client.get("/api/library").json()["items"][0]  # not on the tile
    bad = {**body, "version": "0.2.0", "origin": {**origin, "url": "javascript:alert(1)"}}
    assert client.post("/api/registry/plugin/fuzz/releases", json=bad, headers=h).status_code == 422


def test_library_filters_by_category_and_searches_the_summary(client, make_admin):
    token = make_token(client, make_admin)
    h = {"Authorization": f"Bearer {token}"}
    for slug, summary, category in (("lfo", "Slow waves", "Modulation"), ("osc", "A triangle core", "Sources"), ("plain", "", "")):
        body = {"version": "0.1.0", "summary": summary, "category": category, "files": [declare(f"{slug}.zip", b"x", slug=slug, version="0.1.0")]}
        assert client.post(f"/api/registry/plugin/{slug}/releases", json=body, headers=h).status_code == 201
        client.put(f"/api/registry/plugin/{slug}/releases/0.1.0/files/{slug}.zip", content=b"x", headers=h)
        client.post(f"/api/registry/plugin/{slug}/releases/0.1.0/publish", headers=h)
    everything = client.get("/api/library").json()
    assert everything["categories"] == ["Modulation", "Sources"] and everything["total"] == 3
    assert [i["slug"] for i in client.get("/api/library?category=Sources").json()["items"]] == ["osc"]
    assert [i["slug"] for i in client.get("/api/library?q=triangle").json()["items"]] == ["osc"]
    assert next(i for i in everything["items"] if i["slug"] == "plain")["image_url"] is None


def test_library_detail_is_public_and_hides_drafts(client, make_admin):
    token = make_token(client, make_admin)
    assert release(client, token, "bleep-board", "0.1.0").status_code == 200
    assert release(client, token, "bleep-board", "0.2.0", publish=False).status_code == 201
    r = client.get("/api/library/plugin/bleep-board")
    assert r.status_code == 200
    assert [x["version"] for x in r.json()["releases"]] == ["0.1.0"]
    f = r.json()["releases"][0]["file_list"][0]
    assert f["uploaded"] is True and f["signer"]["publisher"] == "bleep" and "uploaded_by" not in f
    assert client.get("/api/library/module/bleep-board").status_code == 404
    assert client.get("/api/library/bogus/x").status_code == 422


def test_platform_can_be_added_to_a_published_release(client, make_admin, storage):
    token = make_token(client, make_admin)
    h = {"Authorization": f"Bearer {token}"}
    assert release(client, token).status_code == 200
    url = "/api/registry/plugin/bleep-board/releases/0.1.0"
    data = b"linuxzip"
    f = declare("bleep-board-0.1.0-linux-x86_64.zip", data, platform="linux-x86_64")
    assert client.post(url + "/platforms", json={"files": [declare(f["path"], data, platform="macos-arm64")]}, headers=h).status_code == 409
    assert client.post(url + "/platforms", json={"files": [f]}, headers=h).status_code == 200
    entry_key = "v1/plugins/bleep-board/0.1.0/entry.json"
    assert [x["platform"] for x in json.loads(storage.objects[entry_key])["files"]] == ["macos-arm64"]  # not until uploaded
    assert client.put(url + "/files/" + f["path"], content=data, headers=h).status_code == 204
    assert [x["platform"] for x in json.loads(storage.objects[entry_key])["files"]] == ["macos-arm64", "linux-x86_64"]
    assert client.put(url + "/files/" + f["path"], content=data, headers=h).status_code == 409  # uploaded files never change
    assert client.put(url + "/files/bleep-board-0.1.0.zip", content=b"other", headers=h).status_code == 409
    assert client.post(url + "/platforms", json={"files": [f]}, headers=h).status_code == 409
    assert client.post("/api/registry/plugin/bleep-board/releases/9.9.9/platforms", json={"files": [f]}, headers=h).status_code == 404


# ---- signing (website/content/developers/modules/signing.md): the registry refuses releases without a valid developer signature

def new_token(capsys, publisher=None):
    from app import cli
    cli.main(["token-create", "dev"] + (["--publisher", publisher] if publisher else []))
    return capsys.readouterr().out.strip().splitlines()[-1]


def post_release(client, token, slug, version, files, kind="plugin", **extra):
    return client.post(f"/api/registry/{kind}/{slug}/releases", json={"version": version, "files": files, **extra},
                       headers={"Authorization": f"Bearer {token}"})


def test_unsigned_release_is_refused(client, make_admin):
    token = make_token(client, make_admin)
    data = b"zipdata"
    f = declare("bleep-board-0.1.0.zip", data)
    del f["signature"]
    r = post_release(client, token, "bleep-board", "0.1.0", [f])
    assert r.status_code == 422 and "signature is required" in r.json()["detail"]
    assert client.get("/api/registry/plugin/bleep-board/versions").json() == []


def test_a_signature_is_only_good_for_what_it_signed(client, make_admin):
    token = make_token(client, make_admin)
    data = b"zipdata"
    ok = declare("bleep-board-0.1.0.zip", data)
    for name, f, slug, version in (
        ("other version", ok, "bleep-board", "0.2.0"),
        ("other plugin", ok, "bleep-audio-bridge", "0.1.0"),
        ("other platform", {**ok, "platform": "windows-x86_64"}, "bleep-board", "0.1.0"),
        ("other bytes", {**ok, "sha256": hashlib.sha256(b"different").hexdigest()}, "bleep-board", "0.1.0"),
    ):
        r = post_release(client, token, slug, version, [f])
        assert r.status_code == 422 and "invalid" in r.json()["detail"], name
    assert post_release(client, token, "bleep-board", "0.1.0", [ok]).status_code == 201


def test_a_signature_from_another_registry_is_refused(client, make_admin):
    token = make_token(client, make_admin)
    root, issuer = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    cert = signing.make_cert(root, None, signing.new_tbs("issuer", signing.public_bytes(issuer), publisher="bleep", scopes=["issue"],
                                                         not_before=0, not_after=2**33))
    evil = signing.issue_kit(issuer, cert, "bleep", scopes=("module", "plugin"), first_party=True)
    r = post_release(client, token, "bleep-board", "0.1.0", [declare("bleep-board-0.1.0.zip", b"x", kit=evil)])
    assert r.status_code == 422


def test_no_root_key_means_no_releases(client, make_admin, monkeypatch):
    token = make_token(client, make_admin)
    monkeypatch.setattr(settings, "root_public_keys", "")
    assert post_release(client, token, "bleep-board", "0.1.0", [declare("bleep-board-0.1.0.zip", b"x")]).status_code == 503


def test_token_may_only_release_for_its_publisher(client, make_admin, capsys):
    login_as_admin(client, make_admin)
    client.post("/api/auth/logout")
    from app import cli
    acme_kit = PKI.kit("acme", scopes=("module", "plugin"))
    plain = new_token(capsys)                       # no publisher: ours (bleep) only
    acme = new_token(capsys, "acme")
    data = b"zipdata"
    mine = [declare("bleep-board-0.1.0.zip", data)]
    theirs = [declare("acme.fuzz-0.1.0.zip", data, slug="acme.fuzz", kit=acme_kit)]
    assert post_release(client, plain, "bleep-board", "0.1.0", mine).status_code == 201
    assert post_release(client, plain, "acme.fuzz", "0.1.0", theirs).status_code == 403   # a bleep token cannot publish for acme
    assert post_release(client, acme, "bleep-board", "0.2.0", [declare("bleep-board-0.2.0.zip", data, version="0.2.0")]).status_code == 403
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
    assert post_release(client, token, "acme.fuzz", "1.0.0", [decl], kind="module", license="MIT").status_code == 201
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


def test_revoking_a_key_publishes_a_signed_list(client, make_admin, capsys, storage):
    from app import cli
    from app.db import SessionLocal
    from app.models import Developer, now
    kit = PKI.kit("acme", scopes=("plugin",))
    with SessionLocal() as db:
        db.add(Developer(publisher="acme", key_id=kit["keyId"], scopes=["plugin"], not_after=now()))
        db.commit()
    roots = [signing.public_bytes(PKI.root)]
    from app.routers.registry import write_revocations
    with SessionLocal() as db:
        write_revocations(db, storage)  # what every publish does with the index
    first = json.loads(storage.objects["v1/revocations.json"])  # empty: nobody is revoked yet
    assert signing.verify_crl(first, roots)["revokedKeys"] == []

    cli.main(["developer-revoke", kit["keyId"]])
    second = json.loads(storage.objects["v1/revocations.json"])
    body = signing.verify_crl(second, roots)
    assert body and [k["keyId"] for k in body["revokedKeys"]] == [kit["keyId"]]
    assert second["serial"] > first["serial"], "the serial rises, so a client can refuse an older list"

    cli.main(["developer-revoke", kit["keyId"]])  # nothing new: the list and its serial stay
    assert json.loads(storage.objects["v1/revocations.json"])["serial"] == second["serial"]

    assert signing.verify_crl(second, [signing.public_bytes(Ed25519PrivateKey.generate())]) is None, "another root's list is refused"
    second["revokedKeys"] = []
    assert signing.verify_crl(second, roots) is None, "an edited list is refused"


def test_only_the_uploading_token_continues_a_draft(client, make_admin, capsys):
    a, b = new_token(capsys), new_token(capsys)
    data = b"zipdata"
    f = declare("bleep-board-0.1.0.zip", data)
    assert post_release(client, a, "bleep-board", "0.1.0", [f]).status_code == 201
    hb = {"Authorization": f"Bearer {b}"}
    url = "/api/registry/plugin/bleep-board/releases/0.1.0"
    assert client.put(f"{url}/files/{f['path']}", content=data, headers=hb).status_code == 403
    assert post_release(client, b, "bleep-board", "0.1.0", [f]).status_code == 403   # nor replace it
    assert client.post(f"{url}/publish", headers=hb).status_code == 403
    ha = {"Authorization": f"Bearer {a}"}
    assert client.put(f"{url}/files/{f['path']}", content=data, headers=ha).status_code == 204
    assert client.post(f"{url}/publish", headers=ha).status_code == 200


# ---- publication receipts (signing.md section 6a)

def verify_entry_file(entry_file, content, kind, id_, version, now):
    return signing.verify(content, entry_file["signature"], kind=kind, id_=id_, version=version, platform=entry_file["platform"],
                          roots=settings.roots, now=now, receipt=entry_file.get("publication"))


def test_a_published_file_has_a_receipt_that_outlives_the_certificate(client, make_admin, storage):
    token = make_token(client, make_admin)
    assert release(client, token, data=b"zipdata").status_code == 200
    f = json.loads(storage.objects["v1/plugins/bleep-board/0.1.0/entry.json"])["files"][0]
    pub = f["publication"]
    assert pub["issuerKeyId"] == f["signature"]["chain"][0]["tbs"]["keyId"] and abs(pub["publishedAt"] - int(__import__("time").time())) < 60
    content = signing.entries_for_file(f["path"], bytes.fromhex(f["sha256"]))
    lapse = f["signature"]["chain"][1]["tbs"]["notAfter"]
    assert verify_entry_file(f, content, "plugin", "bleep-board", "0.1.0", lapse + 10 * 365 * 86400).status == "signed"
    assert verify_entry_file({**f, "publication": None}, content, "plugin", "bleep-board", "0.1.0", lapse + 1).status == "expired"


def test_receipts_of_one_registry_never_go_back_in_time(client, make_admin, storage, monkeypatch):
    token = make_token(client, make_admin)
    assert release(client, token, version="0.1.0").status_code == 200
    first = json.loads(storage.objects["v1/plugins/bleep-board/0.1.0/entry.json"])["files"][0]["publication"]["publishedAt"]
    import datetime
    back = datetime.datetime.fromtimestamp(first - 2, datetime.timezone.utc)  # the clock jumps back, but stays inside the kit's validity
    monkeypatch.setattr("app.routers.registry.now", lambda: back)
    r = release(client, token, version="0.2.0")
    assert r.status_code == 503 and "earlier" in r.text
    assert "v1/plugins/bleep-board/0.2.0/entry.json" not in storage.objects  # the draft stays a draft
    assert first > 0


def test_a_lapsed_certificate_gets_no_release_and_no_receipt(client, make_admin):
    token = make_token(client, make_admin)
    old = signing.issue_kit(PKI.issuer, PKI.issuer_cert, "bleep", scopes=("plugin",), first_party=True, days=1,
                            now=int(__import__("time").time()) - 3 * 86400)  # lapsed two days ago
    data = b"zipdata"
    r = client.post("/api/registry/plugin/bleep-board/releases", headers={"Authorization": f"Bearer {token}"},
                    json={"version": "0.1.0", "files": [declare("bleep-board-0.1.0.zip", data, kit=old)]})
    assert r.status_code == 422 and "expired" in r.text


def test_a_platform_added_later_is_dated_when_its_file_arrives(client, make_admin, storage):
    token = make_token(client, make_admin)
    h = {"Authorization": f"Bearer {token}"}
    assert release(client, token).status_code == 200
    url = "/api/registry/plugin/bleep-board/releases/0.1.0"
    data = b"linuxzip"
    f = declare("bleep-board-0.1.0-linux-x86_64.zip", data, platform="linux-x86_64")
    assert client.post(url + "/platforms", json={"files": [f]}, headers=h).status_code == 200
    assert client.put(url + "/files/" + f["path"], content=data, headers=h).status_code == 204
    files = {x["platform"]: x for x in json.loads(storage.objects["v1/plugins/bleep-board/0.1.0/entry.json"])["files"]}
    assert files["macos-arm64"]["publication"] and files["linux-x86_64"]["publication"]
    assert files["linux-x86_64"]["publication"]["publishedAt"] >= files["macos-arm64"]["publication"]["publishedAt"]


def strip_receipts(storage, slug="bleep-board", version="0.1.0", kind="plugin", published_at=None):
    """Makes a release look like one published before receipts existed."""
    from app.db import SessionLocal
    from app.models import Release
    with SessionLocal() as db:
        row = db.scalar(__import__("sqlalchemy").select(Release).where(Release.slug == slug, Release.version == version))
        row.files = [{k: v for k, v in f.items() if k != "publication"} for f in row.files]
        if published_at is not None:
            row.published_at = published_at
        db.commit()
    key = f"v1/{kind}s/{slug}/{version}/entry.json"
    entry = json.loads(storage.objects[key])
    for f in entry["files"]:
        f.pop("publication", None)
    storage.objects[key] = json.dumps(entry).encode()
    return key


def test_backfill_dates_old_releases_as_of_their_publish_time(client, make_admin, storage, capsys):
    from app import cli
    token = make_token(client, make_admin)
    assert release(client, token).status_code == 200
    key = strip_receipts(storage)
    capsys.readouterr()
    cli.main(["receipts-backfill", "--dry-run"])
    assert "1 file(s) would get a receipt" in capsys.readouterr().out
    assert "publication" not in json.loads(storage.objects[key])["files"][0]  # a dry run changes nothing
    cli.main(["receipts-backfill"])
    assert "1 file(s) got a receipt" in capsys.readouterr().out
    f = json.loads(storage.objects[key])["files"][0]
    content = signing.entries_for_file(f["path"], bytes.fromhex(f["sha256"]))
    lapse = f["signature"]["chain"][1]["tbs"]["notAfter"]
    assert verify_entry_file(f, content, "plugin", "bleep-board", "0.1.0", lapse + 5 * 365 * 86400).status == "signed"
    cli.main(["receipts-backfill"])  # repeatable
    out = capsys.readouterr().out
    assert "0 file(s) got a receipt" in out and "cannot be dated" not in out


def test_backfill_lists_what_it_cannot_date(client, make_admin, storage, capsys):
    import datetime
    from app import cli
    token = make_token(client, make_admin)
    assert release(client, token).status_code == 200
    long_ago = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=30)  # before the kit's certificate began
    key = strip_receipts(storage, published_at=long_ago)
    capsys.readouterr()
    cli.main(["receipts-backfill"])
    out = capsys.readouterr().out
    assert "0 file(s) got a receipt" in out and "1 file(s) cannot be dated" in out and "bleep-board 0.1.0" in out and "expired when it was published" in out
    assert "publication" not in json.loads(storage.objects[key])["files"][0]


def test_backfill_does_not_date_a_revoked_key(client, make_admin, storage, capsys):
    from app import cli
    token = make_token(client, make_admin)
    assert release(client, token).status_code == 200
    key = strip_receipts(storage)
    from app.db import SessionLocal
    from app.models import Developer, now as db_now
    with SessionLocal() as db:
        db.add(Developer(publisher="bleep", key_id=PKI.first_party["keyId"], scopes=["module", "plugin"], first_party=True,
                         not_after=db_now(), revoked_at=db_now()))
        db.commit()
    capsys.readouterr()
    cli.main(["receipts-backfill"])
    assert "revoked when it was published" in capsys.readouterr().out
    assert "publication" not in json.loads(storage.objects[key])["files"][0]


def test_added_platform_must_be_signed_by_the_same_publisher(client, make_admin, capsys):
    token = new_token(capsys)
    h = {"Authorization": f"Bearer {token}"}
    assert release(client, token).status_code == 200
    other = PKI.kit("bleep2", scopes=("plugin",), first_party=True)  # may sign bare ids, but is not "bleep"
    r = client.post("/api/registry/plugin/bleep-board/releases/0.1.0/platforms", headers=h,
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


def release_module(client, token, kit, slug, version, files, **declared):
    """Declares, uploads and publishes a module package; returns the upload response (the step the library checks the package at).
    The release declares the package's own licence and origin (what release.py does) unless `declared` says otherwise."""
    h = {"Authorization": f"Bearer {token}"}
    data, decl = module_zip(files, kit, slug, version)
    meta = json.loads(files["module.json"]) if files["module.json"].startswith(b"{") else {}
    declared = {"license": meta.get("license", "MIT"), "origin": meta.get("origin"), **declared}
    assert post_release(client, token, slug, version, [decl], kind="module", **declared).status_code == 201
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


def test_a_module_release_must_declare_the_licence_of_its_package(client, make_admin, capsys):
    token = new_token(capsys)
    kit = PKI.first_party
    origin = {"name": "Foo", "author": "A", "url": "https://example.org/foo", "license": "GPL-3.0-or-later", "copyright": "(c) A"}
    gpl = {**json.loads(module_files(["pitch"])["module.json"]), "license": "GPL-3.0-or-later", "origin": origin}
    files = {**module_files(["pitch"]), "module.json": json.dumps(gpl).encode()}
    assert release_module(client, token, kit, "pitch", "1.0.0", files).status_code == 204
    detail = client.get("/api/library/module/pitch").json()
    assert (detail["license"], detail["origin"]["name"]) == ("GPL-3.0-or-later", "Foo")
    # a release that says MIT for a GPL package, or leaves the origin out, is refused at the upload
    up = release_module(client, token, kit, "pitch", "1.0.1", files, license="MIT")
    assert up.status_code == 422 and "must match the package's module.json" in up.json()["detail"]
    assert release_module(client, token, kit, "pitch", "1.0.2", files, origin=None).status_code == 422


def test_module_json_must_declare_types_and_abi(client, make_admin, capsys):
    token = new_token(capsys)
    for bad in ({"name": "x"}, {"types": [], "requires": {"engineAbi": 1}}, {"types": ["Bad Name"], "requires": {"engineAbi": 1}},
                {"types": ["a", "a"], "requires": {"engineAbi": 1}}, {"types": ["a"], "requires": {"engineAbi": "1"}}, {"types": "a", "requires": {"engineAbi": 1}}):
        files = {"module.json": json.dumps(bad).encode(), "module.wasm": b"\x00asm"}
        up = release_module(client, token, PKI.first_party, "mod-" + str(abs(hash(json.dumps(bad)))), "1.0.0", files)
        assert up.status_code == 422, bad
