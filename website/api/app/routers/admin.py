# SPDX-License-Identifier: MIT
from fastapi import APIRouter, Depends, HTTPException, status
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin
from ..config import settings
from ..models import AgentChat, User, UserSession
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


chat_router = APIRouter(prefix="/api/admin/chat", tags=["admin"], dependencies=[Depends(require_admin)])


@chat_router.get("/stats")
def chat_stats(days: int = 30, db: Session = Depends(get_db)):
    """Usage of the patch assistant: totals, chats and users overall / last 7 / last 30 days, and tokens + cost per UTC day."""
    days = max(1, min(days, 365))
    now = datetime.now(timezone.utc)
    start = datetime.combine(now.date() - timedelta(days=days - 1), datetime.min.time(), tzinfo=timezone.utc)

    def window(since: datetime | None) -> dict:
        q = [AgentChat.created_at >= since] if since is not None else []
        chats = db.scalar(select(func.count()).select_from(AgentChat).where(AgentChat.new_chat, *q)) or 0
        users = db.scalar(select(func.count(func.distinct(AgentChat.user_id))).where(*q)) or 0
        turns = db.scalar(select(func.count()).select_from(AgentChat).where(*q)) or 0
        return {"chats": chats, "users": users, "turns": turns}

    total = db.execute(select(
        func.coalesce(func.sum(AgentChat.input_tokens), 0), func.coalesce(func.sum(AgentChat.output_tokens), 0),
        func.coalesce(func.sum(AgentChat.cost_usd), 0.0))).one()
    rows = db.execute(select(AgentChat.created_at, AgentChat.input_tokens, AgentChat.output_tokens, AgentChat.cost_usd)
                      .where(AgentChat.created_at >= start)).all()
    daily = {(start + timedelta(days=i)).date().isoformat(): {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}
             for i in range(days)}
    for created, tin, tout, cost in rows:
        d = daily.get(created.astimezone(timezone.utc).date().isoformat())
        if d:
            d["input_tokens"] += tin
            d["output_tokens"] += tout
            d["cost_usd"] += cost
    return {
        "total": {"input_tokens": int(total[0]), "output_tokens": int(total[1]), "tokens": int(total[0] + total[1]), "cost_usd": float(total[2])},
        "windows": {"all": window(None), "7d": window(now - timedelta(days=7)), "30d": window(now - timedelta(days=30))},
        "daily": [{"day": k, **v, "tokens": v["input_tokens"] + v["output_tokens"]} for k, v in daily.items()],
        "pricing_configured": bool(settings.agent_price_input or settings.agent_price_output),
    }
