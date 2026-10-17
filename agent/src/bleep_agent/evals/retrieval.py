# SPDX-License-Identifier: MIT
"""Retrieval on its own: recall@k and MRR of the documentation search per method and question style."""
from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any

import numpy as np

from ..docs_index import DocsIndex
from .cases import Case


def _doc_of(index: DocsIndex, rowids: list[int]) -> list[str]:
    out = []
    for rid in rowids:
        r = index.db.execute("SELECT doc FROM chunks WHERE rowid = ?", (rid,)).fetchone()
        out.append(r["doc"])
    return out


async def evaluate_retrieval(index: DocsIndex, cases: list[Case], k: int = 6) -> dict[str, dict[str, dict[str, float]]]:
    """-> {method: {style: {recall, mrr, n}}}; style = 'all' plus each case tag in ('exact', 'everyday')."""
    methods = ["keyword"] + (["vector", "hybrid"] if index.hybrid else [])
    acc: dict[str, dict[str, list[tuple[float, float]]]] = {m: defaultdict(list) for m in methods}
    for c in cases:
        gold = set(c.gold.get("docs", []))
        if not gold:
            continue
        for m in methods:
            if m == "keyword":
                docs = _doc_of(index, [rid for rid, _ in index.keyword(c.query, k * 3)])
            elif m == "vector":
                res = await index.embed_model.embed([c.query], input_type="query")
                qv = np.asarray(res.embeddings[0], dtype=np.float32)
                qv = qv / (np.linalg.norm(qv) or 1.0)
                docs = _doc_of(index, [rid for rid, _ in index.vector(qv, k * 3)])
            else:
                docs = [h.id.split("#")[0] for h in await index.search(c.query, k)]
            seen: list[str] = []
            for d in docs:  # rank by distinct page
                if d not in seen:
                    seen.append(d)
            top = seen[:k]
            hit = any(d in gold for d in top)
            rr = next((1.0 / (i + 1) for i, d in enumerate(top) if d in gold), 0.0)
            for style in ["all"] + [t for t in c.tags if t in ("exact", "everyday", "musicians", "developers")]:
                acc[m][style].append((float(hit), rr))
    return {m: {s: {"recall": float(np.mean([a for a, _ in v])), "mrr": float(np.mean([b for _, b in v])), "n": len(v)} for s, v in st.items()}
            for m, st in acc.items()}


def render_retrieval(res: dict[str, dict[str, dict[str, float]]], k: int = 6) -> str:
    styles = sorted({s for m in res.values() for s in m})
    out = [f"| method | " + " | ".join(f"{s}: recall@{k} / MRR (n)" for s in styles) + " |", "|---|" + "---|" * len(styles)]
    for m, st in res.items():
        out.append(f"| {m} | " + " | ".join(f"{st[s]['recall']:.0%} / {st[s]['mrr']:.2f} ({int(st[s]['n'])})" if s in st else "-" for s in styles) + " |")
    return "\n".join(out)
