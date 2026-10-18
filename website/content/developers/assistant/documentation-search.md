---
title: Documentation search
description: How the docs skill finds the right pages: heading-based chunks, a keyword index plus embeddings, rank fusion, and a version check.
order: 60
---

# Documentation search

The documentation is about 250,000 tokens: the musicians' and developers' pages in `website/content` and the manual of every module. That is too much to put into every prompt, in cost, in latency and against the daily token budget, so a documentation question runs a **retrieval step**: find the relevant chunks, hand only those to the model, and have it answer from them with links. Code: `agent/src/bleep_agent/docs_index.py`, `embeddings.py`; the tools are `search_docs` and `read_doc`.

![At build time pages are split by heading into chunks of at most 450 tokens, each indexed for keywords and embedded, and stored in one SQLite file. At question time a keyword search and a vector search run, the rankings are merged by reciprocal rank fusion, and the top six chunks go to the model.](/img/assistant-docs-search.svg)

## Why two kinds of search

The text is full of exact terms (module, jack and knob names, file names), where keyword search is strong. Musicians ask in everyday words ("why does my sound crunch?" for a page about aliasing and Drive), where embeddings are strong. So the search is **hybrid**, and the [benchmark](benchmark.md) measures each method on its own (`bleep-agent eval retrieval`).

## Build time

`python -m bleep_agent.docs build` (run by `scripts/build/build-agent-data.sh`) writes one SQLite file:

- **Chunks.** Each page is split by heading. A chunk is at most 450 tokens; very long sections are split at paragraph boundaries, sections under 50 tokens merge into their neighbour. The chunk's text starts with its heading path ("Modules > Multi Filter > Drive"), because the path carries most of the meaning of a short section. Each chunk has an id `<doc>#<anchor>`, the audience (`musicians`, `developers`, `module`) and the URL with anchor.
- **Keyword index.** SQLite FTS5 over the title, heading path and text.
- **Embeddings (optional).** One vector per chunk from the configured model, stored as a BLOB in the same file. The API loads them into one in-memory matrix at start and does a brute-force cosine search, which takes milliseconds for a few thousand chunks. No vector database is needed.
- **A cache.** Each embedding is keyed by the model and a hash of the chunk text, so after a docs edit only the changed chunks are embedded, and a rebuild without changes makes no API calls.

The file records the docs version, the chunking version and the embedding model in a `meta` table.

## Question time

1. The query runs a **keyword search** (FTS5 `bm25`, top 20) and, if embeddings exist, a **vector search** (the query is embedded as a retrieval query, top 20 by cosine).
2. The two rankings are merged with **reciprocal rank fusion**: a chunk scores the sum of `1 / (60 + rank)` over the lists it appears in, so a chunk both searches like beats a chunk only one search loves, and the scores of the two methods never need to be comparable.
3. Chunks whose audience matches the question (musicians or developers) get a boost of 25%.
4. The top six are returned with title, path, URL and a short excerpt. The model reads a full page with `read_doc` when an excerpt is not enough.

The docs skill also gets a table of contents of the pages in its instructions, so it can ask for a page by id directly.

## The embedding model must match

Vectors from different models cannot be compared. If `BLEEP_AGENT_EMBED_MODEL` differs from the model recorded in `docs.sqlite`, the search logs it and falls back to keywords only, instead of returning nonsense. Rebuild the index with the new model to switch.

## Answers

The docs prompt tells the assistant to answer from what it retrieved, link the pages it used as markdown links, and say clearly when the documentation does not cover the question. Musicians get plain musical language, developers get technical detail. "Says when the documentation has no answer" is a benchmark check of its own; see [Benchmark and results](benchmark.md).

These pages are part of the index: the assistant can answer questions about itself from them.
