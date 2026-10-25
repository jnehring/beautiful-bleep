# SPDX-License-Identifier: MIT
"""Community modules: an account uploads a package, the library checks and publishes it."""
import hashlib
import io
import json
import zipfile

import pytest

from app import community
from app.db import SessionLocal
from app.models import ApiToken, Release, Report, User
from sqlalchemy import select
from tests.test_api import register
from tests.test_registry import clean_storage, new_token, storage  # noqa: F401  (fixtures)


def leb(n: int) -> bytes:
    out = b""
    while True:
        b = n & 0x7F
        n >>= 7
        out += bytes([b | (0x80 if n else 0)])
        if not n:
            return out


def name(s: str) -> bytes:
    return leb(len(s.encode())) + s.encode()


def section(sid: int, payload: bytes) -> bytes:
    return bytes([sid]) + leb(len(payload)) + payload


def fake_wasm(imports=(), exports=tuple(sorted(community.REQUIRED_EXPORTS))) -> bytes:
    """A binary the library's reader accepts: the header, the imports and the exports (bodies are not looked at)."""
    out = b"\0asm\x01\0\0\0"
    if imports:
        out += section(2, leb(len(imports)) + b"".join(name(m) + name(n) + b"\x00" + leb(0) for m, n in imports))
    out += section(7, leb(len(exports)) + b"".join(name(e) + (b"\x02" if e == "memory" else b"\x00") + leb(0) for e in exports))
    return out


def package(types=("zed/wobble",), *, wasm=None, extra=None, drop=(), meta=None) -> bytes:
    meta = meta if meta is not None else {"name": "Wobble", "types": list(types), "requires": {"engineAbi": 1}, "summary": "A wobble.", "license": "MIT"}
    files = {"module.json": json.dumps(meta).encode(), "module.wasm": wasm if wasm is not None else fake_wasm(), "spec.json": b"[]\n"}
    files.update(extra or {})
    for d in drop:
        files.pop(d, None)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for p, c in files.items():
            z.writestr(p, c)
    return buf.getvalue()


@pytest.fixture
def community_on():
    return None


def author(client, email="zed@example.com", display="Zed"):
    register(client, email, display)
    return client


def put(client, data, name="wobble", version="1.0.0"):
    return client.put(f"/api/registry/community/modules/{name}/{version}", content=data)


def test_an_account_publishes(client, community_on, storage):
    author(client)
    r = put(client, package())
    assert r.status_code == 201, r.text
    assert r.json() == {"id": "zed/wobble", "version": "1.0.0", "types": ["zed/wobble"]}

    entry = json.loads(storage.objects["v1/modules/zed.wobble/1.0.0/entry.json"])
    assert entry["types"] == ["zed/wobble"]
    f = entry["files"][0]
    assert set(f) == {"path", "sha256", "bytes", "platform"}
    assert "trust" not in json.dumps(json.loads(storage.objects["v1/index.json"]))
    assert "v1/revocations.json" not in storage.objects

    # the stored package is the uploaded files, nothing added
    stored = zipfile.ZipFile(io.BytesIO(storage.objects["v1/modules/zed.wobble/1.0.0/wobble.bleepmod"]))
    assert sorted(stored.namelist()) == ["module.json", "module.wasm", "spec.json"]
    assert hashlib.sha256(storage.objects["v1/modules/zed.wobble/1.0.0/wobble.bleepmod"]).hexdigest() == f["sha256"]


def test_a_leftover_signature_file_is_ignored(client, community_on, storage):
    author(client)
    assert put(client, package(extra={"META/signature.json": b"{}"})).status_code == 201
    stored = zipfile.ZipFile(io.BytesIO(storage.objects["v1/modules/zed.wobble/1.0.0/wobble.bleepmod"]))
    assert "META/signature.json" not in stored.namelist()


def test_login_is_required(client, community_on):
    assert put(client, package()).status_code == 401


