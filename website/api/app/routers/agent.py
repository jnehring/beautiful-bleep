# SPDX-License-Identifier: MIT
"""The patch assistant's endpoints (agent/, doc/specs/agent.md §5).

GET  /api/agent/status  always answers; {"enabled": false, "reason": "disabled"} when BLEEP_AGENT_ENABLED is off (the board then shows the button with a notice, no composer).
POST /api/agent/chat    a Server-Sent Events stream of one assistant turn; signed-in users only (the website's cookie, or the app's personal token), per-user rate, daily token budget.

The library is imported only when the feature is on, so a disabled installation never loads a model client.
"""
import asyncio
import json
import logging
import secrets
import threading
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

from .. import agent_log, agent_quota
from ..config import settings
from ..db import SessionLocal, get_db
from ..deps import get_library_user, get_optional_library_user
from ..models import User
from ..ratelimit import limiter

log = logging.getLogger("bleep.agent")
router = APIRouter(prefix="/api/agent", tags=["agent"])

_user_limit = limiter(max(1, settings.agent_user_per_minute), 60.0)
_resources: Any = None
_lock = threading.Lock()
_secret = secrets.token_bytes(32)


def set_resources(res: Any) -> None:
    """Tests (and embedding code) provide ready-made resources."""
    global _resources
    _resources = res


def _build_resources() -> Any:
    from bleep_agent.catalog import Catalog
    from bleep_agent.docs_index import DocsIndex
    from bleep_agent.embeddings import provider_embedding_model
    from bleep_agent.models import BudgetExceeded, create_model
    from bleep_agent.presets import PresetLibrary
    from bleep_agent.runner import Resources

    data = Path(settings.agent_data_dir)
    catalog_file = data / "catalog.json"
    if not catalog_file.exists():
        raise FileNotFoundError(f"{catalog_file} missing: run ./bleep build agent-data")
    catalog = Catalog.load(catalog_file)
    presets = PresetLibrary.load(data / "presets.jsonl") if (data / "presets.jsonl").exists() else None
    docs = None
    if (data / "docs.sqlite").exists():
        embed = None
        try:
            embed = provider_embedding_model(settings.agent_embed_model)
        except Exception as e:  # noqa: BLE001  (no key, unknown model: keyword search still works)
            log.warning("embedding model unavailable (%s): documentation search is keyword-only", e)
        docs = DocsIndex(data / "docs.sqlite", embed, settings.agent_embed_model)
        if not docs.hybrid:
            log.warning("documentation search is keyword-only: %s", docs.reason)

    def on_usage(u: Any) -> None:
        with SessionLocal() as db:
            agent_quota.record(db, tokens=(u.input_tokens or 0) + (u.output_tokens or 0))

    def check() -> None:
        with SessionLocal() as db:
            if agent_quota.exhausted(db):
                raise BudgetExceeded()

    return Resources(model=create_model(settings.agent_model), catalog=catalog, presets=presets, docs=docs,
                     state_secret=settings.agent_state_secret.encode() or _secret, max_steps=settings.agent_max_steps,
                     on_usage=on_usage, check_budget=check)


def get_resources() -> Any:
    global _resources
    if _resources is None:
        with _lock:
            if _resources is None:
                _resources = _build_resources()
    return _resources


@router.get("/status")
def agent_status(user: User | None = Depends(get_optional_library_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    if not settings.agent_enabled:
        return {"enabled": False, "reason": "disabled"}
    out_of_budget = agent_quota.exhausted(db)
    return {"enabled": True, "signed_in": user is not None, "budget_exhausted": out_of_budget,
            "reset_at": agent_quota.reset_at().isoformat() if out_of_budget else None}


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


@router.post("/chat")
async def chat(body: dict[str, Any], user: User = Depends(get_library_user), db: Session = Depends(get_db)):
    if not settings.agent_enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    from bleep_agent.protocol import ChatRequest
    from pydantic import ValidationError

    try:
        req = ChatRequest.model_validate(body)
    except ValidationError as e:
        raise HTTPException(422, json.loads(e.json(include_url=False, include_input=False))[:5])
    if settings.agent_user_per_minute and not _user_limit.hit(f"user:{user.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Please wait a moment before the next message", headers={"Retry-After": "30"})
    if agent_quota.exhausted(db):
        wait = max(1, int((agent_quota.reset_at() - datetime.now(timezone.utc)).total_seconds()))
        return JSONResponse({"detail": "The daily AI budget is used up", "code": "budget", "reset_at": agent_quota.reset_at().isoformat()},
                            status_code=status.HTTP_429_TOO_MANY_REQUESTS, headers={"Retry-After": str(wait)})
    try:
        res = get_resources()
    except Exception as e:  # noqa: BLE001
        log.error("assistant not available: %s", e)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The assistant is not available")
    agent_quota.record(db, requests=1)
    chat_id = agent_quota.start_chat(db, user.id, new_chat=req.resume is None and len(req.messages) <= 1)

    from bleep_agent.runner import run_chat

    recorder = agent_log.RunRecorder(user.id) if agent_log.enabled() else None

    async def stream() -> AsyncIterator[str]:
        it = run_chat(res, req, record=recorder).__aiter__()
        pending = asyncio.ensure_future(it.__anext__())
        try:
            if recorder is not None:
                yield _sse("run", {"run_id": recorder.run_id})  # lets the browser fetch this run's log (Copy chat)
            while True:
                done, _ = await asyncio.wait({pending}, timeout=15)
                if not done:
                    yield ": ping\n\n"
                    continue
                try:
                    kind, data = pending.result()
                except StopAsyncIteration:
                    break
                if kind == "usage":
                    with SessionLocal() as s:
                        agent_quota.finish_chat(s, chat_id, data.get("input_tokens", 0), data.get("output_tokens", 0))
                        data = {**data, "day_total": agent_quota.used_today(s), "day_limit": settings.agent_daily_tokens}
                yield _sse(kind, data)
                pending = asyncio.ensure_future(it.__anext__())
        except Exception:  # noqa: BLE001  (an aborted stream looks like a lost connection to the browser: say what happened instead)
            log.exception("assistant stream failed")
            yield _sse("error", {"code": "internal", "message": "The assistant failed unexpectedly. See the server log."})
            yield _sse("done", {"reason": "error"})
        finally:
            if recorder is not None:
                recorder.write()  # also when the browser left in the middle of the run
            if not pending.done():
                pending.cancel()
            await it.aclose()

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
