# SPDX-License-Identifier: MIT
"""Model creation and wrappers: provider lookup, usage metering with a budget check (production)."""
from __future__ import annotations

import logging
import time
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from typing import Any

from pydantic_ai.messages import ModelMessage, ModelResponse
from pydantic_ai.models import Model, ModelRequestParameters, StreamedResponse, infer_model
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RequestUsage


log = logging.getLogger("bleep_agent")


class BudgetExceeded(RuntimeError):
    """The daily token budget is used up."""


def normalize_model_name(name: str) -> str:
    if name.startswith("google-gla:"):  # the old provider name
        return "google:" + name.split(":", 1)[1]
    if ":" in name:
        return name
    if name.startswith("gemini"):
        return f"google:{name}"
    if name.startswith(("gpt", "o1", "o3", "o4")):
        return f"openai:{name}"
    if name.startswith("claude"):
        return f"anthropic:{name}"
    return name


def create_model(name: str, api_key: str | None = None) -> Model:
    """'gemini-3.8-flash' or 'google:gemini-3.8-flash' -> a model object. An explicit key beats the environment."""
    full = normalize_model_name(name)
    prov, _, m = full.partition(":")
    if api_key:
        if prov in ("google", "google-gla"):
            from pydantic_ai.models.google import GoogleModel
            from pydantic_ai.providers.google import GoogleProvider

            return GoogleModel(m, provider=GoogleProvider(api_key=api_key))
        if prov == "openai":
            from pydantic_ai.models.openai import OpenAIChatModel
            from pydantic_ai.providers.openai import OpenAIProvider

            return OpenAIChatModel(m, provider=OpenAIProvider(api_key=api_key))
    return infer_model(full)


class MeteredModel(WrapperModel):
    """Reports each model call's tokens and refuses a call when `check()` raises (the daily budget)."""

    def __init__(self, wrapped: Model, on_usage: Callable[[RequestUsage], None] | None = None,
                 check: Callable[[], None] | None = None):
        super().__init__(wrapped)
        self._on_usage = on_usage
        self._check = check

    async def request(self, messages: list[ModelMessage], model_settings: ModelSettings | None,
                      model_request_parameters: ModelRequestParameters) -> ModelResponse:
        if self._check:
            self._check()
        t0 = time.perf_counter()
        resp = await super().request(messages, model_settings, model_request_parameters)
        log.info("model call %.1fs tokens in=%s out=%s", time.perf_counter() - t0, resp.usage.input_tokens, resp.usage.output_tokens)
        if self._on_usage:
            self._on_usage(resp.usage)
        return resp

    @asynccontextmanager
    async def request_stream(self, messages: list[ModelMessage], model_settings: ModelSettings | None,
                             model_request_parameters: ModelRequestParameters, run_context: Any = None) -> AsyncGenerator[StreamedResponse]:
        if self._check:
            self._check()
        t0 = time.perf_counter()
        async with super().request_stream(messages, model_settings, model_request_parameters, run_context) as stream:
            try:
                yield stream
            finally:
                u = stream.usage
                log.info("model call %.1fs tokens in=%s out=%s", time.perf_counter() - t0, u.input_tokens, u.output_tokens)
                if self._on_usage:
                    self._on_usage(stream.usage)