@pytest.mark.parametrize("data,why", ids=lambda v: v if isinstance(v, str) and len(v) < 60 else "package", argvalues=[
    (b"not a zip", "not a .bleepmod"),
    (package(extra={"ui/view.js": b"alert(1)"}), "cannot bring page scripts"),
    (package(extra={"evil.exe": b"MZ"}), "not allowed in a community package"),
    (package(extra={"doc/pic.png": b"not a png"}), "not a PNG"),
    (package(drop=("spec.json",)), "Missing from the package"),
    (package(wasm=fake_wasm(imports=[("env", "fetch")])), "imports env.fetch"),
    (package(wasm=fake_wasm(imports=[("wasi_snapshot_preview1", "path_open")])), "path_open"),
    (package(wasm=fake_wasm(exports=("memory",))), "does not export"),
    (package(wasm=b"\0asm\x02\0\0\0"), "cannot read the file"),
    (package(types=("oscillator",)), "must start with 'zed/'"),
    (package(types=("alice/wobble",)), "must start with 'zed/'"),
    (package(meta={"types": ["zed/w"], "requires": {"engineAbi": 99}}), "engineAbi"),
    (package(meta={"types": ["zed/w"], "requires": {"engineAbi": 1}, "license": "<script>"}), "license"),
])
def test_a_package_that_breaks_a_rule_is_refused(client, community_on, data, why):
    author(client)
    r = put(client, data)
    assert r.status_code == 422 and why in r.json()["detail"], r.text
    assert client.get("/api/library").json()["items"] == []


def test_versions_rise_and_types_are_not_shared(client, community_on):
    author(client)
    assert put(client, package()).status_code == 201
    assert put(client, package()).status_code == 409  # the same version
    assert put(client, package(), version="1.0.1").status_code == 201
    assert put(client, package(), name="other", version="1.0.0").status_code == 409  # "zed/wobble" belongs to the module wobble
    assert put(client, package(types=("zed/other",)), name="other").status_code == 201


def test_a_namespace_a_release_token_is_made_for_is_not_for_authors(client, community_on):
    with SessionLocal() as db:
        db.add(ApiToken(name="acme", prefix="blp_0000", token_hash="0" * 64, publisher="acme"))
        db.commit()
    author(client, "acme@example.com", "Acme")
    r = put(client, package(types=("acme/wobble",)))
    assert r.status_code == 409 and "reserved" in r.json()["detail"]
    author(client, "bleep@example.com", "Bleep")
    assert put(client, package(types=("bleep/wobble",))).status_code == 409


def test_only_the_author_or_an_admin_takes_a_release_down(client, community_on, make_admin, storage):
    from tests.test_api import login_as_admin
    author(client)
    assert put(client, package()).status_code == 201
    url = "/api/registry/community/modules/zed.wobble/1.0.0/takedown"

    client.cookies.clear()
    author(client, "mallory@example.com", "Mallory")
    assert client.post(url).status_code == 404  # not hers: it looks like there is no such module

    client.cookies.clear()
    login_as_admin(client, make_admin)
    assert client.post(url).status_code == 204
    assert "zed.wobble" not in json.loads(storage.objects["v1/index.json"])["channels"]["stable"]["modules"]
    assert client.post(url).status_code == 204  # again: nothing changes


def test_the_author_withdraws_their_own_release(client, community_on, storage):
    author(client)
    assert put(client, package()).status_code == 201
    assert client.post("/api/registry/community/modules/zed.wobble/1.0.0/takedown").status_code == 204
    assert "zed.wobble" not in json.loads(storage.objects["v1/index.json"])["channels"]["stable"]["modules"]


def test_takedown_by_the_cli(client, community_on, storage, capsys):
    from app import cli
    author(client)
    assert put(client, package()).status_code == 201
    cli.main(["community-takedown", "zed/wobble", "1.0.0"])
    assert "zed.wobble" not in json.loads(storage.objects["v1/index.json"])["channels"]["stable"]["modules"]
    # the version number is used up
    assert put(client, package()).status_code == 409
    with pytest.raises(SystemExit):
        cli.main(["community-takedown", "zed/nothing", "1.0.0"])


def test_ban_takes_down_everything_and_signs_the_author_out(client, community_on, storage):
    from app import cli
    author(client)
    assert put(client, package()).status_code == 201
    cli.main(["community-ban", "zed"])
    assert put(client, package(), version="2.0.0").status_code == 401
    with SessionLocal() as db:
        assert db.scalar(select(Release.status).where(Release.slug == "zed.wobble")) == "taken_down"
        assert db.scalar(select(User.is_active).where(User.handle == "zed")) is False


def test_a_report_reaches_the_admin_list(client, community_on, make_admin):
    author(client)
    assert put(client, package()).status_code == 201
    client.cookies.clear()
    author(client, "reader@example.com", "Reader")
    assert client.post("/api/registry/community/modules/zed.wobble/1.0.0/report", json={"reason": "makes my ears bleed"}).status_code == 204
    with SessionLocal() as db:
        rep = db.scalar(select(Report))
        assert (rep.target, rep.reason) == ("module", "makes my ears bleed")


