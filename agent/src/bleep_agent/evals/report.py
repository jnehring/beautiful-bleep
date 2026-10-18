# SPDX-License-Identifier: MIT
"""Aggregate results.jsonl into the provider x skill report: success, cost, latency (doc/agent-concept.md §9)."""
from __future__ import annotations

import json
import math
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

from .pricing import cost


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return 0.0, 0.0
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return max(0.0, (c - h) / d), min(1.0, (c + h) / d)


def pctile(xs: list[float], q: float) -> float:
    if not xs:
        return 0.0
    xs = sorted(xs)
    i = (len(xs) - 1) * q
    lo, hi = math.floor(i), math.ceil(i)
    return xs[lo] + (xs[hi] - xs[lo]) * (i - lo)


def load_results(path: Path) -> list[dict[str, Any]]:
    f = path / "results.jsonl" if path.is_dir() else path
    return [json.loads(l) for l in f.read_text().splitlines() if l.strip()]


def stats(rows: list[dict[str, Any]], prices: dict, model: str) -> dict[str, Any]:
    n = len(rows)
    k = sum(r["success"] for r in rows)
    lo, hi = wilson(k, n)
    costs = [cost(prices, model, r["tokens_in"], r["tokens_out"], r.get("cached_in", 0)) for r in rows]
    known = [c for c in costs if c is not None]
    calls = sum(r["calls"] for r in rows)
    tools = sum(len(r["tools"]) for r in rows)
    judged = [r["judge"]["score"] for r in rows if isinstance(r.get("judge"), dict) and "score" in r["judge"]]
    return {
        "n": n, "success": k / n if n else 0.0, "ci": (lo, hi), "score": statistics.fmean(r["score"] for r in rows) if rows else 0.0,
        "judge": statistics.fmean(judged) if judged else None, "judged": len(judged),
        "tokens_in": statistics.fmean(r["tokens_in"] for r in rows) if rows else 0.0,
        "tokens_out": statistics.fmean(r["tokens_out"] for r in rows) if rows else 0.0,
        "cost": statistics.fmean(known) if known and len(known) == n else None,
        "cost_per_success": (sum(known) / k) if known and len(known) == n and k else None,
        "lat50": pctile([r["latency"] for r in rows], 0.5), "lat95": pctile([r["latency"] for r in rows], 0.95),
        "provider_cache": (sum(r.get("cached_in", 0) for r in rows) / sum(r["tokens_in"] for r in rows)) if sum(r["tokens_in"] for r in rows) else 0.0,
        "calls": calls / n if n else 0.0, "retry_rate": (sum(r["retries"] for r in rows) / tools) if tools else 0.0,
        "errors": sum(1 for r in rows if r["errors"]), "cached": (sum(r["cached_calls"] for r in rows) / calls) if calls else 0.0,
    }


def _fmt_cost(x: float | None, digits: int = 4) -> str:
    return "n/a" if x is None else f"${x:.{digits}f}"


