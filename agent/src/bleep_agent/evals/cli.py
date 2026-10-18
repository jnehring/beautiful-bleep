# SPDX-License-Identifier: MIT
"""bleep-agent eval: generate cases, run them against models, report, compare, measure retrieval.

    bleep-agent eval generate [--out agent/evals/cases]
    bleep-agent eval run --models gemini-3.8-flash,gpt-6-luna --skills docs,diagnose --repeats 3 --judge gemini-4-argon [--cache use]
    bleep-agent eval report agent/evals/runs/<run> [--compare agent/evals/runs/<other>]
    bleep-agent eval retrieval --index website/api/agent_data/docs.sqlite [--embed gemini-embedding-2]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path


class _Progress:
    """One-line progress bar on stderr: runs done, how many passed, elapsed time and an estimate of the time left."""

    def __init__(self, total: int, width: int = 28) -> None:
        self.total, self.width, self.done, self.ok, self.t0 = total, width, 0, 0, time.monotonic()
        self.tty = sys.stderr.isatty()
        self(None)

    def __call__(self, result: dict | None) -> None:
        if result is not None:
            self.done += 1
            self.ok += bool(result.get("success"))
        elapsed = time.monotonic() - self.t0
        eta = elapsed / self.done * (self.total - self.done) if self.done else 0
        filled = int(self.width * self.done / max(self.total, 1))
        line = (f"[{'#' * filled}{'-' * (self.width - filled)}] {self.done}/{self.total} ({self.done / max(self.total, 1):.0%})  "
                f"passed {self.ok}  elapsed {_clock(elapsed)}  eta {_clock(eta) if self.done else '--:--'}")
        if self.tty:
            print("\r" + line + "\033[K", end="\n" if self.done >= self.total else "", file=sys.stderr, flush=True)
        elif result is not None and (self.done % 10 == 0 or self.done == self.total):
            print(line, file=sys.stderr, flush=True)


def _clock(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def _load_api_keys(env_file: Path) -> None:
    """Provider keys from website/.env, so the eval run needs no export. Only *_API_KEY lines; a variable already set wins."""
    if not env_file.is_file():
        return
    for line in env_file.read_text().splitlines():
        name, sep, value = line.partition("=")
        name = name.strip()
        if sep and name.endswith("_API_KEY") and value.strip():
            os.environ.setdefault(name, value.strip().strip("\"'"))


def main(argv: list[str] | None = None) -> int:
    from ..catalog import Catalog, repo_root

    repo = repo_root()
    _load_api_keys(repo / "website" / ".env")
    ap = argparse.ArgumentParser(prog="bleep-agent eval")
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate")
    g.add_argument("--out", type=Path, default=repo / "agent" / "evals" / "cases")
    r = sub.add_parser("run")
    r.add_argument("--models", required=True, help="comma separated model names (gemini-3.8-flash, gpt-6-luna, ...)")
    r.add_argument("--skills", default="")
    r.add_argument("--ids", default="", help="comma separated case id prefixes")
    r.add_argument("--repeats", type=int, default=3)
    r.add_argument("--judge", default="", help="judge model name; empty = no soft scores")
    r.add_argument("--cache", default="use", choices=["use", "refresh", "replay-only", "off"])
    r.add_argument("--cache-dir", type=Path, default=repo / ".eval-cache")
    r.add_argument("--data", type=Path, default=repo / "website" / "api" / "agent_data")
    r.add_argument("--cases", type=Path, default=None)
    r.add_argument("--embed", default="", help="embedding model for hybrid documentation search")
    r.add_argument("--concurrency", type=int, default=4)
    r.add_argument("--limit", type=int, default=0, help="at most N cases per skill (smoke test)")
    r.add_argument("--out", type=Path, default=None)
    r.add_argument("--verbose", action="store_true", help="show the agent's per-call log lines and tracebacks instead of the progress bar only")
    rp = sub.add_parser("report")
    rp.add_argument("run", type=Path)
    rp.add_argument("--compare", type=Path, default=None)
    rt = sub.add_parser("retrieval")
    rt.add_argument("--index", type=Path, default=repo / "website" / "api" / "agent_data" / "docs.sqlite")
    rt.add_argument("--embed", default="")
    rt.add_argument("--cases", type=Path, default=None)
    rt.add_argument("--cache-dir", type=Path, default=repo / ".eval-cache")
    a = ap.parse_args(argv)

    if a.cmd == "generate":
        from ..presets import PresetLibrary
        from .generate import generate_all

        lib = PresetLibrary.from_demo_patches(repo / "patch" / "board" / "ui" / "demo-patches.json")
        cat = Catalog.load(repo / "website" / "api" / "agent_data" / "catalog.json") if (repo / "website" / "api" / "agent_data" / "catalog.json").exists() \
            else __import__("bleep_agent.catalog", fromlist=["build_catalog"]).build_catalog(repo)
        print(generate_all(lib, cat, a.out))
        return 0

    if a.cmd == "report":
        from .pricing import load_prices
        from .report import compare, load_results, render

        res = load_results(a.run)
        meta = json.loads((a.run / "meta.json").read_text()) if (a.run / "meta.json").exists() else None
        text = render(res, load_prices(), meta)
        if a.compare:
            text += "\n\n" + compare(load_results(a.compare), res)
        (a.run / "report.md").write_text(text) if a.run.is_dir() else None
        print(text)
        return 0

    if a.cmd == "retrieval":
        from ..cache import Cache
        from ..docs_index import DocsIndex
        from ..embeddings import CachedEmbeddingModel, provider_embedding_model
        from .cases import load_cases
        from .retrieval import evaluate_retrieval, render_retrieval

        em = CachedEmbeddingModel(provider_embedding_model(a.embed), Cache(a.cache_dir / "cache.sqlite", "use")) if a.embed else None
        idx = DocsIndex(a.index, em, a.embed or None)
        print(f"index: {'hybrid' if idx.hybrid else 'keyword-only'}{(' (' + idx.reason + ')') if idx.reason else ''}")
        cases = load_cases(a.cases, ["docs"])
        print(render_retrieval(asyncio.run(evaluate_retrieval(idx, cases))))
        return 0

    # run
    from ..cache import Cache
    from ..docs_index import DocsIndex
    from ..models import create_model
    from ..presets import PresetLibrary
    from .cases import load_cases
    from .harness import run_many
    from .pricing import load_prices
    from .report import render

    cat = Catalog.load(a.data / "catalog.json")
    lib = PresetLibrary.load(a.data / "presets.jsonl")
    cache = Cache(a.cache_dir / "cache.sqlite", a.cache)
    docs = None
    if (a.data / "docs.sqlite").exists():
        em = None
        if a.embed:
            from ..embeddings import CachedEmbeddingModel, provider_embedding_model

            em = CachedEmbeddingModel(provider_embedding_model(a.embed), cache)
        docs = DocsIndex(a.data / "docs.sqlite", em, a.embed or None)
    skills = [s for s in a.skills.split(",") if s] or None
    cases = load_cases(a.cases, skills, [i for i in a.ids.split(",") if i] or None)
    if a.limit:
        seen: dict[str, int] = {}
        keep = []
        for c in cases:
            seen[c.skill] = seen.get(c.skill, 0) + 1
            if seen[c.skill] <= a.limit:
                keep.append(c)
        cases = keep
    models = {m: create_model(m) for m in a.models.split(",")}
    judge_model = create_model(a.judge) if a.judge else None
    run_id = time.strftime("%Y%m%d-%H%M%S")
    out = a.out or repo / "agent" / "evals" / "runs" / run_id
    out.mkdir(parents=True, exist_ok=True)
    print(f"{len(cases)} cases x {len(models)} models x {a.repeats} repeats = {len(cases) * len(models) * a.repeats} runs (cache: {a.cache})")
    if not a.verbose:
        os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")
        logging.getLogger("bleep_agent").setLevel(logging.CRITICAL)
    progress = _Progress(len(cases) * len(models) * a.repeats)
    results = asyncio.run(run_many(cases, models, repeats=a.repeats, concurrency=a.concurrency, progress=progress, catalog=cat, lib=lib, docs=docs, cache=cache, judge_model=judge_model))
    (out / "results.jsonl").write_text("\n".join(json.dumps(r) for r in results) + "\n")
    prices = load_prices()
    meta = {"run": run_id, "date": time.strftime("%Y-%m-%d %H:%M"), "repeats": a.repeats, "cache": a.cache, "models": list(models), "judge": a.judge,
            "cache_stats": cache.stats()}
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    text = render(results, prices, meta)
    (out / "report.md").write_text(text)
    print(text)
    print(f"\nresults: {out}")
    return 0
