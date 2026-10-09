// SPDX-License-Identifier: MIT
// Tidal: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mono source → gain stage → Verb → Out 1/2.
function verbOut(p, at, src, jack, opts = {}) {
  const { gain = 0, ...rest } = opts;
  const m = p.add("audio-mixer", [at[0] - 1, at[1] + 1], { level1: gain, master: 0 });
  const v = p.add("reverb", at, { size: 0.6, decay: 3, mix: 0.3, ...rest });
  p.cable(src, jack, m, "in1l").cable(src, jack, m, "in1r").stereo(m, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

function slowSwell() {
  const p = patch("Tidal: Slow Swell", {
    module: "tidal", tempo: 66,
    description: "Tidal in Slow range takes about half a minute per cycle: output A slowly opens the filter on a held chord with a long rise and a quicker fall (Skew), while output B fades the volume in and out. Try Skew and Frequency for a faster or more lopsided tide.",
    tags: ["swell", "pad", "slow", "ambient"],
  });
  const t = p.add("tidal", [0, 0], { range: "Slow", freq: 0.09, skew: 0.75, curve: 0.3, smooth: 0.3, spread: 0.35, relation: "Phase", polarity: "Unipolar" });
  const o1 = p.add("oscillator", [1, 0], { shape: 0.8, fine: -6 }, { name: "Root" });
  const o2 = p.add("oscillator", [1, 1], { shape: 0.8, coarse: 7, fine: 5 }, { name: "Fifth" });
  const o3 = p.add("oscillator", [1, 2], { shape: 0.5, coarse: 3, octave: "+1", fine: 0 }, { name: "Third" });
  const mix = p.add("audio-mixer", [2, 0], { level1: 0, level2: -1, level3: -4, pan1: -0.4, pan2: 0.4, master: 4 });
  const flt = p.add("filter", [3, 0], { cutoff: 500, resonance: 0.25, type: "Ladder Tanh" });
  const amp = p.add("vca", [4, 0], { gain: 0.6 });
  [o1, o2, o3].forEach((o, i) => p.cable(o, "out", mix, `in${i + 1}l`).cable(o, "out", mix, `in${i + 1}r`));
  p.stereo(mix, flt, { from: ["outl", "outr"] }).cable(t, "a", flt, "cutoff", 0.45).stereo(flt, amp)
    .cable(t, "b", amp, "gain", 0.35);
  const v = p.add("reverb", [5, 0], { size: 0.85, decay: 9, mix: 0.4 });
  p.stereo(amp, v).stereo(v, p.out);
  return p;
}

function circularPan() {
  const p = patch("Tidal: Circular Pan", {
    module: "tidal", tempo: 92,
    description: "With Relation on Phase and Spread at maximum, outputs A and B are a sine and a cosine of the same slope: they steer two plucked voices around the stereo field in opposite directions. Change Frequency or Curve to speed the circling up or square it off.",
    tags: ["pan", "stereo", "phase", "motion"],
  });
  const t = p.add("tidal", [0, 0], { freq: 0.35, skew: 0.5, curve: 0.5, smooth: 0.2, spread: 1, relation: "Phase" });
  const m1 = melody(p, [1, 0], [0, 4, 7, 4, 9, 7, 4, 2], { rate: "1/8", root: "G", scale: "Major Pentatonic", shape: 0.7 });
  const m2 = melody(p, [1, 2], [7, 9, 12, 9, 14, 12, 9, 7], { rate: "1/8", root: "G", scale: "Major Pentatonic", shape: 0.3, octave: 1, oscName: "Source 2" });
  const mix = p.add("audio-mixer", [4, 0], { level1: -1, level2: -6, master: 1 });
  p.cable(m1.amp, "l", mix, "in1l").cable(m2.amp, "l", mix, "in2l").cable(t, "a", mix, "pan1", 0.9).cable(t, "b", mix, "pan2", 0.9);
  const dl = p.add("delay-network", [5, 0], { time: 0.33, taps: 3, feedback: 0.4, mix: 0.3, scatter: 0.4 });
  p.stereo(mix, dl, { from: ["outl", "outr"] }).stereo(dl, p.out);
  return p;
}

function polyAccents() {
  const p = patch("Tidal: Four Envelopes", {
    module: "tidal", tempo: 100,
    description: "One trigger per bar fires Tidal in AD mode with Relation on Harmonic: its four outputs become four envelopes of different lengths, each opening a VCA on a different chord tone, so the chord dissolves note by note. Try Skew, Frequency or Spread to change how the tones fall away.",
    tags: ["envelope", "chord", "harmonic", "ad"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "E", scale: "Natural Minor", gatelength: 0.1 },
    { data: steps([0, ".", ".", ".", ".", ".", ".", ".", 5, ".", ".", ".", ".", ".", ".", "."]) });
  const t = p.add("tidal", [1, 0], { mode: "AD", relation: "Harmonic", spread: 1, freq: 1.2, skew: 0.15, curve: 0.3, smooth: -0.2, polarity: "Unipolar" });
  p.cable(seq, "gate", t, "trig");
  const mix = p.add("audio-mixer", [4, 0], { level1: -2, level2: -3, level3: -4, level4: -6, pan1: -0.5, pan2: 0.5, pan3: -0.2, pan4: 0.3, master: 0 });
  const tones = [["Root", 0, "-1"], ["Fifth", 7, "-1"], ["Octave", 0, "0"], ["Tenth", 3, "+1"]];
  tones.forEach(([name, c, oct], i) => {
    const o = p.add("oscillator", [2, i], { shape: 0.6, coarse: c, octave: oct }, { name });
    const v = p.add("vca", [3, i]);
    p.cable(seq, "pitch", o, "pitch").cable(o, "out", v, "l").cable(t, "abcd"[i], v, "gain").cable(v, "l", mix, `in${i + 1}l`);
  });
  const v = p.add("reverb", [5, 0], { size: 0.7, decay: 4, mix: 0.3 });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function audioOscillator() {
  const p = patch("Tidal: Audio Oscillator", {
    module: "tidal", tempo: 84,
    description: "Range Audio turns Tidal into a voice: a sequencer plays its Pitch input, Skew sweeps saw to triangle, and a slow Smooth fold adds overtones. A and B go to the left and right channels with a little Spread for width. Try Smooth and Skew by hand while it plays.",
    tags: ["oscillator", "audio rate", "fold", "lead"],
  });
  const m = melody(p, [0, 0], [0, 7, 3, 7, 5, 10, 7, 3], { rate: "1/8", root: "C", scale: "Natural Minor", octave: -1 });
  const t = p.add("tidal", [3, 0], { range: "Audio", mode: "Loop", freq: 10, skew: 0.65, smooth: 0.4, spread: 0.1, relation: "Phase" });
  const lfo = p.add("lfo", [3, 1], { rate: 0.12 }, { name: "Fold" });
  const lfo2 = p.add("lfo", [3, 2], { rate: 0.2 }, { name: "Tilt" });
  p.cable(m.seq, "pitch", t, "pitch").cable(lfo, "out", t, "smooth", 0.5).cable(lfo2, "out", t, "skew", 0.3);
  const va = p.add("vca", [4, 0]), vb = p.add("vca", [4, 1]);
  p.cable(t, "a", va, "l").cable(t, "b", vb, "l").cable(m.env, "env", va, "gain", 1).cable(m.env, "env", vb, "gain", 1);
  const flt = p.add("filter", [5, 0], { cutoff: 3500, resonance: 0.15, type: "SVF Multimode" });
  p.cable(va, "l", flt, "l").cable(vb, "l", flt, "r");
  const gm = p.add("audio-mixer", [5, 1], { level1: 6, master: 6 });
  const v = p.add("reverb", [6, 0], { size: 0.6, decay: 2.5, mix: 0.25 });
  p.stereo(flt, gm, { to: ["in1l", "in1r"] }).stereo(gm, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function clockedRatios() {
  const p = patch("Tidal: Clocked Ratios", {
    module: "tidal", tempo: 112,
    description: "Tidal locked to the song with Sync 1 bar and Relation on Ratio gives four slopes that meet again only after several bars: they sweep the filter, the pulse shape, the tone of a pad stab and the volume of a bass. Try other Sync values or Ratio to change the cycle.",
    tags: ["polyrhythm", "sync", "ratio", "modulation"],
  });
  const t = p.add("tidal", [0, 0], { sync: "1/1", relation: "Ratio", spread: 0.6, skew: 0.4, curve: 0.2, smooth: 0.2, polarity: "Unipolar" });
  const m = melody(p, [1, 0], [0, 3, 7, 12, 7, 3, 10, 7, 5, 8, 12, 15, 12, 8, 7, 3], { rate: "1/16", root: "A", scale: "Natural Minor",
    octave: -1, shape: 0.9, gatelength: 0.7, env: { decay: 0.12, sustain: 0.7, release: 0.08 } });
  const flt = p.add("filter", [4, 0], { cutoff: 300, resonance: 0.5, drive: 0.2, type: "Diode Ladder Tanh" });
  p.cable(m.amp, "l", flt, "l").cable(m.amp, "l", flt, "r").cable(t, "a", flt, "cutoff", 0.5).cable(t, "b", m.osc, "shape", 0.3)
    .cable(t, "c", flt, "resonance", 0.25);
  const bt = beat(p, [0, 3], { style: "shuffle", level: -8 });
  const mix = p.add("audio-mixer", [5, 0], { level1: 5, level2: 0, master: -7 });
  p.cable(flt, "l", mix, "in1l").cable(flt, "r", mix, "in1r").cable(bt, "outl", mix, "in2l").cable(bt, "outr", mix, "in2r")
    .cable(t, "d", mix, "level1", 0.2).stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

export default [slowSwell, circularPan, polyAccents, audioOscillator, clockedRatios];
