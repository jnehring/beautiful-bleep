// SPDX-License-Identifier: MIT
// Limiter: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

const feed = (p, amp, f) => p.cable(amp, "l", f, "l").cable(amp, "l", f, "r");
function out(p, at, src, trim = 0, jacks = ["l", "r"], master = 0) {
  const t = p.add("audio-mixer", at, { level1: trim, master }, { name: "Trim" });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, p.out, { from: ["outl", "outr"] });
  return t;
}

function loudDrums() {
  const p = patch("Limiter: Drums Turned Up", {
    module: "limiter", tempo: 100,
    description: "A broken beat is driven 18 dB into a fast, low-ceiling Limiter: the peaks are shaved flat and the whole kit gets denser and louder at the same top level. Lower Input to hear the open dynamics return, or lower Ceiling for more squash.",
    tags: ["drums", "loudness", "input gain", "ceiling"],
  });
  const d = beat(p, [0, 0], { style: "broken", level: -8 });
  const l = p.add("limiter", [3, 0], { input: 18, ceiling: -8, release: 50, lookahead: "2 ms" });
  p.stereo(d, l, { from: ["outl", "outr"] });
  out(p, [4, 0], l, 0);
  return p;
}

function pumpingRelease() {
  const p = patch("Limiter: Slow Release Pump", {
    module: "limiter", tempo: 120,
    description: "A bass line and a four-on-the-floor beat are pushed hard into a Limiter with a long Release, so the bass dips on every kick and comes back slowly. Shorten Release for a tight, clean sound or lengthen it for a heavy breathing groove.",
    tags: ["pumping", "release", "bass", "house"],
  });
  const m = melody(p, [0, 4], [0, "_", 0, "_", 3, "_", 0, "_", 5, "_", 5, "_", 3, "_", 7, "_"],
    { rate: "1/8", shape: 0.8, octave: -2, root: "F", scale: "Natural Minor", gatelength: 0.95, env: { attack: 0.01, decay: 0.2, sustain: 0.9, release: 0.1 } });
  const d = beat(p, [0, 0], { style: "four", level: -4 });
  const mix = p.add("audio-mixer", [3, 0], { level1: -2, level2: -2, master: 0 });
  p.cable(m.amp, "l", mix, "in1l").cable(m.amp, "l", mix, "in1r").stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const l = p.add("limiter", [4, 0], { input: 12, ceiling: -6, release: 450, lookahead: "5 ms" });
  p.stereo(mix, l, { from: ["outl", "outr"] });
  out(p, [5, 0], l, 0);
  return p;
}

function flatSwells() {
  const p = patch("Limiter: Flattened Swells", {
    module: "limiter", tempo: 72,
    description: "A pad that swells slowly in and out is driven into a low-ceiling Limiter, which holds it at one constant level: the fade-ins vanish and notes simply appear. Pull Input down to let the swells return.",
    tags: ["pad", "swell", "constant level", "dynamics"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_"],
    { rate: "1/4", shape: 0.9, root: "C", scale: "Major Pentatonic", gatelength: 0.99, osc: { fine: 7 },
      env: { attack: 1.8, decay: 0.5, sustain: 0.9, release: 1.5 } });
  const l = p.add("limiter", [3, 0], { input: 22, ceiling: -12, release: 300, lookahead: "5 ms" });
  feed(p, m.amp, l);
  out(p, [4, 0], l, 0);
  return p;
}

function reductionBrightness() {
  const p = patch("Limiter: Reduction Brightens Lead", {
    module: "limiter", tempo: 112,
    description: "A kick-heavy beat is limited, and the Limiter's Reduction output opens the cutoff of a filter on a lead, so the lead brightens exactly when the drums hit hardest. Raise Input for more reduction and a wider swing.",
    tags: ["reduction output", "modulation", "filter", "lead"],
  });
  const d = beat(p, [0, 3], { style: "four", level: -4 });
  const m = melody(p, [0, 0], [12, 10, 7, 10, 12, 15, 12, 10, 7, 5, 7, 10, 12, 10, 7, "."],
    { rate: "1/8", shape: 1, root: "E", scale: "Natural Minor", gatelength: 0.6 });
  const f = p.add("filter", [3, 0], { cutoff: 700, resonance: 0.35 });
  const l = p.add("limiter", [3, 3], { input: 14, ceiling: -6, release: 160 });
  p.stereo(d, l, { from: ["outl", "outr"] });
  feed(p, m.amp, f);
  p.cable(l, "reduction", f, "cutoff", 0.9);
  const mix = p.add("audio-mixer", [5, 0], { level1: -8, level2: -2, master: 0 });
  p.stereo(f, mix, { to: ["in1l", "in1r"] }).stereo(l, mix, { to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function finalStage() {
  const p = patch("Limiter: Final Stage", {
    module: "limiter", tempo: 98,
    description: "The finished mix of lead, bass and drums passes through a transparent Limiter with 5 ms Lookahead and a ceiling just under full scale, as the last module before the output. Raise Input and watch the reduction build while the peaks never pass the ceiling.",
    tags: ["mastering", "lookahead", "transparent", "full mix"],
  });
  const m = melody(p, [0, 0], [0, 3, 7, 12, 10, 7, 3, 7, 5, 8, 12, 15, 12, 8, 5, 3],
    { rate: "1/8", shape: 0.9, root: "G", scale: "Natural Minor", gatelength: 0.6 });
  const b = melody(p, [0, 2], [0, ".", ".", 0, ".", 3, ".", 5], { rate: "1/8", shape: 0.4, octave: -2, root: "G", scale: "Natural Minor", gatelength: 0.7 });
  const d = beat(p, [0, 5], { style: "shuffle", level: -6 });
  const mix = p.add("audio-mixer", [3, 0], { level1: -9, level2: -4, level3: -2, master: 0, limiter: false });
  p.cable(m.amp, "l", mix, "in1l").cable(m.amp, "l", mix, "in1r").cable(b.amp, "l", mix, "in2l").cable(b.amp, "l", mix, "in2r")
    .stereo(d, mix, { from: ["outl", "outr"], to: ["in3l", "in3r"] });
  const l = p.add("limiter", [4, 0], { input: 8, ceiling: -1, release: 120, lookahead: "5 ms" });
  p.stereo(mix, l, { from: ["outl", "outr"] }).stereo(l, p.out);
  return p;
}

export default [loudDrums, pumpingRelease, flatSwells, reductionBrightness, finalStage];
