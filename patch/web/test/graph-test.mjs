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

// 5. missing modules are reported, the rest still runs.
engine.setBoard({ format: 1, id: "t", nodes: [node("w", "wavetable-osc"), node("out", "audio-out", {}, { port: "p" })], cables: [cable("c1", "w", "out", "out", "l")] });
assert.deepEqual(engine.missingSlugs({ nodes: [node("w", "wavetable-osc")] }, { types: { "wavetable-osc": "wavetable-osc" } }), ["wavetable-osc"]);
run(0.05);
console.log("snapshot nodes:", Object.keys(engine.snapshot().nodes).join(","));
console.log("graph tests passed");
