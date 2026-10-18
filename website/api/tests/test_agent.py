# SPDX-License-Identifier: MIT
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("bleep_agent")

from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart  # noqa: E402
from pydantic_ai.models.function import FunctionModel  # noqa: E402

from app import agent_quota  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.routers import agent as agent_router  # noqa: E402
from test_social import app_token, bearer, other_client  # noqa: E402,F401

REPO = Path(__file__).resolve().parents[3]
PATCH = {"format": 1, "nodes": [{"id": "out", "type": "audio-out", "name": "Out", "x": 0, "y": 0, "parent": "", "params": {}}], "cables": []}


def events(resp):
    out, name = [], None
    for line in resp.text.splitlines():
        if line.startswith("event: "):
            name = line[7:]
        elif line.startswith("data: "):
            out.append((name, json.loads(line[6:])))
    return out


@pytest.fixture
def agent_on(monkeypatch):
    from bleep_agent.catalog import build_catalog
    from bleep_agent.models import BudgetExceeded
    from bleep_agent.runner import Resources

    monkeypatch.setattr(settings, "agent_enabled", True)
    monkeypatch.setattr(settings, "agent_daily_tokens", 1_000_000)
    monkeypatch.setattr(settings, "agent_user_per_minute", 0)
    catalog = build_catalog(REPO)

    def make(text="Hello from the model."):
        def fn(messages, info):
            return ModelResponse(parts=[TextPart(text)], usage=__import__("pydantic_ai").RequestUsage(input_tokens=100, output_tokens=20))

        def on_usage(u):
            with SessionLocal() as db:
                agent_quota.record(db, tokens=(u.input_tokens or 0) + (u.output_tokens or 0))

        def check():
            with SessionLocal() as db:
                if agent_quota.exhausted(db):
                    raise BudgetExceeded()

        agent_router.set_resources(Resources(model=FunctionModel(fn), catalog=catalog, stream=False, on_usage=on_usage, check_budget=check))

    make()
    yield make
    agent_router.set_resources(None)


BODY = {"messages": [{"role": "user", "content": "what is a vca?"}], "snapshot": {"patch": PATCH}}


def test_disabled_by_default(client):
    assert settings.agent_enabled is False
    assert client.get("/api/agent/status").json() == {"enabled": False}
    ann = other_client("ann@example.com", "Ann")
    assert ann.post("/api/agent/chat", json=BODY).status_code == 404


def test_status_and_login(client, agent_on):
    assert client.get("/api/agent/status").json() == {"enabled": True, "signed_in": False, "budget_exhausted": False, "reset_at": None}
    assert client.post("/api/agent/chat", json=BODY).status_code == 401
    ann = other_client("ann@example.com", "Ann")
    assert ann.get("/api/agent/status").json()["signed_in"] is True


def test_app_token_signs_in_the_assistant(client, agent_on):
    """The standalone app and the plugins have no cookie: their personal token (the device flow) works for status, chat and the run log."""
    ann = other_client("ann@example.com", "Ann")
    token = app_token(ann)
    bare = TestClient(app)
    assert bare.get("/api/agent/status", headers=bearer(token)).json()["signed_in"] is True
    assert bare.get("/api/agent/status", headers=bearer("blu_wrong")).json()["signed_in"] is False
    assert bare.post("/api/agent/chat", json=BODY, headers=bearer("blu_wrong")).status_code == 401
    r = bare.post("/api/agent/chat", json=BODY, headers=bearer(token))
    assert r.status_code == 200 and events(r)[-1][0] == "done"
    assert bare.get("/api/agent/log", params={"run_ids": "x"}, headers=bearer(token)).status_code != 401


def test_chat_streams_and_counts_tokens(client, agent_on):
    ann = other_client("ann@example.com", "Ann")
    r = ann.post("/api/agent/chat", json=BODY)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    ev = events(r)
    names = [n for n, _ in ev]
    assert "text" in names and names[-1] == "done"
    usage = next(d for n, d in ev if n == "usage")
    assert usage["day_limit"] == 1_000_000 and usage["day_total"] == 120
    with SessionLocal() as db:
        assert agent_quota.used_today(db) == 120


def test_daily_budget_is_global(client, agent_on, monkeypatch):
    monkeypatch.setattr(settings, "agent_daily_tokens", 100)
    ann, ben = other_client("ann@example.com", "Ann"), other_client("ben@example.com", "Ben")
    assert ann.post("/api/agent/chat", json=BODY).status_code == 200      # uses 120 tokens, over the 100 budget
    r = ben.post("/api/agent/chat", json=BODY)                              # another user: refused up front
    assert r.status_code == 429 and r.json()["code"] == "budget" and int(r.headers["Retry-After"]) > 0
    assert ben.get("/api/agent/status").json()["budget_exhausted"] is True


def test_per_user_rate(client, agent_on, monkeypatch):
    monkeypatch.setattr(settings, "agent_user_per_minute", 1)
    agent_router._user_limit.limit = 1
    ann = other_client("ann@example.com", "Ann")
    assert ann.post("/api/agent/chat", json=BODY).status_code == 200
    assert ann.post("/api/agent/chat", json=BODY).status_code == 429


def test_bad_request_is_refused(client, agent_on):
    ann = other_client("ann@example.com", "Ann")
    bad = {"messages": [{"role": "assistant", "content": "x"}], "snapshot": {"patch": PATCH}}
    assert ann.post("/api/agent/chat", json=bad).status_code == 422


def test_unavailable_without_data(client, agent_on, monkeypatch, tmp_path):
    agent_router.set_resources(None)
    monkeypatch.setattr(settings, "agent_data_dir", str(tmp_path))
    ann = other_client("ann@example.com", "Ann")
    assert ann.post("/api/agent/chat", json=BODY).status_code == 503


def test_admin_chat_stats(client, agent_on, monkeypatch, make_admin):
    monkeypatch.setattr(agent_quota, "model_prices", lambda: (1.0, 10.0))
    ann, ben = other_client("ann@example.com", "Ann"), other_client("ben@example.com", "Ben")
    assert ann.post("/api/agent/chat", json=BODY).status_code == 200
    assert ann.post("/api/agent/chat", json=BODY).status_code == 200
    follow_up = {**BODY, "messages": [*BODY["messages"], {"role": "assistant", "content": "a"}, {"role": "user", "content": "more"}]}
    assert ben.post("/api/agent/chat", json=follow_up).status_code == 200   # a later turn: not a new chat
    assert ann.get("/api/admin/chat/stats").status_code == 403
    email, password = make_admin()
    admin = client
    assert admin.post("/api/auth/login", json={"email": email, "password": password}).status_code == 200
    s = admin.get("/api/admin/chat/stats").json()
    assert s["total"]["tokens"] == 360 and s["total"]["cost_usd"] == pytest.approx(3 * (100 + 200) / 1e6)
    assert s["windows"]["all"] == {"chats": 2, "users": 2, "turns": 3}
    assert s["windows"]["7d"]["users"] == 2 and s["windows"]["30d"]["chats"] == 2
    assert len(s["daily"]) == 30 and s["daily"][-1]["tokens"] == 360
