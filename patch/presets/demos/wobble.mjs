// SPDX-License-Identifier: MIT
// Wobble: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mono/stereo source (`src`, jacks l/r) → trim → reverb → Out.
function finish(p, at, src, o = {}) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: o.trim ?? 0, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...(o.verb || {}) });
  const [jl, jr] = o.jacks || ["l", "r"];
  p.cable(src, jl, t, "in1l").cable(src, o.stereo ? jr : jl, t, "in1r");
  p.stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

/// Plucked melody into a Multi Filter (returns the filter, stereo out).
function voice(p, at, notes, o = {}) {
  const m = melody(p, at, notes, o);
  const f = p.add("filter", [at[0] + 3, at[1]], { cutoff: 1200, resonance: 0.25, ...(o.filter || {}) }, { name: "Filter" });
  p.cable(m.amp, "l", f, "l").cable(m.amp, "l", f, "r");
  return { ...m, filt: f };
}

/// Two detuned oscillators (left / right) held by a sequencer → VCA (gain left to the caller) → Multi Filter.
function pad(p, at, notes, o = {}) {
  const [c, r] = at;
  const seq = p.add("step-sequencer", [c, r], { length: notes.length, rate: o.rate || "1/2", root: o.root || "A", scale: o.scale || "Minor Pentatonic",
    octave: o.octave ?? -1, gatelength: o.gate ?? 0.95 }, { data: steps(notes) });
  const o1 = p.add("oscillator", [c + 1, r], { shape: o.shape ?? 0.5, fine: -9 }, { name: "Osc L" });
  const o2 = p.add("oscillator", [c + 1, r + 1], { shape: o.shape ?? 0.5, fine: 9 }, { name: "Osc R" });
  const amp = p.add("vca", [c + 2, r], { gain: o.gain ?? 1 }, { name: "VCA" });
  const f = p.add("filter", [c + 3, r], { cutoff: 1400, resonance: 0.2, ...(o.filter || {}) }, { name: "Filter" });
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "pitch", o2, "pitch").cable(o1, "out", amp, "l").cable(o2, "out", amp, "r")
    .stereo(amp, f);
  return { seq, o1, o2, amp, filt: f };
}

