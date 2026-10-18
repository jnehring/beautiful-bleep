# SPDX-License-Identifier: MIT
import pytest

from bleep_agent.catalog import compatible
from bleep_agent.ops import AddModule, Connect, Disconnect, InsertOnCable, OpError, SetParam, apply_ops, apply_primitives
from bleep_agent.panels import PanelPlan, PanelSection, build_panel, validate_panel
from bleep_agent.patch import Patch
from bleep_agent.sim import diagnose, simulate


def test_catalog_units(catalog):
    f = catalog.get("filter")
    cut = f.param("cutoff")
    assert cut.map == "exp"
    assert abs(cut.from_normalised(cut.to_normalised(1000)) - 1000) < 0.5
    assert cut.parse("2 kHz")[0] == cut.to_normalised(2000)
    assert "outside" in cut.parse(99999)[1]
    with pytest.raises(ValueError):
        f.param("type").parse("no such algorithm")
    assert catalog.get("vca").roles[0] == "vca"
    assert {t.type for t in catalog.search("reverb")} >= {"reverb"}


def test_compat():
    assert compatible("audio", "control")[0]
    assert not compatible("notes", "audio")[0]
    assert not compatible("audio", "notes")[0]


def test_insert_on_stereo_cable(catalog, synth):
    cs = apply_ops(synth, catalog, [InsertOnCable(from_node="reverb", to_node="out", type="chorus", params={"mix": 0.3})])
    adds = [o for o in cs.ops if o["op"] == "add_node"]
    assert len(adds) == 1 and adds[0]["node"]["type"] == "chorus"
    new = adds[0]["node"]["id"]
    # both channels run through the new module; reverb no longer feeds the output directly
    assert len(synth.cables_to("out")) == 2 and all(c["from"]["node"] == new for c in synth.cables_to("out"))
    assert {c["to"]["jack"] for c in synth.cables_from("reverb")} == {"l", "r"}
    assert simulate(synth, catalog).audible


def test_primitives_replay(catalog, library):
    a = Patch(library.entries[3].preset)
    b = Patch(library.entries[3].preset)
    cs = apply_ops(a, catalog, [AddModule(type="delay", ref="d"), Connect(from_node="reverb", from_jack="l", to_node="$d", to_jack="l")])
    apply_primitives(b, cs.ops)
    assert a.to_dict() == b.to_dict()


def test_errors_are_transactional(catalog, synth):
    before = synth.to_dict()
    with pytest.raises(OpError) as e:
        apply_ops(synth, catalog, [AddModule(type="chorus"), Connect(from_node="vca", from_jack="nope", to_node="out", to_jack="l")])
    assert e.value.index == 1 and "no output 'nope'" in e.value.message
    assert synth.to_dict() == before
    with pytest.raises(OpError, match="cannot connect"):
        apply_ops(synth, catalog, [Connect(from_node="stepse", from_jack="notes", to_node="out", to_jack="l")])
    with pytest.raises(OpError, match="unknown module type"):
        apply_ops(synth, catalog, [AddModule(type="flux-capacitor")])
    with pytest.raises(OpError, match="port"):
        apply_ops(synth, catalog, [AddModule(type="audio-out")])


def test_modulation_cable_and_set_param(catalog, synth):
    cs = apply_ops(synth, catalog, [AddModule(type="filter", ref="f", params={"cutoff": "800 Hz"}),
                                    Connect(from_node="lfo", from_jack="out", to_node="$f", to_jack="cutoff")])
    assert any("amount 0.5" in l for l in cs.lines)
    apply_ops(synth, catalog, [SetParam(node="adsr", param="attack", value="50 ms")])
    assert 0 < synth.node("adsr")["params"]["attack"] < 1


def test_every_demo_patch_is_audible(catalog, library):
    silent = [e.name for e in library.entries if not simulate(Patch(e.preset), catalog).audible]
    assert not silent, silent[:5]
    noisy = [e.name for e in library.entries if any(f.severity == "error" for f in diagnose(Patch(e.preset), catalog))]
    assert not noisy, noisy[:5]


