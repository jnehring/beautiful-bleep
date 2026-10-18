# SPDX-License-Identifier: MIT
"""Case generators: fault-injected diagnose cases, patch templates, panel, compose and design cases (doc/agent-concept.md §9).

Ground truth comes from the graph model, so a diagnose case is only written when the injected fault really silences the patch
and the original was audible. Docs cases are written from the documentation (a seed set ships in evals/cases/docs/).
"""
from __future__ import annotations

import random
from pathlib import Path
from typing import Any

from ..catalog import Catalog
from ..patch import Patch
from ..presets import PresetLibrary
from ..sim import simulate
from .cases import Case, dump_cases
from .faults import apply_fault

DIAG_QUERIES = ["why do i not hear sound?", "i press keys but there is no sound", "my patch is silent, what is wrong?",
                "nothing comes out of the speakers", "why is there no sound?", "there is no sound, can you find out why and fix it?"]


def _audible(p: Patch, cat: Catalog) -> bool:
    return simulate(p, cat).audible


def gen_diagnose(lib: PresetLibrary, cat: Catalog, per_fault: int = 5, seed: int = 7) -> list[Case]:
    rnd = random.Random(seed)
    entries = list(lib.entries)
    rnd.shuffle(entries)
    out: list[Case] = []
    counts: dict[str, int] = {}

    def add(fault: str, e, mutate: list[dict[str, Any]], mentions: list[str], difficulty: str = "medium", env: dict | None = None,
            fixable: bool = True) -> None:
        if counts.get(fault, 0) >= per_fault:
            return
        base = Patch(e.preset)
        if not _audible(base, cat):
            return
        broken = base.copy()
        for m in mutate:
            apply_fault(broken, m)
        if mutate and _audible(broken, cat):
            return  # the fault did not silence it in the model: not a valid case
        i = counts.get(fault, 0)
        counts[fault] = i + 1
        checks: list[dict[str, Any]] = [{"kind": "valid_patch"}, {"kind": "text_contains", "any": mentions}]
        if fixable:
            checks += [{"kind": "fixes_fault"}, {"kind": "unrelated_changes", "max": 3}]
        else:
            checks += [{"kind": "no_state_change"}]
        out.append(Case(id=f"diagnose-{fault}-{i + 1:02d}", skill="diagnose", difficulty=difficulty, tags=["fault:" + fault], patch=f"preset:{e.id}",
                        mutate=mutate, query=DIAG_QUERIES[(len(out)) % len(DIAG_QUERIES)], env=env or {}, checks=checks, judge="patch_general",
                        gold={"fault": fault, "mentions": mentions}))

    for e in entries:
        p = Patch(e.preset)
        envs = p.with_role(cat, "envelope")
        vcas = p.of_type("vca")
        outs = p.of_type("audio-out")
        mixers = p.of_type("audio-mixer")
        filters = [n for n in p.of_type("filter")]
        seqs = p.with_role(cat, "sequencer") + p.with_role(cat, "note_source")
        if envs and vcas:
            env = envs[0]
            add("no-gate", e, [{"fault": "remove_cables_to", "node": env["id"], "jack": "gate"}, {"fault": "remove_cables_to", "node": env["id"], "jack": "retrig"}],
                ["gate", env["id"], env["type"]], "medium")
            gc = [c for c in p.cables_to(vcas[0]["id"], "gain")]
            if gc:
                add("vca-not-opened", e, [{"fault": "remove_cables_to", "node": vcas[0]["id"], "jack": "gain"}], ["vca", "gain", vcas[0]["id"]], "medium")
        if outs:
            add("out-unconnected", e, [{"fault": "remove_cables_to", "node": outs[0]["id"]}], ["audio out", "connect", outs[0]["id"]], "easy")
            add("out-volume-zero", e, [{"fault": "set_param", "node": outs[0]["id"], "param": "volume", "value": 0.0}], ["volume", outs[0]["id"]], "easy")
        if mixers:
            m = mixers[0]
            ch = [c["to"]["jack"] for c in p.cables_to(m["id"]) if c["to"]["jack"].startswith("in")]
            nums = sorted({int("".join(x for x in j if x.isdigit())) for j in ch if any(x.isdigit() for x in j)})
            mut = [{"fault": "set_param", "node": m["id"], "param": f"level{n}", "value": 0.0} for n in nums]
            if mut:
                add("mixer-closed", e, mut, ["mixer", "level", m["id"]], "medium")
        if filters:
            f = filters[0]
            add("filter-closed", e, [{"fault": "set_param", "node": f["id"], "param": "cutoff", "value": 0.0}, {"fault": "set_param", "node": f["id"], "param": "mode", "value": 0.0},
                                     {"fault": "remove_cables_to", "node": f["id"], "jack": "cutoff"}], ["cutoff", "filter", f["id"]], "hard")
        if seqs and vcas:
            s = seqs[0]
            add("source-unwired", e, [{"fault": "remove_cables_from", "node": s["id"]}], [s["id"], "gate", "note", "connect"], "medium")
        if outs:
            mid = [n for n in p.nodes if n["type"] in ("vca", "reverb", "delay", "chorus", "audio-mixer", "filter") and p.cables_from(n["id"])]
            if mid:
                add("module-muted", e, [{"fault": "mute", "node": mid[-1]["id"]}], ["mute", mid[-1]["id"]], "medium")
    # environment faults on healthy patches: nothing to fix in the patch, the answer must point at the setup
    healthy = [e for e in entries if any(n["type"] == "step-sequencer" for n in e.preset["nodes"])][:per_fault]
    for i, e in enumerate(healthy):
        out.append(Case(id=f"diagnose-transport-stopped-{i + 1:02d}", skill="diagnose", difficulty="easy", tags=["fault:transport"], patch=f"preset:{e.id}",
                        query=DIAG_QUERIES[i % len(DIAG_QUERIES)], env={"transport": {"playing": False, "bpm": 120}},
                        checks=[{"kind": "text_contains", "any": ["transport", "play button", "press play", "stopped"]}, {"kind": "no_state_change"}],
                        judge="patch_general", gold={"fault": "transport"}))
    for i, e in enumerate(entries[:per_fault]):
        out.append(Case(id=f"diagnose-audio-suspended-{i + 1:02d}", skill="diagnose", difficulty="easy", tags=["fault:audio-off"], patch=f"preset:{e.id}",
                        query=DIAG_QUERIES[(i + 2) % len(DIAG_QUERIES)], env={"audio": {"running": False, "sampleRate": 48000, "muted": False}},
                        checks=[{"kind": "text_contains", "any": ["audio engine", "suspended", "click", "audio is not running", "browser audio"]}, {"kind": "no_state_change"}],
                        judge="patch_general", gold={"fault": "audio-off"}))
    return out


