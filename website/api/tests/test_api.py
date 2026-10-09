# SPDX-License-Identifier: MIT
from app.config import settings
from app.db import SessionLocal
from app.main import ensure_admin

PW = "correct-horse-1"


def register(client, email="a@example.com", name="Ann"):
    return client.post("/api/auth/register", json={"email": email, "password": PW, "display_name": name})


def login_as_admin(client, make_admin):
    email, password = make_admin()
    assert client.post("/api/auth/login", json={"email": email, "password": password}).status_code == 200


def test_register_logs_in_and_defaults_to_user_role(client):
    r = register(client)
    assert r.status_code == 201 and r.json()["role"] == "user"
    assert "password" not in r.text
    assert client.get("/api/auth/me").json()["email"] == "a@example.com"
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie


def test_register_rejects_duplicates_and_weak_input(client):
    assert register(client).status_code == 201
    assert register(client, email="A@Example.com").status_code == 409  # case-insensitive
    assert client.post("/api/auth/register", json={"email": "b@example.com", "password": "short", "display_name": "B"}).status_code == 422
    assert client.post("/api/auth/register", json={"email": "nope", "password": PW, "display_name": "B"}).status_code == 422


def test_cannot_register_as_admin(client):
    r = client.post("/api/auth/register", json={"email": "x@example.com", "password": PW, "display_name": "X", "role": "admin"})
    assert r.json()["role"] == "user"


def test_login_logout(client):
    register(client)
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "a@example.com", "password": "wrong-password"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "nobody@example.com", "password": PW}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "A@example.com", "password": PW}).status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_logout_invalidates_the_token_server_side(client):
    register(client)
    token = client.cookies.get("bleep_session")
    client.post("/api/auth/logout")
    client.cookies.set("bleep_session", token)
    assert client.get("/api/auth/me").status_code == 401


def test_profile_edit_ignores_role_and_status(client):
    register(client)
    r = client.patch("/api/me", json={"display_name": " New Name ", "bio": "hi", "role": "admin", "is_active": False})
    body = r.json()
    assert (body["display_name"], body["bio"], body["role"], body["is_active"]) == ("New Name", "hi", "user", True)
    assert client.patch("/api/me", json={"display_name": "  "}).status_code == 422


def test_profile_requires_login(client):
    assert client.patch("/api/me", json={"bio": "x"}).status_code == 401


def test_change_password_keeps_this_session_and_drops_others(client):
    register(client)
    other = type(client)(client.app)
    other.post("/api/auth/login", json={"email": "a@example.com", "password": PW})
    assert client.post("/api/me/password", json={"current_password": "bad-password-1", "new_password": "another-pass-9"}).status_code == 400
    assert client.post("/api/me/password", json={"current_password": PW, "new_password": "another-pass-9"}).status_code == 204
    assert client.get("/api/auth/me").status_code == 200
    assert other.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "a@example.com", "password": "another-pass-9"}).status_code == 200


def test_admin_endpoints_forbidden_for_users_and_anonymous(client):
    assert client.get("/api/admin/users").status_code == 401
    register(client)
    assert client.get("/api/admin/users").status_code == 403
    assert client.patch("/api/admin/users/1", json={"role": "admin"}).status_code == 403
    assert client.delete("/api/admin/users/1").status_code == 403


def test_admin_manages_users(client, make_admin):
    other = type(client)(client.app)
    register(other, email="u@example.com")
    uid = other.get("/api/auth/me").json()["id"]
    login_as_admin(client, make_admin)

    assert len(client.get("/api/admin/users").json()) == 2
    assert client.patch(f"/api/admin/users/{uid}", json={"role": "admin", "bio": "set by admin"}).json()["role"] == "admin"
    assert other.get("/api/admin/users").status_code == 200  # promotion takes effect immediately

    client.patch(f"/api/admin/users/{uid}", json={"role": "user", "is_active": False})
    assert other.get("/api/auth/me").status_code == 401  # deactivation ends sessions
    assert other.post("/api/auth/login", json={"email": "u@example.com", "password": PW}).status_code == 401

    assert client.delete(f"/api/admin/users/{uid}").status_code == 204
    assert client.get(f"/api/admin/users/{uid}").status_code == 404


def test_last_admin_is_protected(client, make_admin):
    login_as_admin(client, make_admin)
    me = client.get("/api/auth/me").json()["id"]
    assert client.patch(f"/api/admin/users/{me}", json={"role": "user"}).status_code == 409
    assert client.patch(f"/api/admin/users/{me}", json={"is_active": False}).status_code == 409
    assert client.delete(f"/api/admin/users/{me}").status_code == 409


def test_ensure_admin_from_settings(client, monkeypatch):
    monkeypatch.setattr(settings, "admin_email", "Boss@Example.com")
    monkeypatch.setattr(settings, "admin_password", "boss-password-1")
    ensure_admin()
    ensure_admin()  # idempotent
    assert client.post("/api/auth/login", json={"email": "boss@example.com", "password": "boss-password-1"}).json()["role"] == "admin"
    with SessionLocal() as db:
        assert db.query(__import__("app.models", fromlist=["User"]).User).count() == 1
