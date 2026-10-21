# SPDX-License-Identifier: MIT
"""Community modules: anyone with an account publishes a module (signing.md section 2a).

The author uploads an UNSIGNED .bleepmod. The library checks it (app/community.py: the files it may contain, the .wasm's imports and
exports, its node types and licence), then signs it with its own community key, dates it with a publication receipt and publishes it in
one step. The id is always `<handle>/<name>` with the author's own handle, so a namespace belongs to the account that holds the handle.
Takedowns (an admin, or the author for their own release) put the release on the signed revocation list.
"""
import hashlib
import io
import json
import re

from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import community, ratelimit, signing
from ..config import settings
from ..db import get_db
from ..deps import get_library_user
from ..models import Developer, Release, Report, User, now
from ..schemas import LICENSE_PATTERN, OriginIn, ReportIn
from ..storage import Storage, get_storage
from . import registry
from .presets import ensure_handle

router = APIRouter(prefix="/api/registry/community", tags=["community"])

NamePath = Path(pattern=r"^[a-z0-9][a-z0-9-]{0,62}$")
# Namespaces nobody may take as an author handle, besides every developer publisher (checked against the table).
RESERVED = {"bleep", "community", "official", "admin", "beautiful-bleep"}
MODULES_PER_AUTHOR = 100
PUBLISHES_PER_HOUR = ratelimit.limiter(10, 3600)


def _string(meta: dict, key: str, limit: int, default: str = "") -> str:
    value = meta.get(key, default)
    if not isinstance(value, str) or len(value) > limit:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"module.json: `{key}` is a text of up to {limit} characters")
    return value


def _check_namespace(db: Session, handle: str) -> None:
    """A community author's namespace must not be one a developer holds (a developer's key signs `acme/…` too) or one of ours."""
    if handle in RESERVED or db.scalar(select(Developer.id).where(Developer.publisher == handle)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"The name {handle!r} is reserved for a developer of the library; change your name in the profile")


