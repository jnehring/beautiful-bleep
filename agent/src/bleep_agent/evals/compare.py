# SPDX-License-Identifier: MIT
"""Compare two or more benchmark runs in one Markdown report: success, tokens, cost and speed per run, by skill and difficulty, and which cases
got fixed or broke between the runs. Runs are compared on the (model, case) pairs they all contain, so a partial re-run is not judged against a full one."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .report import _clock, _money, benchmark_cost, execution_time, load_results, stats


@dataclass
class Run:
    label: str
    path: Path
    results: list[dict[str, Any]]
    meta: dict[str, Any] = field(default_factory=dict)
    version_id: int | None = None  # from the lab notebook
    changes: list[str] = field(default_factory=list)

    @property
    def run_id(self) -> str:
        return self.meta.get("run") or self.path.name


def parse_spec(spec: str) -> tuple[str | None, Path]:
    """'Quick wins=agent/evals/runs/2026...' -> ('Quick wins', path); a bare path -> (None, path)."""
    label, sep, path = spec.partition("=")
    return (label.strip() or None, Path(path.strip())) if sep and not Path(spec).exists() else (None, Path(spec))


def load_run(spec: str) -> Run:
    label, path = parse_spec(spec)
    if not path.exists():
        raise SystemExit(f"no such run: {path}")
    d = path if path.is_dir() else path.parent
    meta = json.loads((d / "meta.json").read_text()) if (d / "meta.json").exists() else {}
    return Run(label or meta.get("run") or d.name, path, load_results(path), meta)


def load_notebook(path: Path, only: list[int] | None = None, root: Path | None = None) -> list[Run]:
    """The versions of a lab notebook (JSON: {"versions": [{id, name, benchmark, changes: [...]}]}) as runs, in notebook order. Benchmark folders are
    looked up relative to the current directory, the repository root (`root`) and the notebook's own folder."""
    try:
        book = json.loads(path.read_text())
    except FileNotFoundError:
        raise SystemExit(f"no lab notebook at {path}")
    versions = book.get("versions") or []
    ids = [v.get("id") for v in versions]
    if len(set(ids)) != len(ids):
        raise SystemExit(f"{path}: version ids must be unique, got {ids}")
    unknown = sorted(set(only or []) - set(ids))
    if unknown:
        raise SystemExit(f"{path}: no version {unknown} (the notebook has {ids})")
    runs = []
    for v in versions:
        if only and v["id"] not in only:
            continue
        folder = next((c for c in (Path(v["benchmark"]), (root or Path()) / v["benchmark"], path.parent / v["benchmark"])
                       if (c / "results.jsonl").exists() or (c.is_file() and c.name.endswith(".jsonl"))), None)
        if folder is None:
            raise SystemExit(f"version {v['id']} ({v['name']}): no results.jsonl in {v['benchmark']} (is the benchmark still running?)")
        run = load_run(f"{v['name']}={folder}")
        run.version_id, run.changes = v["id"], list(v.get("changes") or [])
        runs.append(run)
    return runs


def _pct(x: float) -> str:
    return f"{x:.0%}"


def _pp(delta: float) -> str:
    return f"{delta * 100:+.0f} pp"


def _rel(new: float, old: float) -> str:
    return "n/a" if not old else f"{(new - old) / old:+.0%}"


def _mark(rate: float | None) -> str:
    if rate is None:
        return "–"
    return "✅" if rate >= 1 - 1e-9 else "❌" if rate <= 1e-9 else f"{rate:.0%}"


def _rates(results: list[dict[str, Any]]) -> dict[tuple[str, str], float]:
    d: dict[tuple[str, str], list[bool]] = defaultdict(list)
    for r in results:
        d[(r["model"], r["case"])].append(bool(r["success"]))
    return {k: sum(v) / len(v) for k, v in d.items()}


def _why(rows: list[dict[str, Any]]) -> str:
    for r in rows:
        if not r["success"]:
            bad = "; ".join(f"{c['kind']}: {c['detail']}" for c in r["checks"] if not c["ok"]) or "; ".join(e.get("message", "") for e in r["errors"])
            return bad[:140].replace("|", "/").replace("\n", " ")
    return ""


