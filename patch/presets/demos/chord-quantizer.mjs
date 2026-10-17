// chord-quantizer: five demo patches. Each plays by itself with the transport.
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

/// The four chord voices -> four oscillators -> panned mixer -> VCA (one ADSR from gate/trigger) -> filter.
function chordPad(p, at, cq, src, o = {}) {
  const [c, r] = at;
  const mix = p.add("audio-mixer", [c + 1, r], { master: -3, level1: -6, level2: -6, level3: -6, level4: -6, pan1: -0.6, pan2: -0.2, pan3: 0.2, pan4: 0.6 }, { name: "Chord Mix" });
  for (let i = 0; i < 4; i++) {
    const osc = p.add("oscillator", [c, r + i], { shape: o.shape ?? 0.6, fine: (i - 1.5) * (o.detune ?? 6), octave: String(o.octave ?? 0) }, { name: `Voice ${i + 1}` });
    p.cable(cq, `voice${i + 1}`, osc, "pitch").cable(osc, "out", mix, `in${i + 1}l`).cable(osc, "out", mix, `in${i + 1}r`);
  }
  const env = p.add("adsr", [c + 1, r + 1], { attack: 0.01, decay: 0.5, sustain: 0.5, release: 0.5, ...(o.env || {}) }, { name: "Chord Env" });
  const amp = p.add("vca", [c + 2, r], {}, { name: "VCA" });
  p.cable(src, "gate", env, "gate").cable(src, "trigger", env, "retrig").cable(env, "env", amp, "gain").stereo(mix, amp, { from: ["outl", "outr"] });
  const flt = p.add("filter", [c + 3, r], { cutoff: o.cutoff ?? 2200, resonance: 0.15 }, { name: "Tone" });
  p.stereo(amp, flt);
  return { amp, env, flt };
}
const seqRoots = (p, at, notes, o = {}) => p.add("step-sequencer", at, { length: notes.length, rate: o.rate || "1/1", root: o.root || "C", scale: o.scale || "Natural Minor", octave: o.octave ?? 0, gatelength: o.gate ?? 0.9 },
  { data: steps(notes) }, { name: "Roots" });
const feed = (p, seq, cq) => p.cable(seq, "pitch", cq, "pitch").cable(seq, "trigger", cq, "trig").cable(seq, "gate", cq, "gate");

function padChanges() {
  const p = patch("Chord Quantizer: Minor Seventh Pad", {
    module: "chord-quantizer", tempo: 72,
    description: "A slow root line goes into the Chord Quantizer, which stacks each root as a minor seventh over four voices; the four oscillators swell into a lush, moving pad. Try Chord on Dominant 9 or Sus4, or Voicing on Spread for a wider sound.",
    tags: ["pad", "minor seventh", "chords", "voicing"],
  });
  const seq = seqRoots(p, [0, 0], [0, 5, 3, 7], { root: "A", octave: -1 });
  const cq = p.add("chord-quantizer", [1, 0], { chord: "Minor 7", voicing: "Drop 2", range: 2 });
  feed(p, seq, cq);
  const pad = chordPad(p, [2, 0], cq, seq, { shape: 0.55, env: { attack: 0.6, decay: 1, sustain: 0.8, release: 1.2 }, cutoff: 1600, octave: 0 });
  const lfo = p.add("lfo", [2, 4], { rate: 0.1, wave: "Sine" }, { name: "Breath" });
  p.cable(lfo, "out", pad.flt, "cutoff", 0.2);
  const bass = p.add("oscillator", [2, 5], { shape: 0.1, octave: "-1" }, { name: "Root Bass" });
  const bv = p.add("vca", [3, 5], { gain: 0.5 }, { name: "Bass Level" });
  p.cable(cq, "root", bass, "pitch").cable(bass, "out", bv, "l");
  finish(p, [6, 0], [{ n: pad.flt, l: "l", r: "r", level: 2 }, { n: bv, level: -10 }], { vmix: 0.4, decay: 5, size: 0.7, master: 0 });
  return p;
}

function smoothLeading() {
  const p = patch("Chord Quantizer: Smooth Voice Leading", {
    module: "chord-quantizer", tempo: 100,
    description: "Rhythmic triad stabs follow a four-chord loop, and Voice Leading chooses the inversion that moves least, so the top voice glides instead of jumping. Turn Voice Leading Off to hear every chord land in root position.",
    tags: ["voice leading", "triads", "stabs", "inversions"],
  });
  const bar = (n) => [n, ".", ".", n, ".", n, ".", "."];
  const seq = seqRoots(p, [0, 0], [...bar(0), ...bar(9), ...bar(5), ...bar(7)], { rate: "1/8", root: "C", scale: "Major", octave: 0, gate: 0.35 });
  const cq = p.add("chord-quantizer", [1, 0], { chord: "Major", voicing: "Close", lead: "Smooth", anchor: "Top", range: 2 });
  feed(p, seq, cq);
  const pad = chordPad(p, [2, 0], cq, seq, { shape: 0.8, env: { attack: 0.005, decay: 0.35, sustain: 0.1, release: 0.25 }, cutoff: 2800 });
  const drums = beat(p, [0, 5], { style: "half", level: -10 });
  finish(p, [6, 0], [{ n: pad.flt, l: "l", r: "r", level: 6 }, drumsOf(drums, 2)], { vmix: 0.2, master: 2 });
  return p;
}

