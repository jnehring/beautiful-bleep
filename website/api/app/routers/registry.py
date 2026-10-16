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
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import signing
from ..config import settings
from ..db import get_db
from ..deps import require_release_token
from ..models import ApiToken, Developer, Release, now
from ..schemas import FileIn, OriginIn, PlatformIn, ReleaseIn, ReleaseOut
from ..storage import Storage, get_storage

router = APIRouter(prefix="/api/registry", tags=["registry"])

Kind = Literal["plugin", "module"]
# A third-party id "acme/fuzz" has the slug "acme.fuzz" (a "/" does not fit in a URL path segment).
Slug = Path(pattern=r"^[a-z0-9][a-z0-9-]{0,62}(\.[a-z0-9][a-z0-9-]{0,62})?$")
VersionPath = Path(pattern=r"^\d{1,4}\.\d{1,5}\.\d{1,6}$")
MAX_FILE_BYTES = 1024 * 1024 * 1024


def _signed_id(slug: str) -> str:
    return slug.replace(".", "/", 1)


def _revocations(db: Session) -> dict:
    keys = db.scalars(select(Developer.key_id).where(Developer.revoked_at.is_not(None)))
    return {"revokedKeys": [{"keyId": k} for k in keys], "revokedArtifacts": []}


def write_revocations(db: Session, storage: Storage) -> dict | None:
    """v1/revocations.json: the revoked developer keys, signed with the issuer key (signing.md section 8). The serial rises with every
    change, so a client keeps the newest and a mirror cannot hand back an older list. Nothing is written when the library has no issuer key."""
    if not (settings.issuer_key or settings.issuer_key_file) or not settings.issuer_cert:
        return None
    keys = sorted(_revocations(db)["revokedKeys"], key=lambda k: k["keyId"])
    prev = storage.get("v1/revocations.json")
    old = json.loads(prev) if prev else {}
    if prev and [k["keyId"] for k in keys] == [k["keyId"] for k in old.get("revokedKeys", [])]:
        return old  # nothing changed: the list stays, with its serial
    stamp = int(now().timestamp())
    crl = signing.make_crl(signing.key_from_pem(signing.issuer_key_pem()), json.loads(settings.issuer_cert),
                           serial=max(stamp, int(old.get("serial", 0)) + 1), issued=stamp, revoked_keys=[k["keyId"] for k in keys])
    storage.put("v1/revocations.json", io.BytesIO(json.dumps(crl, indent=1).encode()), "application/json")
    return crl


def _check_files(db: Session, token: ApiToken, kind: str, slug: str, version: str, files: list[FileIn]) -> list[dict]:
    """The files of a release as stored: every one signed by a developer this token may release for, or the request fails.

    The signature must verify for (kind, id, version, platform, content hash) against the root keys in the settings and
    the revocations; the signer's publisher must be the token's (a token without one releases for "bleep" only); and
    all files of one release have one publisher. Records who signed, and which token declared each file.
    """
    if not settings.require_signatures:
        return [{**f.model_dump(), "uploaded": False, "token": token.id} for f in files]
    roots = settings.roots
    if not roots:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The registry has no root key configured (BLEEP_ROOT_PUBLIC_KEYS)")
    allowed = token.publisher or "bleep"
    crl = _revocations(db)
    out = []
    publishers = set()
    for f in files:
        if f.signature is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{f.path}: a signature is required")
        if kind == "module" and not f.path.endswith((".bleepmod", ".zip")):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{f.path}: a module is a .bleepmod package")
        digest = bytes.fromhex(f.contentDigest) if kind == "module" and f.contentDigest else None
        if kind == "module" and digest is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{f.path}: contentDigest is required")
        content = digest if digest is not None else signing.entries_for_file(f.path, bytes.fromhex(f.sha256))
        result = signing.verify(content, f.signature, kind=kind, id_=_signed_id(slug), version=version, platform=f.platform,
                                roots=roots, now=int(now().timestamp()), crl=crl)
        if result.status != "signed":
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{f.path}: signature {result.status}: {result.reason or 'not valid'}")
        if result.publisher != allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"This token may release for {allowed!r}, the signature is by {result.publisher!r}")
        publishers.add(result.publisher)
        out.append({**f.model_dump(exclude={"signature"}), "contentDigest": f.contentDigest, "signature": f.signature,
                    "signer": {"publisher": result.publisher, "keyId": result.key_id}, "uploaded": False, "token": token.id})
    if len(publishers) > 1:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "All files of a release must be signed by one publisher")
    return out


def _content(kind: str, f: dict):
    """What a file's signature is over: the package's content digest (modules) or the single file (plugins)."""
    if kind == "module" and f.get("contentDigest"):
        return bytes.fromhex(f["contentDigest"])
    return signing.entries_for_file(f["path"], bytes.fromhex(f["sha256"]))


