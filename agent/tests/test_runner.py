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


def test_usage_events_stream_while_running(catalog, synth):
    """The chat's token counter moves after every model call, not only at the end; the totals are cumulative."""
    steps = [("search_docs", {"query": "vca"}), "A VCA scales a signal."]
    res = Resources(model=scripted(*steps), catalog=catalog, stream=False)
    ev = collect(res, request("what is a vca", synth))
    usage = [d for k, d in ev if k == "usage"]
    assert len(usage) >= 2
    assert [u["requests"] for u in usage] == list(range(1, len(usage) + 1))
    totals = [u["input_tokens"] + u["output_tokens"] for u in usage]
    assert totals == sorted(totals)
    assert kinds(ev).index("usage") < kinds(ev).index("done")


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


def test_streaming_reports_usage_and_survives_tools(catalog, synth):
    """The production path: streamed text, tool calls and the usage meter together."""
    from pydantic_ai.models.function import DeltaToolCall

    async def stream_fn(messages, info):
        if returned(messages, "describe_module"):
            yield "The patch has "
            yield "a reverb."
        else:
            yield {0: DeltaToolCall(name="describe_module", json_args='{"type": "reverb"}')}

    seen = []
    res = Resources(model=FunctionModel(stream_function=stream_fn), catalog=catalog, stream=True, on_usage=seen.append)
    ev = collect(res, request("what is in my patch?", synth))
    assert ev[-1] == ("done", {"reason": "final"}), ev[-3:]
    assert "".join(d["delta"] for k, d in ev if k == "text") == "The patch has a reverb."
    assert len(seen) == 2 and all(hasattr(u, "input_tokens") for u in seen)


def test_the_run_log_has_everything(catalog, synth):
    rows = []
    res = Resources(model=scripted(("propose_changes", INSERT), "Added a chorus."), catalog=catalog, stream=False)

    async def go():
        return [e async for e in run_chat(res, request("add a chorus before the output", synth), record=lambda k, d: rows.append((k, d)))]

    asyncio.run(go())
    kinds_ = [k for k, _ in rows]
    assert kinds_[0] == "run_start" and kinds_.count("model_call") == 2 and "tool_call" in kinds_ and "answer" in kinds_
    start = rows[0][1]
    assert start["skill"] == "patch" and start["prompt"].startswith("add a chorus") and start["snapshot"]["patch"]["nodes"]
    calls = [d for k, d in rows if k == "model_call"]
    assert calls[0]["request"] and calls[0]["response"]["parts"][0]["tool_name"] == "propose_changes" and "usage" in calls[0]
    assert "instructions" in calls[0]["request"][0] and "propose_changes" in calls[0]["tools"]
    tool = next(d for k, d in rows if k == "tool_call")
    assert tool["tool"] == "propose_changes" and tool["args"]["summary"] and tool["result"]["ok"] and not tool["retry"]
    names = [d["name"] for k, d in rows if k == "event"]
    assert "changeset" in names and names[-1] == "done"
    assert next(d for k, d in rows if k == "answer")["text"] == "Added a chorus."


def test_the_run_log_records_retries_and_streaming(catalog, synth):
    rows = []
    bad = {"ops": [{"op": "connect", "from_node": "vca", "from_jack": "zzz", "to_node": "out", "to_jack": "l"}], "summary": "x"}
    res = Resources(model=scripted(("propose_changes", bad), ("propose_changes", INSERT), "ok"), catalog=catalog, stream=False)

    async def go():
        return [e async for e in run_chat(res, request("add a chorus before the output", synth), record=lambda k, d: rows.append((k, d)))]

    asyncio.run(go())
    tools = [d for k, d in rows if k == "tool_call"]
    assert [t["retry"] for t in tools] == [True, False] and "no output 'zzz'" in tools[0]["error"]


def test_budget_filter_removes_lookup_tools_near_the_limit():
    import asyncio
    from types import SimpleNamespace
    from bleep_agent.runner import Resources, _budget_prepare

    res = Resources(model=None, catalog=None, max_steps=20)  # type: ignore[arg-type]
    prepare = _budget_prepare(res)
    defs = [SimpleNamespace(name=n) for n in ("describe_module", "search_docs", "propose_changes", "ask_user")]

    def names(used: int) -> list[str]:
        ctx = SimpleNamespace(usage=SimpleNamespace(requests=used))
        return [t.name for t in asyncio.run(prepare(ctx, defs))]

    assert len(names(5)) == 4
    assert names(16) == ["propose_changes", "ask_user"]
    assert names(19) == []


def test_tool_schemas_are_slimmed_without_losing_fields():
    import json

    from bleep_agent import skills, tools
    from bleep_agent.runner import _slim_schema

    schema = {"type": "object", "title": "Args", "properties": {"title": {"type": "string", "title": "Title"}, "node": {"anyOf": [{"type": "string"}, {"type": "null"}], "default": None, "title": "Node", "description": "which"}},
              "required": ["title"]}
    slim = _slim_schema(schema)
    assert slim == {"type": "object", "properties": {"title": {"type": "string"}, "node": {"type": "string", "description": "which"}}, "required": ["title"]}  # a property *named* title stays
    ts = tools.function_toolset(list(skills.SKILLS["design"].funcs))
    before = sum(len(json.dumps(t.tool_def.parameters_json_schema)) for t in ts.tools.values())
    after = sum(len(json.dumps(_slim_schema(t.tool_def.parameters_json_schema))) for t in ts.tools.values())
    assert after < 0.9 * before

    def titles(x):  # string-valued "title" keys are pydantic's; a property named title has a dict value
        return (isinstance(x, dict) and any((k == "title" and isinstance(v, str)) or titles(v) for k, v in x.items())) or (isinstance(x, list) and any(titles(i) for i in x))
    assert titles(ts.tools["propose_changes"].tool_def.parameters_json_schema) and not titles(_slim_schema(ts.tools["propose_changes"].tool_def.parameters_json_schema))
    assert set(ts.tools["propose_changes"].tool_def.parameters_json_schema["properties"]) == set(_slim_schema(ts.tools["propose_changes"].tool_def.parameters_json_schema)["properties"])


def test_docs_tools_hand_out_ready_citations(catalog, synth, repo, tmp_path):
    from types import SimpleNamespace as NS

    from bleep_agent.tools import Deps, describe_module, read_doc, search_docs

    out = tmp_path / "docs.sqlite"
    build_index(repo, out, None, log=lambda *_: None)
    deps = Deps(patch=synth, catalog=catalog, docs=DocsIndex(out))
    ctx = NS(deps=deps)
    hits = asyncio.run(search_docs(ctx, "how do I sign a module"))
    assert hits and all(h["cite_as"] == f"[{h['title']}]({h['url']})" for h in hits)
    text = asyncio.run(read_doc(ctx, hits[0]["id"]))
    assert "Cite as: [" in text and hits[0]["url"] in text and "Sources:" not in text
    d = asyncio.run(describe_module(ctx, "vca"))
    assert d["cite_as"].startswith("[") and "/modules/vca/" in d["cite_as"] and "#" not in d["cite_as"]
