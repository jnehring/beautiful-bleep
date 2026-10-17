# SPDX-License-Identifier: MIT
"""The patch assistant's run log: write a finished run, keep only the newest BLEEP_AGENT_LOG_MESSAGES rows."""
import json
import logging
import time
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import settings
from .db import SessionLocal
from .models import AgentLog

log = logging.getLogger("bleep.agent")
MAX_ROW_CHARS = 400_000  # one row (a model call with a long history) is clipped beyond this


def new_run_id() -> str:
    return uuid.uuid4().hex


def enabled() -> bool:
    return settings.agent_log_messages > 0


class RunRecorder:
    """Collects a run's records in memory; `write()` stores them in one transaction when the run is over (also when the client left)."""

    def __init__(self, user_id: int | None):
        self.run_id = new_run_id()
        self.user_id = user_id
        self.rows: list[tuple[str, dict, float]] = []
        self.t0 = time.time()

    def __call__(self, kind: str, data: dict) -> None:
        self.rows.append((kind, data, time.time()))

    def summary(self) -> dict:
        start = next((d for k, d, _ in self.rows if k == "run_start"), {})
        calls = [d for k, d, _ in self.rows if k == "model_call"]
        done = next((d["data"] for k, d, _ in reversed(self.rows) if k == "event" and d.get("name") == "done"), {})
        err = next((d["data"] for k, d, _ in self.rows if k == "event" and d.get("name") == "error"), None)
        return {
            "skill": start.get("skill"), "mode": start.get("mode"), "resume": start.get("resume"), "prompt": (start.get("prompt") or "")[:300],
            "model": start.get("model"), "duration": round(time.time() - self.t0, 2), "model_calls": len(calls),
            "model_seconds": round(sum(c.get("latency", 0) for c in calls), 2),
            "tokens_in": sum((c.get("usage") or {}).get("input_tokens", 0) for c in calls),
            "tokens_out": sum((c.get("usage") or {}).get("output_tokens", 0) for c in calls),
            "tools": [d["tool"] + ("(retry)" if d.get("retry") else "") for k, d, _ in self.rows if k == "tool_call"],
            "changesets": sum(1 for k, d, _ in self.rows if k == "event" and d.get("name") == "changeset"),
            "reason": done.get("reason"), "error": err, "rows": len(self.rows),
        }

    def write(self) -> None:
        if not self.rows or not enabled():
            return
        try:
            rows = list(self.rows) + [("summary", self.summary(), time.time())]
            with SessionLocal() as db:
                for kind, data, ts in rows:
                    db.add(AgentLog(run_id=self.run_id, user_id=self.user_id, kind=kind, data=_clip(data),
                                    created_at=datetime.fromtimestamp(ts, timezone.utc)))
                db.commit()
                prune(db, settings.agent_log_messages)
        except Exception:  # noqa: BLE001  (the log must never break the assistant)
            log.exception("could not write the run log")


def _clip(data: dict) -> dict:
    text = json.dumps(data, separators=(",", ":"), default=str)
    if len(text) <= MAX_ROW_CHARS:
        return json.loads(text)
    return {"truncated": True, "chars": len(text), "head": text[:20_000]}


def prune(db: Session, keep: int) -> int:
    """Delete everything but the newest `keep` rows. Returns how many rows were removed."""
    if keep <= 0:
        return 0
    cutoff = db.scalar(select(AgentLog.id).order_by(AgentLog.id.desc()).offset(keep).limit(1))
    if cutoff is None:
        return 0
    n = db.execute(delete(AgentLog).where(AgentLog.id <= cutoff)).rowcount
    db.commit()
    return n or 0