@router.put("/modules/{name}/{version}", status_code=status.HTTP_201_CREATED)
async def publish_module(request: Request, name: str = NamePath, version: str = registry.VersionPath, db: Session = Depends(get_db),
                         storage: Storage = Depends(get_storage), user: User = Depends(get_library_user)):
    """Publishes the uploaded (unsigned) `.bleepmod` as `<your handle>/<name>` at `version`, after the library's checks.

    The version must be higher than every earlier one of this module. Answers with the id, the version and what the library signed."""
    if not settings.community_enabled or not settings.roots or not (settings.issuer_key or settings.issuer_key_file):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Community modules are not enabled on this library")
    handle = ensure_handle(db, user)
    _check_namespace(db, handle)
    if not PUBLISHES_PER_HOUR.hit(str(user.id)):
        raise ratelimit.too_many(PUBLISHES_PER_HOUR.window)
    slug, id_ = f"{handle}.{name}", f"{handle}/{name}"
    data = b""
    async for chunk in request.stream():
        data += chunk
        if len(data) > community.MAX_PACKAGE_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"A community module package is at most {community.MAX_PACKAGE_BYTES // (1024 * 1024)} MB")
    try:
        files, meta = community.inspect(data)
    except community.Rejected as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))

    major, minor, patch = (int(p) for p in version.split("."))
    rows = db.scalars(select(Release).where(Release.kind == "module", Release.slug == slug)).all()
    if rows and max((r.major, r.minor, r.patch) for r in rows) >= (major, minor, patch):
        raise HTTPException(status.HTTP_409_CONFLICT, "The version must be higher than every earlier one, also of a release that was taken down")
    if not rows:
        owned = db.scalar(select(func.count(func.distinct(Release.slug))).where(Release.kind == "module", Release.slug.like(f"{handle}.%")))
        if owned >= MODULES_PER_AUTHOR:
            raise HTTPException(status.HTTP_409_CONFLICT, f"An author has up to {MODULES_PER_AUTHOR} community modules")

    licence = _string(meta, "license", 120, "MIT")
    if not re.fullmatch(LICENSE_PATTERN, licence):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "module.json: `license` is an SPDX id or expression")
    try:
        origin = OriginIn(**meta["origin"]).model_dump() if meta.get("origin") else {}
    except (ValidationError, TypeError) as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"module.json: origin is not valid: {e}")
    row = Release(kind="module", slug=slug, version=version, major=major, minor=minor, patch=patch, channel="stable", status="published",
                  title=_string(meta, "title", 120) or _string(meta, "name", 120) or name, summary=_string(meta, "summary", 280),
                  category=_string(meta, "category", 64), license=licence, origin=origin, notes="")
    types, abi = registry._module_meta(db, slug, io.BytesIO(data))  # types in the author's namespace, none taken, the ABI declared
    if abi != community.ENGINE_ABI:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"module.json: requires.engineAbi must be {community.ENGINE_ABI}")
    row.requires = {"engineAbi": abi}

    # Sign. The library checks its own signature against the pinned roots before it publishes anything.
    try:
        community_key = signing.key_from_pem(signing.community_key_pem())
        chain = [json.loads(settings.issuer_cert), json.loads(settings.community_cert)]
    except (TypeError, ValueError) as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"The community key is not usable: {e}")
    entries = community.entries_of(files)
    doc = signing.sign(entries, community_key, chain, "module", id_, version, "any")
    result = signing.verify(entries, doc, kind="module", id_=id_, version=version, roots=settings.roots, now=int(now().timestamp()),
                            crl=registry._revocations(db))
    if result.status != "signed" or result.trust != "community":
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"The library's community key is {result.status}: {result.reason or 'not valid'}")
    package = community.build_zip(files, doc)
    path = f"{name}.bleepmod"
    file = {"path": path, "sha256": hashlib.sha256(package).hexdigest(), "bytes": len(package), "platform": "any",
            "contentDigest": signing.content_digest(entries).hex(), "signature": doc, "uploaded": True, "types": types,
            "signer": {"publisher": result.publisher, "keyId": result.key_id, "trust": "community", "author": handle},
            "uploadedBy": user.id}
    row.files = registry._date_files(db, "module", slug, version, [file])
    row.published_at = now()
    db.add(row)
    storage.put(registry._key(row, path), io.BytesIO(package))
    db.flush()
    storage.put(registry._key(row, "entry.json"), io.BytesIO(json.dumps(registry._entry(row), indent=1).encode()), "application/json")
    db.commit()
    registry.write_index(db, storage)
    return {"id": id_, "version": version, "trust": "community", "types": types, "contentDigest": file["contentDigest"]}


def _owned_release(db: Session, slug: str, version: str, user: User) -> Release:
    row = registry._find(db, "module", slug, version)
    signer = next((f["signer"] for f in row.files if f.get("signer")), {})
    if signer.get("trust") != "community":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such community module")
    if user.role != "admin" and signer.get("author") != user.handle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such community module")
    return row


def take_down(db: Session, storage: Storage, row: Release) -> None:
    """Withdraws a release: it leaves the index and its digest goes on the signed revocation list, so clients that have it stop loading it."""
    row.status = "taken_down"
    db.commit()
    registry.write_index(db, storage)  # also writes the revocation list, which changed


@router.post("/modules/{slug}/{version}/takedown", status_code=status.HTTP_204_NO_CONTENT)
def takedown(slug: str = registry.Slug, version: str = registry.VersionPath, db: Session = Depends(get_db),
             storage: Storage = Depends(get_storage), user: User = Depends(get_library_user)):
    """The author withdraws their own release, an admin any community release. Not undone: the version number stays used."""
    row = _owned_release(db, slug, version, user)
    if row.status == "taken_down":
        return
    take_down(db, storage, row)


@router.post("/modules/{slug}/{version}/report", status_code=status.HTTP_204_NO_CONTENT)
def report(body: ReportIn, slug: str = registry.Slug, version: str = registry.VersionPath, db: Session = Depends(get_db),
           user: User = Depends(get_library_user)):
    """Reports a community module for an admin to look at (the admin console lists it with the other reports)."""
    row = registry._find(db, "module", slug, version)
    if row.status != "published":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such release")
    db.add(Report(target="module", target_id=row.id, reporter_id=user.id, reason=body.reason))
    db.commit()
