# SPDX-License-Identifier: MIT
"""Patches by their public ID (sharing.md): the address every link uses. A patch that was deleted, made private, removed or never
existed answers the same `patch_unavailable`, so the answer tells nothing about a private one."""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_optional_library_user
from ..models import Preset, User
from ..ratings import rating_summaries
from ..schemas import PresetOut
from ..storage import Storage, get_storage
from .presets import _key, _out, patch_unavailable, used_in_counts

router = APIRouter(prefix="/api/patches", tags=["patches"])


def _get(db: Session, pid: str, user: User | None) -> Preset:
    row = db.scalar(select(Preset).where(Preset.pid == pid))
    if row is None or (not row.is_public and not (user and user.id == row.author_id)):
        raise patch_unavailable()
    return row


@router.get("/{pid}", response_model=PresetOut)
def detail(pid: str, db: Session = Depends(get_db), user: User | None = Depends(get_optional_library_user)):
    """The metadata and the list of versions. Public patches need no login; a private one only answers its author."""
    row = _get(db, pid, user)
    return _out(row, rating_summaries(db, "preset", [row.address]), detail=True, used=used_in_counts(db, [row.address]))


def _version(row: Preset, version: str):
    """A version by the author's number ("1.2") or by its sequence number ("3", the older links)."""
    for v in row.versions:
        if (v.label == version) or (version.isdigit() and v.version == int(version)):
            return v
    raise HTTPException(status.HTTP_404_NOT_FOUND, {"error": "version_unavailable"})


@router.get("/{pid}/{version}/file")
def file(pid: str, version: str, db: Session = Depends(get_db), user: User | None = Depends(get_optional_library_user),
         storage: Storage = Depends(get_storage)):
    """The `.bleeppreset` file of one version. Every download is counted."""
    row = _get(db, pid, user)
    found = _version(row, version)
    data = storage.get(_key(row, found.version))
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, {"error": "version_unavailable"})
    row.downloads += 1
    db.commit()
    return Response(data, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{row.slug}.bleeppreset"'})