def benchmark_cost(results: list[dict[str, Any]], prices: dict, judge: str = "") -> list[dict[str, Any]]:
    """Cost of the whole benchmark, per model and for the judge: without the cache (every call priced as if it had been made) and what this
    run actually spent (only the calls the cache could not answer). None = no price for that model, or a run from before the split was recorded."""
    rows: list[dict[str, Any]] = []

    def row(label: str, calls: int, paid_calls: int, tin: int, tout: int, pin: int | None, pout: int | None, model: str, cin: int = 0, pcin: int = 0) -> None:
        full = cost(prices, model, tin, tout, cin)  # input the provider served from its prompt cache is billed at the cached rate
        spent = cost(prices, model, pin, pout, pcin) if pin is not None and pout is not None else None
        rows.append({"label": label, "calls": calls, "paid_calls": paid_calls, "tokens_in": tin, "tokens_out": tout, "full": full, "spent": spent})

    for m in sorted({r["model"] for r in results}):
        rs = [r for r in results if r["model"] == m]
        known = all("paid_in" in r for r in rs)
        row(m, sum(r["calls"] for r in rs), sum(r["calls"] - r["cached_calls"] for r in rs), sum(r["tokens_in"] for r in rs), sum(r["tokens_out"] for r in rs),
            sum(r["paid_in"] for r in rs) if known else None, sum(r["paid_out"] for r in rs) if known else None, m,
            sum(r.get("cached_in", 0) for r in rs), sum(r.get("paid_cached_in", 0) for r in rs))
    js = [r["judge_usage"] for r in results if isinstance(r.get("judge_usage"), dict)]
    if js and judge:
        row(f"{judge} (judge)", sum(j["calls"] for j in js), sum(j["paid_calls"] for j in js), sum(j["tokens_in"] for j in js), sum(j["tokens_out"] for j in js),
            sum(j["paid_in"] for j in js), sum(j["paid_out"] for j in js), judge, sum(j.get("cached_in", 0) for j in js), sum(j.get("paid_cached_in", 0) for j in js))
    return rows


def _money(x: float | None) -> str:
    return _fmt_cost(x, 2 if x is not None and abs(x) >= 1 else 4)


def _cost_section(results: list[dict[str, Any]], prices: dict, meta: dict[str, Any] | None) -> list[str]:
    rows = benchmark_cost(results, prices, (meta or {}).get("judge", ""))
    out = ["## Benchmark cost", "", "| model | model calls (made now / total) | tokens in / out (total) | cost without cache | cost of this run (with cache) | saved by the cache |",
           "|---|---|---|---|---|---|"]
    for r in rows:
        saved = r["full"] - r["spent"] if r["full"] is not None and r["spent"] is not None else None
        out.append(f"| {r['label']} | {r['paid_calls']} / {r['calls']} | {r['tokens_in']} / {r['tokens_out']} | {_money(r['full'])} | {_money(r['spent'])} | {_money(saved)} |")
    full = [r["full"] for r in rows]
    spent = [r["spent"] for r in rows]
    tf = None if None in full else sum(full)
    ts = None if None in spent else sum(spent)
    out.append(f"| **total** | {sum(r['paid_calls'] for r in rows)} / {sum(r['calls'] for r in rows)} | {sum(r['tokens_in'] for r in rows)} / {sum(r['tokens_out'] for r in rows)} | "
               f"**{_money(tf)}** | **{_money(ts)}** | {_money(tf - ts) if tf is not None and ts is not None else 'n/a'} |")
    out += ["", "Without cache = every model and judge call priced at the price table's rates, as if nothing had been replayed (a fresh run). This run = only the calls "
            "the cache could not answer. Input tokens the provider served from its own prompt cache (as recorded when each call was made) are priced at the `cached_input` rate; runs from before this was recorded count them at the full input rate. Documentation embeddings are not included. `n/a` = no price for that model in prices.yaml.", ""]
    return out


