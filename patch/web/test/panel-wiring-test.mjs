// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Panel controls that show a controller module (board/ui/panel-wiring.js): add them to a panel and remove them again.
// usage: node panel-wiring-test.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const W = createRequire(import.meta.url)("../../board/ui/panel-wiring.js");
let n = 0;
const env = {
  uid: (p) => p + ++n,
  types: { filter: { params: [{ id: "cutoff", name: "Cutoff", kind: "float" }] } },
  knobControl: (n, p) => ({ type: "dial", label: p.name, wire: [{ param: `${n.id}.${p.id}` }] }),
  place: (q, type, extra) => { const c = { id: "c" + (q.controls.length + 1), type, at: [q.controls.length, 0], size: [4, 4], ...extra }; q.controls.push(c); return c; },
};
const node = (id, type, parent = "", extra = {}) => ({ id, type, name: type, x: 0, y: 0, parent, params: {}, ...extra });
// A cell "W" with a Dial, a Toggle Button, a Keyboard, a Level Meter, a Wheel and a Filter in it, and a Dial on the board itself.
const board = () => ({ format: 1, id: "t", panels: [], cables: [], nodes: [
  node("W", "cell", "", { name: "Synth", inputs: [], outputs: [] }),
  node("D", "dial", "W", { name: "Macro", params: { value: 0.3 } }),
  node("B", "button", "W", { name: "Hold", params: { mode: 1 } }),
  node("K", "keyboard", "W"), node("M", "level-meter", "W"), node("S", "wheel", "W"), node("X", "xy-pad", "W"),
  node("F", "filter", "W"),
  node("D2", "dial", "", { name: "Top" }),
] });
const at = (b, id) => b.nodes.find((x) => x.id === id);

const b = board();
assert.ok(W.canAddModule(b, at(b, "D")));
assert.ok(!W.canAddModule(b, at(b, "F")), "a filter is not a controller");

// a Dial goes onto its cell's panel, which is made on the way
let r = W.addModule(b, env, at(b, "D"), "new");
assert.ok(r.control && r.panel, JSON.stringify(r));
assert.equal(r.panel.cell, "W");
assert.equal(r.control.type, "dial");
assert.deepEqual(r.control.wire, [{ param: "D.value" }]);
assert.equal(r.control.module, "D");
assert.equal(r.control.label, "Macro");
assert.equal(r.control.target, undefined, "it drives its own module, not a knob behind it");
assert.equal(at(b, "D").params.value, 0.3, "the module is left as it was");
assert.equal(b.nodes.length, 9, "no module is made");
assert.equal(b.cables.length, 0, "no cable is made");
assert.equal(W.moduleControls(b, at(b, "D")).length, 1);
assert.ok(W.addModule(b, env, at(b, "D"), r.panel.id).error, "it is on that panel already");

// the other controllers, on the same panel
const q = r.panel;
assert.deepEqual(W.addModule(b, env, at(b, "B"), q.id).control.wire, [{ press: "B" }]);
assert.equal(W.moduleControls(b, at(b, "B"))[0].control.toggle, true, "a Button in Toggle mode");
assert.deepEqual(W.addModule(b, env, at(b, "K"), q.id).control.wire, [{ keyboard: "K" }]);
assert.deepEqual(W.addModule(b, env, at(b, "M"), q.id).control.source, { out: ["M.l", "M.r"] });
assert.equal(W.addModule(b, env, at(b, "S"), q.id).control.type, "wheel");
assert.deepEqual(W.addModule(b, env, at(b, "X"), q.id).control.wire, [{ param: "X.x", axis: "x" }, { param: "X.y", axis: "y" }]);
assert.equal(b.panels.length, 1, "one panel for the cell");

// a controller on the board itself gets the board's panel
r = W.addModule(b, env, at(b, "D2"), "new");
assert.equal(r.panel.cell, undefined);
assert.equal(b.panels.length, 2);

// several panels: every panel is offered for every node
const second = W.addModule(b, env, at(b, "D"), "new");
assert.equal(second.panel.name, "Synth 2", "a second panel for the cell is numbered");
assert.equal(second.panel.controls.length, 2, "its title and the control");
assert.deepEqual(W.panelsFor(b).map((x) => x.id).sort(), [q.id, second.panel.id, r.panel.id].sort(), "every panel is offered");
assert.equal(W.moduleControls(b, at(b, "D")).length, 2, "one control on each panel");
assert.ok(W.addModule(b, env, at(b, "D"), "nope").error);
assert.ok(W.addModule(b, env, at(b, "D2"), q.id).control, "a cell's panel can show a module outside the cell");
assert.ok(W.remove(b, q.id, W.moduleControls(b, at(b, "D2")).find((h) => h.panel.id === q.id).control.id));

