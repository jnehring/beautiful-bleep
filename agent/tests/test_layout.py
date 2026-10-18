# SPDX-License-Identifier: MIT
"""Where the assistant's new modules go: flow left to right, voices in rows under each other, a mixer right of its voices, nothing on top of anything."""
from pydantic import TypeAdapter

from bleep_agent.layout import COL, NODE_W, ROW
from bleep_agent.ops import AddModule, Connect, InsertOnCable, MoveModule, Op, apply_ops
from bleep_agent.patch import Patch


def node(i, t, x, y):
    return {"id": i, "type": t, "name": i, "x": x, "y": y, "parent": "", "params": {}}


def cab(i, a, aj, b, bj):
    return {"id": i, "from": {"node": a, "jack": aj}, "to": {"node": b, "jack": bj}, "amount": 1.0}


def board(*nodes, cables=()):
    return Patch({"format": 1, "nodes": list(nodes), "cables": list(cables)})


def at(p, i):
    n = p.node(i)
    return n["x"], n["y"]


def overlapping(p):
    top = [n for n in p.nodes if not n.get("parent")]
    return [(a["id"], b["id"]) for k, a in enumerate(top) for b in top[k + 1:] if abs(a["x"] - b["x"]) < NODE_W and abs(a["y"] - b["y"]) < 180]


def backward(p):
    return [c["id"] for c in p.cables if p.node(c["to"]["node"])["x"] <= p.node(c["from"]["node"])["x"]]


def two_voices(catalog):
    p = board(node("keys", "keyboard", 40, 40), node("out", "audio-out", 1500, 40))
    ops = []
    for v in (1, 2):
        ops += [AddModule(type="oscillator", ref=f"o{v}"), AddModule(type="adsr", ref=f"e{v}"), AddModule(type="vca", ref=f"a{v}"),
                Connect(from_node="keys", from_jack="pitch", to_node=f"$o{v}", to_jack="pitch"), Connect(from_node="keys", from_jack="gate", to_node=f"$e{v}", to_jack="gate"),
                Connect(from_node=f"$o{v}", from_jack="out", to_node=f"$a{v}", to_jack="l"), Connect(from_node=f"$e{v}", from_jack="env", to_node=f"$a{v}", to_jack="gain")]
    ops += [AddModule(type="audio-mixer", ref="mix"),
            Connect(from_node="$a1", from_jack="l", to_node="$mix", to_jack="in1l"), Connect(from_node="$a2", from_jack="l", to_node="$mix", to_jack="in2l"),
            Connect(from_node="$mix", from_jack="outl", to_node="out", to_jack="l")]
    cs = apply_ops(p, catalog, ops)
    return p, cs


def test_voices_are_rows_under_each_other_and_a_mixer_collects_them(catalog):
    p, cs = two_voices(catalog)
    ids = {line.split(" as ")[1] for line in cs.lines if line.startswith("+ ") and " as " in line}
    osc = sorted(i for i in ids if p.node(i)["type"] == "oscillator")
    vca = sorted(i for i in ids if p.node(i)["type"] == "vca")
    mix = next(i for i in ids if p.node(i)["type"] == "audio-mixer")
    (o1, o2), (a1, a2) = osc, vca
    kx = at(p, "keys")[0]
    assert at(p, o1)[0] == at(p, o2)[0] == kx + COL                              # both voices start in the column after the keyboard
    assert at(p, a1)[0] == at(p, a2)[0] and at(p, o1)[1] != at(p, o2)[1]          # same columns all along, one row each
    assert abs(at(p, o1)[1] - at(p, o2)[1]) >= 2 * ROW or abs(at(p, o1)[1] - at(p, o2)[1]) == ROW  # the second voice sits under the first
    assert at(p, o1)[1] == at(p, a1)[1] and at(p, o2)[1] == at(p, a2)[1]          # a voice stays in its row
    assert at(p, mix)[0] >= max(at(p, a1)[0], at(p, a2)[0]) + COL                 # the mixer is right of the voices it mixes
    assert at(p, "out")[0] > at(p, mix)[0]                                        # and Audio Out stays right of that
    assert not overlapping(p) and not backward(p)
    adds = {pr["node"]["id"]: (pr["node"]["x"], pr["node"]["y"]) for pr in cs.ops if pr["op"] == "add_node"}
    assert all(adds[i] == at(p, i) for i in adds)  # the primitives carry the final positions


