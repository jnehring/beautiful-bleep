# SPDX-License-Identifier: MIT
from __future__ import annotations

from importlib import resources
from pathlib import Path

import yaml


def load_prices(path: Path | None = None) -> dict:
    text = path.read_text() if path else (resources.files("bleep_agent") / "evals" / "prices.yaml").read_text()
    return yaml.safe_load(text)


def short_name(model: str) -> str:
    return model.split(":", 1)[-1]


def cost(prices: dict, model: str, tokens_in: int, tokens_out: int, cached_in: int = 0) -> float | None:
    p = (prices.get("models") or {}).get(short_name(model))
    if not p or p.get("input") is None or p.get("output") is None:
        return None
    cached_rate = p.get("cached_input") if p.get("cached_input") is not None else p["input"]
    fresh = max(0, tokens_in - cached_in)
    return (fresh * p["input"] + cached_in * cached_rate + tokens_out * p["output"]) / 1_000_000
