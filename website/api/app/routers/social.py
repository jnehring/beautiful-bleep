# SPDX-License-Identifier: MIT
"""Comments and ratings on library entries. An entry is (kind, slug): a plugin, a module or a preset (slug `author/slug`)."""
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_optional_library_user, get_library_user
from ..models import Comment, Preset, Rating, Release, Report, User, now
from ..ratings import rating_summaries
from ..schemas import CommentIn, CommentListOut, CommentOut, RatingIn, RatingOut, ReportIn

router = APIRouter(prefix="/api/social", tags=["social"])

Kind = Literal["plugin", "module", "preset"]
COMMENTS_PER_MINUTE = 5


def _entry_exists(db: Session, kind: str, slug: str) -> Preset | bool:
    """True for a published plugin or module, the Preset for a listed preset; 404 otherwise."""
    if kind == "preset":
        author, _, name = slug.partition("/")
        row = db.scalar(select(Preset).join(User, Preset.author_id == User.id).where(
            User.handle == author, Preset.slug == name, Preset.state == "listed"))
    else:
        row = db.scalar(select(Release.id).where(Release.kind == kind, Release.slug == slug, Release.status == "published").limit(1))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such entry")
    return row


def _comment(c: Comment, viewer: User | None) -> CommentOut:
    return CommentOut(id=c.id, user_id=c.user_id, author=c.user.display_name, body=c.body, created_at=c.created_at,
                      mine=bool(viewer and viewer.id == c.user_id))


@router.get("/{kind}/{slug:path}/comments", response_model=CommentListOut)
def list_comments(kind: Kind, slug: str, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                  db: Session = Depends(get_db), viewer: User | None = Depends(get_optional_library_user)):
    """Newest first. Public."""
    _entry_exists(db, kind, slug)
    where = (Comment.kind == kind, Comment.slug == slug)
    total = db.scalar(select(func.count()).select_from(Comment).where(*where))
    rows = db.scalars(select(Comment).where(*where).order_by(Comment.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return CommentListOut(items=[_comment(c, viewer) for c in rows], total=total, page=page, page_size=page_size)


@router.post("/{kind}/{slug:path}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
def add_comment(kind: Kind, slug: str, body: CommentIn, db: Session = Depends(get_db), user: User = Depends(get_library_user)):
    _entry_exists(db, kind, slug)
    recent = db.scalar(select(func.count()).select_from(Comment).where(Comment.user_id == user.id, Comment.created_at > now() - timedelta(minutes=1)))
    if recent >= COMMENTS_PER_MINUTE:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Slow down a little")
    row = Comment(kind=kind, slug=slug, user_id=user.id, body=body.body)
    row.user = user
    db.add(row)
    db.commit()
    return _comment(row, user)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(comment_id: int, db: Session = Depends(get_db), user: User = Depends(get_library_user)):
    """The author deletes their own comment; an admin any."""
    row = db.get(Comment, comment_id)
    if row is None or (row.user_id != user.id and user.role != "admin"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such comment")
    db.delete(row)
    db.commit()


@router.post("/comments/{comment_id}/report", status_code=status.HTTP_204_NO_CONTENT)
def report_comment(comment_id: int, body: ReportIn, db: Session = Depends(get_db), user: User | None = Depends(get_optional_library_user)):
    if db.get(Comment, comment_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such comment")
    db.add(Report(target="comment", target_id=comment_id, reporter_id=user.id if user else None, reason=body.reason))
    db.commit()


def _rating(db: Session, kind: str, slug: str, viewer: User | None) -> RatingOut:
    average, count = rating_summaries(db, kind, [slug]).get(slug, (None, 0))
    mine = db.scalar(select(Rating.stars).where(Rating.kind == kind, Rating.slug == slug, Rating.user_id == viewer.id)) if viewer else None
    return RatingOut(average=average, count=count, mine=mine)


@router.get("/{kind}/{slug:path}/rating", response_model=RatingOut)
def get_rating(kind: Kind, slug: str, db: Session = Depends(get_db), viewer: User | None = Depends(get_optional_library_user)):
    _entry_exists(db, kind, slug)
    return _rating(db, kind, slug, viewer)


@router.put("/{kind}/{slug:path}/rating", response_model=RatingOut)
def set_rating(kind: Kind, slug: str, body: RatingIn, db: Session = Depends(get_db), user: User = Depends(get_library_user)):
    """Rates 1-5 stars; rating again changes it. Nobody rates their own preset."""
    entry = _entry_exists(db, kind, slug)
    if isinstance(entry, Preset) and entry.author_id == user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot rate your own preset")
    row = db.scalar(select(Rating).where(Rating.kind == kind, Rating.slug == slug, Rating.user_id == user.id))
    if row:
        row.stars = body.stars
    else:
        db.add(Rating(kind=kind, slug=slug, user_id=user.id, stars=body.stars))
    db.commit()
    return _rating(db, kind, slug, user)


@router.delete("/{kind}/{slug:path}/rating", response_model=RatingOut)
def clear_rating(kind: Kind, slug: str, db: Session = Depends(get_db), user: User = Depends(get_library_user)):
    row = db.scalar(select(Rating).where(Rating.kind == kind, Rating.slug == slug, Rating.user_id == user.id))
    if row:
        db.delete(row)
        db.commit()
    return _rating(db, kind, slug, user)