/// Up to six oscillators, each through its own VCA (gain from the caller), mixed to stereo on `master` (jacks outl/outr).
/// tones: [semitones, octave] per oscillator.
function chord(p, at, tones, o = {}) {
  const [c, r] = at;
  const lv = o.lvl ?? -10;
  const mixA = p.add("audio-mixer", [c + 2, r], { level1: lv, level2: lv, level3: lv, pan1: -0.7, pan2: 0, pan3: 0.7, master: 0 }, { name: "Mix 1-3" });
  const mixB = p.add("audio-mixer", [c + 2, r + 3], { level1: lv, level2: lv, level3: lv, pan1: 0.5, pan2: -0.4, pan3: 0.2, master: 0 }, { name: "Mix 4-6" });
  const vcas = [], oscs = [];
  tones.forEach((t, i) => {
    const osc = p.add("oscillator", [c, r + i], { shape: o.shape ?? 0, coarse: t[0], octave: t[1] }, { name: `Tone ${i + 1}` });
    const vca = p.add("vca", [c + 1, r + i], { gain: o.gain ?? 0 }, { name: `Level ${i + 1}` });
    p.cable(osc, "out", vca, "l");
    if (o.pitch) p.cable(o.pitch, "pitch", osc, "pitch");
    const m = i < 3 ? mixA : mixB, k = (i % 3) + 1;
    p.cable(vca, "l", m, `in${k}l`).cable(vca, "l", m, `in${k}r`);
    vcas.push(vca); oscs.push(osc);
  });
  const master = p.add("audio-mixer", [c + 3, r], { level1: 0, level2: 0, master: o.master ?? 0 }, { name: "Master" });
  p.stereo(mixA, master, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(mixB, master, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  return { vcas, oscs, master, jacks: ["outl", "outr"] };
}

function threeShapes() {
  const p = patch("Wobble: Three Shapes", {
    module: "wobble", tempo: 96,
    description: "One random stream, three ways: Stepped jumps the filter, Smooth glides the tone and Wobble overshoots and rings on the reverb. All three follow the same underlying values, so they feel related. Change Smooth and Wobble on the module to reshape the glides and overshoots.",
    tags: ["stepped", "smooth", "wobble", "random"],
  });
  const v = voice(p, [0, 0], [0, 7, 12, 7, 3, 10, 7, 3, 0, 5, 8, 12, 8, 5, 3, 7], { rate: "1/8", shape: 0.7, root: "A", env: { decay: 0.3, sustain: 0.2 }, filter: { cutoff: 700, resonance: 0.3 } });
  const w = p.add("wobble", [3, 1], { rate: 1.2, smooth: 0.6, wobble: 0.7, chaos: 0.1, sync: "1/4" });
  const verb = finish(p, [4, 0], v.filt, { stereo: true, trim: -2, verb: { size: 0.5, decay: 3, mix: 0.3 } });
  p.cable(w, "stepped", v.filt, "cutoff", 0.45).cable(w, "smooth", v.osc, "shape", 0.3).cable(w, "wobble", verb, "size", 0.3);
  return p;
}

function overshoot() {
  const p = patch("Wobble: Ringing Filter", {
    module: "wobble", tempo: 90,
    description: "With Wobble high, every jump of the random value overshoots and rings before it settles, so the filter on this held chord seems to bounce. Reduce Wobble for a plain glide, or increase Chaos for a more unstable movement.",
    tags: ["overshoot", "ringing", "chaos", "pad"],
  });
  const pd = pad(p, [0, 0], [0, 7, 3, 10], { rate: "1/1", root: "F", scale: "Natural Minor", gain: 1, shape: 0.9, filter: { cutoff: 700, resonance: 0.35 } });
  const w = p.add("wobble", [2, 2], { rate: 0.5, smooth: 0.4, wobble: 1, chaos: 0.15, sync: "1/2", level: 0.9 });
  p.cable(w, "wobble", pd.filt, "cutoff", 0.5);
  finish(p, [5, 0], pd.filt, { stereo: true, trim: -13, verb: { size: 0.6, decay: 3.5, mix: 0.3 } });
  return p;
}

function bursts() {
  const p = patch("Wobble: Burst Percussion", {
    module: "wobble", tempo: 108,
    description: "The Burst output fires a quick run of triggers every so often: here they flutter a hi-hat and clap while the clock output keeps the kick steady. Raise Burst for more frequent runs, and change Burst Size for longer flutters.",
    tags: ["burst", "drums", "hats", "triggers"],
  });
  const w = p.add("wobble", [0, 0], { rate: 2, smooth: 0.5, wobble: 0.3, burst: 0.6, burstsize: 5, sync: "1/4" });
  const kick = p.add("punch-kick", [1, 0], { level: 0.7 });
  const hats = p.add("punch-hats", [1, 1], { level: 0.45, tone: 0.6 });
  const clap = p.add("punch-clap", [1, 2], { level: 0.5 });
  const s = p.add("step-sequencer", [0, 3], { length: 8, rate: "1/16", root: "A", scale: "Minor Pentatonic", octave: -2, gatelength: 0.8 },
    { data: steps([0, ".", 0, ".", 7, ".", 5, "."]) });
  const bass = p.add("oscillator", [1, 3], { shape: 0.1 }, { name: "Sub" });
  const env = p.add("adsr", [2, 3], { attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.15 }, { name: "Sub Env" });
  const amp = p.add("vca", [3, 3], {});
  p.cable(w, "clock", kick, "trig").cable(w, "burst", hats, "closed").cable(w, "burst", clap, "trig").cable(w, "stepped", hats, "tune", 0.5)
    .cable(s, "pitch", bass, "pitch").cable(s, "gate", env, "gate").cable(s, "trigger", env, "retrig").cable(bass, "out", amp, "l").cable(env, "env", amp, "gain");
  const mix = p.add("audio-mixer", [4, 0], { level1: -4, level2: -10, level3: -10, level4: -9, master: 0 });
  p.cable(kick, "out", mix, "in1l").cable(kick, "out", mix, "in1r").cable(hats, "out", mix, "in2l").cable(hats, "out", mix, "in2r")
    .cable(clap, "out", mix, "in3l").cable(clap, "out", mix, "in3r").cable(amp, "l", mix, "in4l").cable(amp, "l", mix, "in4r");
  const v = p.add("reverb", [5, 0], { size: 0.4, decay: 1.6, mix: 0.15, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function compareMelody() {
  const p = patch("Wobble: Quantised Tune", {
    module: "wobble", tempo: 100,
    description: "The Stepped output goes through a Quantizer to become a melody in a scale, and the Compare output decides when a note plays, so both pitch and rhythm are random but musical. Raise Wobble's Rate for a busier tune or change the Quantizer's Scale.",
    tags: ["compare", "random melody", "quantizer", "gate"],
  });
  const w = p.add("wobble", [0, 0], { rate: 3, smooth: 0, wobble: 0.2, chaos: 0.2, sync: "1/8", level: 1 });
  const q = p.add("quantizer", [1, 0], { root: "D", scale: "Dorian", range: 1 });
  const osc = p.add("oscillator", [2, 0], { shape: 0.8 }, { name: "Source" });
  const env = p.add("adsr", [2, 1], { attack: 0.004, decay: 0.4, sustain: 0.5, release: 0.3 }, { name: "Amp Env" });
  const amp = p.add("vca", [3, 0], {});
  const f = p.add("filter", [4, 0], { cutoff: 1800, resonance: 0.2 }, { name: "Filter" });
  p.cable(w, "stepped", q, "in", 0.15).cable(w, "clock", q, "clock").cable(q, "out", osc, "pitch").cable(w, "compare", env, "gate").cable(w, "clock", env, "retrig")
    .cable(osc, "out", amp, "l").cable(env, "env", amp, "gain").cable(amp, "l", f, "l").cable(amp, "l", f, "r");
  finish(p, [5, 0], f, { stereo: true, trim: 6, verb: { size: 0.5, decay: 2.5, mix: 0.3 } });
  return p;
}

function sampleHold() {
  const p = patch("Wobble: Sample and Hold", {
    module: "wobble", tempo: 118,
    description: "A triangle LFO patched into Sample is read at each tick of the Wobble clock, and the Stepped output holds the value in between: a classic sample-and-hold filter pattern that stays related to the LFO. Change the LFO rate or the Wobble Sync to change the pattern.",
    tags: ["sample and hold", "sample input", "lfo", "bass"],
  });
  const v = voice(p, [0, 0], [0, "_", 0, 0, 7, "_", 5, ".", 0, "_", 0, 3, 10, "_", 7, 5], { rate: "1/8", shape: 0.95, root: "E", octave: -2, gatelength: 0.8, env: { decay: 0.2, sustain: 0.7 }, filter: { cutoff: 300, resonance: 0.4 } });
  const l = p.add("lfo", [3, 2], { rate: 0.37, wave: "Triangle" }, { name: "Source" });
  const w = p.add("wobble", [3, 1], { smooth: 0, wobble: 0, chaos: 0, sync: "1/8" });
  p.cable(l, "out", w, "sample").cable(w, "stepped", v.filt, "cutoff", 0.55);
  const drums = beat(p, [0, 4], { style: "four", level: -7 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -6, level2: -11, master: 0 });
  const verb = p.add("reverb", [5, 0], { size: 0.4, decay: 1.8, mix: 0.12, quality: "Eco (8 lines)" });
  p.cable(v.filt, "l", mix, "in1l").cable(v.filt, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(mix, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

export default [threeShapes, overshoot, bursts, compareMelody, sampleHold];
