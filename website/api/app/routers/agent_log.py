# SPDX-License-Identifier: MIT
"""Admin read access to the assistant's run log (app/agent_log.py)."""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_library_user, require_admin
from ..models import AgentLog, User

user_router = APIRouter(prefix="/api/agent", tags=["agent-log"])
router = APIRouter(prefix="/api/admin/agent-log", tags=["agent-log"], dependencies=[Depends(require_admin)])


@router.get("/runs")
def runs(limit: int = Query(50, ge=1, le=500), before: int | None = None, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Newest runs first: one line each (prompt, skill, model calls, tokens, tools, outcome). `before` = the id of the last row seen, to page."""
    q = select(AgentLog).where(AgentLog.kind == "summary").order_by(AgentLog.id.desc()).limit(limit)
    if before:
        q = q.where(AgentLog.id < before)
    rows = db.scalars(q).all()
    emails = {u.id: u.email for u in db.scalars(select(User).where(User.id.in_({r.user_id for r in rows if r.user_id})))} if rows else {}
    return {"items": [{"id": r.id, "run_id": r.run_id, "at": r.created_at.isoformat(), "user_id": r.user_id, "user": emails.get(r.user_id), **r.data}
                      for r in rows],
            "rows_stored": db.scalar(select(func.count()).select_from(AgentLog))}


@router.get("/runs/{run_id}")
def run(run_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Every row of one run in order: run_start, model_call (full messages and response), tool_call, event, answer, summary."""
    rows = db.scalars(select(AgentLog).where(AgentLog.run_id == run_id).order_by(AgentLog.id)).all()
    if not rows:
        raise HTTPException(404, "No such run (the log keeps only the newest rows)")
    return {"run_id": run_id, "user_id": rows[0].user_id,
            "rows": [{"id": r.id, "at": r.created_at.isoformat(), "kind": r.kind, "data": r.data} for r in rows]}


@user_router.get("/log")
def my_runs(run_ids: str = Query(..., description="comma separated run ids, as sent in the `run` event"), user: User = Depends(get_library_user),
            db: Session = Depends(get_db)) -> dict[str, Any]:
    """The full log of the given runs, for "Copy chat". Users get their own runs; admins any. Runs the rolling log has already dropped are listed as missing."""
    ids = [i for i in dict.fromkeys(x.strip() for x in run_ids.split(",")) if i][:40]
    q = select(AgentLog).where(AgentLog.run_id.in_(ids)).order_by(AgentLog.id)
    if user.role != "admin":
        q = q.where(AgentLog.user_id == user.id)
    by: dict[str, list[AgentLog]] = {}
    for r in db.scalars(q):
        by.setdefault(r.run_id, []).append(r)
    return {"log_enabled": settings.agent_log_messages > 0,
            "runs": [{"run_id": i, "rows": [{"id": r.id, "at": r.created_at.isoformat(), "kind": r.kind, "data": r.data} for r in by[i]]} for i in ids if i in by],
            "missing": [i for i in ids if i not in by]}
