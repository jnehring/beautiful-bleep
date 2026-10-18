# SPDX-License-Identifier: MIT
"""Run one case against one model like a user would, with the browser simulated; score it."""
from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from pydantic_ai.models import Model

from ..cache import Cache
from ..catalog import Catalog
from ..docs_index import DocsIndex
from ..ops import apply_primitives
from ..patch import Patch
from ..presets import PresetLibrary
from ..protocol import ChatMessage, ChatRequest, Resume, LiveResult, Snapshot
from ..runner import Resources, run_chat
from .caching import CachingModel
from .cases import Case
from .checks import Ctx, run_checks
from .judge import judge, rubric_text
from .runlog import RunRecorder, write_index, write_run_logs
from .simclient import SimClient


def _summary_for_judge(case: Case, ctx: Ctx, cat: Catalog) -> str:
    bits = [f"Changes made: {[cs.get('summary') for cs in ctx.changesets]}"]
    if case.skill in ("design", "patch", "compose"):
        bits.append("Patch after:\n" + ctx.after.summary(cat))
    if case.skill == "panel":
        bits.append("Panels after: " + str(ctx.after.data.get("panels", []))[:4000])
    if case.gold:
        bits.append(f"Reference: {case.gold}")
    return "\n".join(bits)


async def run_case(case: Case, *, model: Model, model_name: str, catalog: Catalog, lib: PresetLibrary | None, docs: DocsIndex | None,
                   cache: Cache, repeat: int = 0, judge_model: Model | None = None, max_pauses: int = 6) -> dict[str, Any]:
    t_wall = time.perf_counter()
    before = case.load_patch(lib)
    cur = before.copy()
    cm = CachingModel(model, cache, salt=f"repeat={repeat}")
    tools: list[tuple[str, bool]] = []
    res = Resources(model=cm, catalog=catalog, presets=lib, docs=docs, stream=False, max_steps=14, state_secret=b"eval",
                    trace=lambda t, r: tools.append((t, r)))
    client = SimClient(lambda: cur, catalog, case.env)
    text, errors, changesets, live_names = [], [], [], []
    req = ChatRequest(messages=[ChatMessage(role="user", content=case.query)],
                      snapshot=Snapshot(patch=cur.to_dict(), selection=case.selection, environment=client.handle("get_environment", {})),
                      mode=case.mode if case.mode in ("ask", "auto") else "auto")
    pauses = 0
    runs: list[dict[str, Any]] = []  # one entry per request to the agent (a pause for a browser tool starts the next one)
    while True:
        pending, token = [], None
        rec = RunRecorder()
        runs.append({"run_id": f"{case.id}.{model_name}.r{repeat}.{pauses}", "rows": rec.rows})
        async for kind, d in run_chat(res, req, record=rec):
            if kind == "text":
                text.append(d["delta"])
            elif kind == "changeset":
                changesets.append(d)
                apply_primitives(cur, d["ops"])  # the simulated user approves everything
            elif kind == "live":
                pending.append(d)
                live_names.append(d["tool"])
            elif kind == "pause":
                token = d["token"]
            elif kind == "error":
                errors.append(d)
        if token is None or pauses >= max_pauses:
            break
        pauses += 1
        results = [LiveResult(call_id=d["call_id"], result=client.handle(d["tool"], d["args"])) for d in pending]
        req = ChatRequest(snapshot=Snapshot(patch=cur.to_dict(), selection=case.selection, environment=client.handle("get_environment", {})),
                          mode=req.mode, resume=Resume(token=token, results=results))
    answer = "".join(text)
    ctx = Ctx(case=case, before=before, after=cur, text=answer, catalog=catalog, tools=tools, changesets=changesets, live=live_names)
    checks = run_checks(ctx, case.checks)
    ok = all(c["ok"] for c in checks) and not errors
    out: dict[str, Any] = {
        "case": case.id, "skill": case.skill, "difficulty": case.difficulty, "model": model_name, "repeat": repeat,
        "success": ok, "score": (sum(c["ok"] for c in checks) / len(checks)) if checks else float(not errors),
        "checks": checks, "errors": errors, "answer": answer, "changesets": [c["summary"] for c in changesets],
        "tools": [t for t, _ in tools], "retries": sum(1 for _, r in tools if r), "live": live_names,
        "paid_in": sum(c["input"] for c in cm.calls if not c["cached"]), "paid_out": sum(c["output"] for c in cm.calls if not c["cached"]),  # what this run really spent
        "cached_in": sum(c["provider_cached"] for c in cm.calls),  # input tokens the provider served from its prompt cache (as recorded when the call was made)
        "paid_cached_in": sum(c["provider_cached"] for c in cm.calls if not c["cached"]),
        "calls": len(cm.calls), "tokens_in": sum(c["input"] for c in cm.calls), "tokens_out": sum(c["output"] for c in cm.calls),
        "latency": sum(c["latency"] for c in cm.calls), "cached_calls": sum(1 for c in cm.calls if c["cached"]),
        "wall": time.perf_counter() - t_wall,
    }
    # `wall` is what this execution really took (almost nothing for replayed calls); `duration` is what a fresh execution takes: the recorded model
    # latencies plus everything else the run spent (tools, simulation), i.e. the wall time minus the time spent waiting on calls made just now.
    out["cached_latency"] = sum(c["latency"] for c in cm.calls if c["cached"])
    out["duration"] = out["latency"] + max(0.0, out["wall"] - sum(c["latency"] for c in cm.calls if not c["cached"]))
    if case.judge and judge_model is not None:
        jm = CachingModel(judge_model, cache, salt="judge")
        try:
            v = await judge(jm, rubric_text(case.judge), case.query, answer, _summary_for_judge(case, ctx, catalog))
            out["judge"] = {"score": v.normalised, "raw": v.score, "reasoning": v.reasoning, "issues": v.issues}
            out["judge_tokens"] = sum(c["input"] + c["output"] for c in jm.calls)
            out["judge_usage"] = {"calls": len(jm.calls), "tokens_in": sum(c["input"] for c in jm.calls), "tokens_out": sum(c["output"] for c in jm.calls),
                                  "cached_in": sum(c["provider_cached"] for c in jm.calls), "paid_cached_in": sum(c["provider_cached"] for c in jm.calls if not c["cached"]),
                                  "paid_in": sum(c["input"] for c in jm.calls if not c["cached"]), "paid_out": sum(c["output"] for c in jm.calls if not c["cached"]),
                                  "paid_calls": sum(1 for c in jm.calls if not c["cached"]),
                                  "latency": sum(c["latency"] for c in jm.calls), "cached_latency": sum(c["latency"] for c in jm.calls if c["cached"])}
            out["duration"] += out["judge_usage"]["latency"]
        except Exception as e:  # noqa: BLE001
            out["judge"] = {"error": f"{type(e).__name__}: {e}"}
    # not part of results.jsonl: run_many writes it to the log files and drops it
    out["_log"] = {"case": case.model_dump(exclude={"checks", "patch", "mutate"}) | {"checks_spec": case.checks},
                   "transcript": [{"role": "user", "text": case.query},
                                  {"role": "assistant", "text": answer, "changesets": changesets}],
                   "runs": runs}
    return out