FX = {"chorus": "chorus", "reverb": "reverb", "delay": "delay", "phaser": "phaser", "saturator": "saturator", "pitch-shifter": "pitch shifter"}


def gen_patch(lib: PresetLibrary, cat: Catalog, seed: int = 11) -> list[Case]:
    rnd = random.Random(seed)
    entries = list(lib.entries)
    rnd.shuffle(entries)
    out: list[Case] = []

    def stereo_out(p: Patch) -> bool:
        o = p.of_type("audio-out")
        return bool(o) and len(p.cables_to(o[0]["id"])) >= 2

    combos = [("chorus", "reverb"), ("delay",), ("reverb",), ("phaser", "reverb"), ("chorus",), ("delay", "reverb"), ("saturator",), ("chorus", "delay")]
    n_fx = 0
    for e in entries:
        if n_fx >= 20:
            break
        p = Patch(e.preset)
        if not stereo_out(p):
            continue
        types = {n["type"] for n in p.nodes}
        combo = combos[n_fx % len(combos)]
        if any(t in types for t in combo):
            continue
        n_fx += 1
        names = " and ".join(FX[t] for t in combo)
        checks: list[dict[str, Any]] = [{"kind": "valid_patch"}, {"kind": "layout"}, {"kind": "audible"}, {"kind": "fx_before_output", "types": list(combo)}, {"kind": "unrelated_changes", "max": 0}]
        checks += [{"kind": "module_added", "type": t} for t in combo]
        out.append(Case(id=f"patch-insert-fx-{n_fx:02d}", skill="patch", difficulty="easy" if len(combo) == 1 else "medium", tags=["insert-on-cable"],
                        patch=f"preset:{e.id}", query=f"add {names} between the synth and the output", checks=checks, judge="patch_general"))
    n = 0
    for e in entries:
        if n >= 8:
            break
        p = Patch(e.preset)
        fl = p.of_type("filter")
        if not fl or p.cables_to(fl[0]["id"], "cutoff") or p.of_type("lfo"):
            continue
        n += 1
        out.append(Case(id=f"patch-lfo-cutoff-{n:02d}", skill="patch", difficulty="medium", tags=["add-and-wire"], patch=f"preset:{e.id}",
                        query="add an LFO and use it to modulate the filter cutoff", selection=[fl[0]["id"]],
                        checks=[{"kind": "valid_patch"}, {"kind": "layout"}, {"kind": "audible"}, {"kind": "module_added", "type": "lfo"},
                                {"kind": "cable", "from": "role:lfo.out", "to": f"{fl[0]['id']}.cutoff"}, {"kind": "unrelated_changes", "max": 1}],
                        judge="patch_general"))
    n = 0
    for e in entries:
        if n >= 6:
            break
        p = Patch(e.preset)
        if p.of_type("midi-device", "midi-in", "instrument") or not (p.of_type("step-sequencer", "keyboard")):
            continue
        n += 1
        out.append(Case(id=f"patch-midi-keyboard-{n:02d}", skill="patch", difficulty="hard", tags=["midi-device"], patch=f"preset:{e.id}",
                        query="add my usb midi keyboard to the patch",
                        env={"midi": {"inputs": [{"id": "usb-1", "name": "USB MIDI Keyboard", "enabled": True}]}},
                        checks=[{"kind": "valid_patch"}, {"kind": "layout"}, {"kind": "module_added", "type": "midi-device"}, {"kind": "has_output_cable", "node": "type:midi-device"},
                                {"kind": "unrelated_changes", "max": 1}],
                        judge="patch_general"))
    n = 0
    for e in entries:
        if n >= 6:
            break
        p = Patch(e.preset)
        rv = p.of_type("reverb")
        if not rv or rv[0].get("params", {}).get("size", 0.5) > 0.7:
            continue  # room to make it bigger
        n += 1
        out.append(Case(id=f"patch-param-{n:02d}", skill="patch", difficulty="easy", tags=["set-param"], patch=f"preset:{e.id}",
                        query="make the reverb bigger", selection=[rv[0]["id"]],
                        checks=[{"kind": "valid_patch"}, {"kind": "param_changed", "node": rv[0]["id"], "param": "size", "direction": "up"},
                                {"kind": "unrelated_changes", "max": 1, "allow": [rv[0]["id"]]}], judge="patch_general"))
    return out


