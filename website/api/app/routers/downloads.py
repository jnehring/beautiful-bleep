# SPDX-License-Identifier: MIT
"""Admin view of the downloads: what the registry offers."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin
from ..models import Release
from ..schemas import DownloadItemOut, DownloadsOut

router = APIRouter(prefix="/api/admin/downloads", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("", response_model=DownloadsOut)
def contents(db: Session = Depends(get_db)):
    """Every release, newest first, split by kind. Presets are not in the registry yet, so that list is empty."""
    rows = db.scalars(select(Release).order_by(Release.slug, Release.major.desc(), Release.minor.desc(), Release.patch.desc())).all()
    items = [DownloadItemOut(
        slug=r.slug, version=r.version, channel=r.channel, status=r.status, title=r.title or r.slug,
        files=len(r.files), bytes=sum(f["bytes"] for f in r.files), published_at=r.published_at, created_at=r.created_at,
    ) for r in rows]
    return DownloadsOut(
        plugins=[i for i, r in zip(items, rows) if r.kind == "plugin"],
        modules=[i for i, r in zip(items, rows) if r.kind == "module"],
        presets=[],
    )
