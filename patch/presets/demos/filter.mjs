// SPDX-License-Identifier: MIT
// Multi Filter (filter): five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Filter (l/r) → trim mixer → reverb → Out.
function finish(p, at, src, trim = 0, verb = {}, jacks = ["l", "r"]) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.2, damping: 0.5, mix: 0.2, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

function ladderSweep() {
  const p = patch("Multi Filter: Ladder Bass Sweep", {
    module: "filter", tempo: 104,
    description: "A raw saw bass runs through a warm ladder-style low-pass whose Cutoff is opened by an envelope on every note, then closes again for a classic squelch. Raise Resonance or Drive for more bite, or switch Type to another ladder.",
    tags: ["bass", "ladder", "resonance", "envelope", "acid"],
  });
  const m = melody(p, [0, 0], [0, ".", 0, 12, ".", 0, 7, ".", 0, ".", 3, 0, 10, ".", 7, 5], {
    rate: "1/8", root: "E", scale: "Natural Minor", octave: -2, shape: 1, gatelength: 0.6, env: { decay: 0.2, sustain: 0.6, release: 0.1 } });
  const fe = p.add("adsr", [1, 2], { attack: 0.003, decay: 0.28, sustain: 0.1, release: 0.2 }, { name: "Cutoff Env" });
  const f = p.add("filter", [3, 0], { type: "Ladder Tanh", cutoff: 250, resonance: 0.55, drive: 0.3 });
  p.cable(m.seq, "gate", fe, "gate").cable(m.seq, "trigger", fe, "retrig").cable(fe, "env", f, "cutoff", 0.55)
    .cable(m.amp, "l", f, "l").cable(m.amp, "l", f, "r");
  const d = beat(p, [0, 4], { style: "half", level: -7 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -3, level2: -6, master: -1 });
  p.stereo(f, mix, { to: ["in1l", "in1r"] }).stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function phaserPad() {
  const p = patch("Multi Filter: Phaser Pad", {
    module: "filter", tempo: 80,
    description: "The Type is set to a four-stage phaser: a slow LFO sweeps Cutoff through a held, slightly detuned saw chord so the notches drift up and down. Try the 2-Pole phaser, more Resonance, or a faster LFO.",
    tags: ["phaser", "pad", "lfo", "sweep", "ambient"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 7, "_", "_", "_", 3, "_", "_", "_", 5, "_", "_", "_"], {
    rate: "1/4", root: "D", scale: "Dorian", octave: -1, shape: 1, gatelength: 1, env: { attack: 0.3, decay: 0.5, sustain: 0.8, release: 1.2 } });
  const o2 = p.add("oscillator", [1, 2], { shape: 1, fine: 12, coarse: 7 }, { name: "Fifth" });
  p.cable(m.seq, "pitch", o2, "pitch");
  const g = p.add("audio-mixer", [2, 2], { level1: -2, level2: -9, master: 0 }, { name: "Blend" });
  p.cable(m.osc, "out", g, "in1l").cable(o2, "out", g, "in2l");
  const amp2 = p.add("vca", [2, 3], {}, { name: "VCA 2" });
  p.cable(g, "outl", amp2, "l").cable(m.env, "env", amp2, "gain");
  const lfo = p.add("lfo", [3, 2], { rate: 0.12, wave: "Sine" }, { name: "Sweep" });
  const f = p.add("filter", [3, 0], { type: "Phaser 1-Pole ×4", cutoff: 900, resonance: 0.6, mix: 1 });
  p.cable(lfo, "out", f, "cutoff", 0.45).cable(amp2, "l", f, "l").cable(amp2, "l", f, "r");
  finish(p, [4, 0], f, -10, { size: 0.7, decay: 4, mix: 0.3 });
  return p;
}

function drumBandpass() {
  const p = patch("Multi Filter: Telephone Drums", {
    module: "filter", tempo: 112,
    description: "A whole drum loop goes through the unit-gain band-pass type while an LFO sweeps Cutoff: the beat shrinks to a thin radio sound, then opens up again. Move Mix to blend the original back in, or lower Resonance for a wider band.",
    tags: ["band-pass", "drums", "lofi", "sweep", "mix"],
  });
  const d = beat(p, [0, 0], { style: "broken", level: 0 });
  const f = p.add("filter", [3, 0], { type: "SVF Bandpass (unit gain)", cutoff: 1200, resonance: 0.45, mix: 0.85, drive: 0.1, gain: 14 });
  const lfo = p.add("lfo", [3, 1], { wave: "Triangle", sync: "2 bars" }, { name: "Sweep" });
  p.stereo(d, f, { from: ["outl", "outr"] }).cable(lfo, "out", f, "cutoff", 0.5);
  finish(p, [4, 0], f, 6, { mix: 0.12, decay: 1.5 });
  return p;
}

function keyTrack() {
  const p = patch("Multi Filter: Key-Tracked Pluck", {
    module: "filter", tempo: 98,
    description: "The sequencer's pitch also goes into the filter, and Key Track at full makes Cutoff follow every note, so high and low notes keep the same brightness. Lower Key Track to hear the low notes go dull, or move Mode to morph from low-pass to high-pass.",
    tags: ["key tracking", "pluck", "svf", "mode", "resonance"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 3, 10, 15, 10, 5, 12, 17, 12, 7, 14, 19, 14], {
    rate: "1/8", root: "C", scale: "Natural Minor", octave: 0, shape: 1, gatelength: 0.35, env: { decay: 0.35, sustain: 0, release: 0.25 } });
  const f = p.add("filter", [3, 0], { type: "SVF Multimode", cutoff: 500, resonance: 0.5, keytrack: 1, mode: 0.1, drive: 0.1 });
  const lfo = p.add("lfo", [3, 1], { rate: 0.08 }, { name: "Mode" });
  p.cable(m.seq, "pitch", f, "pitch").cable(m.amp, "l", f, "l").cable(m.amp, "l", f, "r").cable(lfo, "out", f, "mode", 0.12);
  finish(p, [4, 0], f, -8, { size: 0.55, decay: 2.5, mix: 0.25 });
  return p;
}

function flangerComb() {
  const p = patch("Multi Filter: Flanger Jet", {
    module: "filter", tempo: 90,
    description: "Type is the flanger algorithm: a long single note rings through a sweeping comb of resonances that rise and fall with a slow LFO on Cutoff. Push Resonance for a metallic jet sound, or pull Mix back for a gentle swirl.",
    tags: ["flanger", "comb", "jet", "drone", "type"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 7, "_", "_", "_", "_", "_", "_", "_"], {
    rate: "1/4", root: "A", scale: "Minor Pentatonic", octave: -1, shape: 0.9, gatelength: 1, env: { attack: 0.05, decay: 0.5, sustain: 0.9, release: 1 } });
  const f = p.add("filter", [3, 0], { type: "Flanger", cutoff: 700, resonance: 0.6, mix: 0.8 });
  const lfo = p.add("lfo", [3, 1], { rate: 0.15, wave: "Triangle" }, { name: "Sweep" });
  p.cable(m.amp, "l", f, "l").cable(m.amp, "l", f, "r").cable(lfo, "out", f, "cutoff", 0.4);
  const d = beat(p, [0, 4], { style: "sparse", level: -9 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -6, level2: -6, master: -1 });
  p.stereo(f, mix, { to: ["in1l", "in1r"] }).stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

export default [ladderSweep, phaserPad, drumBandpass, keyTrack, flangerComb];
