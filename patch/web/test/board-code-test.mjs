// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// board-code.js (the Code node): what the board asks of it without a compiler: the node's type description, when its view is rebuilt,
// and that a board with Code nodes is handed to the compiler once.   node patch/web/test/board-code-test.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const calls = [];
globalThis.BleepWeb = { registerCode: (id, spec, wasm) => calls.push({ id, spec, wasm }) };
await import(fileURLToPath(new URL("../../board/ui/board-code.js", import.meta.url)));
const { BleepCode } = globalThis;

const iface = { type: "gains", name: "Gains", category: "Utility/Mixing", colour: "#94a3b8", description: "d",
  params: [{ id: "vol", name: "Volume", kind: "float", default: 0.5, steps: 0, modulatable: true, min: 0, max: 1, def: 0.5, format: "number", decimals: 1 }],
  inputs: [{ id: "x", name: "In", type: "audio", bipolar: true }], outputs: [{ id: "out", name: "Out", type: "audio", bipolar: true }],
  probes: [{ id: "level", name: "Level" }] };

// a node without an interface is the empty Code type
assert.equal(BleepCode.uiSpec({ id: "n1", type: "code" }), BleepCode.type);
assert.equal(BleepCode.type.type, "code");
assert.deepEqual([BleepCode.type.params, BleepCode.type.inputs, BleepCode.type.outputs], [[], [], []]);
assert.equal(BleepCode.type.creatable, true);

// with one, jacks, knobs and probes come from it, and the board's hooks still see the type "code"
const node = { id: "n1", type: "code", code: { source: "s", interface: iface } };
const spec = BleepCode.uiSpec(node);
assert.equal(spec.type, "code");
assert.equal(spec.name, "Code");
assert.deepEqual(spec.inputs.map((j) => j.id), ["x"]);
assert.deepEqual(spec.params.map((p) => p.id), ["vol"]);
assert.deepEqual(spec.probes, [{ id: "level", name: "Level" }]);
assert.equal(BleepCode.uiSpec(node), spec, "the same object each time: typeOf runs on every render");

// the view is rebuilt when the interface changes, not when only the source does
assert.equal(BleepCode.keyOf({ id: "n1", type: "code" }), "");
const same = { id: "n2", type: "code", code: { source: "other source", interface: { ...iface } } };
assert.equal(BleepCode.keyOf(same), BleepCode.keyOf(node));
const changed = { id: "n3", type: "code", code: { source: "s", interface: { ...iface, params: [] } } };
assert.notEqual(BleepCode.keyOf(changed), BleepCode.keyOf(node));

// sources are told apart by their hash
assert.equal(BleepCode.hashOf("abc"), BleepCode.hashOf("abc"));
assert.notEqual(BleepCode.hashOf("abc"), BleepCode.hashOf("abd"));

// boards: sync never throws, whatever it is given, and does nothing for nodes without source
assert.doesNotThrow(() => BleepCode.sync(null));
assert.doesNotThrow(() => BleepCode.sync({}));
assert.doesNotThrow(() => BleepCode.sync({ nodes: [{ id: "a", type: "oscillator" }, { id: "b", type: "code" }, { id: "c", type: "code", code: { interface: iface } }] }));
assert.equal(calls.length, 0);

