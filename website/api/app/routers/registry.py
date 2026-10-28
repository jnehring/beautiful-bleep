# SPDX-License-Identifier: MIT
"""The release side of the registry: plugins and modules, written with a release token, read by anyone.

Flow (scripts/release/release.py): list versions → create a draft release with its file list → PUT each file
(size and SHA-256 checked) → publish. Publishing writes entry.json and regenerates v1/index.json; a
release is visible to clients only when the index changes.
"""
import hashlib
import io
import json
import re
import tempfile
import zipfile
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_optional_library_user, require_release_token
from ..models import ApiToken, Release, User, now
from ..schemas import FileIn, OriginIn, PlatformIn, ReleaseIn, ReleaseOut
from ..community import read_member
from ..storage import Storage, get_storage

router = APIRouter(prefix="/api/registry", tags=["registry"])

Kind = Literal["plugin", "module"]
# A third-party id "acme/fuzz" has the slug "acme.fuzz" (a "/" does not fit in a URL path segment).
Slug = Path(pattern=r"^[a-z0-9][a-z0-9-]{0,62}(\.[a-z0-9][a-z0-9-]{0,62})?$")
VersionPath = Path(pattern=r"^\d{1,4}\.\d{1,5}\.\d{1,6}(-dev\.\d{12})?$")
MAX_FILE_BYTES = 1024 * 1024 * 1024
KEEP_DEV_BUILDS = 3  # per plugin or module: older development builds are deleted when a new one is published


def _parse(version: str) -> tuple[int, int, int, int]:
    """"1.2.3" or "1.2.3-dev.202610271432" -> major, minor, patch, build (0 for a release)."""
    base, _, build = version.partition("-dev.")
    major, minor, patch = (int(p) for p in base.split("."))
    return major, minor, patch, int(build or 0)


def rank(r: Release) -> tuple[int, int, int, int, int]:
    """The order of versions: a development build ranks above the release of the same number (0.1.4-dev is the work towards 0.1.5, said
    the other way round: it is newer than anything published before it), and development builds among themselves by build time."""
    return (r.major, r.minor, r.patch, 1 if r.build else 0, r.build)


def _id(slug: str) -> str:
    return slug.replace(".", "/", 1)


def _check_files(token: ApiToken, kind: str, slug: str, files: list[FileIn]) -> list[dict]:
    """The files of a release as stored. The token decides who may release: it may release for its own namespace (a token without one
    releases for "bleep": the bare ids and "bleep/…"). Records which token declared each file."""
    allowed = token.publisher or "bleep"
    owner = slug.partition(".")[0] if "." in slug else "bleep"
    if owner != allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"This token may release for {allowed!r}, not for {_id(slug)!r}")
    for f in files:
        if kind == "module" and not f.path.endswith((".bleepmod", ".zip")):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{f.path}: a module is a .bleepmod package")
    return [{**f.model_dump(), "uploaded": False, "token": token.id} for f in files]


def _own_draft(row: Release, token: ApiToken) -> None:
    """Only the token that started a draft continues it."""
    if row.created_by_token != token.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This draft was started with another token")


TYPE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}(/[a-z0-9][a-z0-9-]{0,62})?$")


def _module_meta(db: Session, slug: str, package) -> tuple[list[str], int]:
    """The node types and engine ABI a module package declares in its module.json, after the library's rules for them.

    A module may only provide node types nobody else provides, and a third-party module (id "acme/fuzz") only types in
    its own namespace ("acme/…"): otherwise a module could take over "oscillator" on every board."""
    try:
        meta = json.loads(read_member(zipfile.ZipFile(package), "module.json"))
        types, abi = meta["types"], meta["requires"]["engineAbi"]
    except (KeyError, ValueError, TypeError, zipfile.BadZipFile) as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"module.json must list `types` and `requires.engineAbi`: {e}")
    if not isinstance(types, list) or not types or len(types) > 64 or not all(isinstance(t, str) and TYPE_ID.match(t) for t in types) \
            or len(set(types)) != len(types) or not isinstance(abi, int):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "module.json: `types` is a list of node type ids, `requires.engineAbi` an integer")
    owner = _id(slug).partition("/")[0] if "/" in _id(slug) else None
    if owner and not all(t.startswith(owner + "/") for t in types):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"node types of {_id(slug)!r} must start with '{owner}/'")
    taken = {t for r in _published(db, "module") if r.slug != slug for f in r.files for t in f.get("types", [])}
    clash = sorted(set(types) & taken)
    if clash:
        raise HTTPException(status.HTTP_409_CONFLICT, f"node type(s) already provided by another module: {', '.join(clash)}")
    return types, abi