def compare_runs(runs: list[Run], prices: dict, all_cases: bool = False, max_cases: int = 60) -> str:
    n = len(runs)
    keys_per_run = [{(r["model"], r["case"]) for r in run.results} for run in runs]
    common = set.intersection(*keys_per_run)
    union = set.union(*keys_per_run)
    basis = union if all_cases else common
    rows_of = [[r for r in run.results if (r["model"], r["case"]) in basis] for run in runs]
    models = sorted({r["model"] for rows in rows_of for r in rows})
    skills = sorted({r["skill"] for rows in rows_of for r in rows})
    first, last = 0, n - 1

    out = ["# Benchmark comparison", ""]
    if any(r.changes for r in runs):
        out += ["## Versions and what changed", ""]
        for r in runs:
            out += [f"### {r.version_id if r.version_id is not None else runs.index(r) + 1}. {r.label}", "", f"Benchmark: `{r.path}`", ""]
            out += [f"- {c}" for c in r.changes] or ["- (no changes recorded)"]
            out.append("")
        out.append("## Runs")
        out.append("")
    out += ["| # | label | run | date | models | repeats | runs | judge | benchmark cost without cache | cost of that run | model time (recorded) | fresh run time at its concurrency | wall time of that run |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for i, run in enumerate(runs, 1):
        bc = benchmark_cost(run.results, prices, run.meta.get("judge", ""))
        full = None if any(b["full"] is None for b in bc) else sum(b["full"] for b in bc)
        spent = None if any(b["spent"] is None for b in bc) else sum(b["spent"] for b in bc)
        et = execution_time(run.results, run.meta)
        out.append(f"| {i} | {run.label} | `{run.run_id}` | {run.meta.get('date', '?')} | {', '.join(run.meta.get('models') or sorted({r['model'] for r in run.results}))} | "
                   f"{run.meta.get('repeats', '?')} | {len(run.results)} | {run.meta.get('judge') or '–'} | {_money(full)} | {_money(spent)} | "
                   f"{_clock(et['llm'])} | {_clock(et['estimate'])} | {_clock(et['wall'])} |")
    out.append("")
    if all_cases:
        out.append(f"Compared on all {len(union)} (model, case) pairs of any run; a run that lacks a pair simply has fewer rows (cases in every run: {len(common)}).")
    else:
        out.append(f"Compared on the **{len(common)} (model, case) pairs that every run contains** (of {len(union)} in all). Use `--all-cases` to include the rest.")
    if not basis:
        return "\n".join(out + ["", "The runs have no case in common."])
    out.append("")

    # ---- summary ----
    summ: list[str] = []
    for m in models:
        st = [stats([r for r in rows if r["model"] == m], prices, m) if any(r["model"] == m for r in rows) else None for rows in rows_of]
        if st[first] and st[last]:
            a, b = st[first], st[last]
            line = (f"**{m}**: success {_pct(a['success'])} → {_pct(b['success'])} ({_pp(b['success'] - a['success'])}), "
                    f"input tokens/request {a['tokens_in']:.0f} → {b['tokens_in']:.0f} ({_rel(b['tokens_in'], a['tokens_in'])}), "
                    f"output tokens/request {a['tokens_out']:.0f} → {b['tokens_out']:.0f} ({_rel(b['tokens_out'], a['tokens_out'])}), "
                    f"latency p50 {a['lat50']:.1f}s → {b['lat50']:.1f}s ({_rel(b['lat50'], a['lat50'])}), "
                    f"model calls/request {a['calls']:.1f} → {b['calls']:.1f}")
            summ.append(f"- {line}")
    if summ:
        out += [f"## Summary: {runs[last].label} vs {runs[first].label}", ""] + summ + [""]

    # ---- overall ----
    out += ["## Overall", "", "Δ is against run 1. Latency is the model time of the run (replayed calls keep their recorded latency).", "",
            "| model | # | run | runs | success (95% CI) | Δ success | check score | judge | tokens in / out per request | Δ tokens in | provider cache hit | cost / request | cost / success | latency p50 / p95 | calls / request | retried tool calls | errors |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for m in models:
        base = None
        for i, (run, rows) in enumerate(zip(runs, rows_of), 1):
            mr = [r for r in rows if r["model"] == m]
            if not mr:
                continue
            s = stats(mr, prices, m)
            base = base or s
            j = f"{s['judge']:.2f}" if s["judge"] is not None else "–"
            cps = "n/a" if s["cost"] is None else f"${s['cost']:.4f}"
            cs = "n/a" if s["cost_per_success"] is None else f"${s['cost_per_success']:.4f}"
            out.append(f"| {m} | {i} | {run.label} | {s['n']} | {_pct(s['success'])} ({_pct(s['ci'][0])}-{_pct(s['ci'][1])}) | {'' if s is base else _pp(s['success'] - base['success'])} | "
                       f"{s['score']:.2f} | {j} | {s['tokens_in']:.0f} / {s['tokens_out']:.0f} | {'' if s is base else _rel(s['tokens_in'], base['tokens_in'])} | {'n/a' if s['provider_cache'] is None else _pct(s['provider_cache'])} | {cps} | {cs} | "
                       f"{s['lat50']:.1f}s / {s['lat95']:.1f}s | {s['calls']:.1f} | {s['retry_rate']:.0%} | {s['errors']} |")
    out.append("")
    old = [str(i) for i, rows in enumerate(rows_of, 1) if rows and not any("cached_in" in r for r in rows)]
    if old:
        out += [f"Run {', '.join(old)} predate the provider-cache accounting: their cost counts every input token at the full price, so their cost figures are not comparable with later runs.", ""]

    # ---- by skill / difficulty ----
    def grid(title: str, groups: list[str], field_name: str) -> None:
        out.extend([f"## {title}", "", "Success rate; the last column is the change from the first to the last run.", "",
                    "| model | " + field_name + " | cases | " + " | ".join(f"{i}. {r.label}" for i, r in enumerate(runs, 1)) + f" | Δ {first + 1}→{last + 1} |",
                    "|---|---|---|" + "---|" * n + "---|"])
        for m in models:
            for g in groups:
                cells, rates = [], []
                for rows in rows_of:
                    sel = [r for r in rows if r["model"] == m and r[field_name if field_name == "skill" else "difficulty"] == g] if field_name == "skill" else \
                          [r for r in rows if r["model"] == m and r.get("difficulty", "?") == g]
                    rates.append(sum(r["success"] for r in sel) / len(sel) if sel else None)
                    cells.append(f"{_pct(rates[-1])} (n={len(sel)})" if sel else "–")
                if all(c == "–" for c in cells):
                    continue
                delta = _pp(rates[last] - rates[first]) if rates[first] is not None and rates[last] is not None else ""
                ncase = max((sum(1 for r in rows if r["model"] == m and (r["skill"] if field_name == "skill" else r.get("difficulty", "?")) == g) for rows in rows_of), default=0)
                out.append(f"| {m} | {g} | {ncase} | " + " | ".join(cells) + f" | {delta} |")
        out.append("")

    grid("By skill", skills, "skill")
    grid("By difficulty", sorted({r.get("difficulty", "?") for rows in rows_of for r in rows}), "difficulty")

    # ---- efficiency by skill ----
    out += ["## Tokens and speed by skill", "", "Per request: input tokens, output tokens, latency p50, model calls.", "",
            "| model | skill | " + " | ".join(f"{i}. {r.label}" for i, r in enumerate(runs, 1)) + " |", "|---|---|" + "---|" * n]
    for m in models:
        for sk in skills:
            cells = []
            for rows in rows_of:
                sel = [r for r in rows if r["model"] == m and r["skill"] == sk]
                if not sel:
                    cells.append("–")
                    continue
                s = stats(sel, prices, m)
                cells.append(f"{s['tokens_in']:.0f} / {s['tokens_out']:.0f}, {s['lat50']:.1f}s, {s['calls']:.1f} calls")
            if any(c != "–" for c in cells):
                out.append(f"| {m} | {sk} | " + " | ".join(cells) + " |")
    out.append("")

    # ---- failed checks by kind ----
    kinds = [Counter(f"{r['skill']}: {c['kind']}" for r in rows if not r["success"] for c in r["checks"] if not c["ok"]) +
             Counter(f"{r['skill']}: error" for r in rows if not r["success"] and (r["errors"] or not r["checks"])) for rows in rows_of]
    names = sorted(set().union(*kinds), key=lambda k: -max(c[k] for c in kinds))
    if names:
        out += ["## Failed checks by kind", "", "| check | " + " | ".join(f"{i}. {r.label}" for i, r in enumerate(runs, 1)) + " |", "|---|" + "---|" * n]
        out += [f"| {k} | " + " | ".join(str(c[k]) for c in kinds) + " |" for k in names]
        out.append("")

    # ---- case level ----
    rates = [_rates(rows) for rows in rows_of]
    by_case: list[dict[tuple[str, str], list[dict[str, Any]]]] = []
    for rows in rows_of:
        d: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        for r in rows:
            d[(r["model"], r["case"])].append(r)
        by_case.append(d)

    for i in range(n - 1):
        a, b = rates[i], rates[i + 1]
        shared = a.keys() & b.keys()
        fixed = sorted(k for k in shared if b[k] > a[k] + 1e-9)
        broke = sorted(k for k in shared if b[k] < a[k] - 1e-9)
        out += [f"## Cases: {runs[i].label} → {runs[i + 1].label}", "", f"{len(fixed)} improved, {len(broke)} regressed, {len(shared) - len(fixed) - len(broke)} unchanged "
                f"({len([k for k in shared if b[k] >= 1 - 1e-9])} of {len(shared)} passing now).", ""]
        if broke:
            out += [f"### Regressions ({len(broke)})", "", "| model | case | before → after | why it fails now |", "|---|---|---|---|"]
            out += [f"| {m} | `{c}` | {_pct(a[(m, c)])} → {_pct(b[(m, c)])} | {_why(by_case[i + 1][(m, c)])} |" for m, c in broke[:max_cases]]
            out.append("")
        if fixed:
            out += [f"### Improvements ({len(fixed)})", "", "| model | case | before → after | it failed because |", "|---|---|---|---|"]
            out += [f"| {m} | `{c}` | {_pct(a[(m, c)])} → {_pct(b[(m, c)])} | {_why(by_case[i][(m, c)])} |" for m, c in fixed[:max_cases]]
            out.append("")

    if n > 2:
        changing = sorted(k for k in basis if len({round(r.get(k, -1), 6) for r in rates}) > 1)
        out += [f"## Case outcomes across all runs ({len(changing)} cases that differ)", "", "✅ every repeat passed, ❌ none did, a percentage = mixed, – = not in that run.", "",
                "| model | case | " + " | ".join(f"{i}. {r.label}" for i, r in enumerate(runs, 1)) + " |", "|---|---|" + "---|" * n]
        out += [f"| {m} | `{c}` | " + " | ".join(_mark(r.get((m, c))) for r in rates) + " |" for m, c in changing[:max_cases]]
        if len(changing) > max_cases:
            out.append(f"| … | {len(changing) - max_cases} more | " + " | ".join("" for _ in runs) + " |")
        out.append("")

    still = sorted(k for k in basis if all(r.get(k, 1.0) <= 1e-9 for r in rates))
    out += [f"## Failing in every run ({len(still)})", ""]
    if still:
        out += ["| model | case | why (latest run) |", "|---|---|---|"]
        out += [f"| {m} | `{c}` | {_why(by_case[last][(m, c)])} |" for m, c in still[:max_cases]]
    else:
        out.append("None.")
    out.append("")
    return "\n".join(out)