def _receipts_enabled() -> bool:
    return bool(settings.require_signatures and (settings.issuer_key or settings.issuer_key_file) and settings.issuer_cert and settings.roots)


def _newest_receipt(db: Session) -> int:
    """The latest publishedAt this registry has issued: a receipt is never dated earlier (signing.md section 6a)."""
    return max((f["publication"]["publishedAt"] for files in db.scalars(select(Release.files)) for f in files if f.get("publication")), default=0)


def _date_files(db: Session, kind: str, slug: str, version: str, files: list[dict], paths: set[str] | None = None) -> list[dict]:
    """Gives the files that have none a publication receipt, after verifying each as of this server's clock (signing.md section 6a).
    A file whose certificate has lapsed, whose key was revoked or whose signature does not hold gets none and the request fails."""
    if not _receipts_enabled():
        return files
    issuer = signing.key_from_pem(signing.issuer_key_pem())
    crl, newest = _revocations(db), _newest_receipt(db)
    out = []
    for f in files:
        if f.get("publication") or (paths is not None and f["path"] not in paths) or not f.get("signature"):
            out.append(f)
            continue
        try:
            receipt = signing.issue_receipt(issuer, _content(kind, f), f["signature"], kind=kind, id_=_signed_id(slug), version=version,
                                            platform=f["platform"], roots=settings.roots, now=int(now().timestamp()), crl=crl, newest=newest)
        except signing.ClockError as e:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"{f['path']}: {e}")
        except ValueError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{f['path']}: {e}")
        newest = receipt["publishedAt"]
        out.append({**f, "publication": receipt})
    return out


def backfill_receipts(db: Session, storage: Storage, *, dry_run: bool = False) -> tuple[list[str], list[str]]:
    """Gives the files of releases published before receipts existed a receipt dated at the release's recorded publish time
    (signing.md section 16). Returns (dated, skipped), one line each.

    Each file is verified as of that time, not now: a file whose certificate was not valid then, whose key is revoked, or that
    was certified by another issuer than this registry's gets no receipt and is listed; its developer re-signs it once. Files
    that have a receipt are left alone, so the job can be repeated. Rewrites entry.json of every release it changed."""
    if not _receipts_enabled():
        raise ValueError("Set BLEEP_ISSUER_KEY, BLEEP_ISSUER_CERT and BLEEP_ROOT_PUBLIC_KEYS (and leave BLEEP_REQUIRE_SIGNATURES on)")
    issuer = signing.key_from_pem(signing.issuer_key_pem())
    issuer_id = signing.key_id(signing.public_bytes(issuer))
    crl = _revocations(db)
    dated, skipped = [], []
    for row in _published(db):
        changed, files = False, []
        for f in row.files:
            label = f"{row.kind} {row.slug} {row.version} {f['path']}"
            if not f["uploaded"] or f.get("publication") or not f.get("signature"):
                files.append(f)
                continue
            at = row.published_at if row.published_at.tzinfo else row.published_at.replace(tzinfo=timezone.utc)
            at = int(at.timestamp())
            res = signing.verify(_content(row.kind, f), f["signature"], kind=row.kind, id_=_signed_id(row.slug), version=row.version,
                                 platform=f["platform"], roots=settings.roots, now=at, crl=crl)
            if res.status != "signed":
                skipped.append(f"{label}: {res.status} when it was published{': ' + res.reason if res.reason else ''}")
            elif f["signature"]["chain"][0]["tbs"]["keyId"] != issuer_id:
                skipped.append(f"{label}: certified by another issuer than this registry's")
            else:
                f = {**f, "publication": signing.make_receipt(issuer, kind=row.kind, id_=_signed_id(row.slug), version=row.version, platform=f["platform"],
                                                              signer_key_id=f["signature"]["keyId"], digest=bytes(_digest(row.kind, f)), published_at=at)}
                dated.append(f"{label}: published {datetime.fromtimestamp(at, timezone.utc):%Y-%m-%d %H:%M} UTC")
                changed = True
            files.append(f)
        if changed and not dry_run:
            row.files = files
            storage.put(_key(row, "entry.json"), io.BytesIO(json.dumps(_entry(row), indent=1).encode()), "application/json")
    if not dry_run:
        db.commit()
    return dated, skipped


def _digest(kind: str, f: dict) -> bytes:
    content = _content(kind, f)
    return content if isinstance(content, (bytes, bytearray)) else signing.content_digest(content)


def _own_draft(row: Release, token: ApiToken) -> None:
    """Only the token that started a draft continues it."""
    if row.created_by_token != token.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This draft was started with another token")


TYPE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}(/[a-z0-9][a-z0-9-]{0,62})?$")


