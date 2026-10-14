# SPDX-License-Identifier: MIT
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import Release

from test_api import login_as_admin, register

PRESET = {"title": "Warm Pad", "summary": "Slow and wide", "type": "patch", "tags": ["pad", "Warm"],
          "preset": {"nodes": [{"id": "a", "type": "lfo"}], "cables": [], "needs": {"lfo": {"min": "1.2.0"}}}}


def other_client(email="b@example.com", name="Ben"):
    c = TestClient(app)
    assert register(c, email=email, name=name).status_code == 201
    return c


def app_token(client) -> str:
    """The device flow, as the app goes through it: the client is the user's browser."""
    start = TestClient(app).post("/api/auth/device", json={"client_name": "Bleep Standalone"})
    assert start.status_code == 201
    code = start.json()
    app_side = TestClient(app)
    assert app_side.post("/api/auth/device/token", json={"device_code": code["device_code"]}).json() == {"status": "pending", "token": None, "user": None}
    assert client.get(f"/api/auth/device/{code['user_code'].lower()}").json()["client_name"] == "Bleep Standalone"
    assert client.post("/api/auth/device/approve", json={"user_code": code["user_code"]}).status_code == 204
    done = app_side.post("/api/auth/device/token", json={"device_code": code["device_code"]}).json()
    assert done["status"] == "approved" and done["token"].startswith("blu_")
    assert app_side.post("/api/auth/device/token", json={"device_code": code["device_code"]}).status_code == 410  # the token comes once
    return done["token"]


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_device_flow_gives_a_token_that_works_for_the_store_only(client):
    register(client)
    token = app_token(client)
    anon = TestClient(app)
    assert anon.post("/api/presets", json=PRESET, headers=bearer(token)).status_code == 201
    assert anon.get("/api/auth/me", headers=bearer(token)).status_code == 401  # not a login for accounts, profile or admin
    assert anon.post("/api/tokens", json={"name": "x"}, headers=bearer(token)).status_code == 401
    me = anon.get("/api/tokens/self", headers=bearer(token))
    assert me.status_code == 200 and me.json()["display_name"] == "Ann"
    assert anon.get("/api/tokens/self").status_code == 401
    # revoking it from the account stops the app
    listed = client.get("/api/tokens").json()
    assert len(listed) == 1 and "token" not in listed[0]
    assert client.delete(f"/api/tokens/{listed[0]['id']}").status_code == 204
    assert anon.post("/api/presets", json=PRESET, headers=bearer(token)).status_code == 401


def test_device_flow_denied_unknown_and_needs_login(client):
    start = TestClient(app).post("/api/auth/device", json={}).json()
    assert client.post("/api/auth/device/approve", json={"user_code": start["user_code"]}).status_code == 401
    register(client)
    assert client.post("/api/auth/device/approve", json={"user_code": "ZZZZ-ZZZZ"}).status_code == 404
    assert client.post("/api/auth/device/approve", json={"user_code": start["user_code"], "approve": False}).status_code == 204
    assert TestClient(app).post("/api/auth/device/token", json={"device_code": start["device_code"]}).json()["status"] == "denied"


