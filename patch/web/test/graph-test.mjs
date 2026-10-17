// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Graph runner test (node): oscillator → filter → audio-out, with a cable that modulates a knob.
// usage: node graph-test.mjs <site dir>   (the output of build_modules.py)
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { compileModule } from "../js/module-host.js";
import { Engine } from "../js/graph.js";

const site = process.argv[2];
const manifest = JSON.parse(readFileSync(`${site}/manifest.json`));
const types = JSON.parse(readFileSync(new URL("../../board/ui/demo-types.json", import.meta.url)));
const engine = new Engine(48000);
engine.setTypes(types);
for (const [slug, m] of Object.entries(manifest.modules))
  engine.addModule(slug, await compileModule(readFileSync(`${site}/${m.file}`)), m.types);

const node = (id, type, params = {}, extra = {}) => ({ id, type, name: id, x: 0, y: 0, parent: "", muted: false, params, ...extra });
const cable = (id, a, aj, b, bj, amount = 1) => ({ id, from: { node: a, jack: aj }, to: { node: b, jack: bj }, amount });
const run = (seconds) => {
  const n = Math.ceil(48000 * seconds / 128) * 128, l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i += 128) engine.render(l.subarray(i, i + 128), r.subarray(i, i + 128), 128);
  return l;
};
const crossings = (x) => { let c = 0; for (let i = 1; i < x.length; ++i) if (x[i - 1] < 0 && x[i] >= 0) c++; return c; };

// 1. oscillator straight to the output: C4 at 261.6 Hz.
engine.setBoard({ format: 1, id: "t", nodes: [node("osc", "oscillator"), node("out", "audio-out", {}, { port: "p" })],
  cables: [cable("c1", "osc", "sine", "out", "l")] });
let x = run(1);
assert.ok(Math.abs(crossings(x) - 261) <= 2, `expected ~261 Hz, got ${crossings(x)}`);
assert.ok(x.reduce((m, v) => Math.max(m, Math.abs(v)), 0) > 0.9);
console.log("oscillator → out: ok,", crossings(x), "Hz");

// 2. the amount scales the cable.
engine.setBoard({ format: 1, id: "t", nodes: [node("osc", "oscillator"), node("out", "audio-out", {}, { port: "p" })],
  cables: [cable("c1", "osc", "sine", "out", "l", 0.25)] });
x = run(0.2);
const peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
assert.ok(peak > 0.24 && peak < 0.26, `peak ${peak}`);
engine.setAmount("c1", 0.5);
x = run(0.2);
assert.ok(x.reduce((m, v) => Math.max(m, Math.abs(v)), 0) > 0.49);
console.log("cable amount (live edit): ok");

// 3. a knob moves the pitch: octave +1 doubles it (a choice knob, set live).
engine.setBoard({ format: 1, id: "t", nodes: [node("osc", "oscillator", { octave: 4 / 6 }), node("out", "audio-out", {}, { port: "p" })],
  cables: [cable("c1", "osc", "sine", "out", "l")] });
x = run(1);
assert.ok(Math.abs(crossings(x) - 523) <= 3, `octave up: ${crossings(x)}`);
engine.setKnob("osc", "octave", 3 / 6);
run(0.05);
assert.ok(Math.abs(crossings(run(1)) - 261) <= 2);
console.log("knob edit: ok");

// 4. CV modulation: a Dial into the oscillator's Coarse knob (+12 st at full amount → one octave up).
engine.setBoard({ format: 1, id: "t", nodes: [node("osc", "oscillator"), node("dial", "dial", { value: 1, min: 0.5, max: 1 }), node("out", "audio-out", {}, { port: "p" })],
  cables: [cable("c1", "osc", "sine", "out", "l"), cable("c2", "dial", "out", "osc", "coarse", 0.5)] });
