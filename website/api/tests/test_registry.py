# SPDX-License-Identifier: MIT
import hashlib
import io
import json
import zipfile

import pytest

from app.storage import MemoryStorage, get_storage
from tests.test_api import login_as_admin, register


@pytest.fixture
def storage():
    return get_storage()


@pytest.fixture(autouse=True)
def clean_storage(storage):
    assert isinstance(storage, MemoryStorage)
    storage.objects.clear()


def declare(path, data, *, platform="macos-arm64"):
    """A file declaration for a release, like scripts/release/release.py makes it."""
    return {"path": path, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "platform": platform}


def module_files(types, abi=1, wasm=b"\x00asm\x01\x00\x00\x00"):
    """The files of a module package with a module.json that declares these node types."""
    meta = {"name": "Fuzz", "types": types, "requires": {"engineAbi": abi}}
    return {"module.json": json.dumps(meta).encode(), "module.wasm": wasm}


def module_zip(files, slug, version):
    """A .bleepmod and its declaration: files {path: bytes}."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for p, c in files.items():
            z.writestr(p, c)
    data = buf.getvalue()
    return data, {"path": f"{slug}-{version}.bleepmod", "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "platform": "any"}


def make_token(client, make_admin):
    login_as_admin(client, make_admin)
    r = client.post("/api/admin/tokens", json={"name": "ci"})
    assert r.status_code == 201
    client.post("/api/auth/logout")
    return r.json()["token"]


def release(client, token, slug="bleep-board", version="0.1.0", data=b"zipdata", publish=True, channel="stable"):
    h = {"Authorization": f"Bearer {token}"}
    body = {"version": version, "channel": channel, "files": [declare(f"{slug}-{version}.zip", data)]}
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
    client.post("/api/registry/plugin/p/releases", headers=h, json={"version": "0.1.0", "files": [declare("p.zip", data)]})
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
            "files": [declare("lfo-0.1.0.zip", data)]}
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
    origin = {"name": "Foo", "author": "A. Author", "url": "https://example.org/foo", "license": "GPL-3.0-only", "copyright": "(c) A"}
    body = {"version": "0.1.0", "license": "GPL-3.0-only", "origin": origin, "files": [declare("fuzz.zip", b"x")]}
    assert client.post("/api/registry/plugin/fuzz/releases", json=body, headers=h).status_code == 201
    client.put("/api/registry/plugin/fuzz/releases/0.1.0/files/fuzz.zip", content=b"x", headers=h)
    assert client.post("/api/registry/plugin/fuzz/releases/0.1.0/publish", headers=h).status_code == 200
    detail = client.get("/api/library/plugin/fuzz").json()
    assert (detail["license"], detail["origin"]["name"], detail["releases"][0]["license"]) == ("GPL-3.0-only", "Foo", "GPL-3.0-only")
    entry = json.loads(storage.objects["v1/plugins/fuzz/0.1.0/entry.json"])
    assert (entry["license"], entry["origin"]["url"]) == ("GPL-3.0-only", "https://example.org/foo")
    assert "license" not in client.get("/api/library").json()["items"][0]  # not on the tile
    bad = {**body, "version": "0.2.0", "origin": {**origin, "url": "javascript:alert(1)"}}
    assert client.post("/api/registry/plugin/fuzz/releases", json=bad, headers=h).status_code == 422


def test_library_filters_by_category_and_searches_the_summary(client, make_admin):
    token = make_token(client, make_admin)
    h = {"Authorization": f"Bearer {token}"}
    for slug, summary, category in (("lfo", "Slow waves", "Modulation"), ("osc", "A triangle core", "Sources"), ("plain", "", "")):
        body = {"version": "0.1.0", "summary": summary, "category": category, "files": [declare(f"{slug}.zip", b"x")]}
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
    assert f["uploaded"] is True and "signer" not in f and "uploaded_by" not in f
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


# ---- who may release what: the token decides

def new_token(capsys, publisher=None):
    from app import cli
    cli.main(["token-create", "dev"] + (["--publisher", publisher] if publisher else []))
    return capsys.readouterr().out.strip().splitlines()[-1]


def post_release(client, token, slug, version, files, kind="plugin", **extra):
    return client.post(f"/api/registry/{kind}/{slug}/releases", json={"version": version, "files": files, **extra},
                       headers={"Authorization": f"Bearer {token}"})


def test_token_may_only_release_for_its_publisher(client, make_admin, capsys):
    login_as_admin(client, make_admin)
    client.post("/api/auth/logout")
    plain = new_token(capsys)                       # no publisher: ours (bleep) only
    acme = new_token(capsys, "acme")
    data = b"zipdata"
    mine = [declare("bleep-board-0.1.0.zip", data)]
    theirs = [declare("acme.fuzz-0.1.0.zip", data)]
    assert post_release(client, plain, "bleep-board", "0.1.0", mine).status_code == 201
    assert post_release(client, plain, "acme.fuzz", "0.1.0", theirs).status_code == 403   # a bleep token cannot publish for acme
    assert post_release(client, acme, "bleep-board", "0.2.0", [declare("bleep-board-0.2.0.zip", data)]).status_code == 403
    assert post_release(client, acme, "acme.fuzz", "0.1.0", theirs).status_code == 201
    # and acme cannot release a bare id, or an id in another namespace
    assert post_release(client, acme, "evil.fuzz", "0.1.0", [declare("evil-0.1.0.zip", data)]).status_code == 403
    assert post_release(client, acme, "reverb", "0.1.0", [declare("reverb-0.1.0.zip", data)]).status_code == 403


def test_module_package_flow_and_entry(client, make_admin, capsys, storage):
    token = new_token(capsys, "acme")
    files = module_files(["acme/fuzz"])
    data, decl = module_zip(files, "acme.fuzz", "1.0.0")
    h = {"Authorization": f"Bearer {token}"}
    assert post_release(client, token, "acme.fuzz", "1.0.0", [decl], kind="module", license="MIT").status_code == 201
    url = "/api/registry/module/acme.fuzz/releases/1.0.0"
    assert client.put(f"{url}/files/{decl['path']}", content=data, headers=h).status_code == 204
    assert client.post(f"{url}/publish", headers=h).status_code == 200
    entry = json.loads(storage.objects["v1/modules/acme.fuzz/1.0.0/entry.json"])
    assert entry["files"][0] == {"path": decl["path"], "sha256": decl["sha256"], "bytes": decl["bytes"], "platform": "any"}
    assert entry["types"] == ["acme/fuzz"] and entry["requires"]["engineAbi"] == 1
    index = json.loads(storage.objects["v1/index.json"])["channels"]["stable"]["modules"]["acme.fuzz"]
    assert index["types"] == ["acme/fuzz"]  # a client finds the package of a node type from the index alone
    assert "token" not in json.dumps(entry)  # who uploaded stays in the database
    assert "signature" not in json.dumps(entry) and "trust" not in json.dumps(index)
    assert "v1/revocations.json" not in storage.objects


def test_a_module_package_must_be_a_zip(client, make_admin, capsys):
    token = new_token(capsys, "acme")
    data, decl = module_zip(module_files(["acme/fuzz"]), "acme.fuzz", "1.0.0")
    h = {"Authorization": f"Bearer {token}"}
    assert post_release(client, token, "acme.fuzz", "1.0.0", [decl], kind="module").status_code == 201
    r = client.put(f"/api/registry/module/acme.fuzz/releases/1.0.0/files/{decl['path']}", content=b"not a zip", headers=h)
    assert r.status_code == 422


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


def release_module(client, token, slug, version, files, **declared):
    """Declares, uploads and publishes a module package; returns the upload response (the step the library checks the package at).
    The release declares the package's own licence and origin (what release.py does) unless `declared` says otherwise."""
    h = {"Authorization": f"Bearer {token}"}
    data, decl = module_zip(files, slug, version)
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
    assert release_module(client, ours, "oscillator", "1.0.0", module_files(["oscillator"])).status_code == 204
    # a third party may not provide a type that exists, nor one outside its namespace
    up = release_module(client, theirs, "acme.copy", "1.0.0", module_files(["oscillator"]))
    assert up.status_code == 422 and "must start with 'acme/'" in up.json()["detail"]
    up = release_module(client, theirs, "acme.copy", "1.0.1", module_files(["acme/oscillator"]))
    assert up.status_code == 204
    # nor may another of our modules provide the same type name
    up = release_module(client, ours, "oscillator2", "1.0.0", module_files(["oscillator"]))
    assert up.status_code == 409 and "already provided" in up.json()["detail"]
    # a new version of the module itself may keep its own types
    assert release_module(client, ours, "oscillator", "1.0.1", module_files(["oscillator", "oscillator-sub"])).status_code == 204


