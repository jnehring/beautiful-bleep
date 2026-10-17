# SPDX-License-Identifier: MIT
"""A model wrapper that replays identical requests from the cache (non-streaming)."""
from __future__ import annotations

import time
from typing import Any

from pydantic_ai import ModelMessagesTypeAdapter
from pydantic_ai.messages import ModelMessage, ModelResponse
from pydantic_ai.models import Model, ModelRequestParameters
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.settings import ModelSettings
from pydantic_core import to_jsonable_python

from ..cache import Cache, make_key

_VOLATILE = {"timestamp", "run_id", "conversation_id", "provider_response_id", "provider_url"}


def scrub(x: Any) -> Any:
    if isinstance(x, dict):
        return {k: scrub(v) for k, v in x.items() if k not in _VOLATILE}
    if isinstance(x, list):
        return [scrub(v) for v in x]
    return x


class CachingModel(WrapperModel):
    """Key = model, salt (repeat index, purpose), scrubbed message history, tool definitions, settings.
    Stores the response and the original latency, so reports of cached runs keep real numbers."""

    def __init__(self, wrapped: Model, cache: Cache, salt: str = ""):
        super().__init__(wrapped)
        self.cache, self.salt = cache, salt
        self.last_latency = 0.0
        self.calls: list[dict[str, Any]] = []  # per call: tokens, latency, cached

    async def request(self, messages: list[ModelMessage], model_settings: ModelSettings | None,
                      model_request_parameters: ModelRequestParameters) -> ModelResponse:
        key = make_key("model", self.wrapped.system, self.wrapped.model_name, self.salt,
                       scrub(ModelMessagesTypeAdapter.dump_python(messages, mode="json")),
                       scrub(to_jsonable_python(model_request_parameters)), to_jsonable_python(model_settings))
        hit = self.cache.get("model", key)
        if hit is not None:
            resp = ModelMessagesTypeAdapter.validate_python([hit["response"]])[0]
            self.calls.append({"input": resp.usage.input_tokens, "output": resp.usage.output_tokens, "latency": hit["latency"], "cached": True})
            return resp  # type: ignore[return-value]
        t0 = time.perf_counter()
        resp = await self.wrapped.request(messages, model_settings, model_request_parameters)
        lat = time.perf_counter() - t0
        self.cache.put("model", key, {"response": ModelMessagesTypeAdapter.dump_python([resp], mode="json")[0], "latency": lat})
        self.calls.append({"input": resp.usage.input_tokens, "output": resp.usage.output_tokens, "latency": lat, "cached": False})
        return resp
