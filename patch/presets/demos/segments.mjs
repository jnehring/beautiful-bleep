// SPDX-License-Identifier: MIT
// Segments: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Segments node data: up to 8 {type, wait, loop, sync} definitions (the rest are plain ramps).
function segData(defs) {
  const segments = [];
  for (let i = 0; i < 8; i++) {
    const d = defs[i] || {};
    segments.push({ type: d.type || "ramp", loop: !!d.loop, wait: d.wait || "gate", segIn: "advance", sync: d.sync || "1/4" });
  }
  return { segments };
}

/// Mixes (source, left jack, right jack, level dB) rows into Out 1/2.
function mixOut(p, at, parts, master = 0) {
  const lv = {};
  parts.forEach(([, , , l], i) => { lv[`level${i + 1}`] = l; });
  const mx = p.add("audio-mixer", at, { ...lv, master });
  parts.forEach(([src, jl, jr], i) => p.cable(src, jl, mx, `in${i + 1}l`).cable(src, jr, mx, `in${i + 1}r`));
  p.stereo(mx, p.out, { from: ["outl", "outr"] });
  return mx;
}

function twoBloomPluck() {
  const p = patch("Segments: Two-Bloom Pluck", {
    module: "segments", tempo: 88,
    description: "Five segments draw an envelope no ADSR can: a bright attack, a quick drop, a second bloom, a held sustain and a slow release. The same shape opens the VCA and the filter. Drag the points in the graph, or turn Time 3 and Level 3 to move the second bloom.",
    tags: ["envelope", "custom", "pluck", "ahdsr"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/4", root: "G", scale: "Major Pentatonic", gatelength: 0.8 },
    { data: steps([0, 4, 7, 4, 9, 7, 4, 2]) });
  const osc = p.add("oscillator", [1, 0], { shape: 0.85 });
  const flt = p.add("filter", [2, 0], { cutoff: 350, resonance: 0.35, type: "Ladder Tanh" });
  const amp = p.add("vca", [3, 0]);
  const sg = p.add("segments", [1, 1], {
    count: 5, run: "Gated",
    time1: 0.008, level1: 1, shape1: 0,
    time2: 0.12, level2: 0.15, shape2: 0.6,
    time3: 0.3, level3: 0.75, shape3: -0.2,
    time4: 0.2, level4: 0.6, shape4: 0,
    time5: 0.6, level5: 0, shape5: 0.5,
  }, { data: segData([{ type: "ramp" }, { type: "ramp" }, { type: "ramp" }, { type: "hold", wait: "gate" }, { type: "ramp" }]) });
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "gate", sg, "gate").cable(osc, "out", flt, "l").cable(sg, "out", flt, "cutoff", 0.4)
    .cable(flt, "l", amp, "l").cable(sg, "out", amp, "gain");
  const v = p.add("reverb", [4, 0], { size: 0.6, decay: 2.8, mix: 0.3 });
  const gm = p.add("audio-mixer", [3, 1], { level1: 1, master: 0 });
  p.cable(amp, "l", gm, "in1l").cable(amp, "l", gm, "in1r").stereo(gm, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function tempoLfo() {
  const p = patch("Segments: Lopsided LFO", {
    module: "segments", tempo: 110,
    description: "Run on Free with Sync turns four looped segments into a tempo-locked LFO of a shape no standard wave has: a fast curved rise, a dip and two uneven steps. It sweeps the filter on a bass line. Drag the points or change the note values to reshape the wobble.",
    tags: ["lfo", "sync", "wobble", "bass"],
  });
  const m = melody(p, [0, 0], [0, 0, 7, 0, 5, 0, 3, 5], { rate: "1/8", root: "D", scale: "Natural Minor", octave: -1, shape: 0.9, gatelength: 0.65,
    env: { decay: 0.2, sustain: 0.7, release: 0.1 } });
  const sg = p.add("segments", [0, 2], {
    count: 4, run: "Free", sync: true,
    level1: 1, shape1: 0.6, level2: -0.3, shape2: -0.4, level3: 0.5, shape3: 0, level4: -0.8, shape4: 0.3,
  }, { data: segData([{ sync: "1/8.", loop: true }, { sync: "1/16", loop: true }, { sync: "1/16", loop: true }, { sync: "1/8", loop: true }]) });
  const flt = p.add("filter", [3, 0], { cutoff: 300, resonance: 0.55, drive: 0.2, type: "Ladder Tanh" });
  p.cable(m.amp, "l", flt, "l").cable(m.amp, "l", flt, "r").cable(sg, "out", flt, "cutoff", 0.4);
  const bt = beat(p, [0, 4], { style: "half", level: -6 });
  mixOut(p, [5, 0], [[flt, "l", "r", 2], [bt, "outl", "outr", -4]], -4);
  return p;
}

function stepMelody() {
  const p = patch("Segments: Step Melody", {
    module: "segments", tempo: 106,
    description: "Eight Step segments on Free with Sync at 1/8 are a tiny sequencer: each segment's Level is a pitch, and a Quantizer snaps the staircase to A minor pentatonic. Drag the Levels in the graph to write a new tune, or change Count to shorten the loop.",
    tags: ["sequence", "steps", "melody", "quantized"],
  });
  const lv = [-0.5, -0.17, 0.08, 0.33, 0.58, 0.25, -0.08, -0.33];
  const params = { count: 8, run: "Free", sync: true };
  lv.forEach((l, i) => { params[`level${i + 1}`] = l; });
  const sg = p.add("segments", [0, 0], params, { data: segData(lv.map(() => ({ type: "step", sync: "1/8", loop: true }))) });
  const q = p.add("quantizer", [1, 0], { root: "A", scale: "Minor Pentatonic" });
  const osc = p.add("oscillator", [2, 0], { shape: 0.4 });
  const gate = p.add("lfo", [0, 2], { wave: "Square", sync: "1/8", pw: 0.5, polarity: "Unipolar" }, { name: "Note Gate" });
  const env = p.add("adsr", [2, 1], { attack: 0.003, decay: 0.2, sustain: 0.25, release: 0.15 });
  const amp = p.add("vca", [3, 0]);
  p.cable(sg, "out", q, "in").cable(q, "out", osc, "pitch").cable(gate, "out", env, "gate").cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  const dl = p.add("delay-network", [4, 0], { time: 0.28, taps: 3, feedback: 0.4, mix: 0.3, scatter: 0.3 });
  const gm = p.add("audio-mixer", [3, 1], { level1: -2, master: 0 });
  p.cable(amp, "l", gm, "in1l").cable(amp, "l", gm, "in1r").stereo(gm, dl, { from: ["outl", "outr"] }).stereo(dl, p.out);
  return p;
}

function swellPad() {
  const p = patch("Segments: Breathing Pad", {
    module: "segments", tempo: 72,
    description: "A long chord is shaped by a swell of two peaks: it rises, dips and rises again before holding while the gate is high, then releases slowly. Time Scale stretches the whole breath at once; try it, or move the dip's Level.",
    tags: ["pad", "swell", "slow", "envelope"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 4, rate: "1/1", root: "F", scale: "Lydian", gatelength: 0.92 },
    { data: steps([0, 5, 2, 7]) });
  const tones = [["Root", 0, -5, "-1"], ["Third", 4, 6, "0"], ["Fifth", 7, -3, "0"]];
  const mix = p.add("audio-mixer", [3, 0], { level1: -6, level2: -8, level3: -8, pan1: -0.3, pan2: 0.3, pan3: -0.1, master: 0 });
  tones.forEach(([name, c, f, oct], i) => {
    const o = p.add("oscillator", [1, i], { shape: 0.7, coarse: c, fine: f, octave: oct }, { name });
    p.cable(seq, "pitch", o, "pitch").cable(o, "out", mix, `in${i + 1}l`).cable(o, "out", mix, `in${i + 1}r`);
  });
  const sg = p.add("segments", [2, 3], {
    count: 5, run: "Gated",
    time1: 0.6, level1: 0.7, shape1: 0.3, time2: 0.4, level2: 0.3, shape2: 0,
    time3: 0.7, level3: 1, shape3: 0.2, time4: 1, level4: 1, shape4: 0, time5: 2.2, level5: 0, shape5: 0.3,
  }, { data: segData([{ type: "ramp" }, { type: "ramp" }, { type: "ramp" }, { type: "hold", wait: "gate" }, { type: "ramp" }]) });
  const flt = p.add("filter", [4, 0], { cutoff: 500, resonance: 0.2, type: "SVF Multimode" });
  const amp = p.add("vca", [5, 0]);
  p.cable(seq, "gate", sg, "gate").stereo(mix, flt, { from: ["outl", "outr"] }).cable(sg, "out", flt, "cutoff", 0.4)
    .stereo(flt, amp).cable(sg, "out", amp, "gain");
  const gm = p.add("audio-mixer", [6, 1], { level1: -5, master: 0 });
  const v = p.add("reverb", [7, 0], { size: 0.85, decay: 7, mix: 0.4 });
  p.cable(amp, "l", gm, "in1l").cable(amp, "r", gm, "in1r").stereo(gm, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function segmentRhythm() {
  const p = patch("Segments: Drums From Segments", {
    module: "segments", tempo: 120,
    description: "Eight looped Step segments of an eighth note each make a one-bar clock: every segment's gate output fires a drum, so the Seg outputs are a patchable pattern, while the stepped Out moves a bass filter. Try patching other Seg outputs onto other drums.",
    tags: ["rhythm", "seg outputs", "drums", "clock"],
  });
  const lv = [1, 0.2, 0.7, 0.1, 0.9, 0.3, 0.6, -0.2];
  const params = { count: 8, run: "Free", sync: true };
  lv.forEach((l, i) => { params[`level${i + 1}`] = l; });
  const sg = p.add("segments", [0, 0], params, { data: segData(lv.map(() => ({ type: "step", sync: "1/8", loop: true }))) });
  const kick = p.add("punch-kick", [1, 0], { level: 0.85 });
  const snare = p.add("punch-snare", [1, 1], { level: 0.65 });
  const hats = p.add("punch-hats", [1, 2], { level: 0.5 });
  const rim = p.add("punch-rim", [1, 3], { level: 0.5 });
  const mix = p.add("audio-mixer", [2, 0], { level1: -2, level2: -5, level3: -10, level4: -9, pan3: 0.3, pan4: -0.3, master: 0 });
  p.cable(sg, "seg1", kick, "trig").cable(sg, "seg5", kick, "trig").cable(sg, "seg7", kick, "trig")
    .cable(sg, "seg3", snare, "trig").cable(sg, "seg8", rim, "trig")
    .cable(sg, "seg2", hats, "closed").cable(sg, "seg4", hats, "closed").cable(sg, "seg6", hats, "open")
    .cable(kick, "out", mix, "in1l").cable(snare, "out", mix, "in2l").cable(hats, "out", mix, "in3l").cable(rim, "out", mix, "in4l");
  const b = melody(p, [0, 4], [0, 0, 7, 0, 5, 0, 3, 7], { rate: "1/8", root: "C", scale: "Natural Minor", octave: -1, shape: 0.9, env: { decay: 0.18, sustain: 0.5, release: 0.1 } });
  const flt = p.add("filter", [3, 4], { cutoff: 250, resonance: 0.45, type: "Ladder Tanh" });
  p.cable(b.amp, "l", flt, "l").cable(b.amp, "l", flt, "r").cable(sg, "out", flt, "cutoff", 0.3);
  mixOut(p, [4, 0], [[mix, "outl", "outr", 0], [flt, "l", "r", -2]], -3);
  return p;
}

export default [twoBloomPluck, tempoLfo, stepMelody, swellPad, segmentRhythm];
