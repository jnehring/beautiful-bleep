# SPDX-License-Identifier: MIT
"""The tool surface of the assistant (doc/specs/agent.md §4).

Read and write tools run in Python against the run's working copy of the patch. Live tools are *external*: the run
ends, the browser executes them, and a later request resumes (see runner.py).
"""
from __future__ import annotations

import functools
from dataclasses import dataclass, field
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field
from pydantic_ai import ExternalToolset, FunctionToolset, ModelRetry, RunContext, ToolDefinition

from .catalog import Catalog
from .docs_index import DocsIndex
from .ops import AddModule, Changeset, Op, OpError, SetNodeData, SetParam, apply_ops, apply_primitives, make_changeset
from .panels import PanelPlan, build_panel, validate_panel
from .patch import Patch, PatchError
from .presets import PresetLibrary
from .sim import Stimulus, diagnose, simulate


@dataclass
class Deps:
    patch: Patch
    catalog: Catalog
    presets: PresetLibrary | None = None
    docs: DocsIndex | None = None
    selection: list[str] = field(default_factory=list)
    env: dict[str, Any] = field(default_factory=dict)
    mode: str = "ask"
    skill: str = "design"
    emit: Callable[[str, dict[str, Any]], None] = lambda kind, data: None
    changesets: list[Changeset] = field(default_factory=list)
    trace: Callable[[str, bool], None] = lambda tool, retried: None


def _emit_changeset(d: Deps, cs: Changeset) -> dict[str, Any]:
    d.changesets.append(cs)
    d.emit("changeset", {"id": cs.id, "summary": cs.summary, "ops": cs.ops, "lines": cs.lines, "destructive": cs.destructive,
                         "needs_confirmation": cs.destructive or d.mode == "ask", "notes": cs.notes})
    new_nodes = [o["node"]["id"] for o in cs.ops if o["op"] == "add_node"]
    out: dict[str, Any] = {"ok": True, "changeset": cs.id, "changes": cs.lines}
    if new_nodes:
        out["new_module_ids"] = new_nodes
    if cs.notes:
        out["notes"] = cs.notes
    if d.mode == "ask" or cs.destructive:
        out["status"] = "proposed: the user has to approve it before it is applied to their board"
    else:
        out["status"] = "applied to the user's board"
    return out


# ---------------------------------------------------------------------------------------------------------
# Read tools


async def get_patch(ctx: RunContext[Deps], detail: Literal["brief", "full"] = "brief") -> str:
    """The patch as text: every module (id, type, name, knobs that differ from default) and every cable. Use 'full' to also see
    default knob values. Always reflects changes you have already proposed in this conversation turn."""
    d = ctx.deps
    return d.patch.summary(d.catalog, params="all" if detail == "full" else "changed", selection=d.selection)


async def get_selection(ctx: RunContext[Deps]) -> str:
    """The modules the user currently has selected on the board (what 'this', 'it' or 'the synth' may refer to)."""
    d = ctx.deps
    if not d.selection:
        return "Nothing is selected."
    return "\n".join(d.patch.describe_node(n, d.catalog) for nid in d.selection if (n := d.patch.node(nid)))


async def list_module_types(ctx: RunContext[Deps], query: str = "", role: str = "", category: str = "", limit: int = 15) -> list[dict[str, Any]]:
    """Search the module catalog. `role` is one of: source, filter, vca, mixer, effect, reverb, chorus, delay, envelope, lfo,
    sequencer, clock, controller, note_source, utility, meter, drum. `category` matches e.g. 'Effects', 'Modulation'."""
    return [t.summary() for t in ctx.deps.catalog.search(query, role, category, min(limit, 40))]


async def describe_module(ctx: RunContext[Deps], type: str, include_docs: bool = False) -> dict[str, Any]:
    """Full facts about one module type: input and output jacks with signal types, knobs with ranges and defaults, typical use.
    Set include_docs to also get the start of its manual page."""
    t = ctx.deps.catalog.get(type)
    if t is None:
        similar = [m.type for m in ctx.deps.catalog.search(type, limit=6)]
        raise ModelRetry(f"unknown module type '{type}'. Similar: {similar}")
    out = t.summary(detail=True)
    if include_docs and ctx.deps.docs is not None and t.doc:
        text, _ = ctx.deps.docs.read(t.doc, max_tokens=1800)
        out["manual"] = text
    return out


async def search_presets(ctx: RunContext[Deps], query: str, uses: list[str] | None = None, limit: int = 6) -> list[dict[str, Any]]:
    """Find example patches in the library by words (name, tags, description). `uses` restricts to patches that contain all of
    the given module types. Use get_preset to study one before building something similar."""
    lib = ctx.deps.presets
    if lib is None:
        return [{"note": "the preset library is not available"}]
    return [e.brief() for e in lib.search(query, min(limit, 12), uses)]


