# SPDX-License-Identifier: MIT
"""Request and event schemas and the signed resume token (doc/specs/agent.md §5)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import zlib
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

MAX_MESSAGES = 40
MAX_MESSAGE_CHARS = 8000
MAX_PATCH_BYTES = 150_000
TOKEN_MAX_AGE = 15 * 60


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=MAX_MESSAGE_CHARS)


class Snapshot(BaseModel):
    patch: dict[str, Any] = Field(default_factory=dict)
    selection: list[str] = []
    environment: dict[str, Any] = {}

    @field_validator("patch")
    @classmethod
    def _size(cls, v: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(v, separators=(",", ":"))) > MAX_PATCH_BYTES:
            raise ValueError("patch is too large")
        return v


class LiveResult(BaseModel):
    call_id: str
    result: Any = None


class Resume(BaseModel):
    token: str
    results: list[LiveResult] = []


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list, max_length=MAX_MESSAGES)
    snapshot: Snapshot = Field(default_factory=Snapshot)
    mode: Literal["ask", "auto"] = "ask"
    skill: Literal["docs", "diagnose", "patch", "panel", "compose", "design"] | None = None
    resume: Resume | None = None
    client: dict[str, Any] = {}

    @field_validator("messages")
    @classmethod
    def _last_is_user(cls, v: list[ChatMessage]) -> list[ChatMessage]:
        if v and v[-1].role != "user":
            raise ValueError("the last message must be from the user")
        return v


Event = tuple[str, dict[str, Any]]


class TokenError(ValueError):
    pass


def sign_state(secret: bytes, payload: dict[str, Any]) -> str:
    body = zlib.compress(json.dumps({**payload, "iat": int(time.time())}, separators=(",", ":")).encode(), 6)
    mac = hmac.new(secret, body, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac + body).decode().rstrip("=")


def verify_state(secret: bytes, token: str, max_age: int = TOKEN_MAX_AGE) -> dict[str, Any]:
    try:
        raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
        mac, body = raw[:32], raw[32:]
        if not hmac.compare_digest(mac, hmac.new(secret, body, hashlib.sha256).digest()):
            raise TokenError("bad signature")
        data = json.loads(zlib.decompress(body))
    except TokenError:
        raise
    except Exception as e:  # noqa: BLE001
        raise TokenError("malformed token") from e
    if time.time() - data.get("iat", 0) > max_age:
        raise TokenError("token expired")
    return data
