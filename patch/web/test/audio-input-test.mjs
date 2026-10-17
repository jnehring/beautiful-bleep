// SPDX-License-Identifier: MIT
// The audio input of the browser engine (js/graph.js): Engine.render's inL/inR feed the Audio In nodes, scaled by their Gain knob.
// Needs no module files: Audio In and Audio Out are ports of the engine itself.
//
//   node patch/web/test/audio-input-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Engine } from "../js/graph.js";

const here = dirname(fileURLToPath(import.meta.url));
const types = JSON.parse(readFileSync(join(here, "..", "..", "board", "ui", "demo-types.json"), "utf8"));
const engine = new Engine(48000);
engine.setTypes(types);

const node = (id, type, params = {}, extra = {}) => ({ id, type, name: id, x: 0, y: 0, parent: "", muted: false, params, ...extra });
const cable = (id, a, aj, b, bj) => ({ id, from: { node: a, jack: aj }, to: { node: b, jack: bj }, amount: 1 });
const thru = (both = true) => ({
  format: 1, id: "t",
  nodes: [node("in", "audio-in", {}, { port: "p-in" }), node("out", "audio-out", {}, { port: "p-out" })],
  cables: [cable("c1", "in", "l", "out", "l"), ...(both ? [cable("c2", "in", "r", "out", "r")] : [])],
});
const sine = (hz, n, amp = 0.5) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / 48000));
const render = (frames, inL, inR) => {
  const l = new Float32Array(frames), r = new Float32Array(frames);
  for (let i = 0; i < frames; i += 128) engine.render(l.subarray(i, i + 128), r.subarray(i, i + 128), 128, inL && inL.subarray(i, i + 128), inR && inR.subarray(i, i + 128));
  return [l, r];
};
const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

// the input comes out at the same level (the Gain knob's default is 0 dB), left and right apart
engine.setBoard(thru());
const a = sine(220, 4096), b = sine(330, 4096, 0.25);
let [l, r] = render(4096, a, b);
assert.ok(maxDiff(l, a) < 1e-6, "left is the left input");
assert.ok(maxDiff(r, b) < 1e-6, "right is the right input");

// a mono input plays on both sides
[l, r] = render(4096, a);
assert.ok(maxDiff(l, a) < 1e-6 && maxDiff(r, a) < 1e-6, "mono on both sides");

// no input: silence (a board with an Audio In plays nothing until the page connects something)
[l, r] = render(1024);
assert.equal(peak(l) + peak(r), 0);

// the input follows the engine's chunks: a signal that is not a multiple of 32 samples long into 128-sample blocks is not distorted
[l] = render(8192, sine(1000, 8192, 0.4));
assert.ok(maxDiff(l, sine(1000, 8192, 0.4)) < 1e-6, "no seams");

// the Gain knob: +6 dB is about twice as loud (it is smoothed, so look at the end), the knob is live
engine.setKnob("in", "gain", (6 + 24) / 48);
[l] = render(16384, sine(220, 16384));
const tail = l.subarray(15000);
assert.ok(Math.abs(peak(tail) / 0.5 - 1.995) < 0.02, `+6 dB: ${(peak(tail) / 0.5).toFixed(3)}`);
engine.setKnob("in", "gain", 0);
[l] = render(16384, sine(220, 16384));
assert.ok(peak(l.subarray(15000)) < 0.5 * 0.07, "bottom of the knob (−24 dB) is quiet");

// only the left cable patched: the right input does not leak into the left
engine.setBoard(thru(false));
engine.setKnob("in", "gain", 0.5);
render(16384, a, b);   // the knob is smoothed: let it get back to 0 dB
[l, r] = render(4096, a, b);
assert.ok(maxDiff(l, a) < 1e-6, "the left input");
assert.ok(maxDiff(r, l) < 1e-6, "Audio Out plays a mono board on both sides: the right input does not leak in");

console.log("audio-input-test: ok");