run(0.1);
const f = crossings(run(1));
console.log("dial → coarse:", f, "Hz");
assert.ok(Math.abs(f - 523) <= 3, "Dial at full, amount 0.5 on Coarse (±12 st): one octave up");

// 5. a board with modules that are not loaded yet reports which files it needs; the rest still runs.
{
  const bare = new Engine(48000);
  bare.setTypes(types);
  const board = { format: 1, id: "t", nodes: [node("w", "wavetable-osc"), node("out", "audio-out", {}, { port: "p" })], cables: [cable("c1", "w", "out", "out", "l")] };
  assert.deepEqual(bare.missingSlugs(board, manifest), ["wavetable-osc"]);
  bare.setBoard(board);
  bare.render(new Float32Array(128), new Float32Array(128), 128);
  assert.deepEqual(Object.keys(bare.snapshot().nodes), ["out"]);
  console.log("missing modules: ok");
}

// 6. a module that uses juce_core (node data as JSON): the Step Sequencer plays from the transport.
{
  const seqType = types.find((t) => t.type === "step-sequencer");
  assert.ok(manifest.modules["step-sequencer"], "step-sequencer.wasm is built (needs the JUCE checkout)");
  engine.setBoard({ format: 1, id: "t", nodes: [node("seq", "step-sequencer"), node("osc", "oscillator"), node("out", "audio-out", {}, { port: "p" })],
    cables: [cable("c1", "seq", seqType.outputs[0].id, "osc", "pitch"), cable("c2", "osc", "sine", "out", "l")] });
  run(0.5);
  const first = engine.snapshot();
  // Its default pattern was sanitised by the module and is handed to the board document.
  assert.ok(first.nodes.seq.data, "node data defaults come back for the board");
  assert.ok(JSON.parse(first.nodes.seq.data).steps.length > 0);
  const a = engine.snapshot().nodes.seq.step;
  run(0.3);
  const b = engine.snapshot().nodes.seq.step;
  assert.ok(a !== undefined && b !== undefined && a !== b, `the sequencer advances (step ${a} → ${b})`);
  console.log("step-sequencer (juce_core module): ok, step", a, "→", b);
}
console.log("all tests passed");

// Audio Out's Volume knob: -6 dB halves the level (skewed knob, set in its own units → normalised by hand).
{
  const p = types.find((t) => t.type === "audio-out").params.find((q) => q.id === "volume");
  const norm = Math.pow((-6.0206 - p.min) / (p.max - p.min), Math.log(0.5) / Math.log((p.centre - p.min) / (p.max - p.min)));
  engine.setBoard({ format: 1, id: "t", nodes: [node("osc", "oscillator"), node("out", "audio-out", { volume: norm }, { port: "p" })],
    cables: [cable("c1", "osc", "sine", "out", "l")] });
  run(0.2);
  const pk = run(0.2).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(pk > 0.48 && pk < 0.52, `volume -6 dB peak ${pk}`);
  console.log("audio-out volume: ok");
}

// Bypass: a bypassed effect does not run and passes its audio in to its audio out (the native engine does the same).
{
  const board = (bypassed) => ({ format: 1, id: "t", nodes: [node("osc", "oscillator"), node("fx", "filter", { cutoff: 0 }, { bypassed }), node("out", "audio-out", {}, { port: "p" })],
    cables: [cable("c1", "osc", "sine", "fx", "l"), cable("c2", "fx", "l", "out", "l")] });
  const peakOf = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  engine.setBoard(board(false));
  run(0.2);
  const filtered = peakOf(run(0.2));
  engine.setBoard(board(true));
  run(0.2);
  const passed = peakOf(run(0.2));
  assert.ok(passed > 0.9 && filtered < 0.5, `bypass: passed ${passed}, filtered ${filtered}`);
  engine.setBoard(board(false));
  run(0.2);
  assert.ok(peakOf(run(0.2)) < 0.5, "bypass off again: the filter works again");
  console.log("bypass: ok");
}
