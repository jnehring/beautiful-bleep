// SPDX-License-Identifier: MIT
// Rhythm Bank: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody } from "../demo-kit.mjs";

/// Mixes (source, left jack, right jack, level dB) rows into Out 1/2.
function mixOut(p, at, parts, master = 0) {
  const lv = {};
  parts.forEach(([, , , l], i) => { lv[`level${i + 1}`] = l; });
  const mx = p.add("audio-mixer", at, { ...lv, master });
  parts.forEach(([src, jl, jr], i) => p.cable(src, jl, mx, `in${i + 1}l`).cable(src, jr, mx, `in${i + 1}r`));
  p.stereo(mx, p.out, { from: ["outl", "outr"] });
  return mx;
}

/// A plucked sine voice on a Rhythm Bank gate: Oscillator → VCA, enveloped by an ADSR from the gate. Mono audio on `amp` "l".
function pluck(p, at, rb, jack, tune, oct, env = {}) {
  const [c, r] = at;
  const osc = p.add("oscillator", [c, r], { shape: 0.15, coarse: tune, octave: oct }, { name: `Pluck ${r + 1}` });
  const e = p.add("adsr", [c + 1, r], { attack: 0.002, decay: 0.35, sustain: 0, release: 0.2, ...env });
  const amp = p.add("vca", [c + 2, r]);
  p.cable(rb, jack, e, "gate").cable(osc, "out", amp, "l").cable(e, "env", amp, "gain");
  return amp;
}

/// Kick/snare/hats-style voices on Rhythm Bank outs 1–4 (Output: Trigger).
function kit(p, rb, at, voices) {
  const [c, r] = at;
  const mods = voices.map(([type, vals, jack], i) => {
    const m = p.add(type, [c, r + i], vals);
    p.cable(rb, `out${i + 1}`, m, jack || "trig");
    return m;
  });
  const mix = p.add("audio-mixer", [c + 1, r], { level1: -2, level2: -5, level3: -9, level4: -8, pan2: 0.15, pan3: 0.3, pan4: -0.3, master: 0 }, { name: "Kit Mix" });
  mods.forEach((m, i) => p.cable(m, "out", mix, `in${i + 1}l`));
  return mix;
}

function euclidKit() {
  const p = patch("Rhythm Bank: Euclid Kit", {
    module: "rhythm-bank", tempo: 118,
    description: "In the Even family the four outputs spread different numbers of hits evenly over 16 steps: kick, snare, hats and rim lock into a lopsided but steady groove. Turn Pattern to browse related grooves or use Rotate 1-4 to shift one drum against the others.",
    tags: ["euclidean", "drums", "groove", "even"],
  });
  const rb = p.add("rhythm-bank", [0, 0], { family: "Even", pattern: 20, length: "16", rate: "1/16", output: "Trigger", rotate2: 2, rotate3: 1 });
  const mix = kit(p, rb, [1, 0], [
    ["punch-kick", { level: 0.8 }], ["punch-snare", { level: 0.6 }], ["punch-hats", { level: 0.5 }, "closed"], ["punch-rim", { level: 0.6 }],
  ]);
  const m = melody(p, [1, 4], [0, ".", ".", 7, ".", 3, ".", "."], { rate: "1/8", root: "E", scale: "Minor Pentatonic", octave: -1, shape: 0.8 });
  mixOut(p, [4, 0], [[mix, "outl", "outr", 0], [m.amp, "l", "l", -8]]);
  return p;
}