// patch scripts: what a script built replaces what it built before, and keeps the cables that still fit
{
  assert.equal(BleepCode.isPatch('import { cell } from "bleep/patch";\nexport default cell("A", (c) => {});'), true);
  assert.equal(BleepCode.isPatch('@module({ name: "M" })\nexport class M {}'), false);
  assert.equal(BleepCode.isPatch("const x = 1;"), false);
  const made = (names, ins = ["pitch"], outs = ["l"]) => ({
    nodes: [{ id: "gen-c1", type: "cell", name: "SuperSaw", x: 0, y: 0, parent: "", params: {}, generatedBy: "c1", inputs: ins.map((id) => ({ id, name: id, type: "audio" })), outputs: outs.map((id) => ({ id, name: id, type: "audio" })) },
      { id: "gen-c1/ci", type: "cell-in", parent: "gen-c1", params: {}, generatedBy: "c1" }, { id: "gen-c1/co", type: "cell-out", parent: "gen-c1", params: {}, generatedBy: "c1" },
      ...names.map((n) => ({ id: "gen-c1/" + n, type: "oscillator", name: n, parent: "gen-c1", params: {}, generatedBy: "c1" }))],
    cables: names.map((n, i) => ({ id: "gen-c1/k" + i, from: { node: "gen-c1/ci", jack: ins[0] }, to: { node: "gen-c1/" + n, jack: "pitch" }, amount: 1, generatedBy: "c1" })),
  });
  const board = () => ({ nodes: [{ id: "c1", type: "code", name: "Code", x: 100, y: 200, parent: "", params: {} }, { id: "src", type: "oscillator", name: "Src", x: 0, y: 0, parent: "", params: {} }, { id: "dst", type: "filter", name: "Dst", x: 0, y: 0, parent: "", params: {} }], cables: [] });
  const b = board();
  assert.equal(BleepCode.applyGenerated(b, "c1", { source: "s1", interface: { kind: "patch", name: "SuperSaw" } }, made(["a", "b"])), true);
  assert.equal(b.nodes.length, 3 + 5, "the cell, its two boundaries and two modules are added");
  const cell = b.nodes.find((n) => n.id === "gen-c1");
  assert.deepEqual([cell.x, cell.y, cell.parent], [340, 200, ""], "the cell is put beside the Code node");
  assert.equal(b.nodes.find((n) => n.id === "c1").code.source, "s1", "the source is saved on the Code node in the same step");
  // the user cables things to the cell
  b.cables.push({ id: "u1", from: { node: "src", jack: "out" }, to: { node: "gen-c1", jack: "pitch" }, amount: 1 }, { id: "u2", from: { node: "gen-c1", jack: "l" }, to: { node: "dst", jack: "l" }, amount: 1 });
  b.nodes.find((n) => n.id === "gen-c1").x = 999;   // and moves it
  b.nodes.find((n) => n.id === "gen-c1").name = "My saw";
  assert.equal(BleepCode.applyGenerated(b, "c1", { source: "s2", interface: { kind: "patch", name: "SuperSaw" } }, made(["a", "b", "c", "d"])), true);
  assert.equal(b.nodes.filter((n) => n.generatedBy === "c1").length, 3 + 4, "the old modules are replaced, not added to");
  assert.deepEqual(b.cables.filter((c) => !c.generatedBy).map((c) => c.id).sort(), ["u1", "u2"], "the user's cables to the cell's jacks are kept");
  assert.equal(b.cables.filter((c) => c.generatedBy).length, 4, "the cables inside are the new ones");
  assert.equal(b.nodes.find((n) => n.id === "gen-c1").x, 999, "the cell stays where the user put it");
  assert.equal(b.nodes.find((n) => n.id === "gen-c1").name, "My saw", "and keeps the name the user gave it");
  // a jack that is gone takes its cables with it
  assert.equal(BleepCode.applyGenerated(b, "c1", { source: "s3", interface: { kind: "patch", name: "SuperSaw" } }, made(["a"], ["pitch"], ["r"])), true);
  assert.deepEqual(b.cables.filter((c) => !c.generatedBy).map((c) => c.id), ["u1"], "a cable to a jack the script no longer declares is dropped");
  assert.equal(BleepCode.applyGenerated(b, "gone", {}, made(["a"])), false, "no Code node, no change");
  const ui = BleepCode.uiSpec({ code: { interface: { kind: "patch", name: "SuperSaw", description: "d" } } });
  assert.deepEqual([ui.type, ui.inputs.length, ui.outputs.length, ui.params.length, ui.description], ["code", 0, 0, 0, "d"], "a patch script's Code node has no jacks of its own");
  assert.doesNotThrow(() => BleepCode.sync({ nodes: [{ id: "p", type: "code", code: { source: 'export default cell("x", (c) => {});', interface: { kind: "patch" } } }] }));
  assert.equal(calls.length, 0, "a patch script is never handed to the engine");
}

// help pages: the author's own, else one made from the description; none for a node that has no module yet
{
  assert.equal(BleepCode.helpOf({ id: "h0", type: "code" }), null, "a Code node that has not compiled has no page");
  assert.equal(BleepCode.helpOf({ id: "h1", type: "code", code: { interface: { kind: "patch" } } }), null, "nor a patch script");
  assert.equal(BleepCode.helpOf({ id: "h2", type: "oscillator" }), null, "nor a module that is not from a Code node");
  const own = BleepCode.helpOf({ id: "h3", type: "code", code: { source: "s", interface: iface, help: "# Mine\n\nText." } });
  assert.equal(own, "# Mine\n\nText.", "the page the author wrote");
  const made = BleepCode.helpOf({ id: "h4", type: "code", code: { source: "s", interface: iface, help: "  \n " } });
  assert.match(made, /^# Gains\n\nd\n/, "a blank page is replaced by one made from the description");
  assert.match(made, /\| \*\*Volume\*\* \| 0 to 1 \|/, "with a table of the knobs and their ranges");
  assert.match(made, /- \*\*In\*\* \(audio\)/, "and the jacks");
  assert.match(BleepCode.stubHelp({ name: "X", params: [{ name: "Mode", kind: "choice", choices: ["A", "B"] }, { name: "On", kind: "bool" }, { name: "Gain", kind: "float", min: -6, max: 6, label: "dB", description: "a | b" }] }), /\| \*\*Mode\*\* \| A, B \|[\s\S]*\| \*\*On\*\* \| off \/ on \|[\s\S]*-6 dB to 6 dB \| a \/ b \|/, "ranges, choices, toggles, units, and a pipe in a description cannot break the table");
  // without the board's renderer the text is shown as text, escaped
  assert.equal(BleepCode.renderHelp("<b>x</b> & y"), "<pre>&lt;b>x&lt;/b> &amp; y</pre>");
  // with it, images are left out (a page from someone else's patch must not make the board fetch anything)
  globalThis.BleepMarkdown = { render: (t) => `<p>${t}</p><img src="https://x.test/a.png" alt="A picture"><img src="b.png">` };
  assert.equal(BleepCode.renderHelp("hi"), "<p>hi</p>A picture");
}

console.log("board-code: ok");