def _check_licence(row: Release, package) -> None:
    """The licence and origin a module release declares must be the ones in the package's module.json (a missing
    licence there is MIT, like package-module.py): the library's detail view must not say something else than the package."""
    package.seek(0)
    try:
        meta = json.loads(read_member(zipfile.ZipFile(package), "module.json"))
    except (KeyError, ValueError, zipfile.BadZipFile) as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"module.json cannot be read: {e}")
    try:  # the same shape the release's origin was stored in (defaults filled in)
        origin = OriginIn(**meta["origin"]).model_dump() if meta.get("origin") else None
    except (ValidationError, TypeError) as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"module.json: origin is not valid: {e}")
    if (row.license, row.origin or None) != (meta.get("license", "MIT"), origin):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "The release's license and origin must match the package's module.json "
                            f"(release: {row.license or 'none'}, package: {meta.get('license', 'MIT')})")
    package.seek(0)


def _types(r: Release) -> list[str]:
    return sorted({t for f in r.files if f["uploaded"] for t in f.get("types", [])})


def _key(r: Release, path: str = "") -> str:
    """Where a release is stored. Development builds live under dev/, which the public /registry/ path does not serve (Caddyfile):
    they are handed out by dev_file() to the accounts that may have them."""
    return ("dev/" if r.channel == "dev" else "") + f"v1/{r.kind}s/{r.slug}/{r.version}" + (f"/{path}" if path else "")


def _find(db: Session, kind: str, slug: str, version: str) -> Release:
    row = db.scalar(select(Release).where(Release.kind == kind, Release.slug == slug, Release.version == version))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such release")
    return row


def _published(db: Session, kind: str | None = None, slug: str | None = None, dev: bool | None = False) -> list[Release]:
    """Published releases, oldest first. `dev`: False the public ones (stable, beta), True only development builds, None all."""
    q = select(Release).where(Release.status == "published")
    if kind:
        q = q.where(Release.kind == kind)
    if slug:
        q = q.where(Release.slug == slug)
    if dev is not None:
        q = q.where(Release.channel == "dev") if dev else q.where(Release.channel != "dev")
    return sorted(db.scalars(q), key=rank)


@router.get("/token")
def check_token(token: ApiToken = Depends(require_release_token)):
    """Lets scripts/release/release.py fail early on a bad token, before it packages anything."""
    return {"name": token.name}


@router.get("/{kind}/{slug}/versions")
def versions(kind: Kind, slug: str = Slug, db: Session = Depends(get_db)):
    return [{"version": r.version, "channel": r.channel, "published_at": r.published_at} for r in _published(db, kind, slug)]


@router.get("/{kind}/{slug}/newest")
def newest(kind: Kind, slug: str = Slug, channel: Literal["stable", "dev"] = "stable", db: Session = Depends(get_db),
           token: ApiToken = Depends(require_release_token)):
    """The newest published release with its files' digests, for a release script that skips what did not change. `dev` also counts
    development builds (a token that may release into the dev channel); `stable` only the public releases."""
    if channel == "dev" and "dev" not in (token.channels or []):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This token may not use the dev channel")
    rows = _published(db, kind, slug, dev=None if channel == "dev" else False)
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nothing published yet")
    r = rows[-1]
    return {"version": r.version, "channel": r.channel,
            "files": [{k: f[k] for k in ("path", "sha256", "platform")} for f in r.files if f["uploaded"]]}


