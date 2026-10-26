# SPDX-License-Identifier: MIT
from fastapi.testclient import TestClient

from app.main import app

from test_api import register
from test_social import PRESET, other_client

GONE = {"detail": {"error": "patch_unavailable"}}


def test_a_new_patch_is_private_and_has_an_id(client):
    register(client)
    made = client.post("/api/presets", json={k: v for k, v in PRESET.items() if k != "visibility"}).json()
    assert made["visibility"] == "private" and len(made["pid"]) == 10
    anon = TestClient(app)
    assert anon.get("/api/presets").json()["total"] == 0
    assert anon.get(f"/api/patches/{made['pid']}").json() == GONE
    assert anon.get(f"/api/patches/{made['pid']}/1/file").json() == GONE
    assert other_client().get(f"/api/patches/{made['pid']}").json() == GONE
    assert anon.get("/api/patches/nosuchpid00").json() == GONE   # the same answer as for a private one
    assert client.get(f"/api/patches/{made['pid']}").json()["address"] == "ann/warm-pad"
    assert client.get(f"/api/patches/{made['pid']}/1/file").status_code == 200   # the author reads it


def test_publish_and_unpublish_by_visibility(client):
    register(client)
    made = client.post("/api/presets", json=PRESET).json()
    anon = TestClient(app)
    pid = made["pid"]
    assert anon.get(f"/api/patches/{pid}").json()["version"] == 1
    assert anon.get(f"/api/patches/{pid}/1/file").json()["preset"]["nodes"][0]["type"] == "lfo"
    assert anon.get("/api/presets").json()["total"] == 1
    assert client.patch(f"/api/presets/{made['id']}", json={"visibility": "private"}).json()["visibility"] == "private"
    assert anon.get(f"/api/patches/{pid}/1/file").json() == GONE
    assert anon.get("/api/presets").json()["total"] == 0
    assert client.patch(f"/api/presets/{made['id']}", json={"visibility": "public"}).json()["pid"] == pid   # the ID stays


def test_versions_are_pinned_and_an_update_finds_the_patch_by_its_id(client):
    register(client)
    pid = client.post("/api/presets", json=PRESET).json()["pid"]
    # renamed: the slug is new, the ID still finds the patch, and the visibility stays
    again = client.post("/api/presets", json={**PRESET, "visibility": None, "title": "Cold Pad", "slug": "cold-pad", "pid": pid}).json()
    assert again["pid"] == pid and again["version"] == 2 and again["visibility"] == "public" and again["address"] == "ann/warm-pad"
    anon = TestClient(app)
    assert anon.get(f"/api/patches/{pid}/1/file").status_code == 200
    assert anon.get(f"/api/patches/{pid}/2/file").json()["title"] == "Cold Pad"
    assert anon.get(f"/api/patches/{pid}/9/file").json() == {"detail": {"error": "version_unavailable"}}
    ben = other_client()
    assert ben.post("/api/presets", json={**PRESET, "pid": pid}).json() == GONE   # not yours


def test_a_deleted_patch_is_no_longer_available(client):
    register(client)
    made = client.post("/api/presets", json=PRESET).json()
    assert client.delete(f"/api/presets/{made['id']}").status_code == 204
    anon = TestClient(app)
    for who in (anon, client):
        assert who.get(f"/api/patches/{made['pid']}").json() == GONE
        assert who.get(f"/api/patches/{made['pid']}/1/file").json() == GONE
    assert client.post("/api/presets", json={**PRESET, "pid": made["pid"]}).json() == GONE   # an update of a deleted one


def test_versions_have_the_authors_number_and_links_use_it(client):
    register(client)
    made = client.post("/api/presets", json={**PRESET, "version_label": "1.0"}).json()
    pid = made["pid"]
    assert made["version_label"] == "1.0" and made["versions"][0]["label"] == "1.0"
    again = client.post("/api/presets", json={**PRESET, "pid": pid, "version_label": "1.1"}).json()
    assert again["version"] == 2 and again["version_label"] == "1.1"
    assert client.post("/api/presets", json={**PRESET, "pid": pid, "version_label": "1.1"}).status_code == 409   # a number is used once
    assert client.post("/api/presets", json={**PRESET, "pid": pid, "version_label": "one"}).status_code == 422
    anon = TestClient(app)
    assert anon.get(f"/api/patches/{pid}/1.0/file").status_code == 200
    assert anon.get(f"/api/patches/{pid}/1.1/file").status_code == 200
    assert anon.get(f"/api/patches/{pid}/2/file").status_code == 200       # the sequence number still works
    assert anon.get(f"/api/patches/{pid}/3.0/file").json() == {"detail": {"error": "version_unavailable"}}
    assert client.post("/api/presets", json={**PRESET, "slug": "other"}).json()["version_label"] == "1.0"   # default: <n>.0


def test_a_cell_has_categories_and_roles(client):
    register(client)
    cell = {**PRESET, "type": "cell", "categories": ["Pads", "Drums/Kicks"],
            "preset": {**PRESET["preset"], "plays": {"instrument": {"notes": "voice"}}}}
    made = client.post("/api/presets", json=cell).json()
    assert made["categories"] == ["Pads", "Drums/Kicks"] and made["roles"] == ["instrument"]
    assert client.get("/api/presets/ann/warm-pad/file").json()["categories"] == ["Pads", "Drums/Kicks"]
    assert TestClient(app).get("/api/library?kind=preset").json()["items"][0]["category"] == "Cells/Pads"
    # a new version may change them; no plays means no roles
    again = client.post("/api/presets", json={**cell, "pid": made["pid"], "version_label": "1.1", "categories": ["Basses"], "preset": PRESET["preset"]}).json()
    assert again["categories"] == ["Basses"] and again["roles"] == []
    assert client.post("/api/presets", json={**cell, "slug": "x", "categories": ["a", "b", "c", "d"]}).status_code == 422
    assert client.post("/api/presets", json={**cell, "slug": "y", "categories": ["<b>"]}).status_code == 422
    assert client.post("/api/presets", json={**cell, "slug": "z", "preset": {**PRESET["preset"], "plays": {"drone": {}}}}).status_code == 422
