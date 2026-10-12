// SPDX-License-Identifier: MIT
// Panel controls as modules (board/ui/panel-wiring.js): create and remove them on a board document.
// usage: node panel-wiring-test.mjs [out.json]   (a board with the controls in it, for the engine's sanitiser)
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const W = createRequire(import.meta.url)("../../board/ui/panel-wiring.js");
const types = Object.fromEntries(JSON.parse(readFileSync(new URL("../../board/ui/demo-types.json", import.meta.url))).map((t) => [t.type, t]));
let n = 0;
const env = {
  types,
  uid: (p) => p + ++n,
  place: (q, type, extra) => { const c = { id: "c" + (q.controls.length + 1), type, at: [q.controls.length, 0], size: [4, 4], ...extra }; q.controls.push(c); return c; },
};
const node = (id, type, parent = "", extra = {}) => {
  const params = {};
  for (const p of types[type]?.params || []) params[p.id] = p.default;
  return { id, type, name: type, x: 400, y: 100, parent, params, ...extra };
};
// A cell "W" with a Voice Cell "V" (a filter and an oscillator in it) and a Reverb beside it.
const board = () => ({ format: 1, id: "t", panels: [], cables: [], nodes: [
  node("W", "cell", "", { name: "Synth", inputs: [{ id: "notes", name: "Notes", type: "notes" }], outputs: [] }),
  node("Wi", "cell-in", "W"), node("Wo", "cell-out", "W"),
  node("V", "voice-cell", "W", { name: "Voice", inputs: [], outputs: [] }),
  node("Vi", "cell-in", "V"), node("Vo", "cell-out", "V"), node("Vvi", "voice-in", "V"), node("Vvo", "voice-out", "V"),
  node("F", "filter", "V", { name: "Filter" }), node("O", "oscillator", "V", { name: "Osc", x: 100 }),
  node("R", "reverb", "W", { name: "Reverb" }),
] });
const count = (b, type) => b.nodes.filter((x) => x.type === type).length;

// what can drive what
assert.deepEqual(W.kindsFor(types, node("F", "filter"), { param: "cutoff" }).map((k) => k.kind), ["dial", "slider"]);
assert.deepEqual(W.kindsFor(types, node("F", "filter"), { param: "type" }).map((k) => k.kind), ["select", "dial"]);   // a cableable setting
assert.deepEqual(W.kindsFor(types, node("R", "reverb"), { param: "freeze" }).map((k) => k.kind), ["toggle"]);
assert.deepEqual(W.kindsFor(types, node("V", "voice-cell"), { jack: "notes", dir: "in" }).map((k) => k.kind), ["keys"]);
assert.deepEqual(W.kindsFor(types, node("R", "reverb"), { jack: "freeze", dir: "in" }).map((k) => k.kind), ["button", "toggle"]);
assert.deepEqual(W.kindsFor(types, node("F", "filter"), { param: "doesnotexist" }), []);

const b = board();
const F = b.nodes.find((x) => x.id === "F"), R = b.nodes.find((x) => x.id === "R"), V = b.nodes.find((x) => x.id === "V");
const cutoffBefore = F.params.cutoff;

// a knob of a module inside a Voice Cell: Panel cell beside it, bundle into the Voice Cell, bay beside the filter
let r = W.create(b, env, F, { param: "cutoff" }, "dial");
assert.ok(r.control && r.panel, JSON.stringify(r));
const q = r.panel;
assert.equal(q.cell, "W");
const panelCell = b.nodes.find((x) => x.id === q.panelCell);
assert.ok(panelCell && panelCell.parent === "W" && panelCell.type === "cell");
assert.equal(count(b, "patchbay-in"), 1);
assert.equal(count(b, "patchbay-out"), 1);
assert.equal(b.nodes.find((x) => x.type === "patchbay-in").parent, panelCell.id);
assert.equal(b.nodes.find((x) => x.type === "patchbay-out").parent, "V");     // next to the filter, inside the Voice Cell
assert.ok(V.inputs.some((j) => j.type === "patchbay"), "the Voice Cell takes the bundle");
assert.ok(panelCell.outputs.some((j) => j.type === "patchbay"));
assert.equal(F.params.cutoff, 0, "the knob is parked at 0");
const dial = b.nodes.find((x) => x.type === "dial");
assert.equal(dial.params.value, cutoffBefore, "the dial holds the knob's value");
assert.equal(dial.parent, panelCell.id);
assert.deepEqual(r.control.wire, [{ param: `${dial.id}.value` }]);
assert.equal(r.control.target.param, "cutoff");

// the same control twice is refused; a second knob of the module shares the bay
assert.ok(W.create(b, env, F, { param: "cutoff" }, "dial").error);
r = W.create(b, env, F, { param: "resonance" }, "slider");
assert.ok(r.control);
assert.equal(count(b, "patchbay-in"), 1, "one bay per module");
assert.equal(b.cables.filter((c) => c.to.node === b.nodes.find((x) => x.type === "patchbay-in").id).length, 2);

// a setting: a dropdown through a Dial with steps
r = W.create(b, env, F, { param: "type" }, "select");
assert.ok(r.control && r.control.type === "select" && r.control.options.length === 25, JSON.stringify(r.control));
const typeDial = b.nodes.find((x) => x.id === r.control.module);
assert.equal(typeDial.params.steps, 0, "25 choices are more than a Dial's 24 steps: continuous, the setting rounds");

// a toggle in the cell itself (no Voice Cell in between)
r = W.create(b, env, R, { param: "freeze" }, "toggle");
assert.ok(r.control && r.control.toggle && r.control.type === "button");
const toggle = b.nodes.find((x) => x.id === r.control.module);
assert.equal(toggle.type, "button");
assert.equal(toggle.params.mode, 1);
assert.deepEqual(toggle.data, { on: false });
assert.equal(count(b, "patchbay-in"), 2);
assert.equal(b.nodes.filter((x) => x.type === "patchbay-out" && x.parent === "W").length, 1);

// Keys on the Voice Cell's notes input
r = W.create(b, env, V, { jack: "notes", dir: "in" }, "keys");
assert.ok(r.control && r.control.type === "keys", JSON.stringify(r));
assert.ok(b.cables.some((c) => c.to.node === "V" && c.to.jack === "notes"));

if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(b));

// remove: the knobs come back to what the controls were set to, and everything the controls made goes
dial.params.value = 0.8;
for (const q2 of b.panels) for (const c of [...q2.controls]) if (c.module) assert.ok(W.remove(b, q2.id, c.id));
assert.equal(F.params.cutoff, 0.8, "the knob takes the dial's value back");
for (const type of ["patchbay-in", "patchbay-out", "dial", "button", "keyboard"]) assert.equal(count(b, type), 0, type);
assert.equal(b.nodes.some((x) => x.id === q.panelCell), false, "an empty Panel cell is removed");
assert.equal(V.inputs.length, 0);
assert.equal(b.cables.length, 0);
console.log("panel-wiring: ok");