def test_a_token_publisher_cannot_be_a_community_author(client, community_on):
    from app import cli
    author(client)
    assert put(client, package()).status_code == 201
    with pytest.raises(SystemExit) as e:
        cli.main(["token-create", "dev", "--publisher", "zed"])
    assert "community author" in str(e.value)
    with pytest.raises(SystemExit):
        cli.main(["token-create", "dev", "--publisher", "community"])


def test_the_publisher_name_can_be_asked_for_before_publishing(client, community_on):
    assert client.get("/api/registry/community/me").status_code == 401   # not logged in
    assert client.post("/api/registry/community/handle").status_code == 401
    author(client)
    assert client.get("/api/registry/community/me").json() == {"handle": None}   # an account has a handle once it publishes or asks for one
    assert client.post("/api/registry/community/handle").json() == {"handle": "zed"}
    assert client.get("/api/registry/community/me").json() == {"handle": "zed"}
    assert client.post("/api/registry/community/handle").json() == {"handle": "zed"}   # the same again
    assert put(client, package()).json()["id"] == "zed/wobble"   # and it is the one a module is published under


def test_a_package_may_bring_the_modules_picture_as_a_sandboxed_script(client, community_on, storage):
    author(client)
    r = put(client, package(extra={"view.sandbox.js": b"const c = bleep.canvas(100);"}))
    assert r.status_code == 201, r.text
    stored = zipfile.ZipFile(io.BytesIO(storage.objects["v1/modules/zed.wobble/1.0.0/wobble.bleepmod"]))
    assert stored.read("view.sandbox.js") == b"const c = bleep.canvas(100);"   # kept
    # only that exact name: a page script in a folder, or the same name elsewhere, is still refused
    for name in ("ui/view.js", "view.js", "ui/view.sandbox.js", "x/view.sandbox.js"):
        assert put(client, package(extra={name: b"x"}), version="1.0.1").status_code == 422, name


def test_a_package_may_bring_its_source_so_everyone_can_open_it_in_a_code_node(client, community_on, storage):
    author(client)
    src = b"@module({ name: 'Wobble' })\nexport class Wobble {}\n"
    r = put(client, package(extra={"source.dsp.ts": src, "view.sandbox.js": b"1"}))
    assert r.status_code == 201, r.text
    stored = zipfile.ZipFile(io.BytesIO(storage.objects["v1/modules/zed.wobble/1.0.0/wobble.bleepmod"]))
    assert stored.read("source.dsp.ts") == src
    for name in ("source.ts", "src/source.dsp.ts", "source.dsp.js"):
        assert put(client, package(extra={name: b"x"}), version="1.0.1").status_code == 422, name


def test_a_package_may_bring_the_picture_for_its_tile(client, community_on, storage):
    author(client)
    png = b"\x89PNG\r\n\x1a\n" + b"x" * 40
    r = put(client, package(extra={"image.png": png}))
    assert r.status_code == 201, r.text
    entry = json.loads(storage.objects["v1/modules/zed.wobble/1.0.0/entry.json"])
    assert entry["image"] == "image.png"
    assert storage.objects["v1/modules/zed.wobble/1.0.0/image.png"] == png   # served next to entry.json, for the tile
    index = json.loads(storage.objects["v1/index.json"])
    assert index["channels"]["stable"]["modules"]["zed.wobble"]["image"] == "modules/zed.wobble/1.0.0/image.png"
    tile = next(i for i in client.get("/api/library").json()["items"] if i["kind"] == "module" and i["slug"] == "zed.wobble")
    assert tile["image_url"] == "/registry/v1/modules/zed.wobble/1.0.0/image.png"
    # other formats, and the checks on what a picture is
    assert put(client, package(extra={"image.jpg": b"\xff\xd8\xff" + b"x" * 20}), version="1.0.1").status_code == 201
    assert put(client, package(extra={"image.webp": b"RIFF\0\0\0\0WEBP" + b"x" * 20}), version="1.0.2").status_code == 201
    for name, data, why in (("image.png", b"not a png", "not a PNG"), ("image.jpg", b"GIF89a", "not a JPEG"), ("image.webp", b"RIFFxxxxWAVE", "not a WebP"),
                            ("image.png", png + b"x" * (1024 * 1024), "larger than"), ("image.gif", b"x", "not allowed"), ("img/image.png", png, "not allowed")):
        r = put(client, package(extra={name: data}), version="1.0.3")
        assert r.status_code == 422 and why in r.json()["detail"], (name, r.text)
    # no picture: the library draws its placeholder
    put(client, package(), version="1.0.4")
    assert json.loads(storage.objects["v1/modules/zed.wobble/1.0.4/entry.json"])["image"] is None