def test_cross_site_writes_with_the_cookie_are_refused(client):
    register(client)
    r = client.post("/api/auth/logout", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert client.get("/api/auth/me").status_code == 200  # still logged in
    assert client.post("/api/auth/logout", headers={"Origin": "http://testserver"}).status_code == 204


def test_publish_needs_login_and_validates(client):
    assert client.post("/api/presets", json=PRESET).status_code == 401
    register(client)
    assert client.post("/api/presets", json={**PRESET, "preset": {"nodes": []}}).status_code == 422
    assert client.post("/api/presets", json={**PRESET, "preset": {"nodes": [{}], "needs": {"lfo": "1.0"}}}).status_code == 422
    assert client.post("/api/presets", json={**PRESET, "license": "GPL-3.0-only"}).status_code == 422
    too_big = {**PRESET, "preset": {"nodes": [{"x": "a" * 600_000}]}}
    assert client.post("/api/presets", json=too_big).status_code == 413


def test_publish_versions_download_and_listing(client):
    register(client)
    r = client.post("/api/presets", json=PRESET)
    assert r.status_code == 201
    body = r.json()
    assert body["address"] == "ann/warm-pad" and body["version"] == 1 and body["tags"] == ["pad", "warm"]
    again = client.post("/api/presets", json={**PRESET, "title": "Warm Pad v2", "slug": "warm-pad"}).json()
    assert again["version"] == 2 and again["title"] == "Warm Pad v2" and [v["version"] for v in again["versions"]] == [2, 1]

    anon = TestClient(app)
    f = anon.get("/api/presets/ann/warm-pad/file")
    assert f.status_code == 200 and f.json()["preset"]["nodes"][0]["type"] == "lfo" and f.json()["needs"] == {"lfo": {"min": "1.2.0"}}
    assert anon.get("/api/presets/ann/warm-pad/file?version=1").status_code == 200
    assert anon.get("/api/presets/ann/warm-pad/file?version=9").status_code == 404
    assert anon.get("/api/presets/ann/warm-pad").json()["downloads"] == 2

    assert anon.get("/api/presets?q=warm").json()["total"] == 1
    assert anon.get("/api/presets?type=cell").json()["total"] == 0
    assert anon.get("/api/presets?tag=pad").json()["total"] == 1
    store = anon.get("/api/store?kind=preset").json()
    assert store["total"] == 1 and store["items"][0]["slug"] == "ann/warm-pad" and store["categories"] == ["Patches"]
    assert anon.get("/api/store?kind=plugin").json()["total"] == 0
    detail = anon.get("/api/store/preset/ann/warm-pad").json()
    assert detail["releases"][0]["file_list"][0]["path"] == "/api/presets/ann/warm-pad/file?version=2"


def test_only_the_owner_edits_and_admin_unlists(client, make_admin):
    register(client)
    pid = client.post("/api/presets", json=PRESET).json()["id"]
    ben = other_client()
    assert ben.patch(f"/api/presets/{pid}", json={"title": "Mine"}).status_code == 404
    assert ben.delete(f"/api/presets/{pid}").status_code == 404
    assert client.patch(f"/api/presets/{pid}", json={"summary": "New"}).json()["summary"] == "New"

    admin = TestClient(app)
    login_as_admin(admin, make_admin)
    assert admin.patch(f"/api/presets/{pid}", json={"state": "unlisted"}).json()["state"] == "unlisted"
    anon = TestClient(app)
    assert anon.get("/api/presets").json()["total"] == 0
    assert anon.get("/api/presets/ann/warm-pad").status_code == 404
    assert client.get("/api/presets/ann/warm-pad").status_code == 200  # its author still sees it
    assert client.patch(f"/api/presets/{pid}", json={"state": "listed"}).status_code == 403


def test_publish_is_rate_limited(client):
    register(client)
    for i in range(20):
        assert client.post("/api/presets", json={**PRESET, "slug": f"p{i}"}).status_code == 201
    assert client.post("/api/presets", json={**PRESET, "slug": "one-more"}).status_code == 429


def test_comments(client):
    register(client)
    client.post("/api/presets", json=PRESET)
    anon = TestClient(app)
    url = "/api/social/preset/ann/warm-pad/comments"
    assert anon.post(url, json={"body": "Nice"}).status_code == 401
    ben = other_client()
    c = ben.post(url, json={"body": "  Lovely pad  "})
    assert c.status_code == 201 and c.json()["body"] == "Lovely pad" and c.json()["author"] == "Ben" and c.json()["mine"]
    assert ben.post(url, json={"body": "   "}).status_code == 422
    assert ben.post("/api/social/preset/ann/nothing/comments", json={"body": "x"}).status_code == 404

    listed = anon.get(url).json()
    assert listed["total"] == 1 and listed["items"][0]["mine"] is False
    assert ben.get(url).json()["items"][0]["mine"] is True
    cid = c.json()["id"]
    assert client.delete(f"/api/social/comments/{cid}").status_code == 404  # not the author's, not an admin
    assert anon.post(f"/api/social/comments/{cid}/report", json={"reason": "spam"}).status_code == 204
    assert ben.delete(f"/api/social/comments/{cid}").status_code == 204
    assert anon.get(url).json()["total"] == 0


def test_comment_rate_limit_and_admin_delete(client, make_admin):
    register(client)
    client.post("/api/presets", json=PRESET)
    ben = other_client()
    url = "/api/social/preset/ann/warm-pad/comments"
    ids = [ben.post(url, json={"body": f"c{i}"}).json()["id"] for i in range(5)]
    assert ben.post(url, json={"body": "sixth"}).status_code == 429
    admin = TestClient(app)
    login_as_admin(admin, make_admin)
    assert admin.delete(f"/api/social/comments/{ids[0]}").status_code == 204


def test_ratings(client):
    register(client)
    client.post("/api/presets", json=PRESET)
    url = "/api/social/preset/ann/warm-pad/rating"
    anon = TestClient(app)
    assert anon.get(url).json() == {"average": None, "count": 0, "mine": None}
    assert anon.put(url, json={"stars": 5}).status_code == 401
    assert client.put(url, json={"stars": 5}).status_code == 403  # own preset
    ben, cy = other_client(), other_client("c@example.com", "Cy")
    assert ben.put(url, json={"stars": 6}).status_code == 422
    assert ben.put(url, json={"stars": 5}).json() == {"average": 5.0, "count": 1, "mine": 5}
    assert cy.put(url, json={"stars": 2}).json()["average"] == 3.5
    assert ben.put(url, json={"stars": 4}).json() == {"average": 3.0, "count": 2, "mine": 4}  # rating again replaces
    assert anon.get(url).json() == {"average": 3.0, "count": 2, "mine": None}
    assert anon.get("/api/store?kind=preset").json()["items"][0]["rating_average"] == 3.0
    assert anon.get("/api/store/preset/ann/warm-pad").json()["rating_count"] == 2
    assert cy.delete(url).json()["count"] == 1


def test_comments_and_ratings_on_modules_and_deleting_a_preset(client):
    with SessionLocal() as db:
        db.add(Release(kind="module", slug="acme.fuzz", version="1.0.0", major=1, minor=0, patch=0, status="published", title="Fuzz"))
        db.commit()
    register(client)
    assert client.put("/api/social/module/acme.fuzz/rating", json={"stars": 4}).json()["count"] == 1
    assert client.post("/api/social/module/acme.fuzz/comments", json={"body": "Crunchy"}).status_code == 201
    assert client.post("/api/social/module/acme.nothing/comments", json={"body": "x"}).status_code == 404
    items = {i["slug"]: i for i in TestClient(app).get("/api/store?kind=module").json()["items"]}
    assert items["acme.fuzz"]["rating_average"] == 4.0
    assert TestClient(app).get("/api/store/module/acme.fuzz").json()["rating_count"] == 1

    pid = client.post("/api/presets", json=PRESET).json()["id"]
    ben = other_client()
    ben.put("/api/social/preset/ann/warm-pad/rating", json={"stars": 3})
    assert client.delete(f"/api/presets/{pid}").status_code == 204
    assert TestClient(app).get("/api/social/preset/ann/warm-pad/rating").status_code == 404


def test_reports_for_admins(client, make_admin):
    register(client)
    pid = client.post("/api/presets", json=PRESET).json()["id"]
    assert TestClient(app).post(f"/api/presets/{pid}/report", json={"reason": "stolen"}).status_code == 204
    assert client.get("/api/admin/reports").status_code == 403
    admin = TestClient(app)
    login_as_admin(admin, make_admin)
    reports = admin.get("/api/admin/reports").json()
    assert len(reports) == 1 and reports[0]["target"] == "preset" and reports[0]["reason"] == "stolen"
    assert admin.post(f"/api/admin/reports/{reports[0]['id']}/resolve").status_code == 204
    assert admin.get("/api/admin/reports").json() == []


def test_the_app_signs_itself_out(client):
    register(client)
    token = app_token(client)
    anon = TestClient(app)
    assert anon.delete("/api/tokens/self", headers=bearer(token)).status_code == 204
    assert anon.get("/api/tokens/self", headers=bearer(token)).status_code == 401
    assert client.get("/api/tokens").json() == []
