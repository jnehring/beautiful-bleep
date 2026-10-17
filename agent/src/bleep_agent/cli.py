# SPDX-License-Identifier: MIT
"""bleep-agent: build the data files, try the assistant from a terminal, run the evaluation.

    bleep-agent data  [--out website/api/agent_data] [--embed MODEL]   catalog.json, presets.jsonl, docs.sqlite
    bleep-agent chat  --model gemini-3.8-flash [--patch FILE|--preset NAME] [--data DIR] "message"
    bleep-agent eval  ...                                               see bleep_agent.evals.cli
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path


def build_data(repo: Path, out: Path, embed: str = "", cache: Path | None = None) -> None:
    from .catalog import build_catalog, dumps
    from .docs_index import build_index
    from .presets import PresetLibrary

    out.mkdir(parents=True, exist_ok=True)
    (out / "catalog.json").write_text(dumps(build_catalog(repo)))
    PresetLibrary.from_demo_patches(repo / "patch" / "board" / "ui" / "demo-patches.json").dump(out / "presets.jsonl")
    model = None
    if embed:
        from .cache import Cache
        from .embeddings import CachedEmbeddingModel, provider_embedding_model

        model = CachedEmbeddingModel(provider_embedding_model(embed), Cache((cache or repo / ".eval-cache") / "cache.sqlite", "use"))
    build_index(repo, out / "docs.sqlite", model)
    print(f"agent data written to {out}")


def load_resources(data: Path, model: str, embed: str = "", api_key: str | None = None, stream: bool = False):
    from .catalog import Catalog
    from .docs_index import DocsIndex
    from .models import create_model
    from .presets import PresetLibrary
    from .runner import Resources

    docs = None
    if (data / "docs.sqlite").exists():
        em = None
        if embed:
            from .embeddings import provider_embedding_model

            em = provider_embedding_model(embed)
        docs = DocsIndex(data / "docs.sqlite", em, embed or None)
    presets = PresetLibrary.load(data / "presets.jsonl") if (data / "presets.jsonl").exists() else None
    return Resources(model=create_model(model, api_key), catalog=Catalog.load(data / "catalog.json"), presets=presets, docs=docs, stream=stream)


async def _chat(args: argparse.Namespace) -> int:
    from .patch import Patch
    from .protocol import ChatMessage, ChatRequest, Snapshot
    from .runner import run_chat

    data = Path(args.data)
    res = load_resources(data, args.model, args.embed)
    if args.patch:
        patch = json.loads(Path(args.patch).read_text())
    elif args.preset:
        from .presets import PresetLibrary

        lib = PresetLibrary.load(data / "presets.jsonl")
        patch = lib.by_id[args.preset].preset
    else:
        patch = {"nodes": [], "cables": []}
    req = ChatRequest(messages=[ChatMessage(role="user", content=args.message)], snapshot=Snapshot(patch=patch), mode=args.mode)
    async for kind, d in run_chat(res, req):
        if kind == "text":
            print(d["delta"], end="", flush=True)
        else:
            print(f"\n[{kind}] {json.dumps(d)[:600]}")
    print()
    return 0


def main(argv: list[str] | None = None) -> int:
    from .catalog import repo_root

    ap = argparse.ArgumentParser(prog="bleep-agent")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("data")
    d.add_argument("--repo", type=Path, default=None)
    d.add_argument("--out", type=Path, default=None)
    d.add_argument("--embed", default="", help="embedding model for the documentation index (empty: keyword-only)")
    d.add_argument("--cache", type=Path, default=None)
    c = sub.add_parser("chat")
    c.add_argument("message")
    c.add_argument("--model", default="gemini-3.8-flash")
    c.add_argument("--embed", default="")
    c.add_argument("--data", default=str(repo_root() / "website" / "api" / "agent_data"))
    c.add_argument("--patch")
    c.add_argument("--preset")
    c.add_argument("--mode", default="auto", choices=["ask", "auto"])
    sub.add_parser("eval", add_help=False)
    args, rest = ap.parse_known_args(argv)
    if args.cmd == "data":
        repo = args.repo or repo_root()
        build_data(repo, args.out or repo / "website" / "api" / "agent_data", args.embed, args.cache)
        return 0
    if args.cmd == "chat":
        return asyncio.run(_chat(args))
    if args.cmd == "eval":
        from .evals.cli import main as eval_main

        return eval_main(rest)
    return 2


if __name__ == "__main__":
    sys.exit(main())
