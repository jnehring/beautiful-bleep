// quantizer: five demo patches. Each plays by itself with the transport.
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

const semis = (n) => n / 12;

function triangleClimb() {
  const p = patch("Quantizer: Triangle Climb", {
    module: "quantizer", tempo: 96,
    description: "A slow triangle LFO is a smooth, continuous voltage; the Quantizer turns it into stairs of pentatonic notes and fires a trigger on every new one, so the voice climbs and falls by itself. Widen Range for more octaves, or pick another Scale.",
    tags: ["lfo", "pentatonic", "scale", "generative"],
  });
  const lfo = p.add("lfo", [0, 0], { rate: 0.18, wave: "Triangle" }, { name: "Climb" });
  const q = p.add("quantizer", [1, 0], { root: "C", scale: "Major Pentatonic", range: 2, hysteresis: 0.1 });
  p.cable(lfo, "out", q, "in", 0.5);
  const v = voice(p, [2, 0], { n: q, pitch: "out", gate: "gate", trig: "trigger" }, { shape: 0.35, env: { decay: 0.4, sustain: 0, release: 0.3 }, osc: { octave: "0" } });
  const dl = p.add("delay", [4, 0], { timel: 333, timer: 500, feedback: 0.45, highcut: 5000, mix: 0.3 });
  p.cable(v.amp, "l", dl, "l").cable(v.amp, "l", dl, "r");
  const drone = p.add("oscillator", [2, 3], { shape: 0.1, octave: "-2" }, { name: "Drone" });
  const dv = p.add("vca", [3, 3], { gain: 0.4 }, { name: "Drone Level" });
  p.cable(drone, "out", dv, "l");
  finish(p, [5, 0], [{ n: dl, level: 0 }, { n: v.amp, level: -3 }, { n: dv, level: -12 }], { vmix: 0.3, decay: 3.5, master: 0 });
  return p;
}

function randomWalk() {
  const p = patch("Quantizer: Dorian Wanderer", {
    module: "quantizer", tempo: 108,
    description: "A stepped Random sends any value it likes; the Quantizer is clocked by a sequencer and, on each tick, snaps it into D Dorian, so the wandering always sounds like a tune. Try a different Scale (Whole Tone, Blues) or a smaller Range.",
    tags: ["random", "dorian", "clocked", "melody"],
  });
  const clk = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/8", gatelength: 0.5 }, { data: steps([0, 0, 0, ".", 0, 0, ".", 0]) }, { name: "Clock" });
  const rnd = p.add("random", [0, 2], { rate: 4, sync: "1/8", spread: 0.7, bias: 0, smooth: 0, seed: 21 }, { name: "Wander" });
  const q = p.add("quantizer", [1, 0], { root: "D", scale: "Dorian", range: 1.5, hysteresis: 0.0 });
  p.cable(rnd, "out", q, "in", 0.8).cable(clk, "trigger", q, "clock");
  const v = voice(p, [2, 0], { n: q, pitch: "out", gate: "gate", trig: false }, { shape: 0.7, env: { decay: 0.25, sustain: 0, release: 0.2 }, cutoff: 2800 });
  p.cable(clk, "trigger", v.env, "retrig");
  const bass = melody(p, [0, 4], [0, ".", ".", 0, ".", ".", 7, "."], { rate: "1/8", root: "D", scale: "Dorian", octave: -2, shape: 0.15, gatelength: 0.7, env: { decay: 0.3, sustain: 0.3, release: 0.15 } });
  const drums = beat(p, [0, 6], { style: "broken", level: -10 });
  finish(p, [5, 0], [{ n: v.out.n, level: 5 }, { n: bass.amp, level: -4 }, drumsOf(drums, 0)], { vmix: 0.2, decay: 2, master: 0 });
  return p;
}