def render(results: list[dict[str, Any]], prices: dict, meta: dict[str, Any] | None = None) -> str:
    by: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    by_model: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in results:
        by[(r["model"], r["skill"])].append(r)
        by_model[r["model"]].append(r)
    models = sorted(by_model)
    skills = sorted({r["skill"] for r in results})
    out = ["# Evaluation report", ""]
    if meta:
        out += [f"- run: `{meta.get('run', '')}`, {meta.get('date', '')}, repeats {meta.get('repeats', '?')}, cache `{meta.get('cache', '?')}`, "
                f"price table v{prices.get('version', '?')}", ""]
    out += _cost_section(results, prices, meta)
    out += ["## Overall", "", "| model | runs | success (95% CI) | check score | tokens in / out | provider cache hit | cost / request | cost / success | latency p50 / p95 | model calls | retried tool calls | errors | replayed |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for m in models:
        s = stats(by_model[m], prices, m)
        out.append(f"| {m} | {s['n']} | {s['success']:.0%} ({s['ci'][0]:.0%}-{s['ci'][1]:.0%}) | {s['score']:.2f} | {s['tokens_in']:.0f} / {s['tokens_out']:.0f} | {s['provider_cache']:.0%} | "
                   f"{_fmt_cost(s['cost'])} | {_fmt_cost(s['cost_per_success'])} | {s['lat50']:.1f}s / {s['lat95']:.1f}s | {s['calls']:.1f} | {s['retry_rate']:.0%} | {s['errors']} | {s['cached']:.0%} |")
    out += ["", "## By skill", "", "Success = every deterministic check passed. Judge = mean rubric score 0..1 (soft; not part of success).", "",
            "| skill | model | runs | success (95% CI) | judge | tokens in / out | cost / request | cost / success | latency p50 |", "|---|---|---|---|---|---|---|---|---|"]
    for sk in skills:
        for m in models:
            rows = by.get((m, sk))
            if not rows:
                continue
            s = stats(rows, prices, m)
            j = f"{s['judge']:.2f} (n={s['judged']})" if s["judge"] is not None else "-"
            out.append(f"| {sk} | {m} | {s['n']} | {s['success']:.0%} ({s['ci'][0]:.0%}-{s['ci'][1]:.0%}) | {j} | {s['tokens_in']:.0f} / {s['tokens_out']:.0f} | "
                       f"{_fmt_cost(s['cost'])} | {_fmt_cost(s['cost_per_success'])} | {s['lat50']:.1f}s |")
    by_diff: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for r in results:
        by_diff[(r["model"], r.get("difficulty", "?"))].append(r)
    out += ["", "## By difficulty", "", "| model | " + " | ".join(sorted({d for _, d in by_diff})) + " |", "|---|" + "---|" * len({d for _, d in by_diff})]
    for m in models:
        cells = []
        for d in sorted({d for _, d in by_diff}):
            rows = by_diff.get((m, d), [])
            cells.append(f"{sum(r['success'] for r in rows) / len(rows):.0%} (n={len(rows)})" if rows else "-")
        out.append(f"| {m} | " + " | ".join(cells) + " |")
    out += ["", "## Failures", ""]
    for m in models:
        bad: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for r in by_model[m]:
            if not r["success"]:
                bad[r["case"]].append(r)
        out.append(f"### {m}: {len(bad)} cases with a failing run")
        for cid, rows in sorted(bad.items(), key=lambda kv: -len(kv[1]))[:25]:
            r = rows[0]
            why = "; ".join(f"{c['kind']}: {c['detail']}" for c in r["checks"] if not c["ok"])[:240] or "; ".join(e["message"] for e in r["errors"])[:240]
            out.append(f"- `{cid}` ({len(rows)} of runs failed): {why}")
        out.append("")
    return "\n".join(out)


def compare(a: list[dict[str, Any]], b: list[dict[str, Any]]) -> str:
    """Per (model, case): success rate in run A vs run B; lists regressions and fixes."""
    def rate(rs):
        d: dict[tuple[str, str], list[bool]] = defaultdict(list)
        for r in rs:
            d[(r["model"], r["case"])].append(r["success"])
        return {k: sum(v) / len(v) for k, v in d.items()}
    ra, rb = rate(a), rate(b)
    reg = sorted((k, ra[k], rb[k]) for k in ra.keys() & rb.keys() if rb[k] < ra[k] - 1e-9)
    fix = sorted((k, ra[k], rb[k]) for k in ra.keys() & rb.keys() if rb[k] > ra[k] + 1e-9)
    out = [f"# Comparison: {len(ra.keys() & rb.keys())} shared (model, case) pairs", "", f"## Regressions ({len(reg)})"]
    out += [f"- {m} `{c}`: {x:.0%} -> {y:.0%}" for (m, c), x, y in reg]
    out += ["", f"## Improvements ({len(fix)})"] + [f"- {m} `{c}`: {x:.0%} -> {y:.0%}" for (m, c), x, y in fix]
    return "\n".join(out)