async def get_preset(ctx: RunContext[Deps], id: str) -> str:
    """An example patch as text (modules, knob values, cables), in the same form as get_patch."""
    lib = ctx.deps.presets
    e = lib.by_id.get(id) if lib else None
    if e is None:
        raise ModelRetry(f"no preset '{id}'. Use search_presets to find ids.")
    return f"{e.name}: {e.description}\n" + Patch(e.preset).summary(ctx.deps.catalog)


async def get_panel(ctx: RunContext[Deps], id: str = "") -> Any:
    """The board's panels. Without id: a list (id, name, size, control count). With id: the full panel JSON."""
    panels = ctx.deps.patch.data.get("panels") or []
    if not id:
        return [{"id": p.get("id"), "name": p.get("name"), "cols": p.get("cols"), "rows": p.get("rows"), "controls": len(p.get("controls", []))}
                for p in panels] or "The board has no panels."
    p = next((p for p in panels if p.get("id") == id), None)
    if p is None:
        raise ModelRetry(f"no panel '{id}'. Panels: {[q.get('id') for q in panels]}")
    return p


async def get_sequencer(ctx: RunContext[Deps], node: str) -> dict[str, Any]:
    """A step sequencer's pattern: steps as [gate, pitch, velocity] (gate 0 off, 1 on, 2 tie; pitch in semitones from the root),
    plus its knob values (length, rate, root, scale...)."""
    d = ctx.deps
    try:
        n = d.patch.require_node(node)
    except PatchError as e:
        raise ModelRetry(str(e))
    t = d.catalog.get(n["type"])
    out: dict[str, Any] = {"node": node, "type": n["type"]}
    steps = (n.get("data") or {}).get("steps")
    if steps is not None:
        out["steps"] = [[s.get("g", 0), s.get("p", 0), s.get("v", 100)] for s in steps]
    elif n.get("data"):
        out["data_keys"] = list(n["data"])
    if t:
        out["knobs"] = {p.id: p.text(n.get("params", {}).get(p.id, p.default)) for p in t.params}
    return out


async def trace_signal(ctx: RunContext[Deps], to_node: str = "", from_node: str = "") -> str:
    """Cable paths in the patch. Give both nodes to see how a signal gets from one to the other. Give only to_node (e.g. the audio
    out) to list everything that feeds it, upstream. Give only from_node to see what it feeds."""
    d = ctx.deps
    p = d.patch
    try:
        if from_node and to_node:
            paths = p.paths(from_node, to_node)
            if not paths:
                return f"No cable path from {from_node} to {to_node}."
            return "\n".join(" ; ".join(p.cable_text(c, d.catalog) for c in path) for path in paths)
        if to_node:
            up = p.reachable([to_node], forward=False) - {to_node}
            return f"Feeding {to_node} (upstream): " + (", ".join(sorted(up)) or "nothing")
        if from_node:
            down = p.reachable([from_node], forward=True) - {from_node}
            return f"Fed by {from_node} (downstream): " + (", ".join(sorted(down)) or "nothing")
    except PatchError as e:
        raise ModelRetry(str(e))
    return "Give from_node and/or to_node."


async def check_audibility(ctx: RunContext[Deps]) -> dict[str, Any]:
    """Static diagnosis of 'why is there no sound': simulates the patch with a held note and a running transport and lists likely
    causes (no output, unconnected output, envelope without gate, closed VCA, closed filter, muted module, MIDI/keyboard unwired...),
    each with a ready fix when there is one. It is a model of the patch, not a measurement: confirm with probe_signals when unsure."""
    d = ctx.deps
    sim = simulate(d.patch, d.catalog, Stimulus())
    findings = diagnose(d.patch, d.catalog, d.env)
    return {"audible_in_model": sim.audible, "assumed": "a key is held and the transport is playing",
            "findings": [f.as_dict() for f in findings] or "nothing wrong found"}


async def search_docs(ctx: RunContext[Deps], query: str, audience: Literal["", "musicians", "developers"] = "") -> list[dict[str, Any]]:
    """Search the Bleep documentation (musician guides, module manuals, developer docs). Returns the best passages with ids and
    page URLs. Rephrase and search again if the first results do not answer the question. Cite pages by URL."""
    idx = ctx.deps.docs
    if idx is None:
        return [{"note": "the documentation index is not available"}]
    return [h.brief() for h in await idx.search(query, 6, audience or None)]


