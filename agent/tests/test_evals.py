# SPDX-License-Identifier: MIT
import asyncio
import json
from pathlib import Path

import pytest

from bleep_agent.cache import Cache, CacheMiss
from bleep_agent.docs_index import DocsIndex, build_index
from bleep_agent.embeddings import CachedEmbeddingModel, HashingEmbeddingModel, embed_sync
from bleep_agent.evals.cases import Case, load_cases
from bleep_agent.evals.generate import gen_compose, gen_design, gen_diagnose, gen_panel, gen_patch
from bleep_agent.evals.harness import run_case, run_many
from bleep_agent.evals.report import load_results, render, compare, wilson
from bleep_agent.evals.retrieval import evaluate_retrieval
from helpers import scripted


def test_all_shipped_cases_load(library, catalog):
    cases = load_cases()
    assert len(cases) >= 150
    assert {c.skill for c in cases} == {"docs", "diagnose", "patch", "panel", "compose", "design"}
    assert len({c.id for c in cases}) == len(cases)
    for c in cases:
        c.load_patch(library)


def test_diagnose_cases_have_ground_truth(library, catalog):
    from bleep_agent.patch import Patch
    from bleep_agent.sim import simulate

    for c in gen_diagnose(library, catalog):
        before = c.load_patch(library)
        if any(k["kind"] == "fixes_fault" for k in c.checks):
            assert not simulate(before, catalog).audible, c.id
        assert simulate(Patch(library.by_id[c.patch[7:]].preset), catalog).audible, c.id


def test_generators_make_the_documented_amounts(library, catalog):
    assert len(gen_patch(library, catalog)) == 40 and len(gen_panel(library, catalog)) == 25
    assert len(gen_compose(library, catalog)) == 25 and len(gen_design(library, catalog)) == 20


def run(case, model, cache, library, catalog, **kw):
    return asyncio.run(run_case(case, model=model, model_name="scripted", catalog=catalog, lib=library, docs=None, cache=cache, **kw))


def case_by_id(cid):
    return next(c for c in load_cases() if c.id == cid)


def test_patch_case_passes_with_a_correct_solution_and_replays_from_cache(library, catalog, tmp_path):
    case = case_by_id("patch-insert-fx-01")
    combo = [c for c in case.checks if c["kind"] == "fx_before_output"][0]["types"]
    p = case.load_patch(library)
    out = p.of_type("audio-out")[0]["id"]
    src = p.cables_to(out)[0]["from"]["node"]
    ops, nxt = [], out  # last effect first (next to the output), earlier ones upstream of it
    for i, t in enumerate(reversed(combo)):
        ops.append({"op": "insert_on_cable", "from_node": src, "to_node": nxt, "type": t, "ref": f"fx{i}"})
        nxt = f"$fx{i}"
    cache = Cache(tmp_path / "c.sqlite", "use")
    model = scripted(("propose_changes", {"ops": ops, "summary": "fx"}), "Added the effects.")
    r1 = run(case, model, cache, library, catalog)
    assert r1["success"], r1["checks"]
    assert r1["calls"] == 2 and r1["cached_calls"] == 0 and r1["tokens_in"] > 0
    # the same run again is answered entirely from the cache, with the same numbers
    r2 = run(case, scripted("never used"), cache, library, catalog)
    assert r2["cached_calls"] == 2 and r2["success"] and r2["tokens_in"] == r1["tokens_in"] and abs(r2["latency"] - r1["latency"]) < 1e-9
    # another repeat is a separate sample
    r3 = run(case, scripted(("propose_changes", {"ops": ops, "summary": "fx"}), "again"), cache, library, catalog, repeat=1)
    assert r3["cached_calls"] == 0
    # replay-only fails on a miss
    ro = Cache(tmp_path / "c.sqlite", "replay-only")
    r4 = run(case, scripted("x"), ro, library, catalog, repeat=9)
    assert not r4["success"] and r4["errors"]


