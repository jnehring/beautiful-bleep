# SPDX-License-Identifier: MIT
"""Embedding models: provider lookup, a cached wrapper, and a sync helper (doc/agent-concept.md §5a, §9)."""
from __future__ import annotations

import asyncio
from collections.abc import Sequence

import numpy as np
from pydantic_ai.embeddings import EmbeddingModel, EmbeddingResult, EmbeddingSettings
from pydantic_ai.embeddings.result import EmbedInputType
from pydantic_ai.usage import RequestUsage

from .cache import Cache, make_key


def resolve_model_name(name: str) -> str:
    """'gemini-embedding-2' -> 'google-gla:gemini-embedding-2'; names that already carry a provider are kept."""
    if ":" in name:
        return name
    if name.startswith(("gemini", "text-embedding-004", "embedding-")):
        return f"google-gla:{name}"
    if name.startswith(("text-embedding", "gpt")):
        return f"openai:{name}"
    return name


def provider_embedding_model(name: str, api_key: str | None = None) -> EmbeddingModel:
    """The configured embedding model. An explicit key beats the environment (GEMINI_API_KEY / OPENAI_API_KEY)."""
    full = resolve_model_name(name)
    prov, _, m = full.partition(":")
    if api_key and prov == "google-gla":
        from pydantic_ai.embeddings.google import GoogleEmbeddingModel
        from pydantic_ai.providers.google import GoogleProvider

        return GoogleEmbeddingModel(m, provider=GoogleProvider(api_key=api_key))
    if api_key and prov == "openai":
        from pydantic_ai.embeddings.openai import OpenAIEmbeddingModel
        from pydantic_ai.providers.openai import OpenAIProvider

        return OpenAIEmbeddingModel(m, provider=OpenAIProvider(api_key=api_key))
    from pydantic_ai import Embedder

    return Embedder(full)._model  # noqa: SLF001  (the configured model object)


class HashingEmbeddingModel(EmbeddingModel):
    """A deterministic offline embedding (hashed bag of words) for tests and for running without a key."""

    def __init__(self, dim: int = 256):
        super().__init__()
        self.dim = dim

    @property
    def model_name(self) -> str:
        return f"hashing-{self.dim}"

    @property
    def system(self) -> str:
        return "local"

    async def embed(self, inputs, *, input_type: EmbedInputType, settings: EmbeddingSettings | None = None) -> EmbeddingResult:
        texts, _ = self.prepare_embed(inputs, settings)
        out = []
        for t in texts:
            v = np.zeros(self.dim, dtype=np.float32)
            for w in _words(t):
                h = int.from_bytes(__import__("hashlib").blake2b(w.encode(), digest_size=8).digest(), "big")
                v[h % self.dim] += 1.0 if (h >> 63) & 1 else -1.0
            n = float(np.linalg.norm(v))
            out.append((v / n if n else v).tolist())
        return EmbeddingResult(out, inputs=texts, input_type=input_type, model_name=self.model_name, provider_name=self.system,
                               usage=RequestUsage(input_tokens=sum(len(t.split()) for t in texts)))


def _words(t: str) -> list[str]:
    import re

    return [w for w in re.split(r"\W+", t.lower()) if len(w) > 1]


class CachedEmbeddingModel(EmbeddingModel):
    """Wraps an embedding model; every text is looked up by (model, input type, dimensions, text) first."""

    def __init__(self, inner: EmbeddingModel, cache: Cache, dimensions: int | None = None):
        super().__init__()
        self.inner, self.cache, self.dimensions = inner, cache, dimensions

    @property
    def model_name(self) -> str:
        return self.inner.model_name

    @property
    def system(self) -> str:
        return self.inner.system

    async def embed(self, inputs, *, input_type: EmbedInputType, settings: EmbeddingSettings | None = None) -> EmbeddingResult:
        texts = [inputs] if isinstance(inputs, str) else list(inputs)
        keys = [make_key("embedding", self.inner.system, self.inner.model_name, input_type, self.dimensions, t) for t in texts]
        found: dict[int, list[float]] = {}
        todo: list[int] = []
        for i, k in enumerate(keys):
            hit = self.cache.get("embedding", k)
            if hit is None:
                todo.append(i)
            else:
                found[i] = hit["v"]
        usage = RequestUsage()
        if todo:
            st: EmbeddingSettings = dict(settings or {})  # type: ignore[assignment]
            if self.dimensions:
                st.setdefault("dimensions", self.dimensions)
            for lo in range(0, len(todo), 64):
                batch = todo[lo:lo + 64]
                res = await self.inner.embed([texts[i] for i in batch], input_type=input_type, settings=st)
                usage = usage + res.usage
                per = max(1, res.usage.input_tokens // max(1, len(batch)))
                for j, i in enumerate(batch):
                    vec = [float(x) for x in res.embeddings[j]]
                    found[i] = vec
                    self.cache.put("embedding", keys[i], {"v": vec, "tokens": per})
        return EmbeddingResult([found[i] for i in range(len(texts))], inputs=texts, input_type=input_type,
                               model_name=self.model_name, provider_name=self.system, usage=usage)


def embed_sync(model: EmbeddingModel, texts: Sequence[str], input_type: EmbedInputType = "document") -> np.ndarray:
    """Embed `texts` (blocking) -> L2-normalised float32 matrix."""
    res = asyncio.run(model.embed(list(texts), input_type=input_type))
    m = np.asarray(res.embeddings, dtype=np.float32)
    n = np.linalg.norm(m, axis=1, keepdims=True)
    return m / np.where(n == 0, 1, n)
