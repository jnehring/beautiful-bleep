# SPDX-License-Identifier: MIT
"""The documentation index for the RAG step (doc/agent-concept.md §5a, doc/specs/agent.md §7).

    python -m bleep_agent.docs_index build --out docs.sqlite [--embed MODEL] [--cache DIR]
    python -m bleep_agent.docs_index search "how do I sign a module" [--index docs.sqlite]

One SQLite file: chunks (text, metadata, optional float32 embedding), an FTS5 index, and meta. Search is hybrid
(FTS5 bm25 + cosine over the in-memory matrix, merged by reciprocal rank fusion) and keyword-only when the file has
no embeddings or was built with another embedding model than the one configured.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import re
import sqlite3
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

CHUNKING_VERSION = 1
MAX_CHUNK_TOKENS = 450
MIN_CHUNK_TOKENS = 50
RRF_K = 60


def est_tokens(text: str) -> int:
    return int(len(text.split()) * 1.35) + 1


@dataclass
class DocSource:
    doc: str
    audience: str
    url: str
    title: str
    text: str


@dataclass
class Chunk:
    id: str
    doc: str
    title: str
    path: str
    audience: str
    url: str
    text: str
    tokens: int


@dataclass
class Hit:
    id: str
    title: str
    path: str
    url: str
    audience: str
    text: str
    score: float

    def brief(self, chars: int = 280) -> dict[str, Any]:
        snippet = " ".join(self.text.split())
        return {"id": self.id, "title": self.title, "path": self.path, "url": self.url,
                "snippet": snippet[:chars] + ("..." if len(snippet) > chars else "")}


# ---- collecting and chunking -------------------------------------------------------------------------------------

_FRONT = re.compile(r"\A---\n(.*?)\n---\n", re.S)
_HEAD = re.compile(r"^(#{1,4})\s+(.*?)\s*#*\s*$")


def _front_title(text: str) -> tuple[str | None, str]:
    m = _FRONT.match(text)
    if not m:
        return None, text
    title = None
    for line in m.group(1).splitlines():
        if line.startswith("title:"):
            title = line.split(":", 1)[1].strip().strip("\"'")
    return title, text[m.end():]


def collect_docs(repo: Path) -> list[DocSource]:
    out: list[DocSource] = []
    content = repo / "website" / "content"
    for f in sorted(content.rglob("*.md")):
        rel = f.relative_to(content).with_suffix("")
        parts = rel.parts
        if parts[0] not in ("musicians", "developers"):
            continue
        title, body = _front_title(f.read_text())
        out.append(DocSource("/".join(parts), parts[0], f"/docs/{'/'.join(parts)}/", title or parts[-1], body))
    for f in sorted((repo / "patch" / "modules").glob("*/doc/*.md")):
        if f.name.lower() == "readme.md":
            continue
        _, body = _front_title(f.read_text())
        h1 = next((m.group(2) for line in body.splitlines() if (m := _HEAD.match(line)) and len(m.group(1)) == 1), f.stem)
        out.append(DocSource(f"module:{f.stem}", "musicians", f"/modules/{f.stem}/", h1, body))
    return out


def _anchor(heading: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")


def chunk_doc(src: DocSource) -> list[Chunk]:
    # sections: (heading stack, lines)
    sections: list[tuple[list[str], list[str]]] = []
    stack: list[tuple[int, str]] = []
    cur: list[str] = []
    in_code = False

    def flush() -> None:
        if any(l.strip() for l in cur):
            sections.append(([h for _, h in stack], cur.copy()))
        cur.clear()

    for line in src.text.splitlines():
        if line.lstrip().startswith("```"):
            in_code = not in_code
        m = None if in_code else _HEAD.match(line)
        if m and len(m.group(1)) <= 3:
            flush()
            lvl = len(m.group(1))
            while stack and stack[-1][0] >= lvl:
                stack.pop()
            stack.append((lvl, m.group(2)))
        elif re.match(r"^\s*!\[.*\]\(.*\)\s*$", line):
            continue  # images carry no text
        else:
            cur.append(line)
    flush()

    # split long sections at paragraph boundaries
    pieces: list[tuple[list[str], str]] = []
    for heads, lines in sections:
        text = "\n".join(lines).strip()
        if est_tokens(text) <= MAX_CHUNK_TOKENS:
            pieces.append((heads, text))
            continue
        buf: list[str] = []
        for para in re.split(r"\n\s*\n", text):
            if buf and est_tokens("\n\n".join(buf + [para])) > MAX_CHUNK_TOKENS:
                pieces.append((heads, "\n\n".join(buf)))
                buf = []
            buf.append(para)
        if buf:
            pieces.append((heads, "\n\n".join(buf)))

    # merge tiny pieces into the previous one of the same page when it stays small
    merged: list[tuple[list[str], str]] = []
    for heads, text in pieces:
        if merged and est_tokens(text) < MIN_CHUNK_TOKENS and est_tokens(merged[-1][1]) + est_tokens(text) <= MAX_CHUNK_TOKENS + 150:
            h = (heads[-1] + "\n") if heads and heads != merged[-1][0] else ""
            merged[-1] = (merged[-1][0], merged[-1][1] + "\n\n" + (f"**{h.strip()}** " if h else "") + text)
        else:
            merged.append((heads, text))

    out: list[Chunk] = []
    used: set[str] = set()
    for heads, text in merged:
        if not text.strip():
            continue
        title = heads[-1] if heads else src.title
        path = " > ".join([src.title] + [h for h in heads if h != src.title])
        anchor = _anchor(heads[-1]) if heads else ""
        cid = f"{src.doc}#{anchor}" if anchor else src.doc
        base, i = cid, 2
        while cid in used:
            cid = f"{base}-{i}"
            i += 1
        used.add(cid)
        url = src.url + (f"#{anchor}" if anchor else "")
        out.append(Chunk(cid, src.doc, title, path, src.audience, url, text, est_tokens(text)))
    return out


# ---- building -----------------------------------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE chunks (id TEXT PRIMARY KEY, doc TEXT, title TEXT, path TEXT, audience TEXT, url TEXT, text TEXT,
                     tokens INTEGER, embedding BLOB);
CREATE VIRTUAL TABLE chunks_fts USING fts5(title, path, text, content='chunks', content_rowid='rowid', tokenize='porter unicode61');
"""