def gen_panel(lib: PresetLibrary, cat: Catalog, seed: int = 5) -> list[Case]:
    rnd = random.Random(seed)
    entries = [e for e in lib.entries if e.preset.get("panels") and 6 <= len(e.preset["nodes"]) <= 12]
    rnd.shuffle(entries)
    out: list[Case] = []
    for i, e in enumerate(entries[:12]):
        wired = [w["param"] for c in e.preset["panels"][0]["controls"] for w in c.get("wire", []) if "param" in w]
        key = [w for w in wired if any(w.endswith("." + k) for k in ("cutoff", "attack", "release", "mix", "level"))][:3]
        out.append(Case(id=f"panel-build-{i + 1:02d}", skill="panel", difficulty="medium", tags=["build"], patch=f"preset:{e.id}",
                        mutate=[{"fault": "strip_panels"}], query="build a panel for the patch",
                        checks=[{"kind": "panel_valid"}, {"kind": "panel_covers", "params": key, "min_controls": 6}, {"kind": "valid_patch"}, {"kind": "unrelated_changes", "max": 0}],
                        judge="panel_layout"))
    for i, e in enumerate(entries[12:25] if len(entries) > 12 else entries[:13]):
        out.append(Case(id=f"panel-organize-{i + 1:02d}", skill="panel", difficulty="medium", tags=["organize"], patch=f"preset:{e.id}",
                        mutate=[{"fault": "scramble_panel", "seed": i}], query="organize the panel",
                        checks=[{"kind": "panel_valid"}, {"kind": "panel_covers", "min_controls": max(6, len([c for c in e.preset['panels'][0]['controls'] if c.get('wire')]) - 2),
                                                          "params": [w["param"] for c in e.preset["panels"][0]["controls"][:6] for w in c.get("wire", []) if "param" in w][:2]},
                                {"kind": "valid_patch"}, {"kind": "unrelated_changes", "max": 0}], judge="panel_layout"))
    return out


