// quantizer-suite: five demo patches. Each plays by itself with the transport.
// SPDX-License-Identifier: MIT
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// A mono voice: Oscillator -> VCA with its own ADSR. src: {n, pitch, gate, trig} (trig: false = no retrigger).
/// o: shape, osc (extra knobs), env, cutoff/res (adds a low-pass), name. Returns {osc, env, amp, out: {n, j}}.
function voice(p, at, src, o = {}) {
  const [c, r] = at;
  const osc = p.add("oscillator", [c, r], { shape: o.shape ?? 0.7, ...(o.osc || {}) }, { name: o.name || "Source" });
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.3, sustain: 0.3, release: 0.25, ...(o.env || {}) }, { name: o.envName || "Amp Env" });
  const amp = p.add("vca", [c + 1, r], {}, { name: "VCA" });
  if (src.pitch !== null) p.cable(src.pn || src.n, src.pitch || "pitch", osc, "pitch");
  p.cable(src.n, src.gate || "gate", env, "gate");
  if (src.trig !== false) p.cable(src.n, src.trig || "trigger", env, "retrig");
  p.cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  let out = { n: amp, j: "l" }, flt;
  if (o.cutoff) {
    flt = p.add("filter", [c + 2, r], { cutoff: o.cutoff, resonance: o.res ?? 0.2, ...(o.flt || {}) }, { name: "Filter" });
    p.cable(amp, "l", flt, "l");
    out = { n: flt, j: "l" };
  }
  return { osc, env, amp, flt, out };
}

/// chans: [{n, l, r?, level (dB), pan}] -> Audio Mixer -> Verb -> Out 1/2.  Returns {mix, verb}.
function finish(p, at, chans, o = {}) {
  const vals = { master: o.master ?? -3 };
  chans.forEach((c, i) => { vals[`level${i + 1}`] = c.level ?? -6; vals[`pan${i + 1}`] = c.pan ?? 0; });
  const mix = p.add("audio-mixer", at, vals, { name: "Mix" });
  chans.forEach((c, i) => {
    p.cable(c.n, c.l || "l", mix, `in${i + 1}l`);
    if (c.r) p.cable(c.n, c.r, mix, `in${i + 1}r`);
    for (const [n, j] of c.also || []) p.cable(n, j, mix, `in${i + 1}l`);
  });
  const verb = p.add("reverb", [at[0] + 1, at[1]], { size: o.size ?? 0.5, decay: o.decay ?? 2.5, damping: 0.5, mix: o.vmix ?? 0.22, quality: "Eco (8 lines)" });
  p.cable(mix, "outl", verb, "l").cable(mix, "outr", verb, "r").stereo(verb, p.out);
  return { mix, verb };
}
const drumsOf = (m, level = -8, pan) => ({ n: m, l: "outl", r: "outr", level, pan: pan ?? 0 });

const MASKS = (masks) => ({ masks: [...masks, 4095, 4095, 4095, 4095].slice(0, 4) });
/// A clock lane: a step sequencer whose gate/trigger drive the suite's triggers and the voices' envelopes.
const clock = (p, at, pat, rate = "1/8", name = "Clock") => p.add("step-sequencer", at, { length: pat.length, rate, gatelength: 0.45 }, { data: steps(pat) }, { name });
const eighths = [0, 0, ".", 0, 0, ".", 0, ".", 0, 0, ".", 0, ".", 0, 0, "."];

function chordToneMask() {
  const p = patch("Quantizer Suite: Chord-Tone Mask", {
    module: "quantizer-suite", tempo: 104,
    description: "A random line goes into channel A, where the note mask keeps only the notes of a C major seventh chord (C, E, G, B): any value lands on a chord tone, so the melody always outlines the harmony. Click other keys in the view's keyboard to change which notes are allowed.",
    tags: ["mask", "chord tones", "random", "quantize"],
  });
  const clk = clock(p, [0, 0], eighths);
  const rnd = p.add("random", [0, 2], { rate: 4, sync: "1/8", spread: 0.9, smooth: 0, seed: 9 }, { name: "Wander" });
  const qs = p.add("quantizer-suite", [1, 0], { "a.mode": "Quantize", "a.root": "C", "a.scale": "Major", "a.sample": "Trigger", "a.notes": false },
    { data: MASKS([0b100010010001]) });
  p.cable(rnd, "out", qs, "ina", 0.7).cable(clk, "trigger", qs, "triga");
  const v = voice(p, [2, 0], { pn: qs, n: clk, pitch: "outa" }, { shape: 0.4, env: { decay: 0.3, sustain: 0, release: 0.2 }, osc: { octave: "0" } });
  const bass = melody(p, [0, 4], [0, ".", ".", ".", 5, ".", ".", ".", 7, ".", ".", ".", 4, ".", ".", "."], { rate: "1/4", root: "C", scale: "Major", octave: -2, shape: 0.2, gatelength: 0.8, env: { decay: 0.5, sustain: 0.3, release: 0.3 } });
  const dl = p.add("delay", [4, 0], { timel: 285, timer: 430, feedback: 0.4, highcut: 5000, mix: 0.3 });
  p.cable(v.amp, "l", dl, "l").cable(v.amp, "l", dl, "r");
  finish(p, [5, 0], [{ n: dl, level: 2 }, { n: v.amp, level: 0 }, { n: bass.amp, level: -3 }], { vmix: 0.3, decay: 3, master: 0 });
  return p;
}