def test_run_logs_are_written_as_json_and_markdown(library, catalog, tmp_path):
    from bleep_agent.evals.runlog import write_index, write_run_logs

    case = case_by_id("patch-insert-fx-01")
    p = case.load_patch(library)
    out = p.of_type("audio-out")[0]["id"]
    src = p.cables_to(out)[0]["from"]["node"]
    ops = [{"op": "insert_on_cable", "from_node": src, "to_node": out, "type": "delay", "ref": "fx0"}]
    model = scripted(("propose_changes", {"ops": ops, "summary": "fx"}), "Added a delay.")
    r = run(case, model, Cache(tmp_path / "c.sqlite", "use"), library, catalog)
    log = r.pop("_log")
    base = write_run_logs(tmp_path / "logs", r, log)
    doc = json.loads(base.with_suffix(base.suffix + ".json").read_text())
    assert doc["format"] == "bleep-benchmark-run" and doc["result"]["case"] == case.id
    assert doc["transcript"][0] == {"role": "user", "text": case.query} and doc["transcript"][1]["text"] == "Added a delay."
    kinds = [row["kind"] for row in doc["runs"][0]["rows"]]
    assert kinds.count("model_call") == 2 and "tool_call" in kinds and kinds[0] == "run_start"
    calls = [row["data"] for row in doc["runs"][0]["rows"] if row["kind"] == "model_call"]
    assert "request" in calls[0] and "request" not in calls[1] and calls[1]["request_first_messages_same_as_previous_call"] >= 1
    md = base.with_suffix(base.suffix + ".md").read_text()
    assert md.startswith(f"# {case.id}") and "**model call 2**" in md and "propose_changes" in md and "Added a delay." in md
    write_index(tmp_path / "logs", [r])
    assert f"{case.id}.r0.md" in (tmp_path / "logs" / "index.md").read_text()


def test_report_states_the_cost_with_and_without_cache(library, catalog, tmp_path):
    from bleep_agent.evals.report import benchmark_cost

    case = case_by_id("patch-insert-fx-01")
    p = case.load_patch(library)
    out = p.of_type("audio-out")[0]["id"]
    src = p.cables_to(out)[0]["from"]["node"]
    ops = [{"op": "insert_on_cable", "from_node": src, "to_node": out, "type": "delay", "ref": "fx0"}]
    cache = Cache(tmp_path / "c.sqlite", "use")
    fresh = run(case, scripted(("propose_changes", {"ops": ops, "summary": "fx"}), "ok"), cache, library, catalog)
    replay = run(case, scripted("never used"), cache, library, catalog)
    assert fresh["paid_in"] == fresh["tokens_in"] > 0 and replay["paid_in"] == replay["paid_out"] == 0
    name = fresh["model"]
    prices = {"models": {name.split(":", 1)[-1]: {"input": 1.0, "output": 2.0}}}
    (row,) = benchmark_cost([fresh, replay], prices)
    full = (2 * fresh["tokens_in"] + 2 * fresh["tokens_out"] * 2) / 1e6
    assert row["full"] == pytest.approx(full) and row["spent"] == pytest.approx(full / 2) and row["calls"] == 4 and row["paid_calls"] == 2
    text = render([fresh, replay], prices, {"judge": ""})
    assert "## Benchmark cost" in text and "cost without cache" in text and "**total**" in text
    assert "n/a" in render([fresh, replay], {"models": {}}, None).split("## Overall")[0]


def test_wrong_solution_fails_the_right_checks(library, catalog, tmp_path):
    case = case_by_id("patch-insert-fx-01")
    r = run(case, scripted("I did it."), Cache(None, "use"), library, catalog)
    assert not r["success"] and any(not c["ok"] for c in r["checks"] if c["kind"] == "fx_before_output")