async def read_doc(ctx: RunContext[Deps], id: str) -> str:
    """Read a documentation passage by id (as returned by search_docs), or a whole page by its doc id without '#'
    (for example 'module:filter' or 'musicians/learn/modulation')."""
    idx = ctx.deps.docs
    if idx is None:
        return "The documentation index is not available."
    text, hits = idx.read(id)
    if not hits:
        raise ModelRetry(f"no documentation with id '{id}'. Use search_docs.")
    return text + "\n\nSources: " + ", ".join(h.url for h in hits[:6])


# ---------------------------------------------------------------------------------------------------------
# Write tools


async def propose_changes(ctx: RunContext[Deps], ops: list[Op], summary: str) -> dict[str, Any]:
    """Change the patch. `ops` run in order, all or nothing; a later op can use '$ref' for a module added earlier in the same call
    (set `ref` on add_module). Knob values are real units (e.g. 800 Hz, 0.25 s, 40 % as 0.4 where the unit is percent) or choice
    names. The user sees the result as one change they can undo. If an op is invalid you get the reason: fix it and call again."""
    d = ctx.deps
    try:
        cs = apply_ops(d.patch, d.catalog, list(ops), summary)
    except OpError as e:
        raise ModelRetry(f"{e.message} (op {e.index}). Nothing was changed.")
    return _emit_changeset(d, cs)


class Step(BaseModel):
    g: int = Field(1, description="0 off, 1 on, 2 tie (hold into the next step; with a new pitch it slides in legato)")
    p: int = Field(0, description="semitones above the root (the sequencer snaps to its scale)")
    v: int = Field(100, description="velocity 1..127; high values are accents")


