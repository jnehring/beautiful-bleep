// harmony-master: five demo patches. Each plays by itself with the transport.
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

/// Tone 1-4 -> four oscillators -> panned Audio Mixer. Returns the mixer (stereo outl/outr).
function tones(p, at, hm, o = {}) {
  const [c, r] = at;
  const vals = { master: o.master ?? -3 };
  [-0.6, -0.2, 0.2, 0.6].forEach((x, i) => { vals[`pan${i + 1}`] = x; vals[`level${i + 1}`] = o.level ?? -6; });
  const mix = p.add("audio-mixer", [c + 1, r], vals, { name: "Chord Mix" });
  for (let i = 0; i < 4; i++) {
    const osc = p.add("oscillator", [c, r + i], { shape: (o.shapes || [0.6, 0.5, 0.6, 0.4])[i], octave: String(o.octave ?? 0), fine: (i - 1.5) * (o.detune ?? 6) }, { name: `Tone ${i + 1}` });
    p.cable(hm, `tone${i + 1}`, osc, "pitch").cable(osc, "out", mix, `in${i + 1}l`).cable(osc, "out", mix, `in${i + 1}r`);
  }
  return mix;
}
/// A swelling or plucked amplitude for the chord mixer: gate/trigger from a source.
function chordEnv(p, at, mix, src, adsr) {
  const env = p.add("adsr", [at[0], at[1] + 1], adsr, { name: "Chord Env" });
  const amp = p.add("vca", at, {}, { name: "Chord VCA" });
  p.cable(src.n, src.gate, env, "gate");
  if (src.trig) p.cable(src.n, src.trig, env, "retrig");
  p.stereo(mix, amp, { from: ["outl", "outr"] }).cable(env, "env", amp, "gain");
  return amp;
}
function bassOn(p, at, hm, jack, o = {}) {
  const osc = p.add("oscillator", at, { shape: o.shape ?? 0.15, octave: String(o.octave ?? -1) }, { name: "Bass" });
  const amp = p.add("vca", [at[0] + 1, at[1]], { gain: o.gain ?? 0.55 }, { name: "Bass Level" });
  p.cable(hm, jack, osc, "pitch").cable(osc, "out", amp, "l");
  return amp;
}
const leadOnBus = (p, at, notes, o = {}) => {
  const seq = p.add("step-sequencer", at, { length: notes.length, rate: o.rate || "1/8", harmony: "Bus A", gatelength: 0.5, octave: o.octave ?? 1, variation: o.variation ?? 0 },
    { data: steps(notes) }, { name: "Follower Lead" });
  const osc = p.add("oscillator", [at[0] + 1, at[1]], { shape: o.shape ?? 0.3 }, { name: "Lead" });
  const env = p.add("adsr", [at[0] + 1, at[1] + 1], { attack: 0.005, decay: 0.3, sustain: 0.1, release: 0.25 }, { name: "Lead Env" });
  const amp = p.add("vca", [at[0] + 2, at[1]], {}, { name: "Lead VCA" });
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  return amp;
};
const SLOW = { attack: 0.5, decay: 1, sustain: 0.85, release: 1.2 };

function minorJourney() {
  const p = patch("Harmony Master: Minor Journey", {
    module: "harmony-master", tempo: 76,
    description: "A minor progression (i, VI, III, VII) runs with the transport; its Tone outputs hold a warm pad, Bass walks underneath and a sequenced lead on the bus rewrites itself to stay inside each chord's scale. Change Key or Scale and the whole board follows.",
    tags: ["progression", "minor", "pad", "bus", "follower"],
  });
  const hm = p.add("harmony-master", [0, 0], { source: "Progression", key: "A", scale: "Natural Minor", advance: "Transport", bus: "A" },
    { data: { slots: [{ deg: 1, q: "diatonic-seventh", len: 4 }, { deg: 6, q: "diatonic-seventh", len: 4 }, { deg: 3, q: "diatonic-seventh", len: 4 }, { deg: 7, q: "diatonic-triad", len: 4 }] } });
  const mix = tones(p, [1, 0], hm, { shapes: [0.55, 0.4, 0.55, 0.35], detune: 7 });
  const pad = p.add("vca", [3, 0], { gain: 0.5 }, { name: "Pad Level" });
  const sw = p.add("lfo", [3, 3], { rate: 0.07, wave: "Sine", polarity: "Unipolar" }, { name: "Swell" });
  p.stereo(mix, pad, { from: ["outl", "outr"] }).cable(sw, "out", pad, "gain", 0.25);
  const flt = p.add("filter", [4, 0], { cutoff: 1500, resonance: 0.15 });
  p.stereo(pad, flt);
  const bass = bassOn(p, [1, 5], hm, "bass");
  const lead = leadOnBus(p, [1, 7], [0, 2, 4, 2, 1, 3, 5, 3], { octave: 1, shape: 0.25 });
  finish(p, [5, 0], [{ n: flt, l: "l", r: "r", level: 0 }, { n: bass, level: -8 }, { n: lead, level: -3, pan: 0.25 }], { vmix: 0.35, decay: 4, size: 0.7, master: 1 });
  return p;
}

