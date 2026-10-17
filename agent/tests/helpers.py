# SPDX-License-Identifier: MIT
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel


def returned(messages, tool):
    return [p for m in messages for p in getattr(m, "parts", []) if isinstance(p, ToolReturnPart) and p.tool_name == tool]


def scripted(*steps):
    """Step n answers the n-th model call: (tool_name, args) or a string (final text)."""
    def fn(messages, info):
        n = sum(1 for m in messages if isinstance(m, ModelResponse))
        s = steps[min(n, len(steps) - 1)]
        if isinstance(s, str):
            return ModelResponse(parts=[TextPart(s)])
        return ModelResponse(parts=[ToolCallPart(s[0], s[1])])
    return FunctionModel(fn)
