# SPDX-License-Identifier: MIT
import pytest

from app import mail
from app.config import settings
from app.routers import contact

MSG = {"name": "Ada", "email": "ada@example.com", "message": "Love the project, a question about presets."}


@pytest.fixture
def outbox(monkeypatch):
    sent = []
    monkeypatch.setattr(mail, "send", lambda to, subject, body, reply_to=None: sent.append((to, subject, body, reply_to)))
    monkeypatch.setattr(settings, "contact_to", "me@example.com")
    contact._per_ip.reset()
    contact._global.reset()
    return sent


def test_message_is_mailed_with_reply_to(client, outbox):
    assert client.post("/api/contact", json=MSG).status_code == 202
    assert len(outbox) == 1
    to, subject, body, reply_to = outbox[0]
    assert to == "me@example.com" and reply_to == "ada@example.com" and "presets" in body and "Ada" in subject


def test_honeypot_sends_nothing(client, outbox):
    assert client.post("/api/contact", json={**MSG, "website": "http://spam"}).status_code == 202
    assert outbox == []


def test_validation(client, outbox):
    assert client.post("/api/contact", json={**MSG, "email": "nope"}).status_code == 422
    assert client.post("/api/contact", json={**MSG, "message": "short"}).status_code == 422
    assert client.post("/api/contact", json={**MSG, "name": "a\nBcc: x@y.z"}).status_code == 422
    assert outbox == []


def test_rate_limit(client, outbox):
    for _ in range(contact.LIMIT):
        assert client.post("/api/contact", json=MSG).status_code == 202
    assert client.post("/api/contact", json=MSG).status_code == 429


def test_one_address_does_not_block_others(client, outbox):
    for _ in range(contact.LIMIT):
        assert client.post("/api/contact", json=MSG).status_code == 202
    assert client.post("/api/contact", json=MSG).status_code == 429
    assert contact._per_ip.blocked("testclient")
    assert not contact._per_ip.blocked("203.0.113.9")  # another visitor is unaffected
    assert contact._per_ip.hit("203.0.113.9")


def test_global_cap(client, outbox, monkeypatch):
    monkeypatch.setattr(contact, "_global", contact.limiter(3, 3600))
    for i in range(3):
        contact._per_ip.reset()
        assert client.post("/api/contact", json=MSG).status_code == 202
    contact._per_ip.reset()
    assert client.post("/api/contact", json=MSG).status_code == 429