def test_compose_case_checks_the_pattern(library, catalog):
    case = case_by_id("compose-01")
    p = case.load_patch(library)
    seq = p.of_type("step-sequencer")[0]["id"]
    notes = [0, 0, 12, 0, 3, 0, 7, 12, 0, 0, 12, 0, 3, 10, 7, 5]
    steps = [{"g": 1 if i % 4 != 3 or i == 15 else 0, "p": notes[i], "v": 120 if i in (2, 6, 10, 14) else 85} for i in range(16)]
    steps[7]["g"] = 2
    r = run(case, scripted(("set_pattern", {"node": seq, "steps": steps, "length": 16}), "Here is an acid line."), Cache(None, "off"), library, catalog)
    pat = [c for c in r["checks"] if c["kind"] == "pattern"][0]
    assert pat["ok"], pat
    assert r["success"], r["checks"]


def test_panel_case(library, catalog):
    case = case_by_id("panel-build-01")
    p = case.load_patch(library)
    assert not p.data.get("panels")
    envs = p.of_type("adsr")
    sections = [{"title": "Env", "node": envs[0]["id"], "params": ["attack", "release"]}] if envs else []
    key = [c for c in case.checks if c["kind"] == "panel_covers"][0]["params"]
    for ref in key:
        nid, _, pid = ref.partition(".")
        if not any(s["node"] == nid for s in sections):
            sections.append({"title": nid, "node": nid, "params": [pid]})
        else:
            next(s for s in sections if s["node"] == nid)["params"].append(pid)
    for s in sections:
        s["params"] = list(dict.fromkeys(s["params"]))
    extra = [n for n in p.nodes if n["type"] in ("lfo", "filter", "reverb", "oscillator", "additive-osc", "vca") and n["id"] not in {s["node"] for s in sections}]
    for n in extra[:4]:
        t = catalog.get(n["type"])
        sections.append({"title": n["id"], "node": n["id"], "params": [q.id for q in t.params if q.kind == "float"][:4]})
    plan = {"id": "p", "name": "Panel", "sections": sections}
    r = run(case, scripted(("build_panel", {"plan": plan}), "Built the panel."), Cache(None, "off"), library, catalog)
    assert [c for c in r["checks"] if c["kind"] == "panel_valid"][0]["ok"], r["checks"]


def test_report_and_compare(library, catalog, tmp_path):
    case = case_by_id("patch-param-01")
    p = case.load_patch(library)
    rv = [c for c in case.checks if c["kind"] == "param_changed"][0]
    good = scripted(("propose_changes", {"ops": [{"op": "set_param", "node": rv["node"], "param": "size", "value": 0.9}], "summary": "bigger"}), "Made it bigger.")
    results = asyncio.run(run_many([case], {"good": good, "bad": scripted("no")}, repeats=2, concurrency=2, catalog=catalog, lib=library, docs=None, cache=Cache(None, "off"), judge_model=None))
    assert {r["model"] for r in results} == {"good", "bad"}
    ok = {r["model"]: r["success"] for r in results}
    assert ok["good"] is True and ok["bad"] is False
    text = render(results, {"version": 1, "models": {}}, {"run": "t", "repeats": 2})
    assert "| good |" in text and "n/a" in text and "Failures" in text
    (tmp_path / "results.jsonl").write_text("\n".join(json.dumps(r) for r in results))
    assert "Regressions" in compare(load_results(tmp_path), results)
    lo, hi = wilson(8, 10)
    assert 0.4 < lo < 0.8 < hi < 1.0


def test_judge_is_cached_and_scored(library, catalog, tmp_path):
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    case = case_by_id("docs-01")
    seen = []

    def judge_fn(messages, info):
        seen.append(1)
        name = info.output_tools[0].name
        return ModelResponse(parts=[ToolCallPart(name, {"score": 5, "reasoning": "good", "issues": []})])

    cache = Cache(tmp_path / "c.sqlite", "use")
    kw = dict(case=case, model=scripted("Press Tab. See /docs/musicians/reference/shortcuts/"), model_name="s", catalog=catalog, lib=library, docs=None, cache=cache,
              judge_model=FunctionModel(judge_fn))
    r = asyncio.run(run_case(**kw))
    assert r["judge"]["score"] == 1.0 and r["success"], r["checks"]
    asyncio.run(run_case(**kw))
    assert len(seen) == 1  # the second judgement came from the cache


