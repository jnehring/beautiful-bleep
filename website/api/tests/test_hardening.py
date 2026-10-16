# SPDX-License-Identifier: MIT
import io
import os
import stat
import zipfile

import pytest

from app import signing
from app.config import settings
from app.main import MAX_BODY, body_limit


def test_body_limits_by_path():
    assert body_limit("/api/presets") == MAX_BODY
    assert body_limit("/api/registry/plugin/p/releases") == MAX_BODY
    assert body_limit("/api/registry/plugin/p/releases/1.0.0/files/p.zip") > 1000 * 1024 * 1024


def test_declared_oversize_body_is_413(client):
    res = client.post("/api/contact", content=b"x" * (MAX_BODY + 1), headers={"Content-Type": "application/json"})
    assert res.status_code == 413


def test_streamed_oversize_body_is_413(client):
    def chunks():  # no Content-Length: chunked
        for _ in range(MAX_BODY // 65536 + 2):
            yield b" " * 65536
    res = client.post("/api/contact", content=chunks(), headers={"Content-Type": "application/json"})
    assert res.status_code == 413


def test_normal_body_still_passes(client):
    assert client.post("/api/contact", json={"name": "a", "email": "nope", "message": "x"}).status_code == 422


def _zip(members):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for n, d in members.items():
            z.writestr(n, d)
    buf.seek(0)
    return buf


def test_zip_member_over_limit_refused_before_reading(monkeypatch):
    monkeypatch.setattr(signing, "MAX_MEMBER_BYTES", 100)
    z = _zip({"a.bin": b"x" * 101})
    with pytest.raises(ValueError, match="more than the limit"):
        signing.read_entries(z)
    assert signing.read_entries(_zip({"a.bin": b"x" * 100}))


def test_zip_total_over_limit_refused(monkeypatch):
    monkeypatch.setattr(signing, "MAX_TOTAL_BYTES", 150)
    with pytest.raises(ValueError, match="larger than"):
        signing.read_entries(_zip({"a": b"x" * 100, "b": b"y" * 100}))


def test_zip_bomb_ratio_refused(monkeypatch):
    monkeypatch.setattr(signing, "RATIO_FROM", 1000)
    with pytest.raises(ValueError, match="ratio"):
        signing.read_entries(_zip({"zeros": b"\0" * 5_000_000}))


def test_oversize_module_json_is_422_not_500(monkeypatch):
    z = zipfile.ZipFile(_zip({"module.json": b"{" + b" " * (signing.MAX_META_BYTES + 1) + b"}"}))
    with pytest.raises(ValueError):
        signing.read_member(z, "module.json")


def test_save_key_is_private_from_the_start(tmp_path, monkeypatch):
    seen = []
    real = os.open
    monkeypatch.setattr(os, "open", lambda p, f, m=0o777, **kw: (seen.append(m), real(p, f, m, **kw))[1])
    key = signing.Ed25519PrivateKey.generate()
    path = tmp_path / "k.key"
    signing.save_key(key, path)
    assert seen == [0o600] and stat.S_IMODE(path.stat().st_mode) == 0o600
    path.chmod(0o644)  # overwriting an older, looser file tightens it
    signing.save_key(key, path)
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert signing.load_key(str(path)).private_bytes_raw() == key.private_bytes_raw()


def test_write_secret_mode(tmp_path):
    p = tmp_path / "registry.env"
    signing.write_secret(p, "A=1\n")
    assert p.read_text() == "A=1\n" and stat.S_IMODE(p.stat().st_mode) == 0o600


def test_issuer_key_from_file(tmp_path, monkeypatch):
    pem = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n"
    f = tmp_path / "issuer.pem"
    f.write_text(pem)
    monkeypatch.setattr(settings, "issuer_key", None)
    monkeypatch.setattr(settings, "issuer_key_file", str(f))
    assert signing.issuer_key_pem() == pem
    monkeypatch.setattr(settings, "issuer_key_file", str(tmp_path / "missing"))
    with pytest.raises(ValueError):
        signing.issuer_key_pem()
    monkeypatch.setattr(settings, "issuer_key", "A\\nB")  # unreadable file but the variable is set: it is used
    assert signing.issuer_key_pem() == "A\nB"


def test_production_start_refuses_placeholder_secrets(monkeypatch):
    import pytest

    from app import main
    from app.config import settings

    monkeypatch.setattr(settings, "cookie_secure", True)
    monkeypatch.setattr(settings, "admin_password", "change-me-too-12345")
    with pytest.raises(RuntimeError, match="BLEEP_ADMIN_PASSWORD"):
        main.refuse_placeholder_secrets()
    monkeypatch.setattr(settings, "admin_password", "a-real-long-secret")
    monkeypatch.setattr(settings, "s3_secret_key", "Change-Me-three")
    with pytest.raises(RuntimeError, match="S3_SECRET_KEY"):
        main.refuse_placeholder_secrets()
    monkeypatch.setattr(settings, "s3_secret_key", "real")
    monkeypatch.setattr(settings, "database_url", "postgresql+psycopg://bleep:change-me@db:5432/bleep")
    with pytest.raises(RuntimeError, match="database password"):
        main.refuse_placeholder_secrets()
    monkeypatch.setattr(settings, "database_url", "postgresql+psycopg://bleep:real@db:5432/bleep")
    main.refuse_placeholder_secrets()  # nothing left to refuse
    monkeypatch.setattr(settings, "cookie_secure", False)
    monkeypatch.setattr(settings, "admin_password", "change-me")
    main.refuse_placeholder_secrets()  # local development may use them
