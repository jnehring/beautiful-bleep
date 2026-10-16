# SPDX-License-Identifier: MIT
from app import ratelimit
from app.routers import auth, user_tokens
from tests.test_api import PW, register


def login(client, email, password=PW):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def test_limiter_counts_a_window_and_forgets():
    lim = ratelimit.Limiter(2, 0.05)
    assert lim.hit("a") and lim.hit("a") and not lim.hit("a") and lim.hit("b")
    assert lim.blocked("a") and not lim.blocked("c")
    import time

    time.sleep(0.06)
    assert lim.hit("a") and not lim.blocked("a")


def test_registration_is_limited_per_address(client):
    for i in range(auth._register_ip.limit):
        assert register(client, f"u{i}@example.com", f"U{i}").status_code == 201
    r = register(client, "late@example.com", "Late")
    assert r.status_code == 429 and "Retry-After" in r.headers


def test_wrong_passwords_lock_that_account_not_others(client):
    register(client, "a@example.com")
    register(client, "b@example.com", "Bea")
    for _ in range(auth._login_account.limit):
        assert login(client, "a@example.com", "wrong-password-1").status_code == 401
    assert login(client, "a@example.com").status_code == 429  # even the right password waits
    assert login(client, "b@example.com").status_code == 200  # someone else's account is untouched


def test_a_good_login_clears_the_failures(client):
    register(client, "a@example.com")
    for _ in range(auth._login_account.limit - 1):
        assert login(client, "a@example.com", "wrong-password-1").status_code == 401
    assert login(client, "a@example.com").status_code == 200
    for _ in range(auth._login_account.limit - 1):
        assert login(client, "a@example.com", "wrong-password-1").status_code == 401
    assert login(client, "a@example.com").status_code == 200


def test_login_attempts_are_limited_per_address(client):
    for i in range(auth._login_ip.limit):
        assert login(client, f"nobody{i}@example.com", "wrong-password-1").status_code == 401
    assert login(client, "another@example.com", "wrong-password-1").status_code == 429


def test_forgot_password_is_limited_per_address(client):
    for i in range(auth._forgot_ip.limit):
        assert client.post("/api/auth/forgot-password", json={"email": f"x{i}@example.com"}).status_code == 202
    assert client.post("/api/auth/forgot-password", json={"email": "x@example.com"}).status_code == 429


def test_device_sign_in_is_limited_and_capped(client, monkeypatch):
    for _ in range(user_tokens._device_start.limit):
        assert client.post("/api/auth/device", json={"client_name": "Bleep"}).status_code == 201
    assert client.post("/api/auth/device", json={"client_name": "Bleep"}).status_code == 429

    ratelimit.reset_all()
    monkeypatch.setattr(user_tokens, "MAX_PENDING_CODES", 1)
    assert client.post("/api/auth/device", json={"client_name": "Bleep"}).status_code == 503  # the earlier ten are still pending


def test_device_code_guessing_is_limited(client):
    register(client)
    for _ in range(user_tokens._device_lookup.limit):
        assert client.get("/api/auth/device/BCDF-GHJK").status_code == 404
    assert client.get("/api/auth/device/BCDF-GHJK").status_code == 429
