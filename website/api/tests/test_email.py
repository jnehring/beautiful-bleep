# SPDX-License-Identifier: MIT
import re
from datetime import timedelta

import pytest
from sqlalchemy import update

from app import mail
from app.db import SessionLocal
from app.models import EmailToken, User, UserToken, now

from test_api import PW, raw_register as register


@pytest.fixture
def outbox(monkeypatch):
    sent = []
    monkeypatch.setattr(mail, "send", lambda to, subject, body: sent.append((to, subject, body)))
    return sent


def link_token(message):
    return re.search(r"token=([\w-]+)", message[2]).group(1)


def age_tokens(minutes):
    """Pretend the emails went out `minutes` ago (so the resend throttle can be tested)."""
    with SessionLocal() as db:
        db.execute(update(EmailToken).values(created_at=now() - timedelta(minutes=minutes)))
        db.commit()


def test_registration_sends_a_confirmation_link(client, outbox):
    r = register(client)
    assert r.json()["email_verified"] is False
    assert len(outbox) == 1 and outbox[0][0] == "a@example.com"
    assert "/verify-email/?token=" in outbox[0][2] and PW not in outbox[0][2]
    r = client.post("/api/auth/verify-email", json={"token": link_token(outbox[0])})
    assert r.json()["email_verified"] is True and "set-cookie" not in r.headers  # confirming does not log anyone in
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "a@example.com", "password": PW}).status_code == 200
    assert client.get("/api/auth/me").json()["email_verified"] is True


def test_verification_link_is_single_use_and_garbage_is_refused(client, outbox):
    register(client)
    token = link_token(outbox[0])
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 400
    assert client.post("/api/auth/verify-email", json={"token": "x" * 40}).status_code == 400


def test_expired_verification_link_is_refused(client, outbox):
    register(client)
    with SessionLocal() as db:
        db.execute(update(EmailToken).values(expires_at=now() - timedelta(seconds=1)))
        db.commit()
    assert client.post("/api/auth/verify-email", json={"token": link_token(outbox[0])}).status_code == 400


def resend(client, email="a@example.com"):
    return client.post("/api/auth/resend-verification", json={"email": email})


def test_resend_is_throttled_and_replaces_the_old_link(client, outbox):
    register(client)
    resend(client)
    assert len(outbox) == 1  # a minute has not passed
    age_tokens(5)
    assert resend(client).status_code == 202
    assert len(outbox) == 2
    assert client.post("/api/auth/verify-email", json={"token": link_token(outbox[0])}).status_code == 400
    assert client.post("/api/auth/verify-email", json={"token": link_token(outbox[1])}).status_code == 200
    resend(client)
    assert len(outbox) == 2  # verified: nothing to send


def test_resend_is_public_and_never_reveals_whether_the_email_exists(client, outbox):
    register(client)
    outbox.clear()
    age_tokens(5)
    a = resend(client)
    b = resend(client, "nobody@example.com")
    assert a.status_code == b.status_code == 202 and a.text == b.text
    assert [m[0] for m in outbox] == ["a@example.com"]
    assert resend(client, "not-an-email").status_code == 422


def test_resend_is_rate_limited_per_ip(client, outbox):
    from app.routers import auth

    for _ in range(auth._resend_ip.limit):
        assert resend(client, "nobody@example.com").status_code == 202
    r = resend(client, "nobody@example.com")
    assert r.status_code == 429 and "retry-after" in r.headers


def test_unverified_user_cannot_log_in_but_only_after_the_right_password(client, outbox):
    register(client)
    wrong = client.post("/api/auth/login", json={"email": "a@example.com", "password": "wrong-password-1"})
    assert wrong.status_code == 401 and wrong.json()["detail"] == "Wrong email or password"
    r = client.post("/api/auth/login", json={"email": "a@example.com", "password": PW})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "email_not_verified" and r.json()["detail"]["message"]
    assert "set-cookie" not in r.headers and client.get("/api/auth/me").status_code == 401
    client.post("/api/auth/verify-email", json={"token": link_token(outbox[0])})
    assert client.post("/api/auth/login", json={"email": "a@example.com", "password": PW}).status_code == 200


def test_existing_session_of_an_unverified_user_stops_working(client):
    from test_api import register as verified_register

    verified_register(client)
    assert client.get("/api/auth/me").status_code == 200
    with SessionLocal() as db:
        db.execute(update(User).values(email_verified_at=None))
        db.commit()
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/tokens").status_code == 401


def test_unverified_login_works_when_confirmation_is_off(client, monkeypatch):
    register(client)
    monkeypatch.setattr(mail.settings, "email_verification", False)
    assert client.post("/api/auth/login", json={"email": "a@example.com", "password": PW}).status_code == 200


