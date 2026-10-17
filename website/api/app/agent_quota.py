# SPDX-License-Identifier: MIT
"""The daily token budget of the patch assistant, all users together (BLEEP_AGENT_DAILY_TOKENS), stored in `agent_usage`."""
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .models import AgentUsage


def today() -> date:
    return datetime.now(timezone.utc).date()


def reset_at() -> datetime:
    return datetime.combine(today() + timedelta(days=1), time.min, tzinfo=timezone.utc)


def used_today(db: Session) -> int:
    row = db.get(AgentUsage, today())
    return int(row.tokens) if row else 0


def exhausted(db: Session) -> bool:
    return used_today(db) >= settings.agent_daily_tokens


def record(db: Session, tokens: int = 0, requests: int = 0) -> None:
    """Add to today's counters atomically (an UPDATE ... SET x = x + n; the row is created on first use)."""
    d = today()
    for _ in range(2):
        res = db.execute(update(AgentUsage).where(AgentUsage.day == d).values(
            tokens=AgentUsage.tokens + max(0, int(tokens)), requests=AgentUsage.requests + max(0, int(requests))))
        if res.rowcount:
            db.commit()
            return
        try:
            db.add(AgentUsage(day=d, tokens=max(0, int(tokens)), requests=max(0, int(requests))))
            db.commit()
            return
        except IntegrityError:  # another request created the row first: add to it
            db.rollback()
