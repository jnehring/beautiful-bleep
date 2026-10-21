# SPDX-License-Identifier: MIT
"""The Bleep Library: a public, read-only view of what the registry (plugins, modules) and the presets have published."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Preset, Release
from ..ratings import rating_summaries
from . import registry
from .presets import listed_presets
from ..schemas import LibraryDetailOut, LibraryFileOut, LibraryItemOut, LibraryListOut, LibraryReleaseOut

router = APIRouter(prefix="/api/library", tags=["library"])

_NEWEST_FIRST = (Release.major.desc(), Release.minor.desc(), Release.patch.desc())


def _image_url(r: Release) -> str | None:
    """Where the screenshot is served (the registry paths of Caddy, next to entry.json)."""
    return f"/registry/v1/{r.kind}s/{r.slug}/{r.version}/{r.image}" if r.image else None


def _preset_item(p: Preset) -> LibraryItemOut:
    v = p.versions[0]
    return LibraryItemOut(
        kind="preset", slug=p.address, version=str(v.version), channel="stable", title=p.title, notes="", summary=p.summary,
        category="Patches" if p.type == "patch" else "Cells", image_url=None, files=1, bytes=v.bytes, published_at=p.updated_at,
    )


def _with_ratings(db: Session, items: list[LibraryItemOut]) -> list[LibraryItemOut]:
    for kind in {i.kind for i in items}:
        found = rating_summaries(db, kind, [i.slug for i in items if i.kind == kind])
        for i in items:
            if i.kind == kind and i.slug in found:
                i.rating_average, i.rating_count = found[i.slug]
    return items


def _item(r: Release) -> LibraryItemOut:
    return LibraryItemOut(
        kind=r.kind, slug=r.slug, version=r.version, channel=r.channel, title=r.title or r.slug, notes=r.notes,
        summary=r.summary, category=r.category, image_url=_image_url(r), trust=registry._trust(r),
        files=len(r.files), bytes=sum(f["bytes"] for f in r.files), published_at=r.published_at,
    )


@router.get("", response_model=LibraryListOut)
def listing(
    kind: Literal["plugin", "module", "preset"] | None = None,
    q: str = Query("", max_length=100),
    category: str = Query("", max_length=64),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """One entry per plugin, module or preset (its newest published version), filtered by kind, category and search text,
    each with its rating."""
    newest: dict[tuple[str, str], Release] = {}
    if kind != "preset":
        stmt = select(Release).where(Release.status == "published")
        if kind:
            stmt = stmt.where(Release.kind == kind)
        for r in db.scalars(stmt.order_by(Release.kind, Release.slug, *_NEWEST_FIRST)).all():
            newest.setdefault((r.kind, r.slug), r)
    needle = q.strip().lower()
    found = [_item(r) for r in newest.values()
             if not needle or needle in " ".join((r.title or "", r.slug, r.summary, r.category)).lower()]
    if kind in (None, "preset"):
        found += [_preset_item(p) for p in listed_presets(db, q)]
    items = [i for i in found if not category or i.category == category or i.category.startswith(category + "/")]
    items.sort(key=lambda i: (i.title.lower(), i.slug))
    start = (page - 1) * page_size
    return LibraryListOut(items=_with_ratings(db, items[start:start + page_size]), categories=sorted({i.category for i in found if i.category}),
                        total=len(items), page=page, page_size=page_size)


@router.get("/preset/{author}/{slug}", response_model=LibraryDetailOut)
def preset_detail(author: str, slug: str, db: Session = Depends(get_db)):
    """A preset in the shape of the other entries: each version is a release with its one file (`/api/presets/<author>/<slug>/file`)."""
    p = next((p for p in listed_presets(db) if p.author.handle == author and p.slug == slug), None)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such download")
    base = f"/api/presets/{p.address}/file"
    rating = rating_summaries(db, "preset", [p.address]).get(p.address)
    return LibraryDetailOut(
        kind="preset", slug=p.address, title=p.title, summary=p.summary, category="Patches" if p.type == "patch" else "Cells",
        image_url=None, rating_average=rating[0] if rating else None, rating_count=rating[1] if rating else 0, license=p.license,
        origin={}, releases=[
            LibraryReleaseOut(version=str(v.version), channel="stable", notes="", files=1, bytes=v.bytes, published_at=v.created_at,
                            license=p.license, requires={"modules": v.needs},
                            file_list=[LibraryFileOut(path=f"{base}?version={v.version}", bytes=v.bytes, sha256=v.sha256, platform="any", uploaded=True)])
            for v in p.versions
        ])


@router.get("/{kind}/{slug}", response_model=LibraryDetailOut)
def detail(kind: Literal["plugin", "module", "preset"], slug: str, db: Session = Depends(get_db)):
    """All published versions of one entry, newest first, each with its files."""
    rows = db.scalars(
        select(Release).where(Release.kind == kind, Release.slug == slug, Release.status == "published").order_by(*_NEWEST_FIRST)
    ).all()
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such download")
    rating = rating_summaries(db, kind, [slug]).get(slug)
    return LibraryDetailOut(kind=kind, slug=slug, title=rows[0].title or slug, summary=rows[0].summary, category=rows[0].category,
                          image_url=_image_url(rows[0]), rating_average=rating[0] if rating else None,
                          rating_count=rating[1] if rating else 0, license=rows[0].license, origin=rows[0].origin or {}, releases=[
        LibraryReleaseOut(**_item(r).model_dump(exclude={"kind", "slug", "title"}), license=r.license, requires=r.requires,
                        file_list=[LibraryFileOut(**{k: f[k] for k in ("path", "bytes", "sha256", "platform", "uploaded")},
                                                signer=f.get("signer"))
                                   for f in r.files])
        for r in rows
    ])
