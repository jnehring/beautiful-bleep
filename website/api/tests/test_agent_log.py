# SPDX-License-Identifier: MIT
"""The assistant's run log: what is stored, rolling by rows, off at 0, admin-only reading."""
from pathlib import Path

import pytest
from sqlalchemy import func, select

pytest.importorskip("bleep_agent")

from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart  # noqa: E402
from pydantic_ai.models.function import FunctionModel  # noqa: E402

from app import agent_log  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import AgentLog  # noqa: E402
from app.routers import agent as agent_router  # noqa: E402
from test_api import login_as_admin  # noqa: E402
from test_social import other_client  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
PATCH = {"format": 1, "tempo": 100, "nodes": [
    {"id": "out", "type": "audio-out", "name": "Out", "x": 0, "y": 0, "parent": "", "params": {}},
    {"id": "reverb", "type": "reverb", "name": "Verb", "x": 300, "y": 0, "parent": "", "params": {}}],
    "cables": [{"id": "k1", "from": {"node": "reverb", "jack": "l"}, "to": {"node": "out", "jack": "l"}, "amount": 1},
               {"id": "k2", "from": {"node": "reverb", "jack": "r"}, "to": {"node": "out", "jack": "r"}, "amount": 1}]}
BODY = {"messages": [{"role": "user", "content": "add a chorus between the reverb and the output"}], "snapshot": {"patch": PATCH}}
OPS = {"ops": [{"op": "insert_on_cable", "from_node": "reverb", "to_node": "out", "type": "chorus"}], "summary": "Add a chorus"}


@pytest.fixture
def agent_with_log(monkeypatch):
    from bleep_agent.catalog import build_catalog
    from bleep_agent.runner import Resources

    monkeypatch.setattr(settings, "agent_enabled", True)
    monkeypatch.setattr(settings, "agent_user_per_minute", 0)
    monkeypatch.setattr(settings, "agent_log_messages", 5000)

    def fn(messages, info):
        if any(isinstance(p, ToolReturnPart) for m in messages for p in getattr(m, "parts", [])):
            return ModelResponse(parts=[TextPart("Added a chorus.")])
        return ModelResponse(parts=[ToolCallPart("propose_changes", OPS)])

    agent_router.set_resources(Resources(model=FunctionModel(fn), catalog=build_catalog(REPO), stream=False))
    yield
    agent_router.set_resources(None)


def rows():
    with SessionLocal() as db:
        return db.scalars(select(AgentLog).order_by(AgentLog.id)).all()


def test_a_run_is_logged_in_full(client, agent_with_log):
    ann = other_client("ann@example.com", "Ann")
    assert ann.post("/api/agent/chat", json=BODY).status_code == 200
    rs = rows()
    kinds = [r.kind for r in rs]
    assert kinds[0] == "run_start" and kinds[-1] == "summary" and kinds.count("model_call") == 2
    assert {"tool_call", "answer", "event"} <= set(kinds)
    assert len({r.run_id for r in rs}) == 1 and all(r.user_id for r in rs)
    start = rs[0].data
    assert start["prompt"].startswith("add a chorus") and start["snapshot"]["patch"]["nodes"][1]["id"] == "reverb"
    call = next(r.data for r in rs if r.kind == "model_call")
    assert call["request"] and call["response"]["parts"][0]["tool_name"] == "propose_changes" and call["tools"]
    tool = next(r.data for r in rs if r.kind == "tool_call")
    assert tool["tool"] == "propose_changes" and tool["result"]["changeset"] and tool["args"]["summary"] == "Add a chorus"
    assert next(r.data for r in rs if r.kind == "answer")["text"] == "Added a chorus."
    s = rs[-1].data
    assert s["skill"] == "patch" and s["model_calls"] == 2 and s["tools"] == ["propose_changes"] and s["changesets"] == 1 and s["reason"] == "final"


def test_the_log_rolls_by_rows(client, agent_with_log, monkeypatch):
    ann = other_client("ann@example.com", "Ann")
    ann.post("/api/agent/chat", json=BODY)
    per_run = len(rows())
    monkeypatch.setattr(settings, "agent_log_messages", per_run + 3)
    for _ in range(4):
        ann.post("/api/agent/chat", json=BODY)
    rs = rows()
    assert len(rs) == per_run + 3  # exactly the newest rows; older runs were cut
    assert rs[-1].kind == "summary"
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(AgentLog)) == per_run + 3
        assert agent_log.prune(db, 10) == per_run + 3 - 10
        assert agent_log.prune(db, 10) == 0


def test_log_off_at_zero(client, agent_with_log, monkeypatch):
    monkeypatch.setattr(settings, "agent_log_messages", 0)
    ann = other_client("ann@example.com", "Ann")
    assert ann.post("/api/agent/chat", json=BODY).status_code == 200
    assert rows() == []


def test_only_admins_read_the_log(client, agent_with_log, make_admin):
    ann = other_client("ann@example.com", "Ann")
    ann.post("/api/agent/chat", json=BODY)
    assert ann.get("/api/admin/agent-log/runs").status_code == 403
    assert client.get("/api/admin/agent-log/runs").status_code == 401
    login_as_admin(client, make_admin)
    listing = client.get("/api/admin/agent-log/runs").json()
    assert listing["rows_stored"] == len(rows()) and len(listing["items"]) == 1
    item = listing["items"][0]
    assert item["user"] == "ann@example.com" and item["tools"] == ["propose_changes"] and item["prompt"].startswith("add a chorus")
    detail = client.get(f"/api/admin/agent-log/runs/{item['run_id']}").json()
    assert [r["kind"] for r in detail["rows"]][0] == "run_start" and any(r["kind"] == "model_call" for r in detail["rows"])
    assert client.get("/api/admin/agent-log/runs/nope").status_code == 404


def test_huge_rows_are_clipped(client):
    clipped = agent_log._clip({"x": "a" * (agent_log.MAX_ROW_CHARS + 10)})
    assert clipped["truncated"] and clipped["chars"] > agent_log.MAX_ROW_CHARS and len(clipped["head"]) == 20_000


def test_the_browser_gets_the_run_id_and_can_fetch_its_own_log(client, agent_with_log):
    from test_agent import events

    ann, ben = other_client("ann@example.com", "Ann"), other_client("ben@example.com", "Ben")
    ev = events(ann.post("/api/agent/chat", json=BODY))
    assert ev[0][0] == "run"
    run_id = ev[0][1]["run_id"]
    got = ann.get("/api/agent/log", params={"run_ids": run_id + ",nonexistent"}).json()
    assert got["log_enabled"] is True and got["missing"] == ["nonexistent"]
    assert [r["kind"] for r in got["runs"][0]["rows"]][0] == "run_start" and got["runs"][0]["rows"][-1]["kind"] == "summary"
    # somebody else's run is not theirs to read
    other = ben.get("/api/agent/log", params={"run_ids": run_id}).json()
    assert other["runs"] == [] and other["missing"] == [run_id]
    assert client.get("/api/agent/log", params={"run_ids": run_id}).status_code == 401
