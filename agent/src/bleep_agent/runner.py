# SPDX-License-Identifier: MIT
"""One chat request -> a stream of events (doc/specs/agent.md §5). Stateless: a paused run is resumed from a signed token."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterable, AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

from pydantic_ai import (Agent, DeferredToolRequests, DeferredToolResults, FunctionToolCallEvent, ModelMessagesTypeAdapter,
                         PartDeltaEvent, PartStartEvent, RunContext, TextPart, TextPartDelta, UsageLimitExceeded, UsageLimits)
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, UserPromptPart
from pydantic_ai.models import Model

from .catalog import Catalog
from .docs_index import DocsIndex
from .models import BudgetExceeded, MeteredModel
from .patch import Patch
from .presets import PresetLibrary
from .protocol import ChatRequest, Event, TokenError, sign_state, verify_state
from .skills import SKILLS, Skill, prompt_text, route
from .tools import Deps, function_toolset, live_toolset

log = logging.getLogger("bleep_agent")
if not log.handlers:  # uvicorn configures only its own loggers; make ours readable in `docker compose logs`
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(levelname)s agent: %(message)s"))
    log.addHandler(_h)
    log.setLevel(logging.INFO)
    log.propagate = False

ACTIVITY = {
    "get_patch": "Looking at the patch", "get_selection": "Looking at the selection", "list_module_types": "Searching modules",
    "describe_module": "Reading about a module", "trace_signal": "Tracing cables", "check_audibility": "Checking why there is no sound",
    "search_presets": "Looking at example patches", "get_preset": "Studying an example patch", "search_docs": "Searching the documentation",
    "read_doc": "Reading the documentation", "propose_changes": "Preparing changes", "set_pattern": "Writing the pattern",
    "build_panel": "Building the panel", "propose_panel": "Preparing the panel", "get_panel": "Reading the panel",
    "get_sequencer": "Reading the sequencer", "get_environment": "Checking your setup", "probe_signals": "Measuring signals",
    "play": "Playing notes", "highlight": "Pointing at it", "ask_user": "Asking you",
}


@dataclass
class Resources:
    """What a run needs besides the request. Built once at start-up."""
    model: Model
    catalog: Catalog
    presets: PresetLibrary | None = None
    docs: DocsIndex | None = None
    state_secret: bytes = b"dev-secret"
    max_steps: int = 20
    stream: bool = True
    on_usage: Callable[[Any], None] | None = None
    check_budget: Callable[[], None] | None = None
    trace: Callable[[str, bool], None] | None = None


def _catalog_index(cat: Catalog) -> str:
    by_cat: dict[str, list[str]] = {}
    for t in cat.types:
        if t.creatable and t.category:
            by_cat.setdefault(t.category, []).append(t.type)
    return "\n".join(f"- {c}: {', '.join(v)}" for c, v in sorted(by_cat.items()))


def build_instructions(skill: Skill, deps: Deps, res: Resources, used: int = 0) -> str:
    parts = [prompt_text("base.md"), prompt_text(skill.prompt)]
    if used >= res.max_steps - 4:
        parts.append(f"# Steps\nYou have used {used} of {res.max_steps} steps. Stop researching now: make the change with what you know, or "
                     "answer and say what is still open. Do not call more lookup tools.")
    parts.append("# Situation\n" + ("Changes you propose are applied to the user's board immediately (they can undo)."
                                    if deps.mode == "auto" else
                                    "Changes you propose are shown to the user, who approves them before they apply."))
    if skill.catalog_index:
        parts.append("# Module types (ids for tools)\n" + _catalog_index(res.catalog))
    if skill.name == "docs" and res.docs is not None:
        parts.append("# Documentation pages (ids for read_doc)\n" + res.docs.contents(7000))
    parts.append("# The user's board right now\n" + deps.patch.summary(res.catalog, selection=deps.selection))
    if deps.env:
        parts.append("# Environment reported by the browser\n" + _short(deps.env))
    return "\n\n".join(parts)


def _short(d: Any, limit: int = 900) -> str:
    import json

    s = json.dumps(d, separators=(",", ":"))
    return s if len(s) <= limit else s[:limit] + "..."


def _history(msgs: list) -> list[ModelMessage]:
    out: list[ModelMessage] = []
    for m in msgs:
        if m.role == "user":
            out.append(ModelRequest(parts=[UserPromptPart(content=m.content)]))
        else:
            out.append(ModelResponse(parts=[TextPart(content=m.content)]))
    return out


async def run_chat(res: Resources, req: ChatRequest, agent_hook: Callable[[Agent], None] | None = None) -> AsyncIterator[Event]:
    """Yield (event, data) pairs until `done`. Never raises: failures become `error` + `done`."""
    queue: asyncio.Queue[Event | None] = asyncio.Queue()

    def emit(kind: str, data: dict[str, Any]) -> None:
        queue.put_nowait((kind, data))

    calls: list[str] = []

    async def worker() -> None:
        try:
            await _run(res, req, emit, agent_hook, calls)
        except BudgetExceeded:
            emit("error", {"code": "budget", "message": "The daily AI budget is used up. It resets at midnight UTC."})
            emit("done", {"reason": "budget"})
        except UsageLimitExceeded as e:
            log.warning("run hit the step limit (%s); tool calls in order: %s", e, " > ".join(calls) or "none")
            emit("error", {"code": "limit", "message": "The assistant took too many steps for this request. Try a smaller request."})
            emit("done", {"reason": "limit"})
        except TokenError as e:
            emit("error", {"code": "invalid", "message": f"This conversation step expired or is invalid ({e}). Please ask again."})
            emit("done", {"reason": "error"})
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log.exception("agent run failed")
            emit("error", {"code": "model", "message": f"The AI service failed: {type(e).__name__}"})
            emit("done", {"reason": "error"})
        finally:
            queue.put_nowait(None)

    task = asyncio.create_task(worker())
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass


async def _run(res: Resources, req: ChatRequest, emit: Callable[[str, dict[str, Any]], None],
               agent_hook: Callable[[Agent], None] | None, calls: list[str] | None = None) -> None:
    calls = calls if calls is not None else []
    snap = req.snapshot
    resume = None
    history: list[ModelMessage] = []
    patch = Patch(snap.patch)
    skill_name = None
    prompt: str | None = None
    results: DeferredToolResults | None = None

    if req.resume is not None:
        state = verify_state(res.state_secret, req.resume.token)
        history = ModelMessagesTypeAdapter.validate_python(state["messages"])
        skill_name = state["skill"]
        if req.mode == "ask":  # the user has not approved earlier proposals yet: keep them in the working copy
            patch = Patch(state["patch"])
        pending = set(state["pending"])
        got = {r.call_id: r.result for r in req.resume.results}
        missing = pending - set(got)
        if missing:
            raise TokenError(f"missing results for {sorted(missing)}")
        results = DeferredToolResults(calls={k: got[k] for k in pending})
        resume = True
    else:
        if not req.messages:
            raise TokenError("no message")
        prompt = req.messages[-1].content
        history = _history(req.messages[:-1])
        skill_name = route(prompt, req.skill)

    skill = SKILLS[skill_name]
    deps = Deps(patch=patch, catalog=res.catalog, presets=res.presets, docs=res.docs, selection=list(snap.selection),
                env=dict(snap.environment), mode=req.mode, skill=skill_name, emit=emit)
    def trace(tool: str, retried: bool) -> None:
        calls.append(tool + ("(retry)" if retried else ""))
        if res.trace:
            res.trace(tool, retried)

    deps.trace = trace
    log.info("run: skill=%s mode=%s resume=%s modules=%d prompt=%r", skill_name, req.mode, bool(resume), len(patch.nodes),
             (prompt or "")[:120])
    model = MeteredModel(res.model, on_usage=res.on_usage, check=res.check_budget) if (res.on_usage or res.check_budget) else res.model
    agent: Agent[Deps, Any] = Agent(
        model, deps_type=Deps, output_type=[str, DeferredToolRequests],
        instructions=lambda ctx: build_instructions(skill, ctx.deps, res, ctx.usage.requests),
        toolsets=[function_toolset(list(skill.funcs)), live_toolset(list(skill.live))] if skill.live else [function_toolset(list(skill.funcs))],
        retries=2)
    if agent_hook:
        agent_hook(agent)
    emit("activity", {"text": {"docs": "Looking up the documentation", "diagnose": "Looking into it", "patch": "Planning the change",
                               "panel": "Planning the panel", "compose": "Planning the pattern", "design": "Planning the sound"}[skill_name]})

    streamed = False

    async def handler(ctx: RunContext[Deps], events: AsyncIterable[Any]) -> None:
        nonlocal streamed
        async for ev in events:
            if isinstance(ev, PartStartEvent) and isinstance(ev.part, TextPart) and ev.part.content:
                streamed = True
                emit("text", {"delta": ev.part.content})
            elif isinstance(ev, PartDeltaEvent) and isinstance(ev.delta, TextPartDelta) and ev.delta.content_delta:
                streamed = True
                emit("text", {"delta": ev.delta.content_delta})
            elif isinstance(ev, FunctionToolCallEvent):
                emit("activity", {"text": ACTIVITY.get(ev.part.tool_name, ev.part.tool_name)})

    result = await agent.run(
        prompt, message_history=history or None, deferred_tool_results=results, deps=deps,
        usage_limits=UsageLimits(request_limit=res.max_steps),
        event_stream_handler=handler if res.stream else None)

    usage = result.usage
    log.info("run done: requests=%d tokens=%d/%d tools: %s", usage.requests, usage.input_tokens, usage.output_tokens, " > ".join(calls) or "none")
    emit("usage", {"input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens, "requests": usage.requests})
    out = result.output
    if isinstance(out, DeferredToolRequests):
        for call in out.calls:
            emit("live", {"call_id": call.tool_call_id, "tool": call.tool_name, "args": call.args_as_dict()})
        token = sign_state(res.state_secret, {
            "messages": ModelMessagesTypeAdapter.dump_python(result.all_messages(), mode="json"),
            "patch": deps.patch.to_dict(), "skill": skill_name, "pending": [c.tool_call_id for c in out.calls]})
        emit("pause", {"token": token})
        emit("done", {"reason": "pause"})
        return
    if not streamed:
        emit("text", {"delta": str(out)})
    emit("done", {"reason": "final"})
