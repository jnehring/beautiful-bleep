// SPDX-License-Identifier: MIT
// Chord Quantizer: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

function mixer(p, at, vals, name) {
  return p.add("audio-mixer", at, vals, { name });
}
function chordBus(p, at, cq, o = {}) {
  const [c, r] = at;
  const shapes = o.shapes || [0.8, 0.8, 0.8, 0.8];
  const pans = o.pans || [-0.6, -0.2, 0.2, 0.6];
  const vals = { master: o.master ?? -8 };
  pans.forEach((x, i) => { vals[`pan${i + 1}`] = x; vals[`level${i + 1}`] = (o.levels || [-3, -3, -3, -3])[i]; });
  const mix = mixer(p, [c + 1, r], vals, o.name || "Chord Mix");
  for (let i = 0; i < 4; i++) {
    const osc = p.add("oscillator", [c, r + i], { shape: shapes[i], octave: String(o.octave ?? 0), fine: (i - 1.5) * (o.detune ?? 6), ...(o.osc || {}) },
      { name: `Voice ${i + 1}` });
    p.cable(cq, `voice${i + 1}`, osc, "pitch").cable(osc, "out", mix, `in${i + 1}l`);
  }
  return mix;
}

function smoothPad() {
  const p = patch("Chord Quantizer: Smooth Pad", {
    module: "chord-quantizer", tempo: 66,
    description: "A bar-long sequence of single notes becomes a lush A minor pad. Voice Leading on Smooth + Top picks the inversion that moves least, so the top voice glides and the chords flow instead of jumping. Try Voice Leading Off to hear the raw jumps, or Voicing Close.",
    tags: ["pad", "voice leading", "ambient", "chords"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/1", root: "A", scale: "Natural Minor", octave: 0, gatelength: 0.98 },
    { data: steps([0, 5, 3, 7, 0, 5, 10, 7]) });
  const cq = p.add("chord-quantizer", [1, 0], { stack: "Seventh", chord: "Minor 7", mode: "Diatonic", root: "A", scale: "Natural Minor", voices: 4,
    voicing: "Spread", lead: "Smooth + Top", anchor: "Top", range: 3, velocity: 0.8 });
  p.cable(seq, "pitch", cq, "pitch").cable(seq, "trigger", cq, "trig");
  const mix = chordBus(p, [2, 0], cq, { shapes: [0.75, 0.6, 0.75, 0.9], detune: 9, master: -9, osc: {} });
  const env = p.add("adsr", [3, 1], { attack: 0.9, decay: 1, sustain: 0.8, release: 2 }, { name: "Swell" });
  const vca = p.add("vca", [4, 0], {}, { name: "VCA" });
  const flt = p.add("filter", [5, 0], { cutoff: 1100, resonance: 0.25, type: "Ladder Tanh" });
  const lfo = p.add("lfo", [4, 1], { rate: 0.07, wave: "Sine" }, { name: "Breath" });
  const verb = p.add("reverb", [6, 0], { size: 0.8, decay: 6, damping: 0.5, mix: 0.4 });
  p.cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig");
  p.stereo(mix, vca, { from: ["outl", "outr"] }).cable(env, "env", vca, "gain");
  p.stereo(vca, flt).cable(lfo, "out", flt, "cutoff", 0.18);
  p.stereo(flt, verb).stereo(verb, p.out);
  return p;
}

function strumHarp() {
  const p = patch("Chord Quantizer: Strummed Dorian", {
    module: "chord-quantizer", tempo: 92,
    description: "Plucked quarter notes in D Dorian each become an open-voiced ninth chord that is strummed across the four voices instead of arriving at once, with an echo behind it. Turn Strum up for a lazier roll, or change Strum Order to Down.",
    tags: ["strum", "harp", "dorian", "open voicing"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/4", root: "D", scale: "Dorian", octave: 0, gatelength: 0.9 },
    { data: steps([0, ".", 4, ".", 2, ".", 7, 5]) });
  const cq = p.add("chord-quantizer", [1, 0], { stack: "Ninth", chord: "Minor 9", mode: "Diatonic", root: "D", scale: "Dorian", voices: 4,
    voicing: "Open", lead: "Smooth", anchor: "Centre", range: 2, strum: 0.085, strumorder: "Up" });
  p.cable(seq, "pitch", cq, "pitch").cable(seq, "trigger", cq, "trig");
  const mix = chordBus(p, [2, 0], cq, { shapes: [0.05, 0.1, 0.05, 0.15], detune: 4, master: -2, octave: 0 });
  const env = p.add("adsr", [3, 1], { attack: 0.004, decay: 0.9, sustain: 0, release: 0.5 }, { name: "Pluck" });
  const vca = p.add("vca", [4, 0], {}, { name: "VCA" });
  const dly = p.add("delay-network", [5, 0], { sync: "1/8.", taps: 3, feedback: 0.4, tone: -0.3, width: 0.9, mix: 0.3, routing: "Ring" });
  const verb = p.add("reverb", [6, 0], { size: 0.6, decay: 3.5, mix: 0.3 });
  p.cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig");
  p.stereo(mix, vca, { from: ["outl", "outr"] }).cable(env, "env", vca, "gain");
  p.stereo(vca, dly).stereo(dly, verb).stereo(verb, p.out);
  return p;
}

function funkStabs() {
  const p = patch("Chord Quantizer: Offbeat Stabs", {
    module: "chord-quantizer", tempo: 104,
    description: "Syncopated single notes turn into short minor-seventh stabs over a root-note bass, on a broken beat. In Chromatic mode the Chord knob picks the quality: try Dominant 7, Minor add9 or Sus4, and raise Inversion for a higher voicing.",
    tags: ["stabs", "funk", "chromatic", "rhythm"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/16", root: "E", scale: "Minor Pentatonic", octave: 0, gatelength: 0.3 },
    { data: steps([0, ".", ".", 0, ".", ".", 3, ".", ".", 0, ".", 5, ".", ".", 3, "."]) });
  const cq = p.add("chord-quantizer", [1, 0], { mode: "Chromatic", chord: "Minor 7", voices: 4, voicing: "Drop 2", lead: "Smooth",
    anchor: "Centre", range: 2, inversion: 0 });
  p.cable(seq, "pitch", cq, "pitch").cable(seq, "trigger", cq, "trig");
  const mix = chordBus(p, [2, 0], cq, { shapes: [0.9, 0.9, 0.9, 0.9], detune: 8, master: -7, octave: 0 });
  const env = p.add("adsr", [3, 1], { attack: 0.003, decay: 0.16, sustain: 0, release: 0.08 }, { name: "Stab" });
  const vca = p.add("vca", [4, 0], {}, { name: "VCA" });
  const flt = p.add("filter", [5, 0], { cutoff: 1800, resonance: 0.3, type: "Ladder Tanh" });
  const fenv = p.add("adsr", [4, 1], { attack: 0.002, decay: 0.2, sustain: 0, release: 0.1 }, { name: "Filter Env" });
  p.cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(seq, "gate", fenv, "gate").cable(seq, "trigger", fenv, "retrig");
  p.stereo(mix, vca, { from: ["outl", "outr"] }).cable(env, "env", vca, "gain");
  p.stereo(vca, flt).cable(fenv, "env", flt, "cutoff", 0.35);
  // The chord's root as a sine bass, an octave and a half down.
  const bass = p.add("oscillator", [2, 5], { shape: 0.1, octave: "-2" }, { name: "Root Bass" });
  const benv = p.add("adsr", [3, 5], { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.15 }, { name: "Bass Env" });
  const bvca = p.add("vca", [4, 5], {}, { name: "Bass VCA" });
  p.cable(cq, "root", bass, "pitch").cable(seq, "gate", benv, "gate").cable(seq, "trigger", benv, "retrig")
    .cable(bass, "out", bvca, "l").cable(benv, "env", bvca, "gain");
  const drums = beat(p, [0, 7], { style: "broken", level: -10 });
  const out = p.add("audio-mixer", [6, 1], { level1: -4, level2: -2, level3: -4, master: -2 }, { name: "Mix" });
  p.stereo(flt, out, { to: ["in1l", "in1r"] }).cable(bvca, "l", out, "in2l").cable(bvca, "l", out, "in2r")
    .cable(drums, "outl", out, "in3l").cable(drums, "outr", out, "in3r");
  p.stereo(out, p.out, { from: ["outl", "outr"] });
  return p;
}

function followChanges() {
  const p = patch("Chord Quantizer: Follow the Changes", {
    module: "chord-quantizer", tempo: 72,
    description: "Mode Follow: the chord is whatever the Harmony Master's progression says (A minor 7, F, C, G), voiced as a drop-2 pad with a root bass below. A slow LFO into Pitch lifts and drops the register. Change Voicing or Anchor in the module's view.",
    tags: ["follow", "harmony", "progression", "pad"],
  });
  const hm = p.add("harmony-master", [0, 0], { source: "Progression", key: "A", scale: "Natural Minor", bus: "A", advance: "Transport" },
    { data: { slots: [
      { deg: 1, q: "diatonic-seventh", len: 8 }, { deg: 6, q: "diatonic-seventh", len: 8 },
      { deg: 3, q: "diatonic-seventh", len: 8 }, { deg: 7, q: "diatonic-triad", len: 8 } ] } });
  const lfo = p.add("lfo", [0, 1], { rate: 0.05, wave: "Triangle" }, { name: "Register" });
  const cq = p.add("chord-quantizer", [1, 0], { mode: "Follow", harmony: "Bus A", voices: 4, voicing: "Drop 2", lead: "Smooth",
    anchor: "Centre", range: 2 });
  p.cable(lfo, "out", cq, "pitch", 0.3).cable(hm, "change", cq, "trig");
  const mix = chordBus(p, [2, 0], cq, { shapes: [0.5, 0.7, 0.7, 0.4], detune: 8, master: -3, octave: 0 });
  const flt = p.add("filter", [5, 0], { cutoff: 1500, resonance: 0.2, type: "Ladder Tanh" });
  p.stereo(mix, flt, { from: ["outl", "outr"] });
  const bass = p.add("oscillator", [2, 5], { shape: 0.15, octave: "-1" }, { name: "Bass" });
  const bvca = p.add("vca", [3, 5], { gain: 0.5 }, { name: "Bass Level" });
  p.cable(hm, "bass", bass, "pitch").cable(bass, "out", bvca, "l");
  const out = p.add("audio-mixer", [6, 1], { level1: -3, level2: -6, master: -2 }, { name: "Mix" });
  const verb = p.add("reverb", [7, 0], { size: 0.8, decay: 5, mix: 0.35 });
  p.stereo(flt, out, { to: ["in1l", "in1r"] }).cable(bvca, "l", out, "in2l").cable(bvca, "l", out, "in2r");
  p.stereo(out, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function pulsingWholeTone() {
  const p = patch("Chord Quantizer: Whole-tone Pulse", {
    module: "chord-quantizer", tempo: 110,
    description: "A wandering Random feeds Pitch; in a whole-tone scale every triad is an augmented chord, so the harmony floats without a home. An LFO gates the chords as eighth-note pulses. Switch Scale to Hirajoshi or Blues in the view for a different colour.",
    tags: ["whole tone", "random", "pulse", "floating"],
  });
  const rnd = p.add("random", [0, 0], { rate: 1, sync: "1/2", spread: 0.8, smooth: 0, quantize: true, seed: 11 }, { name: "Wander" });
  const cq = p.add("chord-quantizer", [1, 0], { mode: "Diatonic", stack: "Triad", root: "C", scale: "Whole Tone", voices: 4,
    voicing: "Open", lead: "Smooth + Top", anchor: "Centre", range: 2, hysteresis: 0.15 });
  p.cable(rnd, "out", cq, "pitch", 0.45).cable(rnd, "trig", cq, "trig");
  const mix = chordBus(p, [2, 0], cq, { shapes: [0.1, 0.5, 0.2, 0.7], detune: 5, master: -2, octave: 0 });
  const gate = p.add("lfo", [3, 1], { wave: "Square", sync: "1/8", pw: 0.45, polarity: "Unipolar" }, { name: "Pulse" });
  const env = p.add("adsr", [4, 1], { attack: 0.01, decay: 0.15, sustain: 0.4, release: 0.12 }, { name: "Pulse Env" });
  const vca = p.add("vca", [4, 0], {}, { name: "VCA" });
  const dly = p.add("delay-network", [5, 0], { sync: "1/8.", taps: 3, feedback: 0.45, tone: -0.2, width: 1, mix: 0.35, routing: "Ring" });
  const verb = p.add("reverb", [6, 0], { size: 0.7, decay: 4, mix: 0.3 });
  p.cable(gate, "out", env, "gate");
  p.stereo(mix, vca, { from: ["outl", "outr"] }).cable(env, "env", vca, "gain");
  p.stereo(vca, dly).stereo(dly, verb).stereo(verb, p.out);
  return p;
}

export default [smoothPad, strumHarp, funkStabs, followChanges, pulsingWholeTone];