def test_diagnose_faults(catalog, synth):
    def broken(mutate):
        p = synth.copy()
        mutate(p)
        p._reindex()
        return {f.code for f in diagnose(p, catalog)}

    assert "LEVEL_CLOSED" in broken(lambda p: p.data.__setitem__("cables", [c for c in p.cables if c["id"] != "k4"]))      # envelope no longer opens the VCA
    assert "ENV_NO_GATE" in broken(lambda p: p.data.__setitem__("cables", [c for c in p.cables if c["id"] not in ("k2", "k3")]))
    assert "OUT_UNCONNECTED" in broken(lambda p: p.data.__setitem__("cables", [c for c in p.cables if c["to"]["node"] != "out"]))
    assert "OUT_VOLUME_ZERO" in broken(lambda p: p.node("out").setdefault("params", {}).__setitem__("volume", 0))
    assert "NO_OUTPUT" in broken(lambda p: p.data.__setitem__("nodes", [n for n in p.nodes if n["type"] != "audio-out"]))
    assert "AUDIO_OFF" in {f.code for f in diagnose(synth, catalog, {"audio": {"running": False}})}


def test_panels(catalog, library):
    bad = [e.name for e in library.entries for pn in e.preset.get("panels", []) if validate_panel(pn, Patch(e.preset), catalog)]
    assert not bad
    p = Patch(library.entries[0].preset)
    plan = PanelPlan(id="mine", name="Mine", sections=[PanelSection(title="Env", node="adsr", params=["attack", "decay", "sustain", "release"]),
                                                       PanelSection(title="Verb", node="reverb", params=["size", "mix"])])
    panel = build_panel(plan, p, catalog)
    assert validate_panel(panel, p, catalog) == []
    next(c for c in panel["controls"] if c["type"] == "dial")["wire"] = [{"param": "adsr.nope"}]
    assert validate_panel(panel, p, catalog)


def test_cables_to_a_cell_use_the_cells_own_jacks(catalog):
    """'Trigger Slate Stabs from a step sequencer': the sequencer goes next to the cell at the top level, cabled to the cell's own `notes` jack."""
    cell = {"id": "slate", "type": "cell", "name": "Slate Stabs", "x": 600, "y": 0, "parent": "", "params": {},
            "inputs": [{"id": "notes", "name": "Notes", "type": "notes"}, {"id": "cut", "name": "Cutoff", "type": "control"}],
            "outputs": [{"id": "l", "name": "Out L", "type": "audio"}, {"id": "r", "name": "Out R", "type": "audio"}]}
    p = Patch({"nodes": [cell], "cables": []})
    assert "cell jacks in: notes(notes), cut(control); out: l(audio), r(audio)" in p.summary(catalog)
    cs = apply_ops(p, catalog, [AddModule(type="step-sequencer", ref="seq", near="slate"), Connect(from_node="$seq", from_jack="notes", to_node="slate", to_jack="notes")])
    assert p.node("stepse")["parent"] == "" and any("stepse.notes -> slate.notes" in l for l in cs.lines)
    with pytest.raises(OpError, match=r"Inputs: \['notes', 'cut'\]"):
        apply_ops(p, catalog, [Connect(from_node="stepse", from_jack="pitch", to_node="slate", to_jack="gate")])


def test_set_muted_op_unmutes_and_set_node_data_refuses_mute(catalog, synth):
    from bleep_agent.ops import SetMuted, SetNodeData

    synth.node("reverb")["muted"] = True
    assert not simulate(synth, catalog).audible
    with pytest.raises(OpError, match="set_muted"):
        apply_ops(synth, catalog, [SetNodeData(node="reverb", data={"muted": False})])
    cs = apply_ops(synth, catalog, [SetMuted(node="reverb", muted=False)])
    assert cs.ops == [{"op": "set_muted", "node": "reverb", "muted": False}] and "unmuted" in cs.lines[0]
    assert not synth.node("reverb")["muted"] and simulate(synth, catalog).audible
    other = Patch(synth.to_dict())  # the client applies the same primitive
    other.node("reverb")["muted"] = True
    apply_primitives(other, cs.ops)
    assert not other.node("reverb")["muted"]


def test_scale_minor_is_read_as_natural_minor(catalog):
    p = catalog.get("step-sequencer").param("scale")
    norm, note = p.parse("Minor")
    assert p.choices[round(p.from_normalised(norm))] == "Natural Minor" and "Natural Minor" in note
    assert p.parse("minor pentatonic")[0] == p.parse("Minor Pentatonic")[0]
    with pytest.raises(ValueError):
        p.parse("Pentatonic soup")


def test_snapshot_leaves_out_embedded_sample_data():
    import json

    from bleep_agent.protocol import MAX_PATCH_BYTES, Snapshot

    patch = {"format": 1, "nodes": [], "cables": [], "media": {"a.wav": {"data": "A" * (MAX_PATCH_BYTES * 2), "name": "a"}, "b.wav": {"data": "tiny"}}}
    s = Snapshot(patch=patch)
    assert len(json.dumps(s.patch)) < 1000 and s.patch["media"]["b.wav"]["data"] == "tiny" and "audio data left out" in s.patch["media"]["a.wav"]["data"]
    assert patch["media"]["a.wav"]["data"].startswith("AAAA")  # the original is untouched
    with pytest.raises(ValueError):
        Snapshot(patch={"nodes": [{"id": "x" * (MAX_PATCH_BYTES + 1)}]})


