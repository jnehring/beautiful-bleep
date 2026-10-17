# SPDX-License-Identifier: MIT
import asyncio

import pytest
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from bleep_agent.docs_index import DocsIndex, build_index
from bleep_agent.models import BudgetExceeded
from bleep_agent.protocol import ChatMessage, ChatRequest, Resume, LiveResult, Snapshot
from bleep_agent.runner import Resources, run_chat
from bleep_agent.skills import route
from helpers import returned, scripted

INSERT = {"ops": [{"op": "insert_on_cable", "from_node": "reverb", "to_node": "out", "type": "chorus", "params": {"mix": 0.3}}],
          "summary": "Add a chorus before the output"}


def collect(res, req):
    async def go():
        return [e async for e in run_chat(res, req)]
    return asyncio.run(go())


def request(text, patch, **kw):
    return ChatRequest(messages=[ChatMessage(role="user", content=text)], snapshot=Snapshot(patch=patch.to_dict()), **kw)


def kinds(events):
    return [k for k, _ in events]


def test_routing():
    cases = {
        "why do i not hear sound?": "diagnose",
        "how do i wire the adsr to the vca?": "docs",
        "add chorus and reverb between the synth and the output": "patch",
        "add my usb midi keyboard to the patch": "patch",
        "in the step sequencer program an acid line": "compose",
        "build an acid synthesizer": "design",
        "build a panel for the patch": "panel",
        "organize the panel": "panel",
        "what does Drive do in the Multi Filter?": "docs",
        "how do I sign a module?": "docs",
    }
    for text, skill in cases.items():
        assert route(text) == skill, text
    assert route("whatever", "compose") == "compose"


def test_patch_request_ask_and_auto(catalog, synth):
    res = Resources(model=scripted(("propose_changes", INSERT), "Added a chorus before the output."), catalog=catalog, stream=False)
    ev = collect(res, request("add a chorus before the output", synth))
    cs = [d for k, d in ev if k == "changeset"]
    assert len(cs) == 1 and cs[0]["needs_confirmation"] is True and any(o["op"] == "add_node" for o in cs[0]["ops"])
    assert ev[-1] == ("done", {"reason": "final"}) and any(k == "text" for k, _ in ev)
    ev = collect(res, request("add a chorus before the output", synth, mode="auto"))
    assert [d for k, d in ev if k == "changeset"][0]["needs_confirmation"] is False


def test_tool_error_is_retried(catalog, synth):
    bad = {"ops": [{"op": "connect", "from_node": "vca", "from_jack": "zzz", "to_node": "out", "to_jack": "l"}], "summary": "x"}
    res = Resources(model=scripted(("propose_changes", bad), ("propose_changes", INSERT), "done"), catalog=catalog, stream=False)
    ev = collect(res, request("add a chorus before the output", synth))
    assert kinds(ev).count("changeset") == 1 and ev[-1][0] == "done" and ev[-1][1]["reason"] == "final"


def test_live_tool_pause_and_resume(catalog, synth):
    probe = {"points": [{"node": "vca", "jack": "l"}], "seconds": 1, "test_note": {"note": 60}}

    def fn(messages, info):
        if returned(messages, "probe_signals"):
            return ModelResponse(parts=[TextPart("The VCA output is silent.")])
        return ModelResponse(parts=[ToolCallPart("probe_signals", probe)])

    res = Resources(model=FunctionModel(fn), catalog=catalog, stream=False, state_secret=b"k")
    ev = collect(res, request("why do i not hear sound?", synth, mode="ask"))
    live = [d for k, d in ev if k == "live"]
    assert len(live) == 1 and live[0]["tool"] == "probe_signals" and live[0]["args"]["points"][0]["node"] == "vca"
    assert ev[-1] == ("done", {"reason": "pause"})
    token = next(d["token"] for k, d in ev if k == "pause")
    req = ChatRequest(snapshot=Snapshot(patch=synth.to_dict()), resume=Resume(token=token, results=[LiveResult(call_id=live[0]["call_id"], result={"points": []})]))
    ev2 = collect(res, req)
    assert ev2[-1] == ("done", {"reason": "final"}) and "silent" in "".join(d["delta"] for k, d in ev2 if k == "text")
    # a tampered token is refused
    bad = ChatRequest(snapshot=Snapshot(patch=synth.to_dict()), resume=Resume(token=token[:-4] + "AAAA", results=[]))
    ev3 = collect(res, bad)
    assert ev3[0][0] == "error" and ev3[0][1]["code"] == "invalid"


def test_budget_stops_the_run(catalog, synth):
    def check():
        raise BudgetExceeded()

    res = Resources(model=scripted("hi"), catalog=catalog, stream=False, check_budget=check)
    ev = collect(res, request("what is a vca", synth))
    assert ("done", {"reason": "budget"}) in ev and any(k == "error" and d["code"] == "budget" for k, d in ev)


def test_usage_is_reported(catalog, synth):
    seen = []
    res = Resources(model=scripted("ok"), catalog=catalog, stream=False, on_usage=seen.append)
    collect(res, request("what is a vca", synth))
    assert len(seen) == 1


def test_docs_skill_uses_the_index(catalog, synth, repo, tmp_path):
    out = tmp_path / "docs.sqlite"
    build_index(repo, out, None, log=lambda *_: None)
    idx = DocsIndex(out)
    assert not idx.hybrid
    hits = idx.search_sync("how do I sign a module", 6)
    assert hits and any("signing" in h.id for h in hits)
    steps = [("search_docs", {"query": "sign a module"}), "Signing is described [here](/docs/developers/modules/signing/)."]
    res = Resources(model=scripted(*steps), catalog=catalog, docs=idx, stream=False)
    ev = collect(res, request("how do I sign a module?", synth))
    assert ev[-1][1]["reason"] == "final" and any(k == "activity" and "documentation" in d["text"] for k, d in ev)


def test_streaming_text(catalog, synth):
    async def stream_fn(messages, info):
        yield "Hello "
        yield "world"

    model = FunctionModel(stream_function=stream_fn)
    res = Resources(model=model, catalog=catalog, stream=True)
    ev = collect(res, request("what is a vca", synth))
    assert "".join(d["delta"] for k, d in ev if k == "text") == "Hello world"
