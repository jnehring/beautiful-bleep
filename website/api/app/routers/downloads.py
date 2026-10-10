# SPDX-License-Identifier: MIT
"""Admin view of the downloads: what the registry offers."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin
from ..models import ApiToken, Release
from ..schemas import DownloadDetailOut, DownloadFileOut, DownloadItemOut, DownloadReleaseOut, DownloadsOut

router = APIRouter(prefix="/api/admin/downloads", tags=["admin"], dependencies=[Depends(require_admin)])


def _item(r: Release) -> DownloadItemOut:
    return DownloadItemOut(
        slug=r.slug, version=r.version, channel=r.channel, status=r.status, title=r.title or r.slug,
        files=len(r.files), bytes=sum(f["bytes"] for f in r.files), published_at=r.published_at, created_at=r.created_at,
    )


@router.get("", response_model=DownloadsOut)
def contents(db: Session = Depends(get_db)):
    """Every release, newest first, split by kind. Presets are not in the registry yet, so that list is empty."""
    rows = db.scalars(select(Release).order_by(Release.slug, Release.major.desc(), Release.minor.desc(), Release.patch.desc())).all()
    items = [_item(r) for r in rows]
    return DownloadsOut(
        plugins=[i for i, r in zip(items, rows) if r.kind == "plugin"],
        modules=[i for i, r in zip(items, rows) if r.kind == "module"],
        presets=[],
    )


@router.get("/{kind}/{slug}", response_model=DownloadDetailOut)
def detail(kind: Literal["plugin", "module", "preset"], slug: str, db: Session = Depends(get_db)):
    """All versions of one plugin or module, newest first, each with its individual files."""
    rows = db.scalars(
        select(Release).where(Release.kind == kind, Release.slug == slug)
        .order_by(Release.major.desc(), Release.minor.desc(), Release.patch.desc())
    ).all()
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such download")
    names = {t.id: t.name for t in db.scalars(select(ApiToken))}  # who uploaded: the release token's name
    return DownloadDetailOut(kind=kind, slug=slug, title=rows[0].title or slug, releases=[
        DownloadReleaseOut(**_item(r).model_dump(), notes=r.notes, requires=r.requires,
                           file_list=[DownloadFileOut(**{k: f[k] for k in ("path", "bytes", "sha256", "platform", "uploaded")},
                                                      signer=f.get("signer"), uploaded_by=names.get(f.get("token")))
                                      for f in r.files])
        for r in rows
    ])
