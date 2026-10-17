# SPDX-License-Identifier: MIT
"""A graph model of "is anything audible": role-based signal propagation and a rule-based diagnosis.

This is an approximation by module role, not DSP (doc/specs/agent.md §6). It answers: with a note held and the
transport playing, which outputs carry a signal, where does the signal stop, and what is wrong? Phase 2 of the
probe (real levels) replaces the numbers, not the questions.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .catalog import Catalog, ModuleType
from .patch import PORT_TYPES, Patch

GATEISH = {"gate", "trigger", "notes"}
TRIGGERED_TYPES = {"modal-voice", "perc-voice"}


@dataclass
class Stimulus:
    note_held: bool = True
    transport: bool = True


@dataclass
class SimResult:
    # (node, jack) -> carries a signal / moves
    outputs: dict[tuple[str, str], bool] = field(default_factory=dict)
    sinks: dict[str, bool] = field(default_factory=dict)  # audio-out node -> receives audio
    why: dict[str, str] = field(default_factory=dict)  # node -> reason it is silent (when it has active-looking inputs)

    @property
    def audible(self) -> bool:
        return any(self.sinks.values())

    def present(self, node: str, jack: str) -> bool:
        return self.outputs.get((node, jack), False)


def _norm(n: dict[str, Any], t: ModuleType, pid: str) -> float | None:
    p = t.param(pid)
    if p is None:
        return None
    return n.get("params", {}).get(pid, p.default)


def _loops(n: dict[str, Any], t: ModuleType) -> bool:
    """An envelope whose mode is set to Loop/Cycle needs no gate."""
    for p in t.params:
        if p.choices and p.id == "mode":
            i = int(round(p.from_normalised(n.get("params", {}).get(p.id, p.default)) - p.min))
            if 0 <= i < len(p.choices) and p.choices[i].lower() in ("loop", "cycle", "free", "free run"):
                return True
    return False


def _mod_active(patch: Patch, nid: str, pid: str, outputs: dict[tuple[str, str], bool]) -> bool:
    return any(outputs.get((c["from"]["node"], c["from"]["jack"]), False) and abs(c.get("amount", 1)) > 1e-6
               for c in patch.cables_to(nid, pid))


def _inputs_active(patch: Patch, t: ModuleType, nid: str, outputs: dict[tuple[str, str], bool],
                   kinds: set[str] | None = None) -> bool:
    for j in t.inputs:
        if kinds is not None and j.type not in kinds:
            continue
        for c in patch.cables_to(nid, j.id):
            if outputs.get((c["from"]["node"], c["from"]["jack"]), False):
                return True
        if j.normal and kinds is None:
            pass
    return False


def simulate(patch: Patch, cat: Catalog, stim: Stimulus | None = None) -> SimResult:
    stim = stim or Stimulus()
    outputs: dict[tuple[str, str], bool] = {}
    why: dict[str, str] = {}
    nodes = patch.nodes

    def has_steps(n: dict[str, Any]) -> bool:
        steps = (n.get("data") or {}).get("steps")
        return True if steps is None else any(s.get("g") for s in steps)

    def node_out(n: dict[str, Any]) -> bool:
        """Does any output of node n carry a signal, by role?"""
        t = cat.get(n["type"])
        if t is None or n.get("muted"):
            if n.get("muted"):
                why[n["id"]] = "muted"
            return False
        roles = set(t.roles)
        nid = n["id"]
        any_in = _inputs_active(patch, t, nid, outputs)
        audio_in = _inputs_active(patch, t, nid, outputs, {"audio"})
        gate_in = _inputs_active(patch, t, nid, outputs, GATEISH)

        if "note_source" in roles:
            return stim.note_held
        if "sequencer" in roles:
            ok = stim.transport and has_steps(n)
            if not ok:
                why[nid] = "transport stopped" if not stim.transport else "no active steps"
            return ok
        if "clock" in roles:
            return stim.transport
        if "envelope" in roles:
            if _loops(n, t):
                return True  # a looping envelope runs free
            if not gate_in:
                why[nid] = "no gate or trigger arrives"
            return gate_in
        if "vca" in roles and t.type == "vca":
            if not audio_in:
                return False
            gain = _norm(n, t, "gain") or 0.0
            if gain > 1e-3 or _mod_active(patch, nid, "gain", outputs):
                return True
            why[nid] = "gain is 0 and nothing opens it"
            return False
        if t.type == "low-pass-gate":
            if not audio_in:
                return False
            if (_norm(n, t, "level") or 0.0) > 1e-3 or _mod_active(patch, nid, "level", outputs) or \
               any(outputs.get((c["from"]["node"], c["from"]["jack"]), False) for c in patch.cables_to(nid, "cv")) or \
               any(outputs.get((c["from"]["node"], c["from"]["jack"]), False) for c in patch.cables_to(nid, "ping")):
                return True
            why[nid] = "level is 0 and nothing opens it"
            return False
        if "mixer" in roles and t.type == "audio-mixer":
            master = _norm(n, t, "master")
            if master is not None and master <= 1e-3 and not _mod_active(patch, nid, "master", outputs):
                why[nid] = "master level is 0"
                return False
            live = False
            for j in t.inputs:
                if j.type != "audio" or j.id.startswith("return"):
                    live = live or (j.type == "audio" and _inputs_active(patch, t, nid, outputs, {"audio"}))
                    continue
                m = re.match(r"in(\d+)", j.id)
                if not m:
                    continue
                src = any(outputs.get((c["from"]["node"], c["from"]["jack"]), False) for c in patch.cables_to(nid, j.id))
                if not src:
                    continue
                lvl = _norm(n, t, f"level{m.group(1)}")
                if (lvl is None or lvl > 1e-3 or _mod_active(patch, nid, f"level{m.group(1)}", outputs)):
                    live = True
            if not live and audio_in:
                why[nid] = "every connected channel level is 0"
            return live
        if t.type == "filter":
            if not audio_in:
                return False
            cut = _norm(n, t, "cutoff")
            mode = _norm(n, t, "mode") or 0.0
            if cut is not None and cut < 0.03 and mode < 0.1 and not _mod_active(patch, nid, "cutoff", outputs):
                why[nid] = "low-pass cutoff is fully closed"
                return False
            return True
        if t.type == "audio-out":
            return audio_in
        if "source" in roles:
            triggered = t.category.startswith("Drums/") or t.type in TRIGGERED_TYPES
            if triggered:
                if not gate_in:
                    why[nid] = "no trigger or notes arrive"
                return gate_in
            return True  # oscillators and generators run free
        if "modulator" in roles:
            if t.category == "Modulation/Followers":
                return audio_in
            return True
        if t.type == "grains" and n.get("data"):
            return True  # a granular node plays its stored/frozen buffer without input
        if t.type in ("voice-cell", "cell"):
            return any_in or _cell_has_free_source(patch, cat, nid)
        if "port" in roles and "input" in roles:
            return True  # audio in: whatever the host feeds
        return any_in

    def _cell_has_free_source(p: Patch, c: Catalog, cell_id: str) -> bool:
        for m in p.nodes:
            if m.get("parent") == cell_id:
                mt = c.get(m["type"])
                if mt and "source" in mt.roles and not mt.category.startswith("Drums/") and mt.type not in TRIGGERED_TYPES:
                    return True
        return False

    # cell bridging: cell-in outputs follow the cell node's inputs, the cell node's outputs follow cell-out inputs
    def bridged(n: dict[str, Any]) -> bool | None:
        if n["type"] in ("cell-in", "voice-in"):
            cell = patch.node(n.get("parent", ""))
            if cell:
                ct = cat.get(cell["type"])
                return bool(ct and _inputs_active(patch, ct, cell["id"], outputs))
        return None

    for _ in range(len(nodes) + 2):  # propagate to a fixed point (cycles settle after one lap)
        changed = False
        for n in nodes:
            t = cat.get(n["type"])
            if t is None:
                continue
            b = bridged(n)
            active = b if b is not None else node_out(n)
            if t.type in ("voice-cell", "cell"):
                outs_in_cell = [m for m in nodes if m.get("parent") == n["id"] and m["type"] in ("cell-out", "voice-out")]
                if outs_in_cell:
                    active = any(_inputs_active(patch, cat.get(m["type"]) or t, m["id"], outputs) for m in outs_in_cell) or \
                        (active and not any_cell_in(patch, n))
            for j in t.outputs:
                # a node's outputs are active as a whole, except jacks that need more than the node being alive
                a = active and _jack_alive(t, j.id, j.type, active, n, stim)
                if outputs.get((n["id"], j.id)) != a:
                    outputs[(n["id"], j.id)] = a
                    changed = True
        if not changed:
            break

    sinks = {}
    for n in nodes:
        if n["type"] == "audio-out":
            t = cat.get(n["type"])
            sinks[n["id"]] = bool(t and not n.get("muted") and _inputs_active(patch, t, n["id"], outputs, {"audio"})
                                  and (_norm(n, t, "volume") or 0.0) > 1e-3)
    return SimResult(outputs=outputs, sinks=sinks, why=why)


def any_cell_in(patch: Patch, cell: dict[str, Any]) -> bool:
    return any(m.get("parent") == cell["id"] and m["type"] in ("cell-in", "voice-in") for m in patch.nodes)


def _jack_alive(t: ModuleType, jack: str, jtype: str, active: bool, n: dict[str, Any], stim: Stimulus) -> bool:
    """Within an active node some jacks stay quiet: bend/mod/cc of a note source, 'end' triggers, and so on."""
    if "note_source" in t.roles:
        return jack in ("notes", "pitch", "gate", "velocity", "vel", "trigger")
    return active


# ---------------------------------------------------------------------------------------------------------
# Diagnosis


@dataclass
class Finding:
    code: str
    severity: str  # error | warning | info
    message: str
    node: str | None = None
    jack: str | None = None
    fix: dict[str, Any] | None = None  # arguments for propose_changes

    def as_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"code": self.code, "severity": self.severity, "message": self.message}
        if self.node:
            d["node"] = self.node
        if self.jack:
            d["jack"] = self.jack
        if self.fix:
            d["fix"] = self.fix
        return d


def diagnose(patch: Patch, cat: Catalog, env: dict[str, Any] | None = None, stim: Stimulus | None = None) -> list[Finding]:
    """Why might this patch be silent? Findings in order of likelihood; empty list = nothing wrong found."""
    f: list[Finding] = []
    env = env or {}
    sim = simulate(patch, cat, stim)
    outs = patch.of_type("audio-out")

    # host / environment
    audio = env.get("audio") or {}
    if audio.get("running") is False:
        f.append(Finding("AUDIO_OFF", "error", "The audio engine is not running (browser audio is suspended until you click or press a key in the page)."))
    if audio.get("muted"):
        f.append(Finding("AUDIO_MUTED", "error", "Audio output is muted in the host."))
    transport = env.get("transport") or {}
    if transport.get("playing") is False and patch.with_role(cat, "sequencer"):
        f.append(Finding("TRANSPORT_STOPPED", "warning", "A sequencer is in the patch but the transport is stopped, so it does not play. Press play."))

    if not outs:
        f.append(Finding("NO_OUTPUT", "error", "There is no Audio Out module, so nothing reaches the speakers."))
        return f
    for o in outs:
        t = cat.get(o["type"])
        if o.get("muted"):
            f.append(Finding("OUT_MUTED", "error", f"{o['id']} is muted.", o["id"],
                             fix={"ops": [{"op": "set_param", "node": o["id"], "param": "volume", "value": 0.8}]} if False else None))
        if t and (_norm(o, t, "volume") or 0.0) <= 1e-3:
            f.append(Finding("OUT_VOLUME_ZERO", "error", f"{o['id']} volume is 0.", o["id"],
                             fix={"ops": [{"op": "set_param", "node": o["id"], "param": "volume", "value": 0.8}]}))
        if not patch.cables_to(o["id"]):
            f.append(Finding("OUT_UNCONNECTED", "error", f"Nothing is connected to {o['id']} (Audio Out).", o["id"]))

    sources = [n for n in patch.with_role(cat, "source")]
    if not sources:
        f.append(Finding("NO_SOURCE", "error", "There is no sound source (oscillator, noise, drum voice, sampler...) in the patch."))
    for s in sources:
        t = cat.get(s["type"])
        audio_outs = [j.id for j in t.outputs if j.type == "audio"] if t else []
        if audio_outs and not any(patch.cables_from(s["id"], j) for j in audio_outs):
            f.append(Finding("SOURCE_UNCONNECTED", "warning", f"{s['id']} ({s['type']}) has no cable from any audio output.", s["id"]))

    # note/gate chain
    note_srcs = patch.with_role(cat, "note_source") + patch.with_role(cat, "sequencer")
    for e in patch.with_role(cat, "envelope"):
        t = cat.get(e["type"])
        gate_jacks = [j.id for j in t.inputs if j.type in ("gate", "trigger")] if t else []
        if gate_jacks and not any(patch.cables_to(e["id"], j) for j in gate_jacks):
            fix = None
            gsrc = next((n for n in note_srcs if cat.get(n["type"]) and cat.get(n["type"]).output("gate")), None)
            if gsrc and "gate" in gate_jacks:
                fix = {"ops": [{"op": "connect", "from_node": gsrc["id"], "from_jack": "gate", "to_node": e["id"], "to_jack": "gate"}]}
            f.append(Finding("ENV_NO_GATE", "error", f"Envelope {e['id']} never receives a gate or trigger, so it stays at zero and whatever it controls stays closed.",
                             e["id"], "gate", fix))
    for k in patch.of_type("keyboard", "midi-device", "midi-in", "instrument"):
        t = cat.get(k["type"])
        if t and not any(patch.cables_from(k["id"], j.id) for j in t.outputs):
            f.append(Finding("NOTE_SOURCE_UNWIRED", "error", f"{k['id']} ({k['type']}) plays notes, but none of its outputs is connected to anything.", k["id"]))
    midi = env.get("midi") or {}
    if patch.of_type("midi-device", "midi-in") and midi.get("inputs") == [] and not patch.of_type("keyboard"):
        f.append(Finding("NO_MIDI_DEVICE", "warning", "The patch listens to MIDI, but no MIDI input device is available and there is no on-screen Keyboard module."))

    # closed gates / levels found by the simulation
    for nid, reason in sim.why.items():
        n = patch.node(nid)
        if not n:
            continue
        if reason in ("gain is 0 and nothing opens it", "level is 0 and nothing opens it") or "level is 0" in reason or "master" in reason:
            param = "gain" if n["type"] == "vca" else "master" if "master" in reason else "level"
            f.append(Finding("LEVEL_CLOSED", "error", f"{nid} ({n['type']}): {reason}.", nid, param,
                             fix={"ops": [{"op": "set_param", "node": nid, "param": param, "value": 1.0}]} if n["type"] != "audio-mixer" or param == "master" else None))
        elif "cutoff" in reason:
            f.append(Finding("FILTER_CLOSED", "error", f"{nid} (filter): {reason}.", nid, "cutoff",
                             fix={"ops": [{"op": "set_param", "node": nid, "param": "cutoff", "value": "2 kHz"}]}))
        elif reason == "muted":
            f.append(Finding("NODE_MUTED", "error", f"{nid} is muted.", nid))
        elif reason in ("transport stopped", "no active steps"):
            f.append(Finding("SEQ_IDLE", "warning", f"{nid}: {reason}.", nid))

    if sim.audible:  # the model says sound arrives: structural findings are observations, not causes
        for x in f:
            if x.code in {"NO_SOURCE", "ENV_NO_GATE", "LEVEL_CLOSED", "FILTER_CLOSED", "SOURCE_UNCONNECTED", "NOTE_SOURCE_UNWIRED"}:
                x.severity = "info"
    if outs and not sim.audible and not any(x.severity == "error" for x in f):
        # nothing specific found: report where the signal stops
        brk = first_break(patch, cat, sim)
        f.append(Finding("SIGNAL_STOPS", "error", brk or "No signal reaches the output, but no single cause was found.", None))
    return f


def first_break(patch: Patch, cat: Catalog, sim: SimResult) -> str | None:
    """Walk back from the audio outs to the first module whose inputs carry signal but whose outputs do not."""
    seen: set[str] = set()
    todo = [c["from"]["node"] for o in patch.of_type("audio-out") for c in patch.cables_to(o["id"])]
    while todo:
        n = todo.pop(0)
        if n in seen:
            continue
        seen.add(n)
        node = patch.node(n)
        t = cat.get(node["type"]) if node else None
        if not t:
            continue
        outs_active = any(sim.present(n, j.id) for j in t.outputs)
        ins = patch.predecessors(n)
        ins_active = any(any(sim.present(m, j.id) for j in (cat.get(patch.node(m)["type"]).outputs if cat.get(patch.node(m)["type"]) else []))
                         for m in ins)
        if not outs_active and ins_active:
            return f"Signal arrives at {n} ({t.type}) but nothing leaves it" + (f": {sim.why[n]}" if n in sim.why else "")
        if not outs_active and not ins:
            return f"{n} ({t.type}) produces no signal" + (f": {sim.why[n]}" if n in sim.why else "")
        todo.extend(ins)
    return None