@router.post("/{kind}/{slug}/releases", response_model=ReleaseOut, status_code=status.HTTP_201_CREATED)
def create_release(kind: Kind, body: ReleaseIn, slug: str = Slug, db: Session = Depends(get_db),
                   token: ApiToken = Depends(require_release_token)):
    """Starts a draft. The version must be higher than every published version of this id; a draft of the same version is replaced."""
    major, minor, patch, build = _parse(body.version)
    if body.channel not in (token.channels or ["stable", "beta"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"This token may not release into the {body.channel} channel")
    if len({f.path for f in body.files}) != len(body.files):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Duplicate file paths")
    # releases count among releases, development builds among development builds
    newest = max((rank(r) for r in _published(db, kind, slug, dev=body.channel == "dev")), default=None)
    if newest is not None and (major, minor, patch, 1 if build else 0, build) <= newest:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Version must be higher than {newest[0]}.{newest[1]}.{newest[2]}" + (f"-dev.{newest[4]}" if newest[4] else ""))
    row = db.scalar(select(Release).where(Release.kind == kind, Release.slug == slug, Release.version == body.version))
    if row is None:
        row = Release(kind=kind, slug=slug, version=body.version, major=major, minor=minor, patch=patch, build=build)
        db.add(row)
    else:
        _own_draft(row, token)  # a draft is replaced only by the token that started it
    row.channel, row.title, row.notes, row.requires = body.channel, body.title, body.notes, body.requires
    row.summary, row.category = body.summary, body.category
    row.license, row.origin = body.license, body.origin.model_dump() if body.origin else {}
    row.files = _check_files(token, kind, slug, body.files)
    row.created_by_token = token.id
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "That version already exists")
    return row


@router.put("/{kind}/{slug}/releases/{version}/files/{path:path}", status_code=status.HTTP_204_NO_CONTENT)
async def upload_file(kind: Kind, request: Request, path: str, slug: str = Slug, version: str = VersionPath,
                      db: Session = Depends(get_db), storage: Storage = Depends(get_storage),
                      token: ApiToken = Depends(require_release_token)):
    row = _find(db, kind, slug, version)
    declared = next((f for f in row.files if f["path"] == path), None)
    if declared is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File is not part of this release")
    if declared.get("token", token.id) != token.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This file was declared with another token")
    if row.status != "draft" and declared["uploaded"]:  # a published release only takes files still pending (a platform added later)
        raise HTTPException(status.HTTP_409_CONFLICT, "Release is already published")
    digest, size = hashlib.sha256(), 0
    with tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024) as spool:
        async for chunk in request.stream():
            size += len(chunk)
            if size > min(declared["bytes"], MAX_FILE_BYTES):
                raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "More bytes than declared")
            digest.update(chunk)
            spool.write(chunk)
        if size != declared["bytes"] or digest.hexdigest() != declared["sha256"]:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Size or SHA-256 does not match the declaration")
        if kind == "module":
            spool.seek(0)
            declared = {**declared, "types": (meta := _module_meta(db, slug, spool))[0]}
            row.requires = {**row.requires, "engineAbi": meta[1]}
            _check_licence(row, spool)
        spool.seek(0)
        storage.put(_key(row, path), spool)
    row.files = [{**declared, "uploaded": True} if f["path"] == path else f for f in row.files]
    if row.status == "published":  # a platform added later
        storage.put(_key(row, "entry.json"), io.BytesIO(json.dumps(_entry(row), indent=1).encode()), "application/json")
    db.commit()


IMAGE_TYPES = {"image/png": (b"\x89PNG\r\n\x1a\n", "png"), "image/jpeg": (b"\xff\xd8\xff", "jpg"), "image/webp": (b"RIFF", "webp")}
MAX_IMAGE_BYTES = 1024 * 1024


