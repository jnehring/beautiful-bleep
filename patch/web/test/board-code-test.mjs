// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
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

console.log("board-code: ok");