def test_a_module_release_must_declare_the_licence_of_its_package(client, make_admin, capsys):
    token = new_token(capsys)
    origin = {"name": "Foo", "author": "A", "url": "https://example.org/foo", "license": "GPL-3.0-only", "copyright": "(c) A"}
    gpl = {**json.loads(module_files(["pitch"])["module.json"]), "license": "GPL-3.0-only", "origin": origin}
    files = {**module_files(["pitch"]), "module.json": json.dumps(gpl).encode()}
    assert release_module(client, token, "pitch", "1.0.0", files).status_code == 204
    detail = client.get("/api/library/module/pitch").json()
    assert (detail["license"], detail["origin"]["name"]) == ("GPL-3.0-only", "Foo")
    # a release that says MIT for a GPL package, or leaves the origin out, is refused at the upload
    up = release_module(client, token, "pitch", "1.0.1", files, license="MIT")
    assert up.status_code == 422 and "must match the package's module.json" in up.json()["detail"]
    assert release_module(client, token, "pitch", "1.0.2", files, origin=None).status_code == 422


def test_module_json_must_declare_types_and_abi(client, make_admin, capsys):
    token = new_token(capsys)
    for bad in ({"name": "x"}, {"types": [], "requires": {"engineAbi": 1}}, {"types": ["Bad Name"], "requires": {"engineAbi": 1}},
                {"types": ["a", "a"], "requires": {"engineAbi": 1}}, {"types": ["a"], "requires": {"engineAbi": "1"}}, {"types": "a", "requires": {"engineAbi": 1}}):
        files = {"module.json": json.dumps(bad).encode(), "module.wasm": b"\x00asm"}
        up = release_module(client, token, "mod-" + str(abs(hash(json.dumps(bad)))), "1.0.0", files)
        assert up.status_code == 422, bad