async def set_pattern(ctx: RunContext[Deps], node: str, steps: list[Step], length: int | None = None, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Write a step sequencer pattern (up to 32 steps). `length` is how many steps play (default: len(steps)). `params` sets
    knobs, e.g. {"rate": "1/16", "root": "A", "scale": "Minor Pentatonic", "octave": 0, "gatelength": 0.5}."""
    d = ctx.deps
    n = d.patch.node(node)
    if n is None or n["type"] != "step-sequencer":
        raise ModelRetry(f"{node} is not a step-sequencer module. Step sequencers in this patch: {[x['id'] for x in d.patch.of_type('step-sequencer')]}")
    if not 1 <= len(steps) <= 32:
        raise ModelRetry("give 1..32 steps")
    full = [s.model_dump() for s in steps] + [{"g": 0, "p": 0, "v": 100}] * (32 - len(steps))
    ops: list[Any] = [SetNodeData(node=node, data={"steps": full}), SetParam(node=node, param="length", value=length or len(steps))]
    for k, v in (params or {}).items():
        ops.append(SetParam(node=node, param=k, value=v))
    try:
        cs = apply_ops(d.patch, d.catalog, ops, f"Sequencer pattern: {len(steps)} steps")
    except OpError as e:
        raise ModelRetry(f"{e.message} (op {e.index}). Nothing was changed.")
    cs.lines = [f"~ {node}: pattern of {len(steps)} steps (" + " ".join(_step_name(s) for s in steps[:16]) + (" ..." if len(steps) > 16 else "") + ")"] + \
        [l for l in cs.lines if l.startswith("~ ") and ".length" not in l and "data" not in l]
    return _emit_changeset(d, cs)


def _step_name(s: Step) -> str:
    if s.g == 0:
        return "-"
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    return names[s.p % 12] + ("^" if s.g == 2 else "") + ("!" if s.v >= 110 else "")


async def build_panel_tool(ctx: RunContext[Deps], plan: PanelPlan) -> dict[str, Any]:
    """Build a front panel for the patch from a plan: sections of knobs per module. You choose what goes on the panel (the knobs
    a player wants, grouped by function: oscillator, filter, envelope, effects, mix); the layout is done for you. Replacing a panel
    with an existing id needs the user's confirmation."""
    d = ctx.deps
    try:
        panel = build_panel(plan, d.patch, d.catalog)
    except (PatchError, ValueError) as e:
        raise ModelRetry(str(e))
    return _emit_panel(d, panel, f"Panel '{plan.name}'")


async def propose_panel(ctx: RunContext[Deps], panel: dict[str, Any], summary: str) -> dict[str, Any]:
    """Set a complete panel (JSON as in get_panel) after validation. Use for edits to an existing panel: read it with get_panel, change
    it, and send it back whole. Prefer build_panel for new panels."""
    d = ctx.deps
    errs = validate_panel(panel, d.patch, d.catalog)
    if errs:
        raise ModelRetry("panel is not valid: " + "; ".join(errs))
    return _emit_panel(d, panel, summary)


def _emit_panel(d: Deps, panel: dict[str, Any], summary: str) -> dict[str, Any]:
    errs = validate_panel(panel, d.patch, d.catalog)
    if errs:
        raise ModelRetry("panel is not valid: " + "; ".join(errs))
    existed = any(p.get("id") == panel["id"] for p in d.patch.data.get("panels", []))
    prims = [{"op": "set_panel", "panel": panel}]
    apply_primitives(d.patch, prims)
    cs = make_changeset(prims, [f"{'~ replace' if existed else '+'} panel '{panel['name']}' ({len(panel['controls'])} controls)"], summary, destructive=existed)
    return _emit_changeset(d, cs)


# ---------------------------------------------------------------------------------------------------------
# Live (external) tools: executed by the browser


def _live(name: str, description: str, props: dict[str, Any], required: list[str] | None = None) -> ToolDefinition:
    return ToolDefinition(name=name, description=description,
                          parameters_json_schema={"type": "object", "properties": props, "required": required or []})


_POINT = {"type": "object", "properties": {"node": {"type": "string"}, "jack": {"type": "string"}}, "required": ["node", "jack"]}

LIVE_TOOLS: dict[str, ToolDefinition] = {t.name: t for t in [
    _live("get_environment", "The live state of the user's setup: is the audio engine running or muted, which MIDI input devices are available, is the transport playing, "
          "which Keyboard modules exist.", {}),
    _live("probe_signals", "Measure live signals for up to 2 seconds at chosen module outputs. Returns per point whether it carries a signal, how it moves "
          "(min, max, last, transitions through 0.5, a coarse series). With test_note, a note is played on the board's Keyboard during the "
          "measurement (the user will hear it), which is needed to see envelopes and gates react. Pick points along the path to the audio out "
          "and at the gate/CV inputs you suspect.",
          {"points": {"type": "array", "items": _POINT}, "seconds": {"type": "number"},
           "test_note": {"type": "object", "properties": {"note": {"type": "integer"}, "velocity": {"type": "number"}, "seconds": {"type": "number"}}}},
          ["points"]),
    _live("play", "Play notes on the board's Keyboard so the user can hear the patch (audible!). note is a MIDI number (60 = middle C).",
          {"notes": {"type": "array", "items": {"type": "object", "properties": {"note": {"type": "integer"}, "velocity": {"type": "number"},
                                                                              "at": {"type": "number"}, "length": {"type": "number"}}}},
           "seconds": {"type": "number"}}, ["notes"]),
    _live("highlight", "Flash modules, jacks or cables on the board so the user sees what you are talking about, with an optional short message.",
          {"refs": {"type": "array", "items": {"type": "object", "properties": {"node": {"type": "string"}, "jack": {"type": "string"}, "cable": {"type": "string"}}}},
           "message": {"type": "string"}}, ["refs"]),
    _live("ask_user", "Ask the user a short question when you cannot decide (which of several synths, which MIDI device). Offer choices when you can.",
          {"question": {"type": "string"}, "choices": {"type": "array", "items": {"type": "string"}}, "allow_text": {"type": "boolean"}}, ["question"]),
]}


def live_toolset(names: list[str]) -> ExternalToolset[Deps]:
    return ExternalToolset([LIVE_TOOLS[n] for n in names if n in LIVE_TOOLS])


# ---------------------------------------------------------------------------------------------------------
# Tool groups per skill

READ = [get_patch, get_selection, list_module_types, describe_module, trace_signal]
DOCS = [search_docs, read_doc]
PRESETS = [search_presets, get_preset]
WRITE = [propose_changes]
PANEL = [get_panel, build_panel_tool, propose_panel]
SEQ = [get_sequencer, set_pattern]
DIAG = [check_audibility]


def _traced(f: Callable[..., Any]) -> Callable[..., Any]:
    """Report each call (and whether the model had to retry it) to deps.trace, for logs and the evaluation."""
    @functools.wraps(f)
    async def wrapper(ctx: RunContext[Deps], *args: Any, **kwargs: Any) -> Any:
        try:
            out = await f(ctx, *args, **kwargs)
        except ModelRetry:
            ctx.deps.trace(f.__name__, True)
            raise
        ctx.deps.trace(f.__name__, False)
        return out

    return wrapper


def function_toolset(funcs: list[Callable[..., Any]]) -> FunctionToolset[Deps]:
    seen: set[str] = set()
    uniq = []
    for f in funcs:
        if f.__name__ not in seen:
            seen.add(f.__name__)
            uniq.append(f)
    ts: FunctionToolset[Deps] = FunctionToolset(max_retries=3)
    for f in uniq:
        name = "build_panel" if f is build_panel_tool else None
        ts.add_function(_traced(f), takes_ctx=True, name=name)
    return ts