def test_propose_panel_refuses_to_drop_wired_knobs(catalog, synth):
    import asyncio
    from types import SimpleNamespace as NS

    from pydantic_ai import ModelRetry

    from bleep_agent.tools import Deps, propose_panel

    plan = PanelPlan(id="mine", name="Mine", sections=[PanelSection(title="Env", node="adsr", params=["attack", "decay", "sustain", "release"]),
                                                       PanelSection(title="Verb", node="reverb", params=["size", "mix"])])
    panel = build_panel(plan, synth, catalog)
    apply_primitives(synth, [{"op": "set_panel", "panel": panel}])
    deps = Deps(patch=synth, catalog=catalog, emit=lambda *a, **k: None)
    smaller = {**panel, "controls": [c for c in panel["controls"] if not c.get("wire")][:1] + [c for c in panel["controls"] if c.get("wire")][:1]}
    with pytest.raises(ModelRetry, match="drops"):
        asyncio.run(propose_panel(NS(deps=deps), smaller, "trim"))
    lost = sorted({w["param"] for c in panel["controls"] for w in c.get("wire", [])} - {w["param"] for c in smaller["controls"] for w in c.get("wire", [])})
    out = asyncio.run(propose_panel(NS(deps=deps), smaller, "trim on request", removed=lost))
    assert out["ok"]


def test_set_pattern_tiles_a_motif_and_applies_variations(catalog, library):
    import asyncio
    from types import SimpleNamespace as NS

    from pydantic_ai import ModelRetry

    from bleep_agent.tools import Deps, Step, Variation, set_pattern

    p = next(Patch(e.preset) for e in library.entries if Patch(e.preset).of_type("step-sequencer"))
    seq = p.of_type("step-sequencer")[0]["id"]
    ctx = NS(deps=Deps(patch=p, catalog=catalog, emit=lambda *a, **k: None))
    motif = [Step(g=1, p=0, v=120), Step(g=1, p=7), Step(g=0), Step(g=2, p=3)]
    asyncio.run(set_pattern(ctx, seq, motif, length=16, variations=[Variation(step=16, p=12, v=127), Variation(step=5, g=0)]))
    steps = p.node(seq)["data"]["steps"]
    assert len(steps) == 32 and [s["p"] for s in steps[:16]] == [0, 7, 0, 3] * 3 + [0, 7, 0, 12]
    assert steps[4]["g"] == 0 and steps[8]["g"] == 1 and steps[15]["v"] == 127 and steps[16]["g"] == 0  # beyond the length: rests
    t = catalog.get("step-sequencer").param("length")
    assert round(t.from_normalised(p.node(seq)["params"]["length"])) == 16
    # without length the steps are written as given
    asyncio.run(set_pattern(ctx, seq, motif))
    assert round(t.from_normalised(p.node(seq)["params"]["length"])) == 4
    with pytest.raises(ModelRetry, match="outside"):
        asyncio.run(set_pattern(ctx, seq, motif, length=8, variations=[Variation(step=9)]))
    with pytest.raises(ModelRetry, match="1..32"):
        asyncio.run(set_pattern(ctx, seq, motif, length=33))


def test_describe_module_is_compact_and_the_common_modules_are_in_the_prompt(catalog):
    import asyncio
    import json
    from types import SimpleNamespace as NS

    from bleep_agent.runner import CORE_MODULES, _core_sheet
    from bleep_agent.tools import Deps, describe_module

    d = asyncio.run(describe_module(NS(deps=Deps(patch=Patch({"format": 1, "nodes": [], "cables": []}), catalog=catalog)), "filter"))
    assert all(isinstance(p, str) for p in d["params"]) and len(json.dumps(d)) < 1700
    assert any(p.startswith("cutoff") and "20..20000 Hz" in p and "default" in p for p in d["params"])
    assert any(p.startswith("type") and "SVF Multimode | " in p for p in d["params"])  # a choice knob lists its choices
    sheet = _core_sheet(catalog)
    assert len(sheet.splitlines()) == len(CORE_MODULES) and "- adsr: in gate:gate" in sheet and "knobs attack decay sustain release" in sheet
    assert len(sheet) < 2500