# ---- the dev channel -------------------------------------------------------------------------------

def dev_token(client, make_admin, channels=("dev",)):
    login_as_admin(client, make_admin)
    r = client.post("/api/admin/tokens", json={"name": "ci", "channels": list(channels)})
    assert r.status_code == 201 and r.json()["channels"] == list(channels)
    client.post("/api/auth/logout")
    return r.json()["token"]


def test_a_token_releases_only_into_its_channels(client, make_admin):
    ci = dev_token(client, make_admin)
    assert release(client, ci, version="0.1.0").status_code == 403                                  # stable: not for a CI token
    assert release(client, ci, version="0.1.1", channel="dev").status_code == 422                   # a dev channel needs a dev version
    assert release(client, ci, version="0.1.1-dev.202610271432", channel="stable").status_code == 422
    assert release(client, ci, version="0.1.1-dev.202610271432", channel="dev").status_code == 200


def test_dev_builds_rank_by_build_time_and_do_not_block_releases(client, make_admin):
    ci = dev_token(client, make_admin)
    assert release(client, ci, version="0.2.0-dev.202610271500", channel="dev").status_code == 200
    assert release(client, ci, version="0.2.0-dev.202610271400", channel="dev").status_code == 409   # older build time
    assert release(client, ci, version="0.2.0-dev.202610271600", channel="dev").status_code == 200
    assert release(client, ci, version="0.1.9-dev.202611010000", channel="dev").status_code == 409   # lower number, later date
    # the public side never sees them: not in the version list, not in the index, not in the library listing, not in /registry
    assert client.post("/api/auth/login", json={"email": "admin@example.com", "password": "admin-password-1"}).status_code == 200
    token = client.post("/api/admin/tokens", json={"name": "rel"}).json()["token"]
    client.post("/api/auth/logout")
    assert release(client, token, version="0.2.0").status_code == 200                                # the release of the same number is fine
    assert client.get("/api/registry/plugin/bleep-board/versions").json() == [
        {"version": "0.2.0", "channel": "stable", "published_at": client.get("/api/registry/plugin/bleep-board/versions").json()[0]["published_at"]}]
    public = json.loads(get_storage().get("v1/index.json"))
    assert "dev" not in public["channels"] and public["channels"]["beta"]["plugins"]["bleep-board"]["version"] == "0.2.0"
    assert all(not k.startswith("v1/") or "dev." not in k for k in get_storage().objects)
    assert [i["version"] for i in client.get("/api/library").json()["items"]] == ["0.2.0"]
    assert client.get("/api/library/plugin/bleep-board").json()["releases"][0]["version"] == "0.2.0"


