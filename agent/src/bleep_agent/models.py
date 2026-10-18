# SPDX-License-Identifier: MIT
"""Model creation and wrappers: provider lookup, usage metering with a budget check (production)."""
from __future__ import annotations

import logging
import time
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from typing import Any

from pydantic_ai import ModelMessagesTypeAdapter
from pydantic_ai.messages import ModelMessage, ModelResponse
from pydantic_ai.models import Model, ModelRequestParameters, StreamedResponse, infer_model
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RequestUsage
from pydantic_core import to_jsonable_python


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
    if name.startswith("qwen"):  # Alibaba DashScope; needs ALIBABA_API_KEY (or DASHSCOPE_API_KEY)
        return f"alibaba:{name}"
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


def _call_record(model: Model, messages: list[ModelMessage], settings: Any, params: ModelRequestParameters, resp: ModelResponse | None,
                 latency: float, error: BaseException | None = None) -> dict[str, Any]:
    """Everything about one model call, JSON-ready: what was sent, what came back, what it cost."""
    rec: dict[str, Any] = {
        "model": model.model_name, "latency": round(latency, 3), "settings": to_jsonable_python(settings),
        "tools": [t.name for t in getattr(params, "function_tools", [])] + [t.name for t in getattr(params, "output_tools", [])],
        "request": ModelMessagesTypeAdapter.dump_python(messages, mode="json"),
    }
    if resp is not None:
        rec["response"] = ModelMessagesTypeAdapter.dump_python([resp], mode="json")[0]
        rec["usage"] = {"input_tokens": resp.usage.input_tokens, "output_tokens": resp.usage.output_tokens}
    if error is not None:
        rec["error"] = f"{type(error).__name__}: {error}"
    return rec


class MeteredModel(WrapperModel):
    """Reports each model call's tokens, refuses a call when `check()` raises (the daily budget), and hands every call,
    in full, to `on_call` (the run log)."""

    def __init__(self, wrapped: Model, on_usage: Callable[[RequestUsage], None] | None = None,
                 check: Callable[[], None] | None = None, on_call: Callable[[dict[str, Any]], None] | None = None):
        super().__init__(wrapped)
        self._on_usage = on_usage
        self._check = check
        self._on_call = on_call

    async def request(self, messages: list[ModelMessage], model_settings: ModelSettings | None,
                      model_request_parameters: ModelRequestParameters) -> ModelResponse:
        if self._check:
            self._check()
        t0 = time.perf_counter()
        try:
            resp = await super().request(messages, model_settings, model_request_parameters)
        except BaseException as e:
            if self._on_call:
                self._on_call(_call_record(self.wrapped, messages, model_settings, model_request_parameters, None, time.perf_counter() - t0, e))
            raise
        dt = time.perf_counter() - t0
        log.info("model call %.1fs tokens in=%s out=%s", dt, resp.usage.input_tokens, resp.usage.output_tokens)
        if self._on_call:
            self._on_call(_call_record(self.wrapped, messages, model_settings, model_request_parameters, resp, dt))
        if self._on_usage:
            self._on_usage(resp.usage)
        return resp

    @asynccontextmanager
    async def request_stream(self, messages: list[ModelMessage], model_settings: ModelSettings | None,
                             model_request_parameters: ModelRequestParameters, run_context: Any = None) -> AsyncGenerator[StreamedResponse]:
        if self._check:
            self._check()
        t0 = time.perf_counter()
        err: BaseException | None = None
        try:
            async with super().request_stream(messages, model_settings, model_request_parameters, run_context) as stream:
                try:
                    yield stream
                except BaseException as e:
                    err = e
                    raise
                finally:
                    u = stream.usage
                    dt = time.perf_counter() - t0
                    log.info("model call %.1fs tokens in=%s out=%s", dt, u.input_tokens, u.output_tokens)
                    if self._on_call:
                        try:
                            resp = stream.get()
                        except Exception:  # noqa: BLE001
                            resp = None
                        self._on_call(_call_record(self.wrapped, messages, model_settings, model_request_parameters, resp, dt, err))
                    if self._on_usage:
                        self._on_usage(u)
        except BaseException as e:
            if err is None and self._on_call:  # the stream could not even be opened
                self._on_call(_call_record(self.wrapped, messages, model_settings, model_request_parameters, None, time.perf_counter() - t0, e))
            raise
