// SPDX-License-Identifier: MIT
// Dual Filter (dual-filter): five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// src (stereo jacks) → trim mixer → reverb → Out.
function finish(p, at, src, trim = 0, verb = {}, jacks = ["l", "r"]) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.2, damping: 0.5, mix: 0.2, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}
/// Mono jack of a node into both inputs of a stereo module.
function mono(p, from, jack, to, l = "l", r = "r") { p.cable(from, jack, to, l).cable(from, jack, to, r); }
/// Two stereo sources blended into Out.
function blend(p, at, a, b, la = -3, lb = -6, aj = ["l", "r"], bj = ["outl", "outr"]) {
  const mix = p.add("audio-mixer", at, { level1: la, level2: lb, master: -1 });
  p.stereo(a, mix, { from: aj, to: ["in1l", "in1r"] }).stereo(b, mix, { from: bj, to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return mix;
}

function formantVowels() {
  const p = patch("Dual Filter: Vowel Talker", {
    module: "dual-filter", tempo: 96,
    description: "A buzzy saw drone goes through two band-pass filters pulled apart by Spread, which an LFO moves back and forth: the pair of peaks sounds like a vowel changing from 'oo' to 'ah' and back. Change Spread for a different mouth shape, or the Cutoff for a different voice.",
    tags: ["formant", "vowel", "band-pass", "spread", "voice"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_"], {
    rate: "1/4", root: "G", scale: "Minor Pentatonic", octave: -1, shape: 1, gatelength: 1, env: { attack: 0.03, decay: 0.4, sustain: 0.9, release: 0.5 } });
  const f = p.add("dual-filter", [3, 0], { cutoff: 600, spread: 1.6, res1: 0.7, res2: 0.7, mode1: 0.5, mode2: 0.5, routing: "Parallel", drive: 0.1 });
  const lfo = p.add("lfo", [3, 1], { rate: 0.18, wave: "Sine" }, { name: "Vowel" });
  mono(p, m.amp, "l", f);
  p.cable(lfo, "out", f, "spread", 0.35);
  finish(p, [4, 0], f, -14, { mix: 0.22 });
  return p;
}

function serialWide() {
  const p = patch("Dual Filter: Serial Squelch", {
    module: "dual-filter", tempo: 110,
    description: "In Serial routing the two filters stack into a steep, resonant low-pass that an envelope snaps open on every note. Raise Spread to make the second stage cut lower or higher than the first, or set Character to Saturating for more grit.",
    tags: ["serial", "bass", "envelope", "resonance", "saturating"],
  });
  const m = melody(p, [0, 0], [0, 0, ".", 7, 0, ".", 5, 3, 0, 0, ".", 10, 12, ".", 7, 5], {
    rate: "1/8", root: "D", scale: "Natural Minor", octave: -2, shape: 1, gatelength: 0.5, env: { decay: 0.2, sustain: 0.6, release: 0.1 } });
  const fe = p.add("adsr", [1, 2], { attack: 0.003, decay: 0.25, sustain: 0.05, release: 0.2 }, { name: "Cutoff Env" });
  const f = p.add("dual-filter", [3, 0], { cutoff: 220, spread: 0.6, res1: 0.55, res2: 0.4, routing: "Serial", character: "Saturating", drive: 0.25 });
  p.cable(m.seq, "gate", fe, "gate").cable(m.seq, "trigger", fe, "retrig").cable(fe, "env", f, "cutoff", 0.5);
  mono(p, m.amp, "l", f);
  const d = beat(p, [0, 4], { style: "four", level: -8 });
  blend(p, [4, 0], f, d, -6, -6);
  return p;
}

function stereoSplit() {
  const p = patch("Dual Filter: Stereo Split Arp", {
    module: "dual-filter", tempo: 118,
    description: "Stereo routing sends the left channel through one filter and the right through the other, with Spread putting their cutoffs apart: a busy arpeggio ends up with a dark side and a bright side, which an LFO swaps over time. Try Link set to Mirror or a negative Spread.",
    tags: ["stereo", "arpeggio", "spread", "link", "movement"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 3, 10, 15, 10, 5, 12, 17, 12, 7, 14, 19, 14], {
    rate: "1/16", root: "A", scale: "Natural Minor", octave: 0, shape: 0.9, gatelength: 0.5, env: { decay: 0.18, sustain: 0.1, release: 0.1 } });
  const f = p.add("dual-filter", [3, 0], { cutoff: 1100, spread: 2.2, res1: 0.35, res2: 0.35, routing: "Stereo", link: "Mirror" });
  const lfo = p.add("lfo", [3, 1], { wave: "Sine", sync: "4 bars" }, { name: "Swap" });
  mono(p, m.amp, "l", f);
  p.cable(lfo, "out", f, "spread", 0.5);
  finish(p, [4, 0], f, -5, { size: 0.6, decay: 3, mix: 0.3 });
  return p;
}

function notchPhase() {
  const p = patch("Dual Filter: Hollow Pad", {
    module: "dual-filter", tempo: 76,
    description: "Parallel (F2 inverted) combines a low-pass and an inverted copy, carving a moving hole out of a wide chord. Move Cutoff slowly to sweep the gap, or change Balance to favour one side.",
    tags: ["pad", "notch", "inverted", "parallel", "sweep"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 7, "_", "_", "_", 12, "_", "_", "_", 10, "_", "_", "_"], {
    rate: "1/4", root: "F", scale: "Lydian", octave: -1, shape: 1, gatelength: 1, env: { attack: 0.4, decay: 0.5, sustain: 0.9, release: 1.5 } });
  const o2 = p.add("oscillator", [1, 2], { shape: 1, fine: -10, coarse: 4 }, { name: "Third" });
  p.cable(m.seq, "pitch", o2, "pitch");
  const g = p.add("audio-mixer", [2, 2], { level1: -2, level2: -8, master: 0 }, { name: "Blend" });
  p.cable(m.osc, "out", g, "in1l").cable(o2, "out", g, "in2l");
  const amp2 = p.add("vca", [2, 3], {}, { name: "VCA 2" });
  p.cable(g, "outl", amp2, "l").cable(m.env, "env", amp2, "gain");
  const f = p.add("dual-filter", [3, 0], { cutoff: 900, spread: 0.4, res1: 0.5, res2: 0.5, routing: "Parallel (F2 inverted)", balance: 0.1 });
  const lfo = p.add("lfo", [3, 1], { rate: 0.07, wave: "Triangle" }, { name: "Gap" });
  mono(p, amp2, "l", f);
  p.cable(lfo, "out", f, "cutoff", 0.4);
  finish(p, [4, 0], f, -9, { size: 0.75, decay: 4.5, mix: 0.3 });
  return p;
}

function drumSplit() {
  const p = patch("Dual Filter: Drum Crush", {
    module: "dual-filter", tempo: 124,
    description: "A drum loop runs through a driven Dual Filter in Serial mode with Mode 1 and Mode 2 at opposite ends, so lows and highs are both trimmed into a narrow band that opens with a slow LFO. Turn up Drive or Mix to push it harder.",
    tags: ["drums", "drive", "mode", "band-pass", "crush"],
  });
  const d = beat(p, [0, 0], { style: "four", level: -4 });
  const f = p.add("dual-filter", [3, 0], { cutoff: 900, spread: 1.5, res1: 0.4, res2: 0.4, mode1: 0, mode2: 1, routing: "Serial", drive: 0.5, character: "Saturating", mix: 0.9 });
  const lfo = p.add("lfo", [3, 1], { wave: "Triangle", sync: "2 bars" }, { name: "Open" });
  p.stereo(d, f, { from: ["outl", "outr"] }).cable(lfo, "out", f, "cutoff", 0.45);
  const bass = p.add("oscillator", [3, 3], { octave: "-2", shape: 0.1 }, { name: "Sub" });
  const seq = p.add("step-sequencer", [2, 3], { length: 16, rate: "1/8", root: "E", scale: "Minor Pentatonic", octave: -1, gatelength: 0.6 },
    { data: steps([0, "_", ".", 0, ".", 3, ".", 5, 0, "_", ".", 0, ".", 7, ".", 5]) });
  const env = p.add("adsr", [4, 3], { attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.15 }, { name: "Sub Env" });
  const vca = p.add("vca", [5, 3], {});
  p.cable(seq, "pitch", bass, "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(bass, "out", vca, "l").cable(env, "env", vca, "gain");
  const mix = p.add("audio-mixer", [4, 0], { level1: 0, level2: -9, master: -1 });
  p.stereo(f, mix, { to: ["in1l", "in1r"] }).cable(vca, "l", mix, "in2l").cable(vca, "l", mix, "in2r").stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

export default [formantVowels, serialWide, stereoSplit, notchPhase, drumSplit];