def test_only_accounts_with_dev_access_get_the_dev_channel(client, make_admin):
    from fastapi.testclient import TestClient
    from app.main import app
    from tests.test_api import PW
    ci = dev_token(client, make_admin)
    assert release(client, ci, version="0.3.0-dev.202610271500", channel="dev").status_code == 200
    path = "/api/registry/dev/v1/index.json"
    assert client.get(path).status_code == 401
    tess = TestClient(app)
    register(tess, "t@example.com", "Tess")
    assert tess.get(path).status_code == 403
    assert client.post("/api/auth/login", json={"email": "admin@example.com", "password": "admin-password-1"}).status_code == 200
    users = client.get("/api/admin/users")
    assert users.status_code == 200, users.text
    tester = next(u for u in users.json() if u["email"] == "t@example.com")
    assert client.patch(f"/api/admin/users/{tester['id']}", json={"dev_access": True}).json()["dev_access"] is True
    assert client.get(path).status_code == 200                       # an admin always may
    index = tess.get(path).json()
    assert index["channels"]["dev"]["plugins"]["bleep-board"]["version"] == "0.3.0-dev.202610271500"
    entry = tess.get("/api/registry/dev/v1/plugins/bleep-board/0.3.0-dev.202610271500/entry.json")
    assert entry.status_code == 200 and entry.json()["channel"] == "dev"
    assert tess.get("/api/registry/dev/v1/plugins/bleep-board/0.3.0-dev.202610271500/bleep-board-0.3.0-dev.202610271500.zip").content == b"zipdata"
    assert tess.get("/api/registry/dev/v1/nothing.json").status_code == 404


def test_old_dev_builds_are_deleted(client, make_admin, monkeypatch):
    monkeypatch.setattr("app.routers.registry.KEEP_DEV_BUILDS", 2)
    ci = dev_token(client, make_admin)
    for minute in ("10", "11", "12"):
        assert release(client, ci, version=f"0.4.0-dev.2026102713{minute}", channel="dev").status_code == 200
    keys = [k for k in get_storage().objects if k.startswith("dev/v1/plugins/bleep-board/")]
    assert not any("202610271310" in k for k in keys) and any("202610271312" in k for k in keys)


def test_newest_and_add_platform_in_the_dev_channel(client, make_admin):
    ci = dev_token(client, make_admin)
    h = {"Authorization": f"Bearer {ci}"}
    assert client.get("/api/registry/plugin/bleep-board/newest?channel=dev", headers=h).status_code == 404
    version = "0.5.0-dev.202610271500"
    assert release(client, ci, version=version, channel="dev").status_code == 200
    got = client.get("/api/registry/plugin/bleep-board/newest?channel=dev", headers=h).json()
    assert got["version"] == version and got["channel"] == "dev" and got["files"][0]["platform"] == "macos-arm64"
    assert client.get("/api/registry/plugin/bleep-board/newest", headers=h).status_code == 404   # stable: nothing public
    other = declare("bleep-board-linux.zip", b"linuxzip", platform="linux-x86_64")
    r = client.post(f"/api/registry/plugin/bleep-board/releases/{version}/platforms", json={"files": [other]}, headers=h)
    assert r.status_code == 200
    assert client.put(f"/api/registry/plugin/bleep-board/releases/{version}/files/bleep-board-linux.zip", content=b"linuxzip", headers=h).status_code == 204
    entry = json.loads(get_storage().get(f"dev/v1/plugins/bleep-board/{version}/entry.json"))
    assert sorted(f["platform"] for f in entry["files"]) == ["linux-x86_64", "macos-arm64"]
    # a release token without the dev channel may not look at it
    login = client.post("/api/auth/login", json={"email": "admin@example.com", "password": "admin-password-1"})
    assert login.status_code == 200
    stable = client.post("/api/admin/tokens", json={"name": "rel"}).json()["token"]
    assert client.get("/api/registry/plugin/bleep-board/newest?channel=dev", headers={"Authorization": f"Bearer {stable}"}).status_code == 403
    assert client.post(f"/api/registry/plugin/bleep-board/releases/{version}/platforms", json={"files": [other]},
                       headers={"Authorization": f"Bearer {stable}"}).status_code == 403
