# SPDX-License-Identifier: MIT
"""Presets: data that anyone with an account may share (library.md section 6). The file of every version is in the library bucket,
under `v1/presets/<author>/<slug>/<version>.bleeppreset`; the metadata is in Postgres."""
import base64
import binascii
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
from ..models import Comment, Preset, PresetCredit, PresetVersion, Rating, Report, User, now
from ..ratings import rating_summaries
from ..schemas import PresetIn, PresetListOut, PresetOut, PresetPatchIn, PresetUsedInOut, PresetUsedOut, PresetVersionOut, ReportIn
from ..storage import Storage, get_storage

router = APIRouter(prefix="/api/presets", tags=["presets"])

MAX_BYTES = 512 * 1024
MAX_DEPTH = 40
PUBLISHES_PER_HOUR = 20
MAX_CREDITS = 50
MEDIA_FILES = 8                  # audio files a preset may carry (patch/common/ui/bleep-media.js has the same limits)
MEDIA_BYTES = 5 * 1024 * 1024    # together, decoded
MEDIA_ID = re.compile(r"^[0-9a-f]{16}\.wav$")
CREDIT_LIMITS = {"name": 120, "author": 80, "address": 130, "license": 40}
ADDRESS = re.compile(r"^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*$")


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


def clean_credits(raw) -> list[dict]:
    """The `credits` of a preset: the presets it was made from, {name, author, address?, license}. Presets are copied, never referenced
    (library.md section 6), so this is text for attribution; `address` ("author/slug") is only a key to find "used in", and one that is not
    an address is dropped. Wrong types are refused; entries without a name and repeats are dropped; at most MAX_CREDITS are kept."""
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_CREDITS * 2:
        raise HTTPException(422, f"`credits` must be a list of up to {MAX_CREDITS} {{name, author, address?, license?}}")
    out, seen = [], set()
    for c in raw:
        if not isinstance(c, dict) or not all(isinstance(c.get(k, ""), str) for k in CREDIT_LIMITS):
            raise HTTPException(422, "Each credit must be an object with text fields")
        v = {k: " ".join(c.get(k, "").split())[:n] for k, n in CREDIT_LIMITS.items()}
        if not v["name"]:
            continue
        v["address"] = v["address"].lower() if ADDRESS.match(v["address"].lower()) else ""
        v["license"] = v["license"] or "CC-BY-4.0"
        key = v["address"] or (v["author"] + "/" + v["name"]).lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({k: x for k, x in v.items() if x or k in ("name", "author", "license")})
        if len(out) >= MAX_CREDITS:
            break
    return out


def clean_media(raw) -> tuple[dict, int]:
    """The `media` of a preset: the WAV files its modules use, {"<16 hex>.wav": {name, data: base64}} (library.md section 6). Presets are
    copied, so they take their audio along. Each must be valid base64 of a RIFF/WAVE file; at most MEDIA_FILES, MEDIA_BYTES together.
    Returns the cleaned map and the decoded size."""
    if raw is None:
        return {}, 0
    if not isinstance(raw, dict) or len(raw) > MEDIA_FILES:
        raise HTTPException(422, f"`media` must map up to {MEDIA_FILES} media ids to {{name, data}}")
    out, total = {}, 0
    for key, f in raw.items():
        if not MEDIA_ID.match(key) or not isinstance(f, dict) or not isinstance(f.get("data"), str) or not isinstance(f.get("name", ""), str):
            raise HTTPException(422, "Each audio file needs a media id like 0123456789abcdef.wav, a name and base64 data")
        try:
            blob = base64.b64decode(f["data"], validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(422, f"The audio {key} is not valid base64")
        if len(blob) < 44 or blob[:4] != b"RIFF" or blob[8:12] != b"WAVE":
            raise HTTPException(422, f"The audio {key} is not a WAV file")
        total += len(blob)
        if total > MEDIA_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"The audio of a preset may be up to {MEDIA_BYTES // 1048576} MB together")
        out[key] = {"name": " ".join(f.get("name", "").split())[:120] or key, "data": f["data"]}
    return out, total


def validate_preset(body: PresetIn) -> tuple[bytes, dict, list[dict]]:
    """The file to store, its `needs` and its cleaned `credits`. A preset is pure JSON data of limited size and depth with a node list;
    nothing else is kept."""
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
    credits = clean_credits(p.get("credits"))
    media, media_bytes = clean_media(p.get("media"))
    p = {k: v for k, v in p.items() if k not in ("credits", "media")}   # what is stored is the cleaned lists
    if credits:
        p["credits"] = credits
    if media:
        p["media"] = media
    return json.dumps(p, separators=(",", ":")).encode(), needs, credits


def _key(preset: Preset, version: int) -> str:
    return f"v1/presets/{preset.address}/{version}.bleeppreset"


def used_in_counts(db: Session, addresses: list[str]) -> dict[str, int]:
    """For each address, how many listed presets name it in their credits (lower-case address keys)."""
    keys = [a.lower() for a in addresses]
    if not keys:
        return {}
    rows = db.execute(
        select(PresetCredit.source_address, func.count(func.distinct(PresetCredit.preset_id)))
        .join(Preset, Preset.id == PresetCredit.preset_id)
        .where(PresetCredit.source_address.in_(keys), Preset.state == "listed")
        .group_by(PresetCredit.source_address)
    ).all()
    return {a: n for a, n in rows}