def test_embedding_cache_and_hybrid_retrieval(catalog, repo, tmp_path):
    cache = Cache(tmp_path / "c.sqlite", "use")
    em = CachedEmbeddingModel(HashingEmbeddingModel(128), cache)
    a = embed_sync(em, ["reverb tail", "filter cutoff"])
    n_before = sum(cache.hits.values())
    b = embed_sync(em, ["reverb tail", "filter cutoff"])
    assert (a == b).all() and sum(cache.hits.values()) == n_before + 2
    out = tmp_path / "docs.sqlite"
    build_index(repo, out, em, log=lambda *_: None)
    idx = DocsIndex(out, em, em.model_name)
    assert idx.hybrid and idx.matrix.shape[1] == 128
    other = DocsIndex(out, HashingEmbeddingModel(64), "hashing-64")
    assert not other.hybrid and "built with" in other.reason  # a different embedding model never mixes
    res = asyncio.run(evaluate_retrieval(idx, [c for c in load_cases(skills=["docs"])]))
    assert set(res) == {"keyword", "vector", "hybrid"}
    assert res["keyword"]["all"]["recall"] >= 0.6, res["keyword"]
    assert res["hybrid"]["all"]["n"] == res["keyword"]["all"]["n"]


def test_cache_modes(tmp_path):
    c = Cache(tmp_path / "a.sqlite", "use")
    c.put("k", "x", {"v": 1})
    assert c.get("k", "x") == {"v": 1}
    assert Cache(tmp_path / "a.sqlite", "refresh").get("k", "x") is None
    with pytest.raises(CacheMiss):
        Cache(tmp_path / "a.sqlite", "replay-only").get("k", "nope")
    assert Cache(None, "off").get("k", "x") is None


def test_checks_accept_typographic_apostrophes_and_any_lfo_waveform(library, catalog):
    from bleep_agent.evals.checks import CHECKS, Ctx
    from bleep_agent.patch import Patch

    case = case_by_id("patch-lfo-cutoff-02")
    before = case.load_patch(library)
    ctx = Ctx(case=case, before=before, after=before, text="The docs don’t describe MP3 export.", catalog=catalog, tools=[], changesets=[], live=[])
    assert CHECKS["says_unknown"](ctx, {})[0]
    spec = next(c for c in case.checks if c["kind"] == "cable")
    after = Patch(before.to_dict())
    fl = after.of_type("filter")[0]["id"]
    from bleep_agent.ops import AddModule, Connect, apply_ops

    apply_ops(after, catalog, [AddModule(type="lfo", ref="l"), Connect(from_node="$l", from_jack="sine", to_node=fl, to_jack="cutoff")])
    ctx2 = Ctx(case=case, before=before, after=after, text="", catalog=catalog, tools=[], changesets=[], live=[])
    assert spec["from"] == "role:lfo.out" and CHECKS["cable"](ctx2, spec)[0]  # sine instead of out: same signal type
    ctx3 = Ctx(case=case, before=before, after=before, text="", catalog=catalog, tools=[], changesets=[], live=[])
    assert not CHECKS["cable"](ctx3, spec)[0]


def _fake(case, skill, model, ok, tin=1000, tout=100, lat=2.0, calls=3, why="pattern: no repeating motif"):
    return {"case": case, "skill": skill, "difficulty": "easy", "model": model, "repeat": 0, "success": ok, "score": float(ok),
            "checks": [] if ok else [{"kind": why.split(":")[0], "ok": False, "detail": why}], "errors": [], "answer": "", "changesets": [], "tools": ["a"], "retries": 0,
            "live": [], "calls": calls, "tokens_in": tin, "tokens_out": tout, "latency": lat, "cached_calls": 0, "wall": 1.0, "paid_in": tin, "paid_out": tout}


