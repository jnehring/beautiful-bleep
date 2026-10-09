// SPDX-License-Identifier: MIT
// Harmony Master: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

/// Four oscillators on Tone 1…4, summed on an Audio Mixer (mono channels, panned).
function tonePad(p, at, hm, o = {}) {
  const [c, r] = at;
  const vals = { master: o.master ?? -6 };
  [-0.6, -0.2, 0.2, 0.6].forEach((x, i) => { vals[`pan${i + 1}`] = x; vals[`level${i + 1}`] = -3; });
  const mix = p.add("audio-mixer", [c + 1, r], vals, { name: o.name || "Chord Mix" });
  const shapes = o.shapes || [0.7, 0.7, 0.7, 0.7];
  for (let i = 0; i < 4; i++) {
    const osc = p.add("oscillator", [c, r + i], { shape: shapes[i], octave: String(o.octave ?? 0), fine: (i - 1.5) * (o.detune ?? 6) },
      { name: `Tone ${i + 1}` });
    p.cable(hm, `tone${i + 1}`, osc, "pitch").cable(osc, "out", mix, `in${i + 1}l`);
  }
  return mix;
}
/// A bass voice on one of the Harmony Master's pitch outputs.
function bassVoice(p, at, hm, jack, o = {}) {
  const [c, r] = at;
  const osc = p.add("oscillator", [c, r], { shape: o.shape ?? 0.2, octave: String(o.octave ?? -1) }, { name: "Bass" });
  const amp = p.add("vca", [c + 1, r], { gain: o.gain ?? 0.6 }, { name: "Bass Level" });
  p.cable(hm, jack, osc, "pitch").cable(osc, "out", amp, "l");
  return amp;
}
/// A chord stab/pluck envelope fired by a trigger.
function pluck(p, at, trig, mix, o = {}) {
  const [c, r] = at;
  const env = p.add("adsr", [c, r], { attack: 0.004, decay: o.decay ?? 0.9, sustain: o.sustain ?? 0, release: 0.4 }, { name: "Chord Env" });
  const vca = p.add("vca", [c + 1, r], {}, { name: "VCA" });
  p.cable(trig.node, trig.jack, env, "gate").cable(trig.node, trig.jack, env, "retrig");
  p.stereo(mix, vca, { from: ["outl", "outr"] }).cable(env, "env", vca, "gain");
  return vca;
}