def _out(preset: Preset, ratings: dict[str, tuple[float, int]], detail: bool = False, used: dict[str, int] | None = None) -> PresetOut:
    avg, count = ratings.get(preset.address, (None, 0))
    newest = preset.versions[0]
    return PresetOut(
        id=preset.id, author=preset.author.handle, author_name=preset.author.display_name, slug=preset.slug, address=preset.address,
        title=preset.title, summary=preset.summary, type=preset.type, tags=preset.tags, license=preset.license, state=preset.state,
        downloads=preset.downloads, version=newest.version, bytes=newest.bytes, created_at=preset.created_at, updated_at=preset.updated_at,
        rating_average=avg, rating_count=count, used_in=(used or {}).get(preset.address.lower(), 0),
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
    page_rows = rows[start:start + page_size]
    used = used_in_counts(db, [r.address for r in page_rows])
    return PresetListOut(items=[_out(r, ratings, used=used) for r in page_rows], total=len(rows), page=page, page_size=page_size)


@router.get("/mine", response_model=list[PresetOut])
def mine(db: Session = Depends(get_db), user: User = Depends(get_library_user)):
    """The presets of the signed-in user, listed or not (an unlisted one is not in the search)."""
    rows = list(db.scalars(select(Preset).where(Preset.author_id == user.id).order_by(Preset.updated_at.desc())))
    ratings = rating_summaries(db, "preset", [r.address for r in rows])
    used = used_in_counts(db, [r.address for r in rows])
    return [_out(r, ratings, used=used) for r in rows]


def _find(db: Session, author: str, slug: str, user: User | None) -> Preset:
    row = db.scalar(select(Preset).join(User, Preset.author_id == User.id).where(User.handle == author, Preset.slug == slug))
    # An unlisted preset is still visible to its author and to admins.
    if row is None or (row.state != "listed" and not (user and (user.id == row.author_id or user.role == "admin"))):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such preset")
    return row


@router.get("/{author}/{slug}", response_model=PresetOut)
def detail(author: str, slug: str, db: Session = Depends(get_db), user: User | None = Depends(get_optional_library_user)):
    row = _find(db, author, slug, user)
    return _out(row, rating_summaries(db, "preset", [row.address]), detail=True, used=used_in_counts(db, [row.address]))


@router.get("/{author}/{slug}/used-in", response_model=PresetUsedInOut)
def used_in(author: str, slug: str, db: Session = Depends(get_db), user: User | None = Depends(get_optional_library_user)):
    """The listed presets that name this one in their credits, newest first (anonymous). Unlisted and deleted presets never appear."""
    row = _find(db, author, slug, user)
    found = db.scalars(
        select(Preset).join(PresetCredit, PresetCredit.preset_id == Preset.id)
        .where(PresetCredit.source_address == row.address.lower(), Preset.state == "listed")
        .order_by(Preset.updated_at.desc())
    ).all()
    return PresetUsedInOut(count=len(found), items=[
        PresetUsedOut(address=p.address, author_name=p.author.display_name, title=p.title, type=p.type, updated_at=p.updated_at)
        for p in found[:50]])


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
    data, needs, credits = validate_preset(body)
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
        # The licence stays what the first version had: a preset shared as CC0 before CC BY became the only one is not relicensed.
        preset.title, preset.summary, preset.tags = body.title, body.summary, body.tags
        number = preset.versions[0].version + 1
    envelope = json.dumps({"format": "bleeppreset", "version": 1, "type": body.type, "title": body.title, "author": handle,
                           "license": preset.license, "tags": body.tags, "needs": needs, "preset": json.loads(data)},
                          separators=(",", ":")).encode()
    audio = sum(len(f["data"]) for f in body.preset.get("media", {}).values()) if isinstance(body.preset.get("media"), dict) else 0
    if len(envelope) - audio > MAX_BYTES:   # the limit is for the patch itself; the audio has its own (clean_media)
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"A preset may be up to {MAX_BYTES // 1024} KB, not counting its audio")
    db.flush()
    db.add(PresetVersion(preset_id=preset.id, version=number, bytes=len(envelope), sha256=hashlib.sha256(envelope).hexdigest(), needs=needs))
    # The credits of the newest version replace the older ones; only those with an address can be found again, and a preset
    # does not credit itself.
    preset.credits.clear()
    db.flush()
    for c in credits:
        if c.get("address") and c["address"] != preset.address.lower():
            preset.credits.append(PresetCredit(source_address=c["address"], source_name=c["name"], source_author=c["author"]))
    db.flush()
    storage.put(_key(preset, number), io.BytesIO(envelope), "application/json")
    db.commit()
    db.refresh(preset)
    return _out(preset, {}, detail=True, used=used_in_counts(db, [preset.address]))


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
    return _out(row, rating_summaries(db, "preset", [row.address]), detail=True, used=used_in_counts(db, [row.address]))


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