def _module_meta(db: Session, slug: str, package) -> tuple[list[str], int]:
    """The node types and engine ABI a module package declares in its module.json, after the library's rules for them.

    A module may only provide node types nobody else provides, and a third-party module (id "acme/fuzz") only types in
    its own namespace ("acme/…"): otherwise a signed module could take over "oscillator" on every board."""
    try:
        meta = json.loads(signing.read_member(zipfile.ZipFile(package), "module.json"))
        types, abi = meta["types"], meta["requires"]["engineAbi"]
    except (KeyError, ValueError, TypeError, zipfile.BadZipFile) as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"module.json must list `types` and `requires.engineAbi`: {e}")
    if not isinstance(types, list) or not types or len(types) > 64 or not all(isinstance(t, str) and TYPE_ID.match(t) for t in types) \
            or len(set(types)) != len(types) or not isinstance(abi, int):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "module.json: `types` is a list of node type ids, `requires.engineAbi` an integer")
    owner = _signed_id(slug).partition("/")[0] if "/" in _signed_id(slug) else None
    if owner and not all(t.startswith(owner + "/") for t in types):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"node types of {_signed_id(slug)!r} must start with '{owner}/'")
    taken = {t for r in _published(db, "module") if r.slug != slug for f in r.files for t in f.get("types", [])}
    clash = sorted(set(types) & taken)
    if clash:
        raise HTTPException(status.HTTP_409_CONFLICT, f"node type(s) already provided by another module: {', '.join(clash)}")
    return types, abi


def _check_licence(row: Release, package) -> None:
    """The licence and origin a module release declares must be the ones in the signed package's module.json (a missing
    licence there is MIT, like package-module.py): the library's detail view must not say something else than the package."""
    package.seek(0)
    try:
        meta = json.loads(signing.read_member(zipfile.ZipFile(package), "module.json"))
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
    return f"v1/{r.kind}s/{r.slug}/{r.version}" + (f"/{path}" if path else "")


def _find(db: Session, kind: str, slug: str, version: str) -> Release:
    row = db.scalar(select(Release).where(Release.kind == kind, Release.slug == slug, Release.version == version))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such release")
    return row


def _published(db: Session, kind: str | None = None, slug: str | None = None) -> list[Release]:
    q = select(Release).where(Release.status == "published")
    if kind:
        q = q.where(Release.kind == kind)
    if slug:
        q = q.where(Release.slug == slug)
    return list(db.scalars(q.order_by(Release.major, Release.minor, Release.patch)))


@router.get("/roots")
def roots():
    """The root public keys this registry trusts (public; scripts/release/release.py checks a signing kit against them before uploading)."""
    return {"roots": [k.hex() for k in settings.roots], "requireSignatures": settings.require_signatures}


@router.get("/token")
def check_token(token: ApiToken = Depends(require_release_token)):
    """Lets scripts/release/release.py fail early on a bad token, before it packages anything."""
    return {"name": token.name}


@router.get("/{kind}/{slug}/versions")
def versions(kind: Kind, slug: str = Slug, db: Session = Depends(get_db)):
    return [{"version": r.version, "channel": r.channel, "published_at": r.published_at} for r in _published(db, kind, slug)]


@router.post("/{kind}/{slug}/releases", response_model=ReleaseOut, status_code=status.HTTP_201_CREATED)
def create_release(kind: Kind, body: ReleaseIn, slug: str = Slug, db: Session = Depends(get_db),
                   token: ApiToken = Depends(require_release_token)):
    """Starts a draft. The version must be higher than every published version of this id; a draft of the same version is replaced."""
    major, minor, patch = (int(p) for p in body.version.split("."))
    if len({f.path for f in body.files}) != len(body.files):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Duplicate file paths")
    newest = max(((r.major, r.minor, r.patch) for r in _published(db, kind, slug)), default=None)
    if newest is not None and (major, minor, patch) <= newest:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Version must be higher than {'.'.join(map(str, newest))}")
    row = db.scalar(select(Release).where(Release.kind == kind, Release.slug == slug, Release.version == body.version))
    if row is None:
        row = Release(kind=kind, slug=slug, version=body.version, major=major, minor=minor, patch=patch)
        db.add(row)
    else:
        _own_draft(row, token)  # a draft is replaced only by the token that started it
    row.channel, row.title, row.notes, row.requires = body.channel, body.title, body.notes, body.requires
    row.summary, row.category = body.summary, body.category
    row.license, row.origin = body.license, body.origin.model_dump() if body.origin else {}
    row.files = _check_files(db, token, kind, slug, body.version, body.files)
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
        if declared.get("contentDigest") and settings.require_signatures:
            spool.seek(0)  # the files inside a module package must be the ones that were signed
            try:
                actual = signing.content_digest(signing.read_entries(spool)).hex()
            except (ValueError, zipfile.BadZipFile) as e:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Not a valid package: {e}")
            if actual != declared["contentDigest"]:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The files in the package are not the ones that were signed")
            if kind == "module":
                spool.seek(0)
                declared = {**declared, "types": (meta := _module_meta(db, slug, spool))[0]}
                row.requires = {**row.requires, "engineAbi": meta[1]}
                _check_licence(row, spool)
        spool.seek(0)
        storage.put(_key(row, path), spool)
    row.files = [{**declared, "uploaded": True} if f["path"] == path else f for f in row.files]
    if row.status == "published":  # a platform added later: dated now, when the library accepts the file
        row.files = _date_files(db, kind, slug, version, row.files, {path})
        storage.put(_key(row, "entry.json"), io.BytesIO(json.dumps(_entry(row), indent=1).encode()), "application/json")
    db.commit()


