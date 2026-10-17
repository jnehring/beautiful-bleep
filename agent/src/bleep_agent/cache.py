# SPDX-License-Identifier: MIT
"""A content-addressed cache for expensive deterministic-by-replay calls (models, embeddings, judges, renders).

Modes: use (read-through), refresh (ignore reads, write), replay-only (a miss raises CacheMiss; for CI without keys),
off (neither reads nor writes). Stored in one SQLite file, e.g. .eval-cache/cache.sqlite.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from collections import Counter
from pathlib import Path
from typing import Any

MODES = ("use", "refresh", "replay-only", "off")


class CacheMiss(RuntimeError):
    pass


def make_key(*parts: Any) -> str:
    blob = json.dumps(parts, sort_keys=True, separators=(",", ":"), default=str, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()


class Cache:
    def __init__(self, path: str | Path | None = None, mode: str = "use"):
        if mode not in MODES:
            raise ValueError(f"cache mode must be one of {MODES}")
        self.mode = mode
        self.hits: Counter[str] = Counter()
        self.misses: Counter[str] = Counter()
        self._lock = threading.Lock()
        self._db: sqlite3.Connection | None = None
        if mode != "off":
            if path is not None:
                Path(path).parent.mkdir(parents=True, exist_ok=True)
            self._db = sqlite3.connect(str(path) if path else ":memory:", check_same_thread=False)
            self._db.execute("CREATE TABLE IF NOT EXISTS cache (kind TEXT, key TEXT, value TEXT, created REAL, PRIMARY KEY (kind, key))")
            self._db.commit()

    def get(self, kind: str, key: str) -> Any | None:
        if self.mode in ("off", "refresh") or self._db is None:
            self.misses[kind] += 1
            return None
        with self._lock:
            row = self._db.execute("SELECT value FROM cache WHERE kind=? AND key=?", (kind, key)).fetchone()
        if row is None:
            self.misses[kind] += 1
            if self.mode == "replay-only":
                raise CacheMiss(f"{kind} {key[:12]} not in cache (replay-only)")
            return None
        self.hits[kind] += 1
        return json.loads(row[0])

    def put(self, kind: str, key: str, value: Any) -> None:
        if self.mode in ("off", "replay-only") or self._db is None:
            return
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO cache VALUES (?,?,?,?)", (kind, key, json.dumps(value, separators=(",", ":")), time.time()))
            self._db.commit()

    def stats(self) -> dict[str, dict[str, int]]:
        kinds = set(self.hits) | set(self.misses)
        return {k: {"hits": self.hits[k], "misses": self.misses[k]} for k in sorted(kinds)}

    def close(self) -> None:
        if self._db is not None:
            self._db.close()
            self._db = None
