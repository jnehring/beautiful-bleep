# SPDX-License-Identifier: MIT
import hashlib
import json

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


def make_token(client, make_admin):
    login_as_admin(client, make_admin)
    r = client.post("/api/admin/tokens", json={"name": "ci"})
    assert r.status_code == 201
    client.post("/api/auth/logout")
    return r.json()["token"]


def release(client, token, slug="bleep-patch", version="0.1.0", data=b"zipdata", publish=True, channel="stable"):
    h = {"Authorization": f"Bearer {token}"}
    body = {"version": version, "channel": channel, "files": [
        {"path": f"{slug}-{version}.zip", "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "platform": "macos-arm64"}]}
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
    client.post("/api/registry/plugin/p/releases", headers=h, json={"version": "0.1.0", "files": [
        {"path": "p.zip", "sha256": hashlib.sha256(data).hexdigest(), "bytes": 3}]})
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