IMAGE_TYPES = {"image/png": (b"\x89PNG\r\n\x1a\n", "png"), "image/jpeg": (b"\xff\xd8\xff", "jpg"), "image/webp": (b"RIFF", "webp")}
MAX_IMAGE_BYTES = 1024 * 1024


@router.put("/{kind}/{slug}/releases/{version}/image", status_code=status.HTTP_204_NO_CONTENT)
async def upload_image(kind: Kind, request: Request, slug: str = Slug, version: str = VersionPath,
                       db: Session = Depends(get_db), storage: Storage = Depends(get_storage),
                       token: ApiToken = Depends(require_release_token)):
    """The screenshot of an entry's tile (PNG, JPEG or WebP, up to 1 MB). Display metadata, not code, so it is not signed
    and may be replaced, also after publishing, by the token that created the release."""
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
    declared = _check_files(db, token, kind, slug, version, body.files)
    owner = next((f["signer"]["publisher"] for f in row.files if f.get("signer")), None)
    if owner and any(f["signer"]["publisher"] != owner for f in declared if f.get("signer")):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"A platform of this release must be signed by {owner!r}, like its other files")
    row.files = [f for f in row.files if f["uploaded"] or f["path"] not in pending] + declared
    db.commit()
    return row


def _entry(r: Release) -> dict:
    return {
        "kind": r.kind, "id": r.slug, "version": r.version, "channel": r.channel, "title": r.title or r.slug,
        "summary": r.summary, "category": r.category, "license": r.license, "origin": r.origin or None, "image": r.image or None, "notes": r.notes, "requires": r.requires, "types": _types(r), "published": r.published_at.isoformat(),
        "files": [{k: f[k] for k in ("path", "sha256", "bytes", "platform", "contentDigest", "signer", "signature", "publication") if f.get(k) is not None}
                  for f in r.files if f["uploaded"]],
    }


def write_index(db: Session, storage: Storage) -> dict:
    """v1/index.json: per channel, the newest version of every plugin and module, with its title, summary, category and image. beta also sees stable releases."""
    channels: dict = {"stable": {"plugins": {}, "modules": {}}, "beta": {"plugins": {}, "modules": {}}}
    for r in _published(db):  # ascending, so later rows are newer
        for channel in ("stable", "beta") if r.channel == "stable" else ("beta",):
            channels[channel][r.kind + "s"][r.slug] = {
                "version": r.version, "entry": f"{r.kind}s/{r.slug}/{r.version}/entry.json",
                # what the apps' library tiles show, so one request to the index is enough
                "title": r.title or r.slug, "summary": r.summary, "category": r.category,
                **({"image": f"{r.kind}s/{r.slug}/{r.version}/{r.image}"} if r.image else {}),
            }
            if r.kind == "module":  # which node types a module provides: clients find the package for a type without downloading any
                channels[channel]["modules"][r.slug]["types"] = _types(r)
    index = {"format": 1, "generated": now().isoformat(), "channels": channels}
    storage.put("v1/index.json", io.BytesIO(json.dumps(index, indent=1).encode()), "application/json")
    write_revocations(db, storage)  # the list changes when a key is revoked; it is only written again then
    return index


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
    newest = max(((r.major, r.minor, r.patch) for r in _published(db, kind, slug)), default=None)
    if newest is not None and (row.major, row.minor, row.patch) <= newest:
        raise HTTPException(status.HTTP_409_CONFLICT, f"A version up to {'.'.join(map(str, newest))} was published meanwhile")
    row.files = _date_files(db, kind, slug, version, row.files)  # before anything changes: a failure leaves the draft as it was
    row.status, row.published_at = "published", now()
    storage.put(_key(row, "entry.json"), io.BytesIO(json.dumps(_entry(row), indent=1).encode()), "application/json")
    db.commit()
    write_index(db, storage)
    return row
