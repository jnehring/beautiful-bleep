# SPDX-License-Identifier: MIT
import pytest

from app import cli
from app.db import SessionLocal
from app.models import User

from test_api import register

PW = "correct-horse-1"


def test_list(client, capsys):
    register(client)
    cli.main(["list"])
    out = capsys.readouterr().out
    assert "EMAIL" in out and "a@example.com" in out and "user" in out


def test_promote(client, capsys):
    register(client)
    cli.main(["promote", "A@Example.com"])
    with SessionLocal() as db:
        assert db.query(User).one().role == "admin"
    assert client.get("/api/admin/users").status_code == 200
    cli.main(["promote", "a@example.com"])
    assert "already" in capsys.readouterr().out


def test_demote(client, capsys):
    register(client)
    cli.main(["promote", "a@example.com"])
    cli.main(["demote", "A@Example.com"])
    with SessionLocal() as db:
        assert db.query(User).one().role == "user"
    assert client.get("/api/admin/users").status_code == 403
    cli.main(["demote", "a@example.com"])
    assert "already" in capsys.readouterr().out


def test_unknown_user_exits(client):
    with pytest.raises(SystemExit):
        cli.main(["promote", "nobody@example.com"])


def test_set_password_ends_sessions(client, monkeypatch):
    register(client)
    answers = iter(["brand-new-pass-1", "brand-new-pass-1"])
    monkeypatch.setattr(cli.getpass, "getpass", lambda _: next(answers))
    cli.main(["set-password", "a@example.com"])
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "a@example.com", "password": PW}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "a@example.com", "password": "brand-new-pass-1"}).status_code == 200


@pytest.mark.parametrize("answers", [["short", "short"], ["brand-new-pass-1", "different-pass-12"]])
def test_set_password_rejects_bad_input(client, monkeypatch, answers):
    register(client)
    it = iter(answers)
    monkeypatch.setattr(cli.getpass, "getpass", lambda _: next(it))
    with pytest.raises(SystemExit):
        cli.main(["set-password", "a@example.com"])
    assert client.post("/api/auth/login", json={"email": "a@example.com", "password": PW}).status_code == 200