function primeMarimba() {
  const p = patch("Rhythm Bank: Prime Marimba", {
    module: "rhythm-bank", tempo: 100,
    description: "With Family on Prime and Length on Open the four parts repeat every few steps (2, 3, 5, 7 ...) and slowly drift against each other, each plucking a different note of a minor pentatonic scale, so the melody never repeats the same way twice. Try other Pattern numbers for different cycle lengths.",
    tags: ["prime", "polyrhythm", "pluck", "melodic"],
  });
  const rb = p.add("rhythm-bank", [0, 0], { family: "Prime", pattern: 40, length: "Open", rate: "1/8", width: 0.4 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -1, level2: -1, level3: -3, level4: -4, pan1: -0.5, pan2: 0.4, pan3: -0.15, pan4: 0.6, master: 6 });
  [[0, "-1", "out1"], [7, "-1", "out2"], [3, "0", "out3"], [10, "0", "out4"]].forEach(([tune, oct, jack], i) => {
    const amp = pluck(p, [1, i], rb, jack, tune, oct);
    p.cable(amp, "l", mix, `in${i + 1}l`).cable(amp, "l", mix, `in${i + 1}r`);
  });
  const v = p.add("reverb", [5, 0], { size: 0.7, decay: 3.5, mix: 0.35 });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function metricBackbeat() {
  const p = patch("Rhythm Bank: Metric Backbeat", {
    module: "rhythm-bank", tempo: 104,
    description: "The Metric family builds a kit by metric weight: kick on the one, snare on the backbeat, hats on the off-beats. A Random steps Pattern once per bar, so the groove changes bar by bar but always from the same family. Try Complement on Avoid to stop the parts from colliding.",
    tags: ["metric", "backbeat", "changing", "kit"],
  });
  const rb = p.add("rhythm-bank", [0, 0], { family: "Metric", pattern: 6, length: "16", rate: "1/16", output: "Trigger", complement: "Avoid" });
  const rnd = p.add("random", [0, 1], { sync: "1 bar", spread: 0.6, bias: 0.2, seed: 11 }, { name: "Bar Changes" });
  p.cable(rnd, "out", rb, "pattern", 0.12);
  const mix = kit(p, rb, [1, 0], [
    ["ring-kick", { level: 0.8 }], ["ring-snare", { level: 0.65 }], ["ring-hats", { level: 0.5 }, "closed"], ["punch-clap", { level: 0.5 }],
  ]);
  const m = melody(p, [1, 4], [0, 0, ".", 3, ".", 5, ".", 7], { rate: "1/8", root: "A", scale: "Dorian", octave: -1, shape: 0.9, env: { decay: 0.18, sustain: 0.4 } });
  mixOut(p, [4, 0], [[mix, "outl", "outr", 0], [m.amp, "l", "l", -8]]);
  return p;
}

function crossRhythms() {
  const p = patch("Rhythm Bank: Cross-Rhythms", {
    module: "rhythm-bank", tempo: 92,
    description: "The Poly family plays between 2 and 9 hits per cycle across the same bar, not tied to the sixteenths: with Grid on Free the hits land at their exact positions on four hand drums and a bell. Switch Grid to Snap to hear them squared up.",
    tags: ["polyrhythm", "percussion", "toms", "cross-rhythm"],
  });
  const rb = p.add("rhythm-bank", [0, 0], { family: "Poly", pattern: 33, length: "16", rate: "1/16", grid: "Free", output: "Trigger" });
  const mix = kit(p, rb, [1, 0], [
    ["ring-tom", { tune: 85, decay: 0.6, bend: 0.4, level: 0.8 }], ["ring-tom", { tune: 130, decay: 0.45, level: 0.7 }],
    ["ring-cowbell", { tune: 4, decay: 0.3, level: 0.5 }], ["punch-tom", { tune: 220, decay: 0.3, level: 0.7 }],
  ]);
  const v = p.add("reverb", [3, 1], { size: 0.5, decay: 1.6, mix: 0.2 });
  p.stereo(mix, v, { from: ["outl", "outr"] });
  const m = melody(p, [1, 4], [0, ".", ".", ".", 7, ".", ".", "."], { rate: "1/4", root: "D", scale: "Minor Pentatonic", octave: -1, shape: 0.2, env: { decay: 0.6, sustain: 0.3, release: 0.4 } });
  mixOut(p, [4, 0], [[v, "l", "r", 0], [m.amp, "l", "l", -9]]);
  return p;
}

function interlock() {
  const p = patch("Rhythm Bank: Interlocking Hats", {
    module: "rhythm-bank", tempo: 128,
    description: "Interlock never lets two parts hit on the same step, and Complement on Fill makes Out 4 play every step the other three leave empty: kick, snare and rim weave around a continuous ride of hats. Try Rotate 1-4 or Pattern to reshuffle who plays where.",
    tags: ["interlock", "complement", "hats", "dance"],
  });
  const rb = p.add("rhythm-bank", [0, 0], { family: "Interlock", pattern: 12, length: "16", rate: "1/16", output: "Trigger", complement: "Fill" });
  const mix = kit(p, rb, [1, 0], [
    ["punch-kick", { level: 0.85 }], ["punch-snare", { level: 0.6 }], ["punch-rim", { level: 0.6 }], ["punch-hats", { level: 0.4, tone: 0.6 }, "closed"],
  ]);
  const b = melody(p, [1, 4], [0, 0, 12, 0, 7, 0, 10, 0], { rate: "1/8", root: "F", scale: "Natural Minor", octave: -1, shape: 0.9, env: { decay: 0.15, sustain: 0.4, release: 0.08 } });
  const flt = p.add("filter", [4, 4], { cutoff: 500, resonance: 0.4, type: "Ladder Tanh" });
  p.cable(b.amp, "l", flt, "l").cable(b.amp, "l", flt, "r");
  mixOut(p, [5, 0], [[mix, "outl", "outr", 0], [flt, "l", "r", -4]], -3);
  return p;
}

export default [euclidKit, primeMarimba, metricBackbeat, crossRhythms, interlock];