async def run_many(cases: list[Case], models: dict[str, Model], *, repeats: int, concurrency: int = 4,
                   progress: Callable[[dict[str, Any]], None] | None = None, log_dir: Path | None = None, **kw: Any) -> list[dict[str, Any]]:
    sem = asyncio.Semaphore(concurrency)
    results: list[dict[str, Any]] = []

    async def one(c: Case, name: str, m: Model, r: int) -> None:
        async with sem:
            try:
                res = await run_case(c, model=m, model_name=name, repeat=r, **kw)
                log = res.pop("_log", None)
                if log and log_dir:
                    write_run_logs(log_dir, res, log)  # as each run ends, so an interrupted benchmark keeps what it has
                results.append(res)
            except Exception as e:  # noqa: BLE001  (a broken case must not stop the run; it counts as a failure)
                results.append({"case": c.id, "skill": c.skill, "difficulty": c.difficulty, "model": name, "repeat": r, "success": False, "score": 0.0,
                                "checks": [], "errors": [{"code": "harness", "message": f"{type(e).__name__}: {e}"}], "answer": "",
                                "changesets": [], "tools": [], "retries": 0, "live": [], "calls": 0, "tokens_in": 0, "tokens_out": 0,
                                "latency": 0.0, "cached_calls": 0, "wall": 0.0})
            if progress:
                progress(results[-1])

    await asyncio.gather(*[one(c, n, m, r) for c in cases for n, m in models.items() for r in range(repeats)])
    results.sort(key=lambda x: (x["model"], x["skill"], x["case"], x["repeat"]))
    if log_dir and results:
        write_index(log_dir, results)
    return results
