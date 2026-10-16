# SPDX-License-Identifier: MIT
from fastapi.testclient import TestClient

from app.main import app
from test_social import other_client  # noqa: F401  (a second logged-in browser)

BOARD = {"nodes": [{"id": "a", "type": "lfo"}], "cables": [], "panels": [{"id": "p1", "name": "Front"}], "description": "A pad", "tags": ["pad"]}


def test_projects_need_a_login(client):
    anon = TestClient(app)
    assert anon.get("/api/projects").status_code == 401
    assert anon.post("/api/projects", json={"name": "x", "preset": BOARD}).status_code == 401


def test_save_list_load_replace_delete(client):
    ann = other_client("ann@example.com", "Ann")
    r = ann.post("/api/projects", json={"name": "  My   pad ", "preset": BOARD})
    assert r.status_code == 200 and r.json()["name"] == "My pad" and r.json()["tags"] == ["pad"]
    pid = r.json()["id"]
    again = ann.post("/api/projects", json={"name": "My pad", "preset": {**BOARD, "description": "v2"}}).json()
    assert again["id"] == pid and again["description"] == "v2"
    items = ann.get("/api/projects").json()["items"]
    assert [i["name"] for i in items] == ["My pad"]
    loaded = ann.get(f"/api/projects/{pid}").json()
    assert loaded["panels"] == [{"id": "p1", "name": "Front"}] and loaded["nodes"][0]["type"] == "lfo"
    assert ann.delete(f"/api/projects/{pid}").status_code == 204
    assert ann.get(f"/api/projects/{pid}").status_code == 404


def test_projects_are_private(client):
    ann = other_client("ann@example.com", "Ann")
    ben = other_client("ben@example.com", "Ben")
    pid = ann.post("/api/projects", json={"name": "Mine", "preset": BOARD}).json()["id"]
    assert ben.get("/api/projects").json()["items"] == []
    assert ben.get(f"/api/projects/{pid}").status_code == 404
    assert ben.delete(f"/api/projects/{pid}").status_code == 404


def test_projects_are_validated(client):
    ann = other_client("ann@example.com", "Ann")
    assert ann.post("/api/projects", json={"name": "x", "preset": {"cables": []}}).status_code == 422
    assert ann.post("/api/projects", json={"name": "  ", "preset": BOARD}).status_code == 422
    big = {"nodes": [{"x": "a" * 2_200_000}]}
    assert ann.post("/api/projects", json={"name": "big", "preset": big}).status_code == 413
