// SPDX-License-Identifier: MIT
// Filter Bank: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mono amp → both bank inputs.
const feed = (p, amp, f) => p.cable(amp, "l", f, "l").cable(amp, "l", f, "r");
/// Source (stereo jacks) → trim mixer → reverb → Out.
function finish(p, at, src, trim = 0, verb = {}, jacks = ["l", "r"], master = 0) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.3, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

function rhythmVocoder() {
  const p = patch("Filter Bank: Rhythm Vocoder", {
    module: "filter-bank", tempo: 100,
    description: "A drum beat feeds the Sidechain while a saw chord sits on the input: with Vocode at 100 % and Env From on Sidechain, the ten bands let the beat's spectrum speak through the chord. Try Release and Q.",
    tags: ["vocoder", "sidechain", "rhythm", "chord"],
  });
  const drums = beat(p, [0, 3], { style: "broken", level: 0 });
  const oscs = [0, 4, 7, 11].map((n, i) => {
    const o = p.add("oscillator", [0, i], { shape: 1, coarse: n - 12, fine: (i - 1.5) * 6 }, { name: `Chord ${i + 1}` });
    return o;
  });
  const pad = p.add("audio-mixer", [1, 0], { level1: -8, level2: -8, level3: -8, level4: -8, pan1: -0.5, pan2: 0.5, pan3: -0.2, pan4: 0.2, master: -3 }, { name: "Chord Mix" });
  oscs.forEach((o, i) => p.cable(o, "out", pad, `in${i + 1}l`));
  const f = p.add("filter-bank", [3, 0], { q: 6, attack: 0.003, release: 0.1, vocode: 1, mix: 1, slope: "24 dB/oct", envFrom: "Sidechain" });
  p.stereo(pad, f, { from: ["outl", "outr"] }).cable(drums, "outl", f, "sidechain");
  finish(p, [4, 0], f, 6, { decay: 1.8, mix: 0.25 }, ["l", "r"], 4);
  return p;
}

function scanningWindow() {
  const p = patch("Filter Bank: Scanning Window", {
    module: "filter-bank", tempo: 84,
    description: "Width narrows the bank to a two-band window and a slow LFO on Scan moves it across the spectrum, so a held saw chord sweeps like a gentle formant filter. Open Width back up to hear the full sound.",
    tags: ["scan", "window", "sweep", "pad"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 7, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_"],
    { rate: "1/4", shape: 1, root: "F", scale: "Major Pentatonic", gatelength: 0.97, env: { attack: 0.3, decay: 0.4, sustain: 0.9, release: 1.5 } });
  const f = p.add("filter-bank", [3, 0], { q: 4, width: 2.5, scan: 0.5, mix: 1 });
  const lfo = p.add("lfo", [2, 1], { rate: 0.08, wave: "Triangle" }, { name: "Scan" });
  feed(p, m.amp, f);
  p.cable(lfo, "out", f, "scan", 0.45);
  finish(p, [4, 0], f, -10, { size: 0.65, decay: 4, mix: 0.35 });
  return p;
}

function tunedResonator() {
  const p = patch("Filter Bank: Tuned Resonator", {
    module: "filter-bank", tempo: 90,
    description: "With Tuning on Harmonic and a high Q the ten bands ring at a note's harmonics: noise bursts and a beat become pitched hits that follow a sequencer into the Pitch input. Change Tuning to Scale or lower Q.",
    tags: ["resonator", "harmonic", "pitched", "percussive"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/4", root: "D", scale: "Minor Pentatonic", octave: -1 },
    { data: { steps: [0, 7, 5, 3, 0, 7, 10, 5].map((n) => ({ g: 1, p: n, v: 100 })).concat(new Array(24).fill({ g: 0, p: 0, v: 100 })) } });
  const n = p.add("noise", [0, 1], { level: 0.5 });
  const env = p.add("adsr", [1, 1], { attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 }, { name: "Burst" });
  const vca = p.add("vca", [2, 1], {});
  const f = p.add("filter-bank", [3, 0], { q: 28, tuning: "Harmonic", mix: 1, release: 0.3 });
  p.cable(seq, "gate", env, "gate").cable(n, "out", vca, "l").cable(env, "env", vca, "gain")
    .cable(vca, "l", f, "l").cable(vca, "l", f, "r").cable(seq, "pitch", f, "pitch");
  const drums = beat(p, [0, 3], { style: "sparse", level: -8 });
  const mix = p.add("audio-mixer", [4, 0], { level1: 0, level2: -4, master: 0 });
  p.stereo(f, mix, { to: ["in1l", "in1r"] }).stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  finish(p, [5, 0], mix, 6, { size: 0.4, decay: 1.8, mix: 0.2 }, ["outl", "outr"]);
  return p;
}

function phaseSweep() {
  const p = patch("Filter Bank: Phaser Sweep", {
    module: "filter-bank", tempo: 110,
    description: "An LFO on Shift slides all ten bands up and down together with a modest Q, giving an arpeggio a vocal, phaser-like sweep. Raise Q for more whistle, or Spacing to change how far apart the bands sit.",
    tags: ["shift", "phaser", "arpeggio", "sweep"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 12, 7, 4, 9, 5], { rate: "1/16", shape: 1, root: "A", scale: "Dorian", gatelength: 0.6, env: { decay: 0.25, sustain: 0.3, release: 0.2 } });
  const f = p.add("filter-bank", [3, 0], { q: 7, shift: 0, spacing: 1, tilt: 1, mix: 1 });
  const lfo = p.add("lfo", [2, 1], { wave: "Sine", sync: "4 bars" }, { name: "Shift" });
  feed(p, m.amp, f);
  p.cable(lfo, "out", f, "shift", 0.4);
  finish(p, [4, 0], f, -3, { decay: 2, mix: 0.25 });
  return p;
}

function oddEvenWide() {
  const p = patch("Filter Bank: Odd-Even Wide", {
    module: "filter-bank", tempo: 70,
    description: "Stereo is set to Odd/Even split, so a mono saw pad leaves the odd bands on the left and the even bands on the right: a wide, hollow image. A slow LFO on Odd/Even moves the emphasis between them; try Tilt.",
    tags: ["stereo", "odd even", "wide", "pad"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_", 5, "_", "_", "_"],
    { rate: "1/4", shape: 1, root: "C", scale: "Natural Minor", octave: -1, gatelength: 0.97, env: { attack: 0.5, decay: 0.4, sustain: 0.9, release: 1.5 } });
  const f = p.add("filter-bank", [3, 0], { q: 3, stereo: "Odd/Even split", tilt: -0.5, oddEven: 0, mix: 1 });
  const lfo = p.add("lfo", [2, 1], { rate: 0.06, wave: "Sine" }, { name: "Odd/Even" });
  feed(p, m.amp, f);
  p.cable(lfo, "out", f, "oddEven", 0.5);
  finish(p, [4, 0], f, -10, { size: 0.7, decay: 5, mix: 0.4 });
  return p;
}

export default [rhythmVocoder, scanningWindow, tunedResonator, phaseSweep, oddEvenWide];
