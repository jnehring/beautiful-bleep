# SPDX-License-Identifier: MIT
import re
from datetime import timedelta

import pytest
from sqlalchemy import update

from app import mail
from app.db import SessionLocal
from app.models import EmailToken, User, now

from test_api import PW, register


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
    assert client.post("/api/auth/verify-email", json={"token": link_token(outbox[0])}).json()["email_verified"] is True
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


def test_resend_is_throttled_and_replaces_the_old_link(client, outbox):
    register(client)
    client.post("/api/auth/resend-verification")
    assert len(outbox) == 1  # a minute has not passed
    age_tokens(5)
    assert client.post("/api/auth/resend-verification").status_code == 202
    assert len(outbox) == 2
    assert client.post("/api/auth/verify-email", json={"token": link_token(outbox[0])}).status_code == 400
    assert client.post("/api/auth/verify-email", json={"token": link_token(outbox[1])}).status_code == 200
    client.post("/api/auth/resend-verification")
    assert len(outbox) == 2  # verified: nothing to send


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
    client.post("/api/auth/resend-verification")
    assert outbox == []
    client.post("/api/auth/forgot-password", json={"email": "a@example.com"})
    assert len(outbox) == 1  # password reset still works
