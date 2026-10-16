# SPDX-License-Identifier: MIT
"""Sliding-window rate limits for the endpoints an attacker can hammer without an account (login, register, password reset, device sign-in).

In memory and per process: the API runs as one uvicorn worker. Behind a proxy `request.client.host` is the visitor's address
(uvicorn --proxy-headers, with Caddy replacing any X-Forwarded-For the visitor sent), so the API port must stay unpublished.
"""
import threading
import time
from collections import deque

from fastapi import HTTPException, Request, status

from .config import settings


class Limiter:
    def __init__(self, limit: int, window: float):
        self.limit, self.window = limit, window
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, key: str, t: float) -> deque[float]:
        q = self._hits.setdefault(key, deque())
        while q and t - q[0] > self.window:
            q.popleft()
        return q

    def blocked(self, key: str) -> bool:
        """Is `key` at its limit? Does not count."""
        if not settings.rate_limits:
            return False
        with self._lock:
            q = self._prune(key, time.monotonic())
            if not q:
                self._hits.pop(key, None)
            return len(q) >= self.limit

    def hit(self, key: str) -> bool:
        """Count one use of `key`; False when that was over the limit."""
        if not settings.rate_limits:
            return True
        t = time.monotonic()
        with self._lock:
            if len(self._hits) > 50_000:  # an address flood must not grow the table without end
                for k in [k for k in self._hits if not self._prune(k, t)]:
                    del self._hits[k]
            q = self._prune(key, t)
            if len(q) >= self.limit:
                return False
            q.append(t)
            return True

    def reset(self, key: str | None = None) -> None:
        with self._lock:
            if key is None:
                self._hits.clear()
            else:
                self._hits.pop(key, None)


_all: list[Limiter] = []


def limiter(limit: int, window: float) -> Limiter:
    lim = Limiter(limit, window)
    _all.append(lim)
    return lim


def reset_all() -> None:
    for lim in _all:
        lim.reset()


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def too_many(retry_after: float = 60) -> HTTPException:
    return HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts, please try again later", headers={"Retry-After": str(int(retry_after))})


def by_ip(lim: Limiter):
    """A dependency: each request counts against the visitor's address."""
    def check(request: Request) -> None:
        if not lim.hit(client_ip(request)):
            raise too_many(lim.window)
    return check