def build_index(repo: Path, out: Path, embed_model: Any | None = None, log=print) -> dict[str, Any]:
    """Write the index file. `embed_model` is a pydantic-ai EmbeddingModel (or None for keyword-only)."""
    from .embeddings import embed_sync

    docs = collect_docs(repo)
    chunks = [c for d in docs for c in chunk_doc(d)]
    h = hashlib.sha256("".join(d.text for d in docs).encode()).hexdigest()[:16]
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    db = sqlite3.connect(out)
    db.executescript(SCHEMA)
    vecs = None
    dim = 0
    if embed_model is not None:
        texts = [f"{c.path}\n\n{c.text}" for c in chunks]
        vecs = embed_sync(embed_model, texts, "document")
        dim = int(vecs.shape[1])
    for i, c in enumerate(chunks):
        blob = vecs[i].astype(np.float32).tobytes() if vecs is not None else None
        db.execute("INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?,?)",
                   (c.id, c.doc, c.title, c.path, c.audience, c.url, c.text, c.tokens, blob))
    db.execute("INSERT INTO chunks_fts(rowid, title, path, text) SELECT rowid, title, path, text FROM chunks")
    meta = {"chunking_version": str(CHUNKING_VERSION), "content_hash": h, "n_chunks": str(len(chunks)),
            "n_docs": str(len(docs)), "embed_model": (embed_model.model_name if embed_model is not None else ""),
            "dim": str(dim), "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    db.executemany("INSERT INTO meta VALUES (?,?)", meta.items())
    db.commit()
    db.close()
    log(f"{out}: {len(docs)} docs, {len(chunks)} chunks, embeddings: {meta['embed_model'] or 'none'}")
    return meta


# ---- searching ----------------------------------------------------------------------------------------------------


def _fts_query(q: str) -> str:
    words = [w for w in re.split(r"\W+", q.lower()) if len(w) > 1]
    stop = {"the", "and", "how", "what", "does", "can", "you", "for", "with", "this", "that", "are", "was", "why", "who",
            "when", "where", "is", "to", "of", "in", "on", "it", "do", "my", "i", "a", "an", "use", "get"}
    words = [w for w in words if w not in stop] or words
    return " OR ".join(f'"{w}"' for w in words[:16])


class DocsIndex:
    def __init__(self, path: str | Path, embed_model: Any | None = None, embed_model_name: str | None = None):
        self.path = Path(path)
        self.db = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.meta = {r["key"]: r["value"] for r in self.db.execute("SELECT key, value FROM meta")}
        self.embed_model = embed_model
        self.matrix: np.ndarray | None = None
        self.rowids: list[int] = []
        self.hybrid = False
        self.reason = ""
        built = self.meta.get("embed_model", "")
        if not built:
            self.reason = "index has no embeddings"
        elif embed_model is None:
            self.reason = "no embedding model configured"
        elif built != (embed_model_name or embed_model.model_name):
            self.reason = f"index was built with '{built}', configured model is '{embed_model_name or embed_model.model_name}'"
        else:
            rows = self.db.execute("SELECT rowid, embedding FROM chunks WHERE embedding IS NOT NULL").fetchall()
            if rows:
                dim = int(self.meta["dim"])
                self.matrix = np.vstack([np.frombuffer(r["embedding"], dtype=np.float32, count=dim) for r in rows])
                self.rowids = [r["rowid"] for r in rows]
                self.hybrid = True
        self.n_chunks = int(self.meta.get("n_chunks", 0))

    def _hit(self, row: sqlite3.Row, score: float) -> Hit:
        return Hit(row["id"], row["title"], row["path"], row["url"], row["audience"], row["text"], score)

    def keyword(self, query: str, k: int = 20, audience: str | None = None) -> list[tuple[int, float]]:
        q = _fts_query(query)
        if not q:
            return []
        sql = ("SELECT chunks.rowid AS rid, bm25(chunks_fts, 6.0, 3.0, 1.0) AS s FROM chunks_fts JOIN chunks ON chunks.rowid = chunks_fts.rowid "
               "WHERE chunks_fts MATCH ? ORDER BY s LIMIT ?")
        try:
            return [(r["rid"], -r["s"]) for r in self.db.execute(sql, (q, k))]
        except sqlite3.OperationalError:
            return []

    def vector(self, qvec: np.ndarray, k: int = 20) -> list[tuple[int, float]]:
        if self.matrix is None:
            return []
        sims = self.matrix @ qvec
        top = np.argsort(-sims)[:k]
        return [(self.rowids[i], float(sims[i])) for i in top]

    async def search(self, query: str, k: int = 6, audience: str | None = None) -> list[Hit]:
        kw = self.keyword(query, 20)
        vec: list[tuple[int, float]] = []
        if self.hybrid and self.embed_model is not None:
            res = await self.embed_model.embed([query], input_type="query")
            qv = np.asarray(res.embeddings[0], dtype=np.float32)
            n = float(np.linalg.norm(qv))
            vec = self.vector(qv / n if n else qv, 20)
        scores: dict[int, float] = {}
        for ranked in (kw, vec):
            for rank, (rid, _) in enumerate(ranked):
                scores[rid] = scores.get(rid, 0.0) + 1.0 / (RRF_K + rank + 1)
        if not scores:
            return []
        rows = {r["rowid"]: r for r in self.db.execute(
            f"SELECT rowid, * FROM chunks WHERE rowid IN ({','.join('?' * len(scores))})", list(scores))}
        hits = []
        for rid, s in scores.items():
            r = rows[rid]
            if audience and r["audience"] == audience:
                s *= 1.25
            hits.append(self._hit(r, s))
        hits.sort(key=lambda h: -h.score)
        return hits[:k]

    def search_sync(self, query: str, k: int = 6, audience: str | None = None) -> list[Hit]:
        return asyncio.run(self.search(query, k, audience))

    def read(self, doc_id: str, max_tokens: int = 3000) -> tuple[str, list[Hit]]:
        """A chunk by id, or all chunks of a page (doc id without '#') up to a size cap. -> (text, chunks)."""
        if "#" in doc_id:
            rows = self.db.execute("SELECT * FROM chunks WHERE id = ?", (doc_id,)).fetchall()
        else:
            rows = self.db.execute("SELECT * FROM chunks WHERE doc = ? ORDER BY rowid", (doc_id,)).fetchall()
        hits, used, parts = [], 0, []
        for r in rows:
            if used + r["tokens"] > max_tokens and parts:
                parts.append(f"[...truncated; read the sections by id: {r['id']} ...]")
                break
            used += r["tokens"]
            hits.append(self._hit(r, 1.0))
            parts.append(f"## {r['path']}\n{r['text']}")
        return "\n\n".join(parts), hits

    def contents(self, max_chars: int = 9000) -> str:
        """A table of contents for the prompt: page ids with titles, grouped by audience."""
        rows = self.db.execute("SELECT doc, audience, MIN(path) AS p FROM chunks GROUP BY doc ORDER BY audience, doc").fetchall()
        lines: list[str] = []
        for r in rows:
            title = r["p"].split(" > ")[0]
            lines.append(f"{r['doc']}: {title}")
        text = "\n".join(lines)
        return text[:max_chars]


def main(argv: list[str] | None = None) -> int:
    from .catalog import repo_root

    ap = argparse.ArgumentParser(prog="bleep_agent.docs_index")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--repo", type=Path, default=None)
    b.add_argument("--out", type=Path, default=None)
    b.add_argument("--embed", default="", help="embedding model name; empty = keyword-only index")
    b.add_argument("--cache", type=Path, default=None, help="cache directory for chunk embeddings")
    s = sub.add_parser("search")
    s.add_argument("query")
    s.add_argument("--index", type=Path, default=None)
    s.add_argument("--embed", default="")
    a = ap.parse_args(argv)
    repo = getattr(a, "repo", None) or repo_root()
    default_out = repo / "website" / "api" / "agent_data" / "docs.sqlite"
    if a.cmd == "build":
        model = None
        if a.embed:
            from .cache import Cache
            from .embeddings import CachedEmbeddingModel, provider_embedding_model

            cache = Cache((a.cache or repo / ".eval-cache") / "cache.sqlite", "use")
            model = CachedEmbeddingModel(provider_embedding_model(a.embed), cache)
        build_index(repo, a.out or default_out, model)
        return 0
    model = None
    if a.embed:
        from .embeddings import provider_embedding_model

        model = provider_embedding_model(a.embed)
    idx = DocsIndex(a.index or default_out, model, a.embed or None)
    print(f"[{'hybrid' if idx.hybrid else 'keyword-only'}{': ' + idx.reason if idx.reason else ''}]", file=sys.stderr)
    for h in idx.search_sync(a.query):
        print(f"{h.score:.4f} {h.id}  ({h.url})\n    {h.brief()['snippet'][:160]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
