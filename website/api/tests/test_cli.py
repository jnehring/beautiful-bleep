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


@pytest.mark.parametrize("cmd,days", [("token-create", "0"), ("token-create", "-5"), ("token-create", "3651"),
                                      ("developer-create", "0"), ("developer-create", "826"), ("developer-create", "x")])
def test_days_are_bounded(client, cmd, days, capsys):
    argv = [cmd, "acme" if cmd == "developer-create" else "laptop", "--days", days]
    with pytest.raises(SystemExit) as e:
        cli.main(argv)
    assert e.value.code == 2
    assert "days" in capsys.readouterr().err


def test_token_create_out_file_is_private(client, tmp_path, capsys):
    import os, stat
    out = tmp_path / "token"
    cli.main(["token-create", "laptop", "--days", "30", "--out", str(out)])
    captured = capsys.readouterr()
    assert out.read_text().strip().startswith("blp_") and out.read_text().strip() not in captured.out
    assert stat.S_IMODE(os.stat(out).st_mode) == 0o600


def test_secret_to_readable_file_is_refused(client, tmp_path, monkeypatch, capsys):
    import os
    f = tmp_path / "redirect"
    f.write_text("")
    f.chmod(0o644)
    with open(f, "w") as fh:
        monkeypatch.setattr(cli.sys, "stdout", fh)
        with pytest.raises(SystemExit) as e:
            cli.main(["token-create", "laptop"])
        assert "--out" in str(e.value)
        # a private file is fine
        f.chmod(0o600)
        cli.main(["token-create", "laptop"])
    assert f.read_text().strip().startswith("blp_")


def test_secret_to_pipe_is_allowed(client, monkeypatch):
    import os
    r, w = os.pipe()
    with os.fdopen(w, "w") as fh:
        monkeypatch.setattr(cli.sys, "stdout", fh)
        cli.main(["token-create", "laptop"])
    assert os.read(r, 100).startswith(b"blp_")
    os.close(r)
