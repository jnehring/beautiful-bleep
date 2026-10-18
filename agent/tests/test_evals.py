# SPDX-License-Identifier: MIT
import asyncio
import json

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
    r = run(case, scripted(("set_pattern", {"node": seq, "steps": steps}), "Here is an acid line."), Cache(None, "off"), library, catalog)
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
