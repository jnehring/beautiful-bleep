// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Patch bays in the browser build: flattenPatchbays leaves plain cables (the same cases as controller_modules_test.cpp).
// usage: node patchbay-test.mjs
import assert from "node:assert/strict";
import { flattenPatchbays } from "../js/graph.js";

const node = (id, type, parent = "", extra = {}) => ({ id, type, name: id, x: 0, y: 0, parent, muted: false, params: {}, ...extra });
const cable = (id, a, aj, b, bj, amount = 1) => ({ id, from: { node: a, jack: aj }, to: { node: b, jack: bj }, amount });

{  // a dial through a bay straight to a knob: one cable, the amounts multiply
  const flat = flattenPatchbays({ nodes: [node("d", "dial"), node("a", "patchbay-in"), node("b", "patchbay-out"), node("f", "filter")],
    cables: [cable("k1", "d", "out", "a", "c1", 0.5), cable("k2", "a", "bundle", "b", "bundle"), cable("k3", "b", "c1", "f", "cutoff", 0.5)] });
  assert.equal(flat.nodes.length, 2);
  assert.equal(flat.cables.length, 1);
  assert.deepEqual([flat.cables[0].from.node, flat.cables[0].to.node, flat.cables[0].to.jack], ["d", "f", "cutoff"]);
  assert.ok(Math.abs(flat.cables[0].amount - 0.25) < 1e-9);
}
{  // the bundle goes through a cell's Cell Out and into the bay beside the module
  const flat = flattenPatchbays({ nodes: [node("p", "cell", "", { outputs: [{ id: "saw", name: "Saw", type: "patchbay" }] }), node("d1", "dial", "p"), node("d2", "dial", "p"),
      node("a", "patchbay-in", "p"), node("co", "cell-out", "p"), node("b", "patchbay-out"), node("f", "filter")],
    cables: [cable("k1", "d1", "out", "a", "c1"), cable("k2", "d2", "out", "a", "c2"), cable("k3", "a", "bundle", "co", "saw"),
             cable("k4", "p", "saw", "b", "bundle"), cable("k5", "b", "c1", "f", "cutoff"), cable("k6", "b", "c2", "f", "resonance")] });
  assert.equal(flat.cables.length, 2);
  for (const c of flat.cables) assert.ok((c.to.jack === "cutoff" && c.from.node === "d1") || (c.to.jack === "resonance" && c.from.node === "d2"));
}
{  // bays in a row
  const flat = flattenPatchbays({ nodes: [node("d", "dial"), node("a1", "patchbay-in"), node("b1", "patchbay-out"), node("a2", "patchbay-in"), node("b2", "patchbay-out"), node("f", "filter")],
    cables: [cable("k1", "d", "out", "a1", "c1"), cable("k2", "a1", "bundle", "b1", "bundle"), cable("k3", "b1", "c1", "a2", "c1"),
             cable("k4", "a2", "bundle", "b2", "bundle"), cable("k5", "b2", "c1", "f", "cutoff")] });
  assert.equal(flat.cables.length, 1);
  assert.equal(flat.cables[0].from.node, "d");
}
{  // a board without bays is returned as it is
  const board = { nodes: [node("d", "dial")], cables: [] };
  assert.equal(flattenPatchbays(board), board);
}
console.log("patchbay flatten: ok");