function triggerStepping() {
  const p = patch("Harmony Master: Stepping by Trigger", {
    module: "harmony-master", tempo: 110,
    description: "With Advance set to Trigger, the progression moves one chord every time a trigger arrives; here an off-beat sequencer rhythm does the stepping and each change plucks the chord. Edit the trigger rhythm and the chords change when you decide.",
    tags: ["trigger", "advance", "pluck", "rhythm"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", gatelength: 0.3 }, { data: steps([0, ".", ".", 0, ".", ".", 0, ".", ".", ".", 0, ".", ".", 0, ".", "."]) }, { name: "Change Rhythm" });
  const hm = p.add("harmony-master", [1, 0], { source: "Progression", key: "F", scale: "Major", advance: "Trigger", bus: "A" },
    { data: { slots: [{ deg: 1, q: "major9", len: 1 }, { deg: 2, q: "minor9", len: 1 }, { deg: 5, q: "dominant9", len: 1 }, { deg: 6, q: "minor7", len: 1 }] } });
  p.cable(seq, "trigger", hm, "next");
  const mix = tones(p, [2, 0], hm, { shapes: [0.2, 0.1, 0.25, 0.15], detune: 3 });
  const pluck = chordEnv(p, [4, 0], mix, { n: hm, gate: "change", trig: "change" }, { attack: 0.004, decay: 0.9, sustain: 0, release: 0.9 });
  const bass = bassOn(p, [2, 5], hm, "bass", { shape: 0.1 });
  const drums = beat(p, [0, 6], { style: "shuffle", level: -10 });
  finish(p, [6, 0], [{ n: pluck, level: 6 }, { n: bass, level: -8 }, drumsOf(drums, 0)], { vmix: 0.25, master: 5 });
  return p;
}

function keyModulation() {
  const p = patch("Harmony Master: Key Change Up", {
    module: "harmony-master", tempo: 92,
    description: "A slow two-step sequence feeds the Transpose input, so after four bars the whole progression, bass and follower lead move up two semitones together. Change the transposing sequence to climb through more keys.",
    tags: ["transpose", "modulation", "key change", "pop"],
  });
  const kseq = p.add("step-sequencer", [0, 0], { length: 4, rate: "1/1", root: "C", scale: "Chromatic", octave: 0, gatelength: 1 }, { data: steps([0, 0, 2, 2]) }, { name: "Key Steps" });
  const hm = p.add("harmony-master", [1, 0], { source: "Progression", key: "D", scale: "Major", advance: "Transport", bus: "A" },
    { data: { slots: [{ deg: 1, q: "diatonic-triad", len: 4 }, { deg: 5, q: "diatonic-triad", len: 4 }, { deg: 6, q: "diatonic-triad", len: 4 }, { deg: 4, q: "diatonic-triad", len: 4 }] } });
  p.cable(kseq, "pitch", hm, "transpose");
  const mix = tones(p, [2, 0], hm, { shapes: [0.7, 0.6, 0.7, 0.5], detune: 8 });
  const pad = chordEnv(p, [4, 0], mix, { n: hm, gate: "change", trig: "change" }, { attack: 0.08, decay: 1.5, sustain: 0.5, release: 1.2 });
  const bass = bassOn(p, [2, 5], hm, "bass");
  const lead = leadOnBus(p, [2, 7], [0, 2, 4, 7, 4, 2, 5, 3], { octave: 1, shape: 0.55, rate: "1/8" });
  const drums = beat(p, [0, 6], { style: "four", level: -11 });
  finish(p, [6, 0], [{ n: pad, level: 2 }, { n: bass, level: -8 }, { n: lead, level: -4, pan: 0.2 }, drumsOf(drums, 0)], { vmix: 0.25, master: 3 });
  return p;
}

function modernColours() {
  const p = patch("Harmony Master: Modern Colours", {
    module: "harmony-master", tempo: 84,
    description: "Four chosen chords written as fixed roots and rich qualities: minor 11, dominant 13, major 7 sharp 11 and dominant 7 sharp 9. The Tone outputs get the whole stack. Click a slot in the view to try another quality.",
    tags: ["extensions", "jazz", "qualities", "progression"],
  });
  const hm = p.add("harmony-master", [0, 0], { source: "Progression", key: "C", scale: "Major", advance: "Transport", bus: "A", octave: 0 },
    { data: { slots: [{ root: 2, q: "minor11", len: 4 }, { root: 7, q: "dominant13", len: 4 }, { root: 0, q: "major7#11", len: 4 }, { root: 9, q: "7#9", len: 4 }] } });
  const mix = tones(p, [1, 0], hm, { shapes: [0.1, 0.05, 0.2, 0.1], detune: 3 });
  const pad = chordEnv(p, [3, 0], mix, { n: hm, gate: "change", trig: "change" }, { attack: 0.15, decay: 2, sustain: 0.3, release: 1.2 });
  const flt = p.add("filter", [4, 0], { cutoff: 2400, resonance: 0.1 });
  p.stereo(pad, flt);
  const bass = bassOn(p, [1, 5], hm, "bass", { shape: 0.05, gain: 0.6 });
  const drums = beat(p, [0, 6], { style: "shuffle", level: -12 });
  finish(p, [5, 0], [{ n: flt, l: "l", r: "r", level: 4 }, { n: bass, level: -7 }, drumsOf(drums, 0)], { vmix: 0.28, decay: 3, master: 3 });
  return p;
}

function phrygianDrone() {
  const p = patch("Harmony Master: Phrygian Dominant Drone", {
    module: "harmony-master", tempo: 100,
    description: "Manual source: one held fifth in E Phrygian Dominant, with a follower line that wanders by Variation but never leaves the scale. Change Degree or the scale to colour the drone, or Quality to a richer chord.",
    tags: ["manual", "phrygian dominant", "drone", "variation"],
  });
  const hm = p.add("harmony-master", [0, 0], { source: "Manual", key: "E", scale: "Phrygian Dominant", quality: "Fifth", degree: 1, bus: "A" });
  const mix = tones(p, [1, 0], hm, { shapes: [0.8, 0.7, 0.8, 0.6], octave: -1, detune: 10 });
  const gate = p.add("lfo", [3, 3], { rate: 0.05, wave: "Sine", polarity: "Unipolar" }, { name: "Swell" });
  const amp = p.add("vca", [3, 0], { gain: 0.5 }, { name: "Drone VCA" });
  p.stereo(mix, amp, { from: ["outl", "outr"] }).cable(gate, "out", amp, "gain", 0.4);
  const flt = p.add("filter", [4, 0], { cutoff: 900, resonance: 0.3 });
  p.stereo(amp, flt).cable(gate, "out", flt, "cutoff", 0.3);
  const lead = leadOnBus(p, [1, 5], [0, 1, 2, 4, 2, 1, 0, 3, 4, 5, 4, 2, 1, 2, 0, "."], { octave: 1, shape: 0.35, variation: 0.35, rate: "1/8" });
  const drums = beat(p, [0, 7], { style: "broken", level: -12 });
  finish(p, [5, 0], [{ n: flt, l: "l", r: "r", level: 0 }, { n: lead, level: -3, pan: 0.2 }, drumsOf(drums, 0)], { vmix: 0.3, decay: 3.5, master: -5 });
  return p;
}

export default [minorJourney, triggerStepping, keyModulation, modernColours, phrygianDrone];