function hirajoshiRun() {
  const p = patch("Quantizer: Chromatic Run to Hirajoshi", {
    module: "quantizer", tempo: 100,
    description: "The sequencer plays an ordinary chromatic run, every semitone, and the Quantizer squeezes it into the five-note Hirajoshi scale, so repeated notes appear where the notes were pushed together. Switch Scale to Chromatic for the original run, or Rounding to Up.",
    tags: ["hirajoshi", "scale", "chromatic", "rounding"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "C", scale: "Chromatic", octave: 0, gatelength: 0.5 },
    { data: steps([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 10, 7, 3]) });
  const q = p.add("quantizer", [1, 0], { root: "A", scale: "Hirajoshi", rounding: "Nearest", range: 1 });
  p.cable(seq, "pitch", q, "in");
  const v = voice(p, [2, 0], { n: q, pitch: "out", gate: "gate", trig: "trigger" }, { shape: 0.2, osc: { octave: "0" }, env: { decay: 0.45, sustain: 0.05, release: 0.35 } });
  // the gate comes from the sequencer
  p.cable(seq, "gate", v.env, "gate").cable(seq, "trigger", v.env, "retrig");
  const drums = beat(p, [0, 4], { style: "sparse", level: -10 });
  finish(p, [4, 0], [{ n: v.amp, level: 3 }, drumsOf(drums, 0)], { vmix: 0.3, decay: 3.5, master: 0 });
  return p;
}

function glideSlides() {
  const p = patch("Quantizer: Glide Between Notes", {
    module: "quantizer", tempo: 80,
    description: "A sine LFO sweeps a legato voice; the Quantizer picks scale notes but Glide turns each jump into a slide, like a fretless line stepping through a scale. Set Glide to zero for hard steps, or Rounding to Down to favour the lower note.",
    tags: ["glide", "slide", "legato", "lfo"],
  });
  const lfo = p.add("lfo", [0, 0], { rate: 0.25, wave: "Sine" }, { name: "Swell" });
  const q = p.add("quantizer", [1, 0], { root: "G", scale: "Natural Minor", range: 1.5, glide: 0.18, rounding: "Down", hysteresis: 0.15 });
  p.cable(lfo, "out", q, "in", 0.6);
  const osc = p.add("oscillator", [2, 0], { shape: 0.6, octave: "-1" }, { name: "Voice" });
  const osc2 = p.add("oscillator", [2, 1], { shape: 0.3, octave: "0", fine: 6 }, { name: "Voice 2" });
  const flt = p.add("filter", [3, 0], { cutoff: 1400, resonance: 0.2 });
  p.cable(q, "out", osc, "pitch").cable(q, "out", osc2, "pitch").cable(osc, "out", flt, "l").cable(osc2, "out", flt, "l", 0.6);
  const amp = p.add("vca", [3, 1], { gain: 0.5 }, { name: "Level" });
  p.cable(flt, "l", amp, "l");
  finish(p, [5, 0], [{ n: amp, level: 4 }], { vmix: 0.35, decay: 4, master: 2 });
  return p;
}

function shiftCanon() {
  const p = patch("Quantizer: Shift Echo", {
    module: "quantizer", tempo: 104,
    description: "One sequencer line is quantized to the blues scale; a square LFO adds a step to the Transpose input every other bar, lifting the whole line to a new key area that is still in the scale. Change the LFO Sync or the amount of the Transpose cable.",
    tags: ["transpose", "blues", "shift", "sequencer"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "C", scale: "Chromatic", octave: 0, gatelength: 0.45 },
    { data: steps([0, ".", 3, ".", 5, 6, ".", 7, 10, ".", 7, 5, 3, ".", 0, "."]) });
  const lfo = p.add("lfo", [0, 3], { wave: "Square", sync: "Tempo", division: "2 bars", polarity: "Unipolar" }, { name: "Key Shift" });
  const q = p.add("quantizer", [1, 0], { root: "E", scale: "Blues", range: 1 });
  p.cable(seq, "pitch", q, "in").cable(lfo, "out", q, "transpose", semis(5));
  const v = voice(p, [2, 0], { n: q, pitch: "out", gate: "gate", trig: "trigger" }, { shape: 0.75, env: { decay: 0.25, sustain: 0.1, release: 0.15 }, cutoff: 2200 });
  p.cable(seq, "gate", v.env, "gate").cable(seq, "trigger", v.env, "retrig");
  const drums = beat(p, [0, 5], { style: "four", level: -10 });
  finish(p, [5, 0], [{ n: v.out.n, level: 5 }, drumsOf(drums, 0)], { vmix: 0.15, master: 0 });
  return p;
}

export default [triangleClimb, randomWalk, hirajoshiRun, glideSlides, shiftCanon];