// a knob: a control wired straight to it, on whichever panel
const k = W.addKnob(b, env, at(b, "F"), "cutoff", second.panel.id);
assert.deepEqual(k.control.wire, [{ param: "F.cutoff" }]);
assert.equal(W.knobControls(b, at(b, "F"), "cutoff").length, 1);
assert.ok(W.addKnob(b, env, at(b, "F"), "cutoff", second.panel.id).error, "once per panel");
assert.ok(W.addKnob(b, env, at(b, "F"), "cutoff", q.id).control, "but on another panel too");
assert.ok(W.addKnob(b, env, at(b, "F"), "nope", q.id).error);
assert.ok(W.remove(b, q.id, W.knobControls(b, at(b, "F"), "cutoff").find((h) => h.panel.id === q.id).control.id));
assert.equal(W.knobControls(b, at(b, "F"), "cutoff").length, 1);
assert.ok(at(b, "F"), "the module is untouched");
assert.ok(W.remove(b, second.panel.id, second.control.id));

// removing the control keeps the module
assert.ok(W.remove(b, q.id, W.moduleControls(b, at(b, "D"))[0].control.id));
assert.equal(W.moduleControls(b, at(b, "D")).length, 0);
assert.ok(at(b, "D") && b.nodes.length === 9, "the module stays on the board");

// a control from before (a module in a Panel cell, wired to a knob): removing it takes the module with it
const old = board();
old.nodes.push(node("PC", "cell", "W", { name: "Panel" }), node("PD", "dial", "PC"));
old.panels.push({ id: "p9", name: "Old", cell: "W", cols: 40, rows: 24, panelCell: "PC",
  controls: [{ id: "c2", type: "dial", at: [0, 0], size: [4, 4], label: "Cutoff", target: { node: "F", param: "cutoff" }, module: "PD", wire: [{ param: "PD.value" }] }] });
assert.ok(!W.canAddModule(old, at(old, "PD")), "modules of a Panel cell are not offered");
assert.ok(W.remove(old, "p9", "c2"));
assert.equal(at(old, "PD"), undefined);
assert.equal(at(old, "PC"), undefined, "an empty Panel cell goes too");

// a module's view, whole or in parts (no module, no cable; one control per panel and part)
{
  const v = board();
  const venv = { ...env, hasView: () => true };
  const F = at(v, "F");
  assert.ok(W.canAddView(v, venv, F));
  assert.ok(!W.canAddView(v, { ...venv, hasView: () => false }, F), "a node without a view");
  const whole = W.addView(v, venv, F, null, "new");
  assert.ok(whole.control && whole.panel, JSON.stringify(whole));
  assert.equal(whole.panel.cell, "W");
  assert.deepEqual([whole.control.type, whole.control.node, whole.control.part], ["view", "F", undefined]);
  assert.ok(W.addView(v, venv, F, null, whole.panel.id).error, "the whole view is on that panel already");
  const disp = { id: "d:response", name: "Response", kind: "display" }, sec = { id: "s:cutoff", name: "Cutoff", kind: "controls", knobs: 3 };
  const a = W.addView(v, venv, F, disp, whole.panel.id), c = W.addView(v, venv, F, sec, whole.panel.id);
  assert.equal(a.control.part, "d:response");
  assert.equal(a.control.label, "filter · Response");
  assert.deepEqual(a.control.size, [24, 10]);
  assert.deepEqual(c.control.size, [14, 8], "a section is as wide as its knobs");
  assert.ok(W.addView(v, venv, F, disp, whole.panel.id).error, "a part once per panel");
  assert.equal(W.viewControls(v, F).length, 3);
  assert.deepEqual(W.viewControls(v, F).map((h) => h.part), [null, "d:response", "s:cutoff"]);
  assert.ok(W.addView(v, venv, F, disp, "new").control, "but on another panel too");
  assert.ok(W.remove(v, whole.panel.id, a.control.id));
  assert.equal(W.viewControls(v, F).length, 3);
  assert.equal(v.nodes.length, 9, "no module is made");
  assert.equal(v.cables.length, 0);
}
console.log("panel-wiring: ok");