@router.put("/{kind}/{slug}/releases/{version}/image", status_code=status.HTTP_204_NO_CONTENT)
async def upload_image(kind: Kind, request: Request, slug: str = Slug, version: str = VersionPath,
                       db: Session = Depends(get_db), storage: Storage = Depends(get_storage),
                       token: ApiToken = Depends(require_release_token)):
    """The screenshot of an entry's tile (PNG, JPEG or WebP, up to 1 MB). Display metadata, not code, so it
    may be replaced, also after publishing, by the token that created the release."""
    row = _find(db, kind, slug, version)
    if row.created_by_token != token.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This release was created with another token")
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type not in IMAGE_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "The image is a PNG, JPEG or WebP")
    data = b""
    async for chunk in request.stream():
        data += chunk
        if len(data) > MAX_IMAGE_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "The image is larger than 1 MB")
    magic, ext = IMAGE_TYPES[content_type]
    if not data.startswith(magic) or (ext == "webp" and data[8:12] != b"WEBP"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"This is not a {ext.upper()} file")
    name = f"image.{ext}"
    storage.put(_key(row, name), io.BytesIO(data), content_type)
    row.image = name
    if row.status == "published":
        storage.put(_key(row, "entry.json"), io.BytesIO(json.dumps(_entry(row), indent=1).encode()), "application/json")
    db.commit()


