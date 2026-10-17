# SPDX-License-Identifier: MIT
"""Skills: a prompt section plus a tool subset (doc/agent-concept.md §5), and routing a request to one."""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from typing import Any, Callable

from . import tools as T


@dataclass(frozen=True)
class Skill:
    name: str
    prompt: str
    funcs: tuple[Callable[..., Any], ...]
    live: tuple[str, ...]
    catalog_index: bool  # include the module-type index in the prompt


_READ = tuple(T.READ)

SKILLS: dict[str, Skill] = {
    "docs": Skill("docs", "docs.md", _READ + tuple(T.DOCS), (), False),
    "diagnose": Skill("diagnose", "diagnose.md", _READ + tuple(T.DIAG) + tuple(T.WRITE) + tuple(T.DOCS),
                      ("get_environment", "probe_signals", "highlight", "ask_user"), True),
    "patch": Skill("patch", "patch.md", _READ + tuple(T.WRITE) + tuple(T.PRESETS) + tuple(T.DOCS),
                   ("get_environment", "highlight", "ask_user"), True),
    "panel": Skill("panel", "panel.md", _READ + tuple(T.PANEL) + tuple(T.DOCS), ("highlight",), True),
    "compose": Skill("compose", "compose.md", _READ + tuple(T.SEQ) + tuple(T.WRITE) + tuple(T.DOCS),
                     ("play", "ask_user"), True),
    "design": Skill("design", "design.md", _READ + tuple(T.WRITE) + tuple(T.PRESETS) + tuple(T.SEQ) + tuple(T.PANEL) + tuple(T.DIAG) + tuple(T.DOCS),
                    ("get_environment", "probe_signals", "play", "highlight", "ask_user"), True),
}

_DIAG = re.compile(r"(no sound|not hear|n't hear|cannot hear|can't hear|silen|nothing (happens|plays|comes)|no output|dead\b|why (is|do|does|am|can't|cannot|isn't|doesn't)\b.*(sound|hear|play|work|silent|noise))", re.I)
_QUESTION = re.compile(r"^\s*(how|what|which|where|when|who|can|could|does|do|is|are|explain|tell me|show me how|where's|what's)\b", re.I)
_FOR_ME = re.compile(r"\b(for me|please|can you (add|build|make|create|insert|put|set|program))\b", re.I)
_RX = [
    ("panel", re.compile(r"\bpanels?\b", re.I)),
    ("compose", re.compile(r"\b(step[- ]?sequencer|sequencer|melody|bass ?line|riff|arp|acid line|pattern|program an?)\b", re.I)),
    ("design", re.compile(r"\b(build|create|make|design|give me)\b.*\b(synth\w*|sound|pad|bass|lead|pluck|kick|snare|drum|instrument|voice|patch)\b", re.I)),
    ("patch", re.compile(r"\b(add|insert|put|place|connect|disconnect|remove|delete|replace|swap|wire up|route|hook|plug|set|change|make|raise|lower|reduce|use my|increase|decrease|turn)\b", re.I)),
]


def route(text: str, hint: str | None = None) -> str:
    """Pick a skill: an explicit hint, else by the words of the request. Questions about Bleep itself go to 'docs'."""
    if hint in SKILLS:
        return hint
    if _DIAG.search(text):
        return "diagnose"
    if _QUESTION.search(text) and not _FOR_ME.search(text):
        return "docs"
    for name, rx in _RX:
        if rx.search(text):
            return name
    return "docs"


@lru_cache
def prompt_text(name: str) -> str:
    return (resources.files("bleep_agent") / "prompts" / name).read_text()
