# SPDX-License-Identifier: MIT
"""Presets: data that anyone with an account may share (library.md section 6). The file of every version is in the library bucket,
under `v1/presets/<author>/<slug>/<version>.bleeppreset`; the metadata is in Postgres."""
import hashlib
import io
import json
import re
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_optional_library_user, get_library_user
from ..models import Comment, Preset, PresetVersion, Rating, Report, User, now
from ..ratings import rating_summaries
from ..schemas import PresetIn, PresetListOut, PresetOut, PresetPatchIn, PresetVersionOut, ReportIn
from ..storage import Storage, get_storage

router = APIRouter(prefix="/api/presets", tags=["presets"])

MAX_BYTES = 512 * 1024
MAX_DEPTH = 40
PUBLISHES_PER_HOUR = 20


def slugify(text: str, fallback: str = "preset") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40].strip("-")
    return slug or fallback


def ensure_handle(db: Session, user: User) -> str:
    """The name in a preset's address. Made from the display name on the first publish and kept: addresses must not change."""
    if user.handle:
        return user.handle
    base = slugify(user.display_name, "user")
    handle, n = base, 1
    while db.scalar(select(User.id).where(User.handle == handle)) is not None:
        n += 1
        handle = f"{base}-{n}"
    user.handle = handle
    db.commit()
    return handle


def _depth(value, level: int = 0) -> int:
    if level > MAX_DEPTH:
        return level
    if isinstance(value, dict):
        return max([level, *(_depth(v, level + 1) for v in value.values())])
    if isinstance(value, list):
        return max([level, *(_depth(v, level + 1) for v in value)])
    return level


def validate_preset(body: PresetIn) -> tuple[bytes, dict]:
    """The file to store and its `needs`. A preset is pure JSON data of limited size and depth with a node list; nothing else is kept."""
    p = body.preset
    if not isinstance(p.get("nodes"), list) or not p["nodes"]:
        raise HTTPException(422, "A preset needs a non-empty `nodes` list")
    if "cables" in p and not isinstance(p["cables"], list):
        raise HTTPException(422, "`cables` must be a list")
    needs = p.get("needs", {})
    if not isinstance(needs, dict) or not all(
        isinstance(v, dict) and set(v) <= {"min", "max"} and all(isinstance(x, str) and len(x) <= 32 for x in v.values())
        for v in needs.values()
    ):
        raise HTTPException(422, "`needs` must map module slugs to {min?, max?} versions")
    if _depth(p) > MAX_DEPTH:
        raise HTTPException(422, "The preset is nested too deeply")
    return json.dumps(p, separators=(",", ":")).encode(), needs


def _key(preset: Preset, version: int) -> str:
    return f"v1/presets/{preset.address}/{version}.bleeppreset"


def _out(preset: Preset, ratings: dict[str, tuple[float, int]], detail: bool = False) -> PresetOut:
    avg, count = ratings.get(preset.address, (None, 0))
    newest = preset.versions[0]
    return PresetOut(
        id=preset.id, author=preset.author.handle, author_name=preset.author.display_name, slug=preset.slug, address=preset.address,
        title=preset.title, summary=preset.summary, type=preset.type, tags=preset.tags, license=preset.license, state=preset.state,
        downloads=preset.downloads, version=newest.version, bytes=newest.bytes, created_at=preset.created_at, updated_at=preset.updated_at,
        rating_average=avg, rating_count=count,
        versions=[PresetVersionOut.model_validate(v) for v in preset.versions] if detail else None,
    )


def listed_presets(db: Session, q: str = "", type: str | None = None, tag: str = "") -> list[Preset]:
    stmt = select(Preset).join(User, Preset.author_id == User.id).where(Preset.state == "listed")
    if type:
        stmt = stmt.where(Preset.type == type)
    if q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Preset.title).like(like), func.lower(Preset.summary).like(like), func.lower(User.display_name).like(like)))
    rows = db.scalars(stmt).all()
    if tag.strip():
        rows = [r for r in rows if tag.strip().lower() in r.tags]
    return list(rows)


