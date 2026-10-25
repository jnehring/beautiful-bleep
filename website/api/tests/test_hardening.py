# SPDX-License-Identifier: MIT
import io
import zipfile

import pytest

from app import community
from app.main import MAX_BODY, MAX_PRESET_BODY, body_limit


def test_body_limits_by_path():
    assert body_limit("/api/presets") == MAX_PRESET_BODY   # a preset may carry up to 5 MB of audio
    assert body_limit("/api/contact") == MAX_BODY
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
    monkeypatch.setattr(community, "MAX_MEMBER_BYTES", 100)
    infos = zipfile.ZipFile(_zip({"a.bin": b"x" * 101})).infolist()
    with pytest.raises(ValueError, match="more than the limit"):
        community.check_member(infos[0])
    assert community.check_member(zipfile.ZipFile(_zip({"a.bin": b"x" * 100})).infolist()[0]) == 100


def test_zip_total_over_limit_refused(monkeypatch):
    monkeypatch.setattr(community, "MAX_TOTAL_BYTES", 150)
    total = 0
    with pytest.raises(ValueError, match="larger than"):
        for info in zipfile.ZipFile(_zip({"a": b"x" * 100, "b": b"y" * 100})).infolist():
            total = community.check_member(info, total)


def test_zip_bomb_ratio_refused(monkeypatch):
    monkeypatch.setattr(community, "RATIO_FROM", 1000)
    with pytest.raises(ValueError, match="ratio"):
        community.check_member(zipfile.ZipFile(_zip({"zeros": b"\0" * 5_000_000})).infolist()[0])


def test_oversize_module_json_is_422_not_500(monkeypatch):
    z = zipfile.ZipFile(_zip({"module.json": b"{" + b" " * (community.MAX_META_BYTES + 1) + b"}"}))
    with pytest.raises(ValueError):
        community.read_member(z, "module.json")


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


def test_project_bodies_may_be_bigger_than_other_json():
    from app import main
    from app.routers.projects import MAX_BYTES

    assert main.body_limit("/api/projects") >= MAX_BYTES * 4 + 5 * 1024 * 1024 * 4 // 3 + 64 * 1024  # the board plus its audio as base64; the endpoint's own 413 decides, not the middleware
    assert main.body_limit("/api/presets") > 5 * 1024 * 1024 * 4 // 3   # the audio of a preset as base64, plus its patch
    assert main.body_limit("/api/contact") == main.MAX_BODY