def test_an_effect_inserted_between_neighbours_pushes_the_rest_right(catalog):
    p = board(node("osc", "oscillator", 40, 40), node("vca", "vca", 340, 40), node("out", "audio-out", 640, 40),
              cables=[cab("k1", "osc", "out", "vca", "l"), cab("k2", "vca", "l", "out", "l"), cab("k3", "vca", "r", "out", "r")])
    cs = apply_ops(p, catalog, [InsertOnCable(from_node="vca", to_node="out", type="chorus", ref="ch")])
    chorus = next(n["id"] for n in p.nodes if n["type"] == "chorus")
    assert at(p, chorus) == (640, 40) and at(p, "out") == (940, 40)  # in the row, in the free column, Audio Out made room
    assert [o["id"] for o in cs.ops if o["op"] == "move_node"] == ["out"] and not overlapping(p) and not backward(p)
    assert at(p, "osc") == (40, 40) and at(p, "vca") == (340, 40)     # modules left of the insertion stay


def test_a_modulator_goes_left_of_what_it_modulates_and_not_on_top_of_the_voice(catalog):
    p = board(node("osc", "oscillator", 40, 40), node("filter", "filter", 340, 40), node("vca", "vca", 640, 40), node("out", "audio-out", 940, 40),
              cables=[cab("k1", "osc", "out", "filter", "l"), cab("k2", "filter", "l", "vca", "l"), cab("k3", "vca", "l", "out", "l")])
    apply_ops(p, catalog, [AddModule(type="lfo", ref="l"), Connect(from_node="$l", from_jack="sine", to_node="filter", to_jack="cutoff", amount=0.3)])
    lfo = next(n["id"] for n in p.nodes if n["type"] == "lfo")
    assert at(p, lfo)[0] < at(p, "filter")[0] and at(p, lfo) != (40, 40) and not overlapping(p) and not backward(p)


def test_nothing_new_is_put_on_an_existing_module_and_pinned_modules_stay(catalog):
    p = board(node("keys", "keyboard", 40, 40), node("a", "oscillator", 340, 40), node("b", "filter", 340, 260), node("out", "audio-out", 940, 40),
              cables=[cab("k1", "keys", "pitch", "a", "pitch")])
    apply_ops(p, catalog, [AddModule(type="oscillator", ref="o"), Connect(from_node="keys", from_jack="pitch", to_node="$o", to_jack="pitch"),
                           AddModule(type="vca", ref="v"), Connect(from_node="$o", from_jack="out", to_node="$v", to_jack="l"), MoveModule(node="$v", x=1200, y=700)])
    o = next(n["id"] for n in p.nodes if n["type"] == "oscillator" and n["id"] != "a")
    v = next(n["id"] for n in p.nodes if n["type"] == "vca")
    assert at(p, v) == (1200, 700)                       # the model placed it itself
    assert at(p, o)[0] == 340 and at(p, o)[1] >= 480 and not overlapping(p)  # same column as the other oscillator, the first free row under both


def test_modules_added_without_cables_stay_clear_of_the_others(catalog):
    p = board(node("keys", "keyboard", 40, 40))
    apply_ops(p, catalog, [AddModule(type="reverb", near="keys"), AddModule(type="reverb", near="keys")])
    assert not overlapping(p)


def test_a_board_that_already_flows_backwards_does_not_run_away(catalog):
    # Audio Out sits left of the reverb that feeds it (an old, untidy board): the new effect still goes between them, and nothing is pushed off to infinity
    p = board(node("osc", "oscillator", 40, 40), node("verb", "reverb", 940, 40), node("out", "audio-out", 340, 40),
              cables=[cab("k1", "osc", "out", "verb", "l"), cab("k2", "verb", "l", "out", "l"), cab("k3", "verb", "r", "out", "r")])
    apply_ops(p, catalog, [InsertOnCable(from_node="verb", to_node="out", type="chorus")])
    chorus = next(n["id"] for n in p.nodes if n["type"] == "chorus")
    assert at(p, "verb") == (940, 40) and at(p, chorus)[0] == 1240 and at(p, "out")[0] == 1540 and not overlapping(p)