function fifthsAndOctaves() {
  const p = patch("Quantizer Suite: Fifths and Octaves", {
    module: "quantizer-suite", tempo: 98,
    description: "One melody goes in on A; channels B, C and D transpose it in the scale by 4, 7 and minus 7 steps, which is a fifth up, an octave up and an octave down. Four voices play the thickened line. Change a Steps knob for other intervals.",
    tags: ["transpose", "intervals", "octave", "harmoniser"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "G", scale: "Mixolydian", gatelength: 0.55 },
    { data: steps([0, ".", 2, 4, 5, ".", 4, 2, 0, 2, 4, ".", 7, 5, 4, "."]) });
  const base = (ch, st) => ({ [`${ch}.mode`]: "Transpose", [`${ch}.root`]: "G", [`${ch}.scale`]: "Mixolydian", [`${ch}.steps`]: st, [`${ch}.notes`]: false });
  const qs = p.add("quantizer-suite", [1, 0], { "a.mode": "Quantize", "a.root": "G", "a.scale": "Mixolydian", "a.notes": false, ...base("b", 4), ...base("c", 7), ...base("d", -7) });
  p.cable(seq, "pitch", qs, "ina");
  const mk = (jack, row, shape, pan, level, oct) => {
    const v = voice(p, [2, row], { pn: qs, n: seq, pitch: jack }, { shape, env: { decay: 0.3, sustain: 0.1, release: 0.2 }, osc: { octave: oct }, name: `Voice ${jack.slice(-1).toUpperCase()}` });
    return { n: v.amp, level, pan };
  };
  const c3 = mk("outc", 4, 0.2, -0.3, -4, "0");
  const d4 = mk("outd", 6, 0.8, 0, 0, "0");
  c3.also = [[d4.n, "l"]];
  const drums = beat(p, [0, 8], { style: "half", level: -14 });
  finish(p, [5, 0], [mk("outa", 0, 0.7, 0, 2, "0"), mk("outb", 2, 0.4, 0.3, -3, "0"), c3, drumsOf(drums, 0)], { vmix: 0.2, master: 0 });
  return p;
}

function risingNinths() {
  const p = patch("Quantizer Suite: Rising Ninths", {
    module: "quantizer-suite", tempo: 120,
    description: "Channel A turns each slow root into a ninth chord and plays it converging towards the middle over two octaves; B plays a sus2 chord downwards on the same clock. Change an Order or Chord and the run reshapes at once.",
    tags: ["arpeggio", "ninth", "converge", "arp mode"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/1", root: "D", scale: "Dorian", octave: 0, gatelength: 0.97 }, { data: steps([0, 3, 4, 2, 0, 5, 3, 2]) });
  const clk = clock(p, [0, 3], Array(16).fill(0), "1/16");
  const qs = p.add("quantizer-suite", [1, 0], {
    "a.mode": "Arp", "a.root": "D", "a.scale": "Dorian", "a.chord": "Ninth", "a.order": "Converge", "a.span": 2, "a.notes": false,
    "b.mode": "Arp", "b.root": "D", "b.scale": "Dorian", "b.chord": "Sus2", "b.order": "Down", "b.span": 1, "b.octave": -1, "b.notes": false });
  p.cable(seq, "pitch", qs, "ina").cable(clk, "trigger", qs, "triga").cable(clk, "trigger", qs, "trigb");
  const a = voice(p, [2, 0], { pn: qs, n: clk, pitch: "outa" }, { shape: 0.6, env: { decay: 0.18, sustain: 0, release: 0.12 }, cutoff: 3500, name: "Arp A" });
  const b = voice(p, [2, 3], { pn: qs, n: clk, pitch: "outb" }, { shape: 0.2, env: { decay: 0.3, sustain: 0, release: 0.2 }, name: "Arp B" });
  const drums = beat(p, [0, 6], { style: "four", level: -12 });
  finish(p, [5, 0], [{ n: a.out.n, level: 3, pan: -0.2 }, { n: b.amp, level: -2, pan: 0.3 }, drumsOf(drums, 0)], { vmix: 0.25, decay: 2.5, master: -3 });
  return p;
}

function followChanges() {
  const p = patch("Quantizer Suite: Follow the Changes", {
    module: "quantizer-suite", tempo: 90,
    description: "In Follow mode every channel listens to a Harmony Master on the bus: A snaps a random line to the current chord, B to chord and scale, C holds the chord root. When the progression moves, all three move with it. Change a Target, or the Harmony Master's key.",
    tags: ["follow", "harmony master", "chords", "bus"],
  });
  const hm = p.add("harmony-master", [0, 0], { source: "Progression", key: "A", scale: "Natural Minor", advance: "Transport", bus: "A" },
    { data: { slots: [{ deg: 1, q: "diatonic-seventh", len: 4 }, { deg: 4, q: "diatonic-seventh", len: 4 }, { deg: 6, q: "diatonic-seventh", len: 4 }, { deg: 5, q: "dominant7", len: 4 }] } });
  const clk = clock(p, [0, 4], eighths);
  const rnd = p.add("random", [0, 6], { rate: 4, sync: "1/8", spread: 0.9, seed: 33 }, { name: "Wander" });
  const rnd2 = p.add("random", [0, 7], { rate: 2, sync: "1/4", spread: 0.8, seed: 5 }, { name: "Wander 2" });
  const qs = p.add("quantizer-suite", [1, 0], {
    "a.mode": "Follow", "a.harmony": "Bus A", "a.target": "Chord", "a.sample": "Trigger", "a.notes": false,
    "b.mode": "Follow", "b.harmony": "Bus A", "b.target": "Chord + Scale", "b.sample": "Trigger", "b.octave": 1, "b.notes": false,
    "c.mode": "Follow", "c.harmony": "Bus A", "c.target": "Root", "c.octave": -2, "c.notes": false });
  p.cable(rnd, "out", qs, "ina", 0.8).cable(rnd2, "out", qs, "inb", 0.8).cable(clk, "trigger", qs, "triga").cable(clk, "trigger", qs, "trigb");
  const a = voice(p, [2, 0], { pn: qs, n: clk, pitch: "outa" }, { shape: 0.5, env: { decay: 0.3, sustain: 0, release: 0.2 }, name: "Chord Notes" });
  const b = voice(p, [2, 3], { pn: qs, n: clk, pitch: "outb" }, { shape: 0.3, env: { decay: 0.4, sustain: 0, release: 0.3 }, name: "Scale Notes" });
  const root = p.add("oscillator", [2, 6], { shape: 0.15 }, { name: "Root" });
  const rv = p.add("vca", [3, 6], { gain: 0.5 }, { name: "Root Level" });
  p.cable(qs, "outc", root, "pitch").cable(root, "out", rv, "l");
  finish(p, [5, 0], [{ n: a.amp, level: 0, pan: -0.2 }, { n: b.amp, level: -3, pan: 0.3 }, { n: rv, level: -8 }], { vmix: 0.3, decay: 3, master: 3 });
  return p;
}

function trackAndHold() {
  const p = patch("Quantizer Suite: Track and Hold Slides", {
    module: "quantizer-suite", tempo: 86,
    description: "Channel A follows a slow LFO but only changes pitch when its clock ticks, and Slew slides the voice between the held notes; channel B tracks continuously, so it keeps wobbling into new notes. Try Sample Trigger for hard steps, or Slew A at zero.",
    tags: ["track and hold", "slew", "lfo", "sample"],
  });
  const lfo = p.add("lfo", [0, 0], { rate: 0.23, wave: "Triangle" }, { name: "Drift" });
  const clk = clock(p, [0, 2], [0, ".", 0, ".", 0, ".", ".", 0], "1/4");
  const qs = p.add("quantizer-suite", [1, 0], {
    "a.mode": "Quantize", "a.root": "E", "a.scale": "Minor Pentatonic", "a.sample": "Track & Hold", "a.slew": 0.15, "a.notes": false,
    "b.mode": "Quantize", "b.root": "E", "b.scale": "Minor Pentatonic", "b.sample": "Continuous", "b.octave": 1, "b.slew": 0, "b.notes": false });
  p.cable(lfo, "out", qs, "ina", 0.8).cable(clk, "trigger", qs, "triga");
  const a = voice(p, [2, 0], { pn: qs, n: clk, pitch: "outa" }, { shape: 0.4, env: { attack: 0.02, decay: 0.8, sustain: 0.5, release: 0.6 }, name: "Held Voice" });
  const bosc = p.add("oscillator", [2, 3], { shape: 0.15 }, { name: "Tracking Voice" });
  const bv = p.add("vca", [3, 3], { gain: 0.35 }, { name: "Tracking Level" });
  p.cable(qs, "outb", bosc, "pitch").cable(bosc, "out", bv, "l");
  const drums = beat(p, [0, 5], { style: "sparse", level: -13 });
  finish(p, [5, 0], [{ n: a.amp, level: 2, pan: -0.2 }, { n: bv, level: -4, pan: 0.3 }, drumsOf(drums, 0)], { vmix: 0.3, decay: 3.5, master: 0 });
  return p;
}

export default [chordToneMask, fifthsAndOctaves, risingNinths, followChanges, trackAndHold];
