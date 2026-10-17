// notes-to-cv: five demo patches. Each plays by itself with the transport.
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

function accentLead() {
  const p = patch("Notes to CV: Accent Lead", {
    module: "notes-to-cv", tempo: 104,
    description: "A sequencer's notes come in, and Notes to CV hands out pitch, gate, trigger and velocity: the velocity opens the envelope harder on the accented steps. Try Retrigger Off to hear the tied notes run together.",
    tags: ["lead", "velocity", "accent", "sequencer"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "E", scale: "Minor Pentatonic", octave: 0, gatelength: 0.55 },
    { data: steps([0, ".", 3, 5, 7, "_", 5, 3, 0, 3, 7, ".", 10, 7, 5, 3], [120, 70, 90, 70, 120, 70, 90, 60, 110, 70, 100, 70, 127, 80, 70, 90]) });
  const n2c = p.add("notes-to-cv", [1, 0], { retrigger: "On" });
  p.cable(seq, "notes", n2c, "notes");
  const v = voice(p, [2, 0], { n: n2c }, { shape: 0.8, env: { decay: 0.3, sustain: 0.15, release: 0.2 }, cutoff: 2600, res: 0.25 });
  p.cable(n2c, "velocity", v.env, "velocity");
  const drums = beat(p, [0, 4], { style: "half", level: -10 });
  const dl = p.add("delay", [5, 0], { timel: 300, timer: 450, feedback: 0.35, highcut: 4500, mix: 0.25 });
  p.cable(v.out.n, "l", dl, "l").cable(v.out.n, "l", dl, "r");
  finish(p, [6, 0], [{ n: dl, level: 6 }, drumsOf(drums, 4)], { vmix: 0.2, master: 3 });
  return p;
}

function glideBass() {
  const p = patch("Notes to CV: Gliding Bass", {
    module: "notes-to-cv", tempo: 96,
    description: "Tied notes slide into each other because Glide is up and Glide Mode is Legato Only; separate notes still jump. Turn Glide to 0 for a plain bass, or set Glide Mode to Always to slide into every note.",
    tags: ["glide", "legato", "bass", "portamento"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "A", scale: "Natural Minor", octave: -2, gatelength: 0.8 },
    { data: steps([0, "_", 7, "_", 0, ".", 10, "_", 12, "_", 7, ".", 5, "_", 3, 0]) });
  const n2c = p.add("notes-to-cv", [1, 0], { glide: 0.12, glidemode: "Legato Only", retrigger: "Off (Legato)" });
  p.cable(seq, "notes", n2c, "notes");
  const v = voice(p, [2, 0], { n: n2c }, { shape: 0.9, env: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.12 }, cutoff: 700, res: 0.4, osc: {} });
  const lfo = p.add("lfo", [2, 3], { rate: 0.12, wave: "Sine" }, { name: "Wah" });
  p.cable(lfo, "out", v.flt, "cutoff", 0.25);
  const drums = beat(p, [0, 4], { style: "broken", level: -9 });
  finish(p, [5, 0], [{ n: v.out.n, level: -4 }, drumsOf(drums, -5)], { vmix: 0.12, decay: 1.5 });
  return p;
}

function lowAndHigh() {
  const p = patch("Notes to CV: Lowest and Highest", {
    module: "notes-to-cv", tempo: 88,
    description: "A Chord Quantizer sends four-note chords as notes; one Notes to CV follows the lowest note for a bass, another the highest for a bright lead. Change either Priority to Last or First to follow a different note of the chord.",
    tags: ["priority", "chords", "bass", "lead", "split"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/2", root: "F", scale: "Major", octave: 0, gatelength: 0.9 },
    { data: steps([0, 4, 5, 3, 0, 4, 5, 7]) });
  const cq = p.add("chord-quantizer", [1, 0], { chord: "Major 7", voices: 4, voicing: "Spread" });
  p.cable(seq, "pitch", cq, "pitch").cable(seq, "trigger", cq, "trig").cable(seq, "gate", cq, "gate");
  const lo = p.add("notes-to-cv", [2, 0], { priority: "Lowest" }, { name: "Bass Follows" });
  const hi = p.add("notes-to-cv", [2, 2], { priority: "Highest" }, { name: "Lead Follows" });
  p.cable(cq, "notes", lo, "notes").cable(cq, "notes", hi, "notes");
  const bass = voice(p, [3, 0], { n: lo }, { shape: 0.2, osc: { octave: "-1" }, env: { decay: 0.6, sustain: 0.5, release: 0.4 }, name: "Bass" });
  const lead = voice(p, [3, 2], { n: hi }, { shape: 0.5, osc: { octave: "+1" }, env: { attack: 0.02, decay: 0.7, sustain: 0.2, release: 0.5 }, cutoff: 3500, name: "Lead" });
  const drums = beat(p, [0, 5], { style: "sparse", level: -12 });
  finish(p, [6, 0], [{ n: bass.amp, level: 4, pan: -0.2 }, { n: lead.out.n, level: 2, pan: 0.3 }, drumsOf(drums, 0)], { vmix: 0.28, decay: 3 });
  return p;
}

function legatoPad() {
  const p = patch("Notes to CV: Drifting Pad", {
    module: "notes-to-cv", tempo: 70,
    description: "Overlapping long notes with Retrigger Off and a slow Glide make the pad drift from chord root to chord root without restarting its envelope. Switch Retrigger to On and every note swells again.",
    tags: ["pad", "legato", "retrigger", "slow"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/1", root: "D", scale: "Dorian", octave: -1, gatelength: 1 },
    { data: steps([0, "_", 4, "_", 5, "_", 3, 7]) });
  const n2c = p.add("notes-to-cv", [1, 0], { glide: 0.5, glidemode: "Always", retrigger: "Off (Legato)" });
  p.cable(seq, "notes", n2c, "notes");
  const a = voice(p, [2, 0], { n: n2c }, { shape: 0.65, osc: { fine: -7 }, env: { attack: 0.8, decay: 1, sustain: 0.8, release: 1.5 }, cutoff: 1300, res: 0.15, name: "Pad A" });
  const b = voice(p, [2, 3], { n: n2c }, { shape: 0.5, osc: { fine: 8, octave: "+1" }, env: { attack: 1.2, decay: 1, sustain: 0.8, release: 1.5 }, cutoff: 1800, res: 0.1, name: "Pad B" });
  finish(p, [6, 0], [{ n: a.out.n, level: -8, pan: -0.4 }, { n: b.out.n, level: -12, pan: 0.4 }], { vmix: 0.45, decay: 5, size: 0.7 });
  return p;
}

function triggerOut() {
  const p = patch("Notes to CV: Trigger Out Kick", {
    module: "notes-to-cv", tempo: 118,
    description: "Every note that arrives also leaves Notes to CV as a trigger, here firing a kick drum in step with a bass line, while Pitch plays the bass. Change the sequencer's pattern and the kick follows it.",
    tags: ["trigger", "kick", "bass", "pitch"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "G", scale: "Natural Minor", octave: -2, gatelength: 0.5 },
    { data: steps([0, ".", 0, 12, ".", 0, ".", 7, 0, ".", 0, 12, ".", 5, 7, "."]) });
  const n2c = p.add("notes-to-cv", [1, 0], {});
  p.cable(seq, "notes", n2c, "notes");
  const v = voice(p, [2, 0], { n: n2c }, { shape: 0.8, env: { decay: 0.2, sustain: 0.3, release: 0.1 }, cutoff: 900, res: 0.35 });
  const kick = p.add("punch-kick", [2, 3], { level: 0.8, decay: 0.5 });
  p.cable(n2c, "trigger", kick, "trig").cable(n2c, "velocity", kick, "velocity");
  const hats = beat(p, [0, 5], { style: "four", level: -14 });
  finish(p, [5, 0], [{ n: v.out.n, level: 4 }, { n: kick, l: "out", level: -6 }, drumsOf(hats, -2)], { vmix: 0.1, decay: 1 });
  return p;
}

export default [accentLead, glideBass, lowAndHigh, legatoPad, triggerOut];