def test_compare_runs_across_three_runs_on_the_common_cases(tmp_path):
    from bleep_agent.evals.compare import Run, compare_runs, load_run

    price = {"models": {"m": {"input": 1.0, "output": 2.0}}}
    base = [_fake("c1", "compose", "m", False), _fake("c2", "docs", "m", True), _fake("c3", "docs", "m", False), _fake("c4", "panel", "m", False)]
    mid = [_fake("c1", "compose", "m", True, tin=800), _fake("c2", "docs", "m", False, why="cites: none"), _fake("c3", "docs", "m", False)]  # c4 not re-run
    last = [_fake("c1", "compose", "m", True, tin=600), _fake("c2", "docs", "m", True), _fake("c3", "docs", "m", False), _fake("c4", "panel", "m", True)]
    runs = [Run("First", tmp_path / "a", base), Run("Mid", tmp_path / "b", mid, {"run": "r2", "judge": ""}), Run("Last", tmp_path / "c", last)]
    text = compare_runs(runs, price)
    assert "3 (model, case) pairs that every run contains" in text  # c4 is missing from the middle run
    assert "success 33% → 67% (+33 pp)" in text and "input tokens/request 1000 → 867 (-13%)" in text
    assert "## Cases: First → Mid" in text and "## Cases: Mid → Last" in text and "## Case outcomes across all runs" in text
    assert "| gpt" not in text and "`c1`" in text and "cites: none" in text  # c2 regressed in Mid with that reason
    assert "`c3`" in text.split("## Failing in every run")[1]
    assert "pairs of any run" in compare_runs(runs, price, all_cases=True)
    # run directories, 'label=path' and bare paths load
    for d, rows in (("x", base), ("y", last)):
        (tmp_path / d).mkdir()
        (tmp_path / d / "results.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    assert load_run(f"Mine={tmp_path / 'x'}").label == "Mine" and load_run(str(tmp_path / "y")).label == "y"


def test_compare_reads_versions_from_a_lab_notebook(tmp_path):
    from bleep_agent.evals.compare import compare_runs, load_notebook

    for name, ok in (("r1", False), ("r2", True)):
        (tmp_path / name).mkdir()
        (tmp_path / name / "results.jsonl").write_text(json.dumps(_fake("c1", "compose", "m", ok)) + "\n")
    book = {"versions": [{"id": 1, "name": "Baseline", "benchmark": "r1", "changes": ["the start"]},
                         {"id": 2, "name": "Fixed it", "benchmark": "r2", "changes": ["tiled the motif", "second change"]},
                         {"id": 3, "name": "Not run yet", "benchmark": "r3", "changes": []}]}
    nb = tmp_path / "book.json"
    nb.write_text(json.dumps(book))
    runs = load_notebook(nb, [1, 2])
    assert [(r.version_id, r.label) for r in runs] == [(1, "Baseline"), (2, "Fixed it")]
    text = compare_runs(runs, {"models": {}})
    assert "## Versions and what changed" in text and "### 2. Fixed it" in text and "- tiled the motif" in text and "- second change" in text
    assert text.index("### 1. Baseline") < text.index("### 2. Fixed it") < text.index("## Runs")
    with pytest.raises(SystemExit, match="still running"):
        load_notebook(nb)  # asked for by default without a place to note it: an error
    left_out: list[str] = []
    assert [r.version_id for r in load_notebook(nb, skipped=left_out)] == [1, 2] and "version 3 (Not run yet)" in left_out[0]  # a version still running is left out and noted
    with pytest.raises(SystemExit, match="still running"):
        load_notebook(nb, [1, 3], skipped=[])  # but asking for it by id is an error
    with pytest.raises(SystemExit, match="no version"):
        load_notebook(nb, [7])
    # the shipped notebook is valid JSON with unique ids and the fields the script reads
    shipped = json.loads((Path(__file__).resolve().parents[1] / "evals" / "lab-notebook.json").read_text())
    assert [v["id"] for v in shipped["versions"]] == list(range(1, len(shipped["versions"]) + 1))
    assert all(v["name"] and v["benchmark"] and v["changes"] for v in shipped["versions"])


def test_replayed_calls_keep_their_recorded_latency_in_logs_and_run_time(library, catalog, tmp_path):
    import asyncio

    from pydantic_ai.models.wrapper import WrapperModel

    from bleep_agent.evals.report import execution_time, render

    class Slow(WrapperModel):  # a model that takes a while, so the recorded latency is noticeable
        async def request(self, *a, **k):
            await asyncio.sleep(0.15)
            return await super().request(*a, **k)

    case = case_by_id("patch-insert-fx-01")
    p = case.load_patch(library)
    out = p.of_type("audio-out")[0]["id"]
    src = p.cables_to(out)[0]["from"]["node"]
    ops = [{"op": "insert_on_cable", "from_node": src, "to_node": out, "type": "delay", "ref": "fx0"}]
    script = lambda: Slow(scripted(("propose_changes", {"ops": ops, "summary": "fx"}), "ok"))  # noqa: E731
    cache = Cache(tmp_path / "c.sqlite", "use")
    fresh = run(case, script(), cache, library, catalog)
    replay = run(case, script(), cache, library, catalog)
    assert replay["cached_calls"] == 2 and replay["wall"] < 0.1 and replay["latency"] == pytest.approx(fresh["latency"]) and replay["latency"] >= 0.3
    calls = [r["data"] for r in replay["_log"]["runs"][0]["rows"] if r["kind"] == "model_call"]
    assert all(c["replayed"] and c["latency"] >= 0.1 for c in calls)  # the recorded latency, not the milliseconds the replay took
    assert not any(r["data"].get("replayed") for r in fresh["_log"]["runs"][0]["rows"] if r["kind"] == "model_call")
    # what a fresh execution takes: the recorded model time plus the non-model time, even for a run answered from the cache
    assert replay["duration"] >= replay["latency"] and fresh["duration"] == pytest.approx(replay["duration"], abs=0.3)
    et = execution_time([fresh, replay], {"concurrency": 2, "wall_seconds": 5.0})
    assert et["llm"] == pytest.approx(fresh["latency"] + replay["latency"]) and et["replayed_llm"] == pytest.approx(replay["latency"])
    assert et["estimate"] == pytest.approx(et["sequential"] / 2) and et["wall"] == 5.0
    text = render([fresh, replay], {"models": {}}, {"concurrency": 2, "wall_seconds": 5.0})
    assert "## Benchmark execution time" in text and "this execution (real wall time) | 5.0s" in text
    old = {k: v for k, v in replay.items() if k not in ("duration", "cached_latency")}
    assert execution_time([old])["sequential"] is None and "n/a" in render([old], {"models": {}}, None).split("## Overall")[0]


def test_fx_check_accepts_the_effects_on_any_path_into_the_output(library, catalog):
    from bleep_agent.evals.checks import CHECKS, Ctx
    from bleep_agent.patch import Patch

    def node(i, t):
        return {"id": i, "type": t, "name": i, "x": 0, "y": 0, "parent": "", "params": {}}

    def cab(i, a, aj, b, bj):
        return {"id": i, "from": {"node": a, "jack": aj}, "to": {"node": b, "jack": bj}, "amount": 1.0}

    # drums and a synth meet in a mixer; the delay sits on the synth path only
    board = {"format": 1, "nodes": [node("kick", "punch-kick"), node("osc", "oscillator"), node("dly", "delay"), node("mix", "audio-mixer"), node("out", "audio-out")],
             "cables": [cab("c1", "kick", "l", "mix", "in1l"), cab("c2", "kick", "r", "mix", "in1r"), cab("c3", "osc", "out", "dly", "l"), cab("c4", "osc", "out", "dly", "r"),
                        cab("c5", "dly", "l", "mix", "in2l"), cab("c6", "dly", "r", "mix", "in2r"), cab("c7", "mix", "outl", "out", "l"), cab("c8", "mix", "outr", "out", "r")]}
    case = case_by_id("patch-insert-fx-01")
    p = Patch(board)
    ctx = Ctx(case=case, before=p, after=p, text="", catalog=catalog, tools=[], changesets=[], live=[])
    assert CHECKS["fx_before_output"](ctx, {"types": ["delay"]})[0]  # the drum path comes first in the mixer, the synth path has the delay
    ok, why = CHECKS["fx_before_output"](ctx, {"types": ["delay", "reverb"]})
    assert not ok and "no signal path" in why
    assert not CHECKS["fx_before_output"](ctx, {"types": ["oscillator", "delay", "audio-mixer", "chorus"]})[0]  # order matters
    assert CHECKS["fx_before_output"](ctx, {"types": ["oscillator", "delay", "audio-mixer"]})[0]


def test_cached_tokens_are_backfilled_from_the_logs_of_older_runs(tmp_path):
    from bleep_agent.evals.report import load_results, stats
    from bleep_agent.evals.runlog import write_run_logs

    old = _fake("c1", "compose", "m", True, tin=1000)
    del old["paid_in"], old["paid_out"]  # a run from before the accounting existed
    rows = [{"id": 1, "at": "2026-10-18T10:00:00+00:00", "kind": "model_call", "data": {"latency": 1.0, "request": [], "response": {"parts": [], "usage": {"input_tokens": 600, "cache_read_tokens": 400}}}},
            {"id": 2, "at": "2026-10-18T10:00:01+00:00", "kind": "model_call", "data": {"latency": 1.0, "request": [], "response": {"parts": [], "usage": {"input_tokens": 400, "cache_read_tokens": 100}}}}]
    write_run_logs(tmp_path / "logs", old, {"case": {}, "transcript": [], "runs": [{"run_id": "r", "rows": rows}]})
    (tmp_path / "results.jsonl").write_text(json.dumps(old) + "\n")
    (r,) = load_results(tmp_path)
    assert r["cached_in"] == 500
    assert stats([r], {"models": {"m": {"input": 1.0, "cached_input": 0.1, "output": 2.0}}}, "m")["provider_cache"] == 0.5
    (tmp_path / "other").mkdir()
    (tmp_path / "other" / "results.jsonl").write_text(json.dumps(old) + "\n")
    assert "cached_in" not in load_results(tmp_path / "other")[0]  # no logs, nothing to take it from


def test_layout_check_flags_overlaps_and_backward_cables(library, catalog):
    from bleep_agent.evals.checks import CHECKS, Ctx
    from bleep_agent.ops import AddModule, Connect, apply_ops
    from bleep_agent.patch import Patch

    case = case_by_id("design-01")
    assert any(k["kind"] == "layout" for k in case.checks)
    before = Patch({"format": 1, "nodes": [{"id": "keys", "type": "keyboard", "name": "k", "x": 40, "y": 40, "parent": "", "params": {}}], "cables": []})

    def check(after):
        return CHECKS["layout"](Ctx(case=case, before=before, after=after, text="", catalog=catalog, tools=[], changesets=[], live=[]), {})

    good = Patch(before.to_dict())
    apply_ops(good, catalog, [AddModule(type="oscillator", ref="o"), Connect(from_node="keys", from_jack="pitch", to_node="$o", to_jack="pitch")])
    assert check(good)[0]
    new = next(n for n in good.nodes if n["type"] == "oscillator")
    on_top = Patch(good.to_dict())
    on_top.node(new["id"])["x"], on_top.node(new["id"])["y"] = 60, 60  # on the keyboard
    ok, why = check(on_top)
    assert not ok and "on top of another" in why
    backwards = Patch(good.to_dict())
    backwards.node(new["id"])["x"] = 0  # left of the keyboard that feeds it
    backwards.node("keys")["x"] = 600
    ok, why = check(backwards)
    assert not ok and "0% of 1 cables run left to right" in why