MINOR = [0, 2, 3, 5, 7, 8, 10]
MAJOR = [0, 2, 4, 5, 7, 9, 11]
COMPOSE = [
    ("in the step sequencer program an acid line", dict(length=[16, 16], gated=[9, 14], accents=2, ties=1, range_semitones=[7, 24], motif=True, pitch_classes=MINOR, pitch_tolerance=2), "hard"),
    ("program a 303 style acid bassline in a minor", dict(length=[16, 16], gated=[9, 14], accents=2, ties=1, range_semitones=[7, 24], motif=True, pitch_classes=MINOR, pitch_tolerance=2), "hard"),
    ("write a driving techno bassline, 16 steps", dict(length=[16, 16], gated=[10, 16], accents=1, range_semitones=[0, 14], pitch_classes=MINOR, pitch_tolerance=2), "medium"),
    ("program an 8 step arpeggio in the sequencer", dict(length=[8, 8], gated=[6, 8], range_semitones=[5, 24]), "easy"),
    ("make a slow ambient melody with long held notes, 8 steps", dict(length=[8, 8], gated=[3, 8], ties=1, range_semitones=[4, 19]), "medium"),
    ("program a funky bassline with rests and accents", dict(length=[16, 16], gated=[7, 13], accents=2, range_semitones=[3, 17]), "medium"),
    ("give me a simple major scale melody going up and down, 16 steps", dict(length=[16, 16], gated=[14, 16], range_semitones=[10, 14], pitch_classes=MAJOR, pitch_tolerance=1), "easy"),
    ("program a repeating 4 step bass ostinato", dict(length=[4, 16], gated=[3, 16], range_semitones=[0, 12]), "easy"),
    ("a minimal house bass pattern with off-beat notes", dict(length=[16, 16], gated=[4, 10], range_semitones=[0, 12]), "medium"),
    ("write a dark phrygian riff, 16 steps with a few slides", dict(length=[16, 16], gated=[8, 14], ties=1, range_semitones=[5, 20]), "hard"),
]


def gen_compose(lib: PresetLibrary, cat: Catalog, seed: int = 3) -> list[Case]:
    rnd = random.Random(seed)
    fixtures = [e for e in lib.entries if any(n["type"] == "step-sequencer" for n in e.preset["nodes"])]
    rnd.shuffle(fixtures)
    out: list[Case] = []
    for i in range(25):
        q, chk, diff = COMPOSE[i % len(COMPOSE)]
        e = fixtures[i % len(fixtures)]
        out.append(Case(id=f"compose-{i + 1:02d}", skill="compose", difficulty=diff, tags=["sequencer"], patch=f"preset:{e.id}", query=q,
                        checks=[{"kind": "valid_patch"}, {"kind": "pattern", **chk}, {"kind": "audible"}], judge="compose_musical"))
    return out


EMPTY = {"format": 1, "tempo": 120, "nodes": [
    {"id": "out", "type": "audio-out", "name": "Out 1/2", "x": 1500, "y": 200, "parent": "", "params": {}, "port": "device-out-1"},
    {"id": "keys", "type": "keyboard", "name": "Keyboard", "x": 40, "y": 200, "parent": "", "params": {}}], "cables": []}

DESIGN = [
    ("build an acid synthesizer", [{"kind": "param_range", "node": "type:filter", "param": "resonance", "min": 0.45}], "hard"),
    ("build a fat detuned analog bass", [], "medium"),
    ("make a warm slow pad with a long release", [{"kind": "param_range", "node": "role:envelope", "param": "release", "min": 0.8}], "medium"),
    ("create a plucky synth lead with a short decay", [{"kind": "param_range", "node": "role:envelope", "param": "decay", "max": 0.8}], "medium"),
    ("build a simple subtractive synth", [], "easy"),
    ("make a bright bell-like sound", [], "hard"),
    ("build a wobble bass with an LFO on the filter", [{"kind": "has_path", "chain": ["role:lfo", "role:filter"]}], "hard"),
    ("design a classic mono lead with a bit of delay", [{"kind": "module_added", "type": "delay"}], "medium"),
    ("create a string-like ensemble pad with chorus", [{"kind": "module_added", "type": "chorus"}], "medium"),
    ("make an electric piano-ish sound", [], "hard"),
]


def gen_design(lib: PresetLibrary, cat: Catalog) -> list[Case]:
    out: list[Case] = []
    for i in range(20):
        q, extra, diff = DESIGN[i % len(DESIGN)]
        if i >= len(DESIGN):
            q = q.replace("build", "make me") if "build" in q else q + ", please"
        out.append(Case(id=f"design-{i + 1:02d}", skill="design", difficulty=diff, tags=["synth"], patch=EMPTY, query=q,
                        checks=[{"kind": "valid_patch"}, {"kind": "layout"}, {"kind": "audible"}, {"kind": "has_path", "chain": ["role:source", "type:audio-out"]}] + extra,
                        judge="design_quality"))
    return out


def generate_all(lib: PresetLibrary, cat: Catalog, out: Path) -> dict[str, int]:
    sets = {"diagnose": gen_diagnose(lib, cat), "patch": gen_patch(lib, cat), "panel": gen_panel(lib, cat), "compose": gen_compose(lib, cat), "design": gen_design(lib, cat)}
    for skill, cases in sets.items():
        dump_cases(cases, out / skill / "generated.yaml")
    return {k: len(v) for k, v in sets.items()}