@router.get("", response_model=PresetListOut)
def search(
    q: str = Query("", max_length=100), type: Literal["patch", "cell"] | None = None, tag: str = Query("", max_length=30),
    sort: Literal["new", "top", "downloads"] = "new", page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    rows = listed_presets(db, q, type, tag)
    ratings = rating_summaries(db, "preset", [r.address for r in rows])
    if sort == "downloads":
        rows.sort(key=lambda r: (-r.downloads, r.title.lower()))
    elif sort == "top":
        rows.sort(key=lambda r: (-(ratings.get(r.address, (0, 0))[0]), -ratings.get(r.address, (0, 0))[1], r.title.lower()))
    else:
        rows.sort(key=lambda r: r.updated_at, reverse=True)
    start = (page - 1) * page_size
    return PresetListOut(items=[_out(r, ratings) for r in rows[start:start + page_size]], total=len(rows), page=page, page_size=page_size)


def _find(db: Session, author: str, slug: str, user: User | None) -> Preset:
    row = db.scalar(select(Preset).join(User, Preset.author_id == User.id).where(User.handle == author, Preset.slug == slug))
    # An unlisted preset is still visible to its author and to admins.
    if row is None or (row.state != "listed" and not (user and (user.id == row.author_id or user.role == "admin"))):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such preset")
    return row


@router.get("/{author}/{slug}", response_model=PresetOut)
def detail(author: str, slug: str, db: Session = Depends(get_db), user: User | None = Depends(get_optional_library_user)):
    row = _find(db, author, slug, user)
    return _out(row, rating_summaries(db, "preset", [row.address]), detail=True)


@router.get("/{author}/{slug}/file")
def download(author: str, slug: str, version: int | None = None, db: Session = Depends(get_db),
             user: User | None = Depends(get_optional_library_user), storage: Storage = Depends(get_storage)):
    """The `.bleeppreset` file (anonymous). Every download is counted."""
    row = _find(db, author, slug, user)
    number = version or row.versions[0].version
    if not any(v.version == number for v in row.versions):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such version")
    data = storage.get(_key(row, number))
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The file is missing")
    row.downloads += 1
    db.commit()
    return Response(data, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{row.slug}.bleeppreset"'})


@router.post("", response_model=PresetOut, status_code=status.HTTP_201_CREATED)
def publish(body: PresetIn, db: Session = Depends(get_db), user: User = Depends(get_library_user), storage: Storage = Depends(get_storage)):
    """Publishes a preset, or a new version of one of the caller's own (same slug)."""
    recent = db.scalar(
        select(func.count()).select_from(PresetVersion).join(Preset).where(
            Preset.author_id == user.id, PresetVersion.created_at > now() - timedelta(hours=1))
    )
    if recent >= PUBLISHES_PER_HOUR:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many presets in the last hour; try again later")
    data, needs = validate_preset(body)
    handle = ensure_handle(db, user)
    slug = body.slug or slugify(body.title)
    preset = db.scalar(select(Preset).where(Preset.author_id == user.id, Preset.slug == slug))
    if preset is None:
        preset = Preset(author_id=user.id, slug=slug, title=body.title, summary=body.summary, type=body.type, tags=body.tags,
                        license=body.license)
        preset.author = user
        db.add(preset)
        number = 1
    else:
        if preset.type != body.type:
            raise HTTPException(status.HTTP_409_CONFLICT, "A new version cannot change the type")
        if preset.state != "listed":
            raise HTTPException(status.HTTP_409_CONFLICT, "This preset is unlisted")
        preset.title, preset.summary, preset.tags, preset.license = body.title, body.summary, body.tags, body.license
        number = preset.versions[0].version + 1
    envelope = json.dumps({"format": "bleeppreset", "version": 1, "type": body.type, "title": body.title, "author": handle,
                           "license": body.license, "tags": body.tags, "needs": needs, "preset": json.loads(data)},
                          separators=(",", ":")).encode()
    if len(envelope) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"A preset may be up to {MAX_BYTES // 1024} KB")
    db.flush()
    db.add(PresetVersion(preset_id=preset.id, version=number, bytes=len(envelope), sha256=hashlib.sha256(envelope).hexdigest(), needs=needs))
    db.flush()
    storage.put(_key(preset, number), io.BytesIO(envelope), "application/json")
    db.commit()
    db.refresh(preset)
    return _out(preset, {}, detail=True)


def _own(db: Session, preset_id: int, user: User) -> Preset:
    row = db.get(Preset, preset_id)
    if row is None or (row.author_id != user.id and user.role != "admin"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such preset")
    return row


@router.patch("/{preset_id}", response_model=PresetOut)
def edit(preset_id: int, body: PresetPatchIn, db: Session = Depends(get_db), user: User = Depends(get_library_user)):
    row = _own(db, preset_id, user)
    data = body.model_dump(exclude_none=True)
    if "tags" in data:
        data["tags"] = PresetIn(title="x", type="patch", preset={}, tags=data["tags"]).tags
    if data.get("state") == "listed" and row.state == "unlisted" and user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an admin can list this preset again")
    for field, value in data.items():
        setattr(row, field, value)
    db.commit()
    return _out(row, rating_summaries(db, "preset", [row.address]), detail=True)


@router.delete("/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove(preset_id: int, db: Session = Depends(get_db), user: User = Depends(get_library_user)):
    """Deletes the preset with its comments and ratings. The files of its versions stay in the bucket (library paths are immutable)."""
    row = _own(db, preset_id, user)
    address = row.address
    for model in (Comment, Rating):
        for item in db.scalars(select(model).where(model.kind == "preset", model.slug == address)):
            db.delete(item)
    db.delete(row)
    db.commit()


@router.post("/{preset_id}/report", status_code=status.HTTP_204_NO_CONTENT)
def report(preset_id: int, body: ReportIn, db: Session = Depends(get_db), user: User | None = Depends(get_optional_library_user)):
    row = db.get(Preset, preset_id)
    if row is None or row.state != "listed":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such preset")
    db.add(Report(target="preset", target_id=row.id, reporter_id=user.id if user else None, reason=body.reason))
    db.commit()