@router.post("/{kind}/{slug}/releases/{version}/platforms", response_model=ReleaseOut)
def add_platform(kind: Kind, body: PlatformIn, slug: str = Slug, version: str = VersionPath,
                 db: Session = Depends(get_db), token: ApiToken = Depends(require_release_token)):
    """Declares files for platforms a published release lacks (built on another machine). Existing files never change;
    each file shows in entry.json once it is uploaded, so clients never see a half-uploaded platform file."""
    row = _find(db, kind, slug, version)
    if row.channel not in (token.channels or ["stable", "beta"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"This token may not release into the {row.channel} channel")
    if row.status != "published":
        raise HTTPException(status.HTTP_409_CONFLICT, "Release is not published; create or replace the draft instead")
    have = {f["platform"] for f in row.files if f["uploaded"]}
    paths = {f["path"] for f in row.files if f["uploaded"]}
    if len({f.path for f in body.files}) != len(body.files):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Duplicate file paths")
    for f in body.files:
        if f.platform in have or f.platform == "any":
            raise HTTPException(status.HTTP_409_CONFLICT, f"Platform {f.platform} is already in this release")
        if f.path in paths:
            raise HTTPException(status.HTTP_409_CONFLICT, f"File {f.path} already exists in this release")
    pending = {f.path for f in body.files}
    declared = _check_files(token, kind, slug, body.files)
    row.files = [f for f in row.files if f["uploaded"] or f["path"] not in pending] + declared
    db.commit()
    return row


def _entry(r: Release) -> dict:
    return {
        "kind": r.kind, "id": r.slug, "version": r.version, "channel": r.channel, "title": r.title or r.slug,
        "summary": r.summary, "category": r.category, "license": r.license, "origin": r.origin or None, "image": r.image or None, "notes": r.notes, "requires": r.requires, "types": _types(r), "published": r.published_at.isoformat(),
        "files": [{k: f[k] for k in ("path", "sha256", "bytes", "platform") if f.get(k) is not None}
                  for f in r.files if f["uploaded"]],
    }


def _index_entry(r: Release) -> dict:
    return {
        "version": r.version, "entry": f"{r.kind}s/{r.slug}/{r.version}/entry.json",
        # what the apps' library tiles show, so one request to the index is enough
        "title": r.title or r.slug, "summary": r.summary, "category": r.category,
        **({"image": f"{r.kind}s/{r.slug}/{r.version}/{r.image}"} if r.image else {}),
        **({"types": _types(r)} if r.kind == "module" else {}),  # which node types a module provides: clients find the package for a type without downloading any
    }


def _channels(releases: list[Release], names: tuple[str, ...]) -> dict:
    """Per channel, the newest version of every plugin and module. `releases` ascending, so later rows are newer; beta also sees stable
    releases, dev sees everything."""
    seen = {"stable": ("stable",), "beta": ("stable", "beta"), "dev": ("stable", "beta", "dev")}
    out: dict = {n: {"plugins": {}, "modules": {}} for n in names}
    for r in releases:
        for n in names:
            if r.channel in seen[n]:
                out[n][r.kind + "s"][r.slug] = _index_entry(r)
    return out


def write_index(db: Session, storage: Storage) -> dict:
    """v1/index.json: per channel, the newest version of every plugin and module. Public: stable and beta. dev/v1/index.json (only
    for accounts with dev access, see dev_file) has the dev channel too: development builds, and what they are newer than."""
    releases = _published(db, dev=None)
    index = {"format": 1, "generated": now().isoformat(), "channels": _channels([r for r in releases if r.channel != "dev"], ("stable", "beta"))}
    storage.put("v1/index.json", io.BytesIO(json.dumps(index, indent=1).encode()), "application/json")
    private = {**index, "channels": {**index["channels"], **_channels(releases, ("dev",))}}
    storage.put("dev/v1/index.json", io.BytesIO(json.dumps(private, indent=1).encode()), "application/json")
    return index


def _prune_dev(db: Session, storage: Storage, kind: str, slug: str) -> None:
    """Keeps the newest KEEP_DEV_BUILDS development builds of a plugin or module; older ones are deleted with their files."""
    for old in _published(db, kind, slug, dev=True)[:-KEEP_DEV_BUILDS]:
        for key in [_key(old, f["path"]) for f in old.files] + [_key(old, "entry.json")] + ([_key(old, old.image)] if old.image else []):
            storage.delete(key)
        db.delete(old)
    db.commit()


def _may_use_dev(user: User | None) -> bool:
    return user is not None and (user.role == "admin" or user.dev_access)


@router.get("/dev/v1/{path:path}")
def dev_file(path: str, user: User | None = Depends(get_optional_library_user), storage: Storage = Depends(get_storage)):
    """The library for accounts with dev access: development builds are only here, everything else (a release, an image) is the same as
    under /registry/v1/. Signed in with a session cookie or the app's personal token."""
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    if not _may_use_dev(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has no access to the dev channel")
    if ".." in path.split("/") or path.startswith("/"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such file")
    data = storage.get("dev/v1/" + path)
    if data is None:
        data = storage.get("v1/" + path)
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such file")
    kind = "application/json" if path.endswith(".json") else "image/" + path.rsplit(".", 1)[-1] if path.endswith((".png", ".jpg", ".webp")) else "application/octet-stream"
    return Response(data, media_type=kind, headers={"Cache-Control": "private, no-cache", "Content-Security-Policy": "default-src 'none'; sandbox", "X-Content-Type-Options": "nosniff"})


@router.post("/{kind}/{slug}/releases/{version}/publish", response_model=ReleaseOut)
def publish(kind: Kind, slug: str = Slug, version: str = VersionPath, db: Session = Depends(get_db),
            storage: Storage = Depends(get_storage), token: ApiToken = Depends(require_release_token)):
    row = _find(db, kind, slug, version)
    _own_draft(row, token)
    if row.status == "published":
        raise HTTPException(status.HTTP_409_CONFLICT, "Already published")
    missing = [f["path"] for f in row.files if not f["uploaded"]]
    if missing:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Files not uploaded: {', '.join(missing)}")
    newest = max((rank(r) for r in _published(db, kind, slug, dev=row.channel == "dev")), default=None)
    if newest is not None and rank(row) <= newest:
        raise HTTPException(status.HTTP_409_CONFLICT, f"A version up to {newest[0]}.{newest[1]}.{newest[2]} was published meanwhile")
    row.status, row.published_at = "published", now()
    storage.put(_key(row, "entry.json"), io.BytesIO(json.dumps(_entry(row), indent=1).encode()), "application/json")
    db.commit()
    if row.channel == "dev":
        _prune_dev(db, storage, kind, slug)
    write_index(db, storage)
    return row
