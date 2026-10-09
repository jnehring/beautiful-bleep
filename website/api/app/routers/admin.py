# SPDX-License-Identifier: MIT
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin
from ..models import User, UserSession
from ..schemas import AdminUserIn, UserOut

router = APIRouter(prefix="/api/admin/users", tags=["admin"], dependencies=[Depends(require_admin)])


def _get(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such user")
    return user


def _other_active_admins(db: Session, user: User) -> int:
    return db.scalar(
        select(func.count()).select_from(User).where(User.role == "admin", User.is_active, User.id != user.id)
    ) or 0


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.id)).all()


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db)):
    return _get(db, user_id)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: AdminUserIn, db: Session = Depends(get_db)):
    user = _get(db, user_id)
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    loses_admin = user.role == "admin" and user.is_active and (
        changes.get("role", "admin") != "admin" or changes.get("is_active", True) is False
    )
    if loses_admin and not _other_active_admins(db, user):
        raise HTTPException(status.HTTP_409_CONFLICT, "There must be at least one active admin")
    for field, value in changes.items():
        setattr(user, field, value)
    if changes.get("is_active") is False:
        db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.add(user)
    db.commit()
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = _get(db, user_id)
    if user.role == "admin" and user.is_active and not _other_active_admins(db, user):
        raise HTTPException(status.HTTP_409_CONFLICT, "There must be at least one active admin")
    db.delete(user)
    db.commit()