function fourChordLoop() {
  const p = patch("Harmony Master: Four-Chord Loop", {
    module: "harmony-master", tempo: 84,
    description: "The classic I – vi – IV – V in C major runs as a progression with the transport, four beats per chord. Tone 1 – 4 feed a soft pad and Bass a sine below. Click a slot in the view to change its chord or length, or switch Quality to Diatonic Seventh.",
    tags: ["progression", "pad", "pop", "chords"],
  });
  const hm = p.add("harmony-master", [0, 0], { source: "Progression", key: "C", scale: "Major", advance: "Transport", bus: "A" },
    { data: { slots: [{ deg: 1, q: "diatonic-triad", len: 4 }, { deg: 6, q: "diatonic-triad", len: 4 },
                      { deg: 4, q: "diatonic-triad", len: 4 }, { deg: 5, q: "diatonic-triad", len: 4 }] } });
  const mix = tonePad(p, [1, 0], hm, { shapes: [0.7, 0.55, 0.7, 0.45], detune: 8, master: -4 });
  const flt = p.add("filter", [3, 0], { cutoff: 1400, resonance: 0.15, type: "Ladder Tanh" });
  const lfo = p.add("lfo", [3, 1], { rate: 0.09, wave: "Sine" }, { name: "Breath" });
  const bass = bassVoice(p, [1, 5], hm, "bass", { shape: 0.1, octave: -1, gain: 0.55 });
  const drums = beat(p, [0, 7], { style: "half", level: -12 });
  const verb = p.add("reverb", [5, 0], { size: 0.7, decay: 4, mix: 0.3 });
  const out = p.add("audio-mixer", [4, 1], { level1: -3, level2: -3, level3: -6, master: -1 }, { name: "Mix" });
  p.stereo(mix, flt, { from: ["outl", "outr"] }).cable(lfo, "out", flt, "cutoff", 0.15);
  p.stereo(flt, out, { to: ["in1l", "in1r"] }).cable(bass, "l", out, "in2l").cable(bass, "l", out, "in2r")
    .cable(drums, "outl", out, "in3l").cable(drums, "outr", out, "in3r");
  p.stereo(out, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function jazzChanges() {
  const p = patch("Harmony Master: Jazz Changes", {
    module: "harmony-master", tempo: 92,
    description: "A ii – V – I – VI progression written with fixed roots and rich qualities (minor 9, dominant 9, major 9, dominant 7♭9), one slot with a slash bass. Each change plucks the chord and the Bass output walks underneath, on a shuffle. Edit the qualities in the progression strip.",
    tags: ["jazz", "progression", "extensions", "slash bass"],
  });
  const hm = p.add("harmony-master", [0, 0], { source: "Progression", key: "C", scale: "Major", advance: "Transport" },
    { data: { slots: [{ root: 2, q: "minor9", len: 4 }, { root: 7, q: "dominant9", len: 4, bass: 11 },
                      { root: 0, q: "major9", len: 4 }, { root: 9, q: "7b9", len: 4 }] } });
  const mix = tonePad(p, [1, 0], hm, { shapes: [0.05, 0.05, 0.2, 0.1], detune: 3, master: -1 });
  const vca = pluck(p, [3, 0], { node: hm, jack: "change" }, mix, { decay: 1.8, sustain: 0.15 });
  const bass = bassVoice(p, [1, 5], hm, "bass", { shape: 0.05, octave: -1, gain: 0.7 });
  const drums = beat(p, [0, 7], { style: "shuffle", level: -14 });
  const dly = p.add("delay-network", [5, 0], { sync: "1/8.", taps: 2, feedback: 0.3, tone: -0.4, width: 0.8, mix: 0.25, routing: "Ring" });
  const verb = p.add("reverb", [6, 0], { size: 0.5, decay: 2.5, mix: 0.25 });
  const out = p.add("audio-mixer", [4, 1], { level1: -2, level2: -2, level3: -4, master: -1 }, { name: "Mix" });
  p.stereo(vca, dly).stereo(dly, out, { to: ["in1l", "in1r"] }).cable(bass, "l", out, "in2l").cable(bass, "l", out, "in2r")
    .cable(drums, "outl", out, "in3l").cable(drums, "outr", out, "in3r");
  p.stereo(out, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function triggerChanges() {
  const p = patch("Harmony Master: Rhythmic Changes", {
    module: "harmony-master", tempo: 118,
    description: "Advance is set to Trigger: a syncopated step sequencer pulses Next, so the chord changes exactly when you want, cycling through five minor-key chords as short stabs over a pumping root bass. Try Advance Transport to hear it follow the slot lengths instead.",
    tags: ["trigger", "rhythm", "stabs", "minor"],
  });
  const clk = p.add("step-sequencer", [0, 1], { length: 16, rate: "1/16", gatelength: 0.3 },
    { data: steps([0, ".", ".", 0, ".", ".", 0, ".", 0, ".", ".", ".", 0, ".", 0, "."]) }, { name: "Change Rhythm" });
  const hm = p.add("harmony-master", [0, 0], { source: "Progression", key: "D", scale: "Natural Minor", advance: "Trigger" },
    { data: { slots: [{ deg: 1, q: "diatonic-seventh", len: 4 }, { deg: 1, q: "minor9", len: 4 }, { deg: 6, q: "diatonic-seventh", len: 4 },
                      { deg: 7, q: "dominant7", len: 4 }, { deg: 4, q: "diatonic-seventh", len: 4 }] } });
  p.cable(clk, "trigger", hm, "next");
  const mix = tonePad(p, [1, 0], hm, { shapes: [0.9, 0.9, 0.85, 0.9], detune: 9, master: -2 });
  const env = p.add("adsr", [3, 1], { attack: 0.003, decay: 0.2, sustain: 0, release: 0.1 }, { name: "Stab" });
  const vca = p.add("vca", [4, 0], {}, { name: "VCA" });
  const flt = p.add("filter", [5, 0], { cutoff: 2200, resonance: 0.25, type: "Ladder Tanh" });
  p.cable(clk, "gate", env, "gate").cable(clk, "trigger", env, "retrig");
  p.stereo(mix, vca, { from: ["outl", "outr"] }).cable(env, "env", vca, "gain").stereo(vca, flt);
  // Root bass on every eighth.
  const bseq = p.add("step-sequencer", [1, 6], { length: 8, rate: "1/8", gatelength: 0.5 }, { data: steps([0, 0, 0, 0, 0, 0, 0, 0]) });
  const bass = bassVoice(p, [2, 5], hm, "root", { shape: 0.5, octave: -2, gain: 1 });
  const benv = p.add("adsr", [3, 5], { attack: 0.004, decay: 0.2, sustain: 0.3, release: 0.1 }, { name: "Bass Env" });
  const bgain = p.add("vca", [4, 5], {}, { name: "Bass VCA" });
  p.cable(bseq, "gate", benv, "gate").cable(bseq, "trigger", benv, "retrig").cable(bass, "l", bgain, "l").cable(benv, "env", bgain, "gain");
  const verb = p.add("reverb", [7, 0], { size: 0.5, decay: 2, mix: 0.2 });
  const out = p.add("audio-mixer", [6, 1], { level1: -1, level2: 0, master: 0 }, { name: "Mix" });
  p.stereo(flt, out, { to: ["in1l", "in1r"] }).cable(bgain, "l", out, "in2l").cable(bgain, "l", out, "in2r");
  p.stereo(out, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function adaptiveScale() {
  const p = patch("Harmony Master: Adapting Scale", {
    module: "harmony-master", tempo: 100,
    description: "In A minor the progression visits E major, whose G♯ is not in the scale. With Scale Policy on Adapt the published scale bends to A harmonic minor for that chord, so a Quantizer Suite following the bus plays the G♯ in its random pluck line. Switch Scale Policy to Keep and listen to the line lose it.",
    tags: ["adapt", "harmonic minor", "followers", "quantizer"],
  });
  const hm = p.add("harmony-master", [0, 0], { source: "Progression", key: "A", scale: "Natural Minor", policy: "Adapt", bus: "A" },
    { data: { slots: [{ deg: 1, q: "diatonic-triad", len: 4 }, { deg: 4, q: "diatonic-triad", len: 4 },
                      { root: 4, q: "major", len: 4 }, { deg: 1, q: "diatonic-triad", len: 4 }] } });
  const mix = tonePad(p, [1, 0], hm, { shapes: [0.6, 0.5, 0.6, 0.4], detune: 7, master: -6 });
  const pad = p.add("filter", [3, 0], { cutoff: 1000, resonance: 0.15, type: "Ladder Tanh" });
  p.stereo(mix, pad, { from: ["outl", "outr"] });
  // Random line, kept in the scale by a follower on bus A.
  const rnd = p.add("random", [0, 3], { rate: 2, sync: "1/8", spread: 0.55, smooth: 0, seed: 21 }, { name: "Line" });
  const qs = p.add("quantizer-suite", [1, 3], { "a.mode": "Follow", "a.harmony": "Bus A", "a.target": "Scale", "a.sample": "Trigger",
    "a.octave": 1, "a.notes": false });
  const osc = p.add("oscillator", [2, 3], { shape: 0.3 }, { name: "Lead" });
  const env = p.add("adsr", [2, 4], { attack: 0.003, decay: 0.28, sustain: 0, release: 0.2 }, { name: "Pluck Env" });
  const vca = p.add("vca", [3, 3], {}, { name: "VCA" });
  p.cable(rnd, "out", qs, "ina", 0.5).cable(rnd, "trig", qs, "triga").cable(qs, "outa", osc, "pitch")
    .cable(rnd, "trig", env, "gate").cable(rnd, "trig", env, "retrig").cable(osc, "out", vca, "l").cable(env, "env", vca, "gain");
  const bass = bassVoice(p, [1, 6], hm, "bass", { shape: 0.15, octave: -1, gain: 0.55 });
  const dly = p.add("delay-network", [4, 3], { sync: "1/8.", taps: 3, feedback: 0.4, tone: -0.3, width: 1, mix: 0.3, routing: "Ring" });
  const verb = p.add("reverb", [6, 0], { size: 0.7, decay: 4, mix: 0.3 });
  const out = p.add("audio-mixer", [5, 1], { level1: -3, level2: -5, level3: -4, master: -1 }, { name: "Mix" });
  p.stereo(pad, out, { to: ["in1l", "in1r"] }).stereo(vca, dly, { from: ["l", "l"] }).stereo(dly, out, { to: ["in2l", "in2r"] })
    .cable(bass, "l", out, "in3l").cable(bass, "l", out, "in3r");
  p.stereo(out, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function walkingKeys() {
  const p = patch("Harmony Master: Wandering Key", {
    module: "harmony-master", tempo: 76,
    description: "Manual source: a slow stepped Random walks the Degree knob through the Mixolydian chords while a sequencer on Transpose moves the whole key up a fourth and a fifth every few bars. Each change swells in a warm pad with a root drone below. Try Quality Diatonic Triad or another Scale.",
    tags: ["manual", "degree", "transpose", "modulation"],
  });
  const rnd = p.add("random", [0, 0], { rate: 1, sync: "1 bar", spread: 0.9, smooth: 0, seed: 7 }, { name: "Degree Walk" });
  const keys = p.add("step-sequencer", [0, 1], { length: 8, rate: "1/1", root: "C", scale: "Chromatic", gatelength: 0.9 },
    { data: steps([0, 0, 5, 5, 7, 7, 2, 2]) }, { name: "Key Shift" });
  const hm = p.add("harmony-master", [1, 0], { source: "Manual", key: "G", scale: "Mixolydian", quality: "Diatonic Seventh", degree: 4 });
  p.cable(rnd, "out", hm, "degree", 0.5).cable(keys, "pitch", hm, "transpose");
  const mix = tonePad(p, [2, 0], hm, { shapes: [0.4, 0.5, 0.6, 0.3], detune: 10, master: -4 });
  const env = p.add("adsr", [4, 1], { attack: 1.2, decay: 1, sustain: 0.8, release: 2.5 }, { name: "Swell" });
  const vca = p.add("vca", [5, 0], {}, { name: "VCA" });
  const flt = p.add("filter", [6, 0], { cutoff: 1200, resonance: 0.2, type: "Ladder Tanh" });
  p.cable(hm, "change", env, "retrig");
  const hold = p.add("lfo", [4, 2], { wave: "Square", sync: "1 bar", pw: 0.8, polarity: "Unipolar" }, { name: "Gate" });
  p.cable(hold, "out", env, "gate");
  p.stereo(mix, vca, { from: ["outl", "outr"] }).cable(env, "env", vca, "gain").stereo(vca, flt);
  const bass = bassVoice(p, [2, 5], hm, "root", { shape: 0.05, octave: -2, gain: 0.7 });
  const verb = p.add("reverb", [7, 0], { size: 0.85, decay: 7, mix: 0.4 });
  const out = p.add("audio-mixer", [6, 1], { level1: -2, level2: -6, master: -1 }, { name: "Mix" });
  p.stereo(flt, out, { to: ["in1l", "in1r"] }).cable(bass, "l", out, "in2l").cable(bass, "l", out, "in2r");
  p.stereo(out, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

export default [fourChordLoop, jazzChanges, triggerChanges, adaptiveScale, walkingKeys];