function quartalBells() {
  const p = patch("Chord Quantizer: Quartal Glass", {
    module: "chord-quantizer", tempo: 76,
    description: "Instead of thirds, each chord is stacked in fourths and spread wide: an open, floating sound that suits slow, bell-like notes. Try Inversion or Range to move the stack, or Chord to Fifth for a hollow drone.",
    tags: ["quartal", "open voicing", "ambient", "bells"],
  });
  const seq = seqRoots(p, [0, 0], [0, 2, 4, 2, 0, 5, 4, 2], { rate: "1/2", root: "E", scale: "Minor Pentatonic", octave: 0, gate: 0.3 });
  const cq = p.add("chord-quantizer", [1, 0], { chord: "Quartal", voicing: "Open", range: 3, inversion: 1 });
  feed(p, seq, cq);
  const pad = chordPad(p, [2, 0], cq, seq, { shape: 0, detune: 2, env: { attack: 0.003, decay: 2.5, sustain: 0, release: 2 }, cutoff: 6000, octave: 0 });
  const dl = p.add("delay", [6, 0], { timel: 450, timer: 600, feedback: 0.45, highcut: 6000, mix: 0.3, mode: "Ping-Pong" });
  p.stereo(pad.flt, dl);
  finish(p, [7, 0], [{ n: dl, l: "l", r: "r", level: 2 }], { vmix: 0.4, decay: 5, size: 0.8, master: 0 });
  return p;
}

function diatonicHarmoniser() {
  const p = patch("Chord Quantizer: Diatonic Harmoniser", {
    module: "chord-quantizer", tempo: 98,
    description: "In Diatonic mode a melody in C major is harmonised note by note: each pitch becomes the root of the right triad for the scale, major on some steps, minor on others. Change the Stack to Seventh, or the setting Scale to Dorian.",
    tags: ["diatonic", "harmonise", "melody", "triads"],
  });
  const seq = seqRoots(p, [0, 0], [0, 2, 4, 2, 5, 4, 2, 0], { rate: "1/4", root: "C", scale: "Major", octave: 0, gate: 0.6 });
  const cq = p.add("chord-quantizer", [1, 0], { mode: "Diatonic", root: "C", scale: "Major", stack: "Triad", voicing: "Close", range: 2 });
  feed(p, seq, cq);
  const pad = chordPad(p, [2, 0], cq, seq, { shape: 0.45, env: { attack: 0.03, decay: 0.8, sustain: 0.3, release: 0.5 }, cutoff: 2400, octave: -1 });
  const lead = p.add("oscillator", [2, 5], { shape: 0.2, octave: "+1" }, { name: "Melody" });
  const lenv = p.add("adsr", [3, 5], { attack: 0.005, decay: 0.3, sustain: 0.25, release: 0.2 }, { name: "Melody Env" });
  const lamp = p.add("vca", [4, 5], {}, { name: "Melody VCA" });
  p.cable(seq, "pitch", lead, "pitch").cable(seq, "gate", lenv, "gate").cable(seq, "trigger", lenv, "retrig").cable(lead, "out", lamp, "l").cable(lenv, "env", lamp, "gain");
  const drums = beat(p, [0, 7], { style: "sparse", level: -12 });
  finish(p, [6, 0], [{ n: pad.flt, l: "l", r: "r", level: 0 }, { n: lamp, level: -3, pan: 0.2 }, drumsOf(drums, -2)], { vmix: 0.25, decay: 2.5, master: 0 });
  return p;
}

function chordArp() {
  const p = patch("Chord Quantizer: Chords into an Arpeggio", {
    module: "chord-quantizer", tempo: 112,
    description: "The Notes output of the Chord Quantizer holds each chord while an Arpeggiator breaks it into a running pattern for a single pluck voice. Change the chord, then the Arpeggiator's Pattern or Octaves, to reshape the same harmony.",
    tags: ["arpeggio", "notes out", "chords", "pluck"],
  });
  const seq = seqRoots(p, [0, 0], [0, 3, 5, 4], { rate: "1/1", root: "G", scale: "Natural Minor", octave: -1, gate: 0.97 });
  const cq = p.add("chord-quantizer", [1, 0], { chord: "Minor 9", voicing: "Close", range: 2 });
  feed(p, seq, cq);
  const arp = p.add("arpeggiator", [2, 0], { rate: "1/16", pattern: "Up & Down", octaves: 2, gatelength: 0.4 });
  p.cable(cq, "notes", arp, "notes");
  const v = voice(p, [3, 0], { n: arp }, { shape: 0.8, env: { decay: 0.2, sustain: 0.05, release: 0.15 }, cutoff: 2800, res: 0.2 });
  const drums = beat(p, [0, 4], { style: "four", level: -10 });
  const dl = p.add("delay", [5, 0], { timel: 280, timer: 420, feedback: 0.3, highcut: 5000, mix: 0.25 });
  p.cable(v.out.n, "l", dl, "l").cable(v.out.n, "l", dl, "r");
  finish(p, [6, 0], [{ n: dl, level: 5 }, drumsOf(drums, 0)], { vmix: 0.2, master: 0 });
  return p;
}

export default [padChanges, smoothLeading, quartalBells, diatonicHarmoniser, chordArp];
