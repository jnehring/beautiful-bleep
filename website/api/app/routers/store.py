# SPDX-License-Identifier: MIT
"""The Bleep Store: a public, read-only view of what the registry has published."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Release
from ..schemas import StoreDetailOut, StoreFileOut, StoreItemOut, StoreListOut, StoreReleaseOut

router = APIRouter(prefix="/api/store", tags=["store"])

_NEWEST_FIRST = (Release.major.desc(), Release.minor.desc(), Release.patch.desc())


def _image_url(r: Release) -> str | None:
    """Where the screenshot is served (the registry paths of Caddy, next to entry.json)."""
    return f"/registry/v1/{r.kind}s/{r.slug}/{r.version}/{r.image}" if r.image else None


def _item(r: Release) -> StoreItemOut:
    return StoreItemOut(
        kind=r.kind, slug=r.slug, version=r.version, channel=r.channel, title=r.title or r.slug, notes=r.notes,
        summary=r.summary, category=r.category, image_url=_image_url(r),
        files=len(r.files), bytes=sum(f["bytes"] for f in r.files), published_at=r.published_at,
    )


@router.get("", response_model=StoreListOut)
def listing(
    kind: Literal["plugin", "module", "preset"] | None = None,
    q: str = Query("", max_length=100),
    category: str = Query("", max_length=64),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """One entry per plugin, module or preset (its newest published version), filtered by kind, category and search text.
    Presets are not in the registry yet, so that filter is empty."""
    stmt = select(Release).where(Release.status == "published")
    if kind:
        stmt = stmt.where(Release.kind == kind)
    rows = db.scalars(stmt.order_by(Release.kind, Release.slug, *_NEWEST_FIRST)).all()
    newest: dict[tuple[str, str], Release] = {}
    for r in rows:
        newest.setdefault((r.kind, r.slug), r)
    needle = q.strip().lower()
    found = [_item(r) for r in newest.values()
             if not needle or needle in " ".join((r.title or "", r.slug, r.summary, r.category)).lower()]
    items = [i for i in found if not category or i.category == category or i.category.startswith(category + "/")]
    items.sort(key=lambda i: (i.title.lower(), i.slug))
    start = (page - 1) * page_size
    return StoreListOut(items=items[start:start + page_size], categories=sorted({i.category for i in found if i.category}),
                        total=len(items), page=page, page_size=page_size)


@router.get("/{kind}/{slug}", response_model=StoreDetailOut)
def detail(kind: Literal["plugin", "module", "preset"], slug: str, db: Session = Depends(get_db)):
    """All published versions of one entry, newest first, each with its files."""
    rows = db.scalars(
        select(Release).where(Release.kind == kind, Release.slug == slug, Release.status == "published").order_by(*_NEWEST_FIRST)
    ).all()
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such download")
    return StoreDetailOut(kind=kind, slug=slug, title=rows[0].title or slug, summary=rows[0].summary, category=rows[0].category,
                          image_url=_image_url(rows[0]), license=rows[0].license, origin=rows[0].origin or {}, releases=[
        StoreReleaseOut(**_item(r).model_dump(exclude={"kind", "slug", "title"}), license=r.license, requires=r.requires,
                        file_list=[StoreFileOut(**{k: f[k] for k in ("path", "bytes", "sha256", "platform", "uploaded")},
                                                signer=f.get("signer"))
                                   for f in r.files])
        for r in rows
    ])