def test_without_smtp_the_log_holds_no_body_unless_asked(monkeypatch, caplog):
    monkeypatch.setattr(mail.settings, "smtp_host", "")
    mail.send("to@example.com", "Subject line", "secret-link-body")
    assert "to@example.com" in caplog.text and "Subject line" in caplog.text and "secret-link-body" not in caplog.text
    caplog.clear()
    monkeypatch.setattr(mail.settings, "log_mail_bodies", True)
    mail.send("to@example.com", "Subject line", "secret-link-body")
    assert "secret-link-body" in caplog.text


def test_password_reset_revokes_personal_access_tokens(client, outbox):
    from test_api import register as verified_register

    verified_register(client)
    pat = client.post("/api/tokens", json={"name": "app"})
    assert pat.status_code in (200, 201), pat.text
    secret = pat.json()["token"]
    assert client.get("/api/tokens").json() and secret.startswith("blu_")
    client.post("/api/auth/forgot-password", json={"email": "a@example.com"})
    client.post("/api/auth/reset-password", json={"token": link_token(outbox[-1]), "new_password": "brand-new-password"})
    with SessionLocal() as db:
        assert db.query(UserToken).count() == 0


def test_forgot_password_answers_the_same_for_unknown_emails(client, outbox):
    register(client)
    outbox.clear()
    a = client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})
    b = client.post("/api/auth/forgot-password", json={"email": "A@example.com"})
    assert a.status_code == b.status_code == 202 and a.text == b.text
    assert [m[0] for m in outbox] == ["a@example.com"]


def test_reset_password_flow(client, outbox):
    register(client)
    outbox.clear()
    client.post("/api/auth/forgot-password", json={"email": "a@example.com"})
    token = link_token(outbox[0])
    assert client.post("/api/auth/reset-password", json={"token": token, "new_password": "short"}).status_code == 422
    assert client.post("/api/auth/reset-password", json={"token": token, "new_password": "brand-new-password"}).status_code == 204
    assert client.get("/api/auth/me").status_code == 401  # every session was ended
    assert client.post("/api/auth/login", json={"email": "a@example.com", "password": PW}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "a@example.com", "password": "brand-new-password"}).status_code == 200
    assert client.get("/api/auth/me").json()["email_verified"] is True
    assert client.post("/api/auth/reset-password", json={"token": token, "new_password": "another-password-1"}).status_code == 400


def test_reset_and_verify_links_are_not_interchangeable(client, outbox):
    register(client)
    assert client.post("/api/auth/reset-password", json={"token": link_token(outbox[0]), "new_password": "brand-new-password"}).status_code == 400
    client.post("/api/auth/forgot-password", json={"email": "a@example.com"})
    assert client.post("/api/auth/verify-email", json={"token": link_token(outbox[1])}).status_code == 400


def test_deactivated_users_get_no_reset_email(client, outbox):
    register(client)
    outbox.clear()
    with SessionLocal() as db:
        db.execute(update(User).values(is_active=False))
        db.commit()
    client.post("/api/auth/forgot-password", json={"email": "a@example.com"})
    assert outbox == []


def test_smtp_send_uses_starttls_and_login(monkeypatch):
    calls = []

    class FakeSMTP:
        def __init__(self, host, port, timeout): calls.append(("connect", host, port))
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def starttls(self, context): calls.append(("starttls",))
        def login(self, user, password): calls.append(("login", user))
        def send_message(self, msg): calls.append(("send", msg["To"], msg["From"], msg["Subject"]))

    monkeypatch.setattr(mail.smtplib, "SMTP", FakeSMTP)
    for k, v in dict(smtp_host="smtp.example.com", smtp_user="bot@example.com", smtp_password="pw").items():
        monkeypatch.setattr(mail.settings, k, v)
    mail.send("to@example.com", "Hi", "body")
    assert calls == [("connect", "smtp.example.com", 587), ("starttls",), ("login", "bot@example.com"),
                     ("send", "to@example.com", "Beautiful Bleep <bot@example.com>", "Hi")]


def test_send_failure_is_swallowed(monkeypatch):
    def boom(*a, **k): raise OSError("down")
    monkeypatch.setattr(mail.smtplib, "SMTP", boom)
    monkeypatch.setattr(mail.settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(mail.settings, "smtp_user", "bot@example.com")
    mail.send("to@example.com", "Hi", "body")


def test_confirmation_can_be_switched_off(client, outbox, monkeypatch):
    monkeypatch.setattr(mail.settings, "email_verification", False)
    r = register(client)
    assert outbox == [] and r.json()["email_verified"] is True  # nothing to confirm, so no banner either
    resend(client)
    assert outbox == []
    client.post("/api/auth/forgot-password", json={"email": "a@example.com"})
    assert len(outbox) == 1  # password reset still works
