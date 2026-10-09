// SPDX-License-Identifier: MIT
// Freq Shifter: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

const feed = (p, amp, f) => p.cable(amp, "l", f, "l").cable(amp, "l", f, "r");
function finish(p, at, src, trim = 0, verb = {}, jacks = ["l", "r"], master = 0) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}
const pad = (p, notes, o = {}) => melody(p, [0, 0], notes, { rate: "1/4", shape: 1, gatelength: 0.97, env: { attack: 0.35, decay: 0.4, sustain: 0.9, release: 1.2 }, ...o });

function barberPole() {
  const p = patch("Freq Shifter: Barber-Pole Phaser", {
    module: "freq-shifter", tempo: 76,
    description: "A saw pad passes through the shifter with a tiny positive Fine and strong Feedback at half Mix: the phaser-like sweep never reaches the end, always rising. Flip Fine negative for a falling one.",
    tags: ["phaser", "feedback", "rising", "pad"],
  });
  const m = pad(p, [0, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_"], { root: "E", scale: "Dorian" });
  const f = p.add("freq-shifter", [3, 0], { shift: 0, fine: 0.35, feedback: 0.72, fbDelay: 0, mix: 0.5, range: "±10 Hz" });
  feed(p, m.amp, f);
  finish(p, [4, 0], f, -12, { size: 0.65, decay: 4, mix: 0.3 });
  return p;
}

function padBells() {
  const p = patch("Freq Shifter: Pad to Bells", {
    module: "freq-shifter", tempo: 70,
    description: "With Shift at about +30 % of the 200 Hz range and Mix at 100 %, a harmonic pad becomes inharmonic and metallic, and a slow LFO on Shift moves between bell clusters. Fold in Spread for a stereo glitter.",
    tags: ["bells", "inharmonic", "metallic", "pad"],
  });
  const m = pad(p, [0, "_", "_", "_", 7, "_", "_", "_", 4, "_", "_", "_", 9, "_", "_", "_"], { root: "C", scale: "Major Pentatonic", shape: 0.7 });
  const f = p.add("freq-shifter", [3, 0], { shift: 0.3, mix: 1, spread: 0.4, range: "±200 Hz" });
  const lfo = p.add("lfo", [2, 1], { rate: 0.05, wave: "Triangle" }, { name: "Shift" });
  feed(p, m.amp, f);
  p.cable(lfo, "out", f, "shift", 0.2);
  finish(p, [4, 0], f, -7, { size: 0.7, decay: 5.5, mix: 0.4 });
  return p;
}

function spiralEchoes() {
  const p = patch("Freq Shifter: Spiral Echoes", {
    module: "freq-shifter", tempo: 94,
    description: "Feedback through a short FB Delay shifts every repeat up by the same amount, so each plucked note spirals upward into a stack of echoes. Change Shift to climb faster or slower, or make it negative to spiral down.",
    tags: ["spiral", "echo", "feedback delay", "pluck"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, ".", 4, ".", 9, "."], { rate: "1/4", shape: 0.6, root: "A", scale: "Minor Pentatonic", gatelength: 0.3, env: { decay: 0.25, sustain: 0, release: 0.2 } });
  const f = p.add("freq-shifter", [3, 0], { shift: 0.08, feedback: 0.62, fbDelay: 0.38, mix: 0.7, range: "±200 Hz" });
  const lfo = p.add("lfo", [2, 1], { rate: 0.06, wave: "Sine" }, { name: "Climb" });
  feed(p, m.amp, f);
  p.cable(lfo, "out", f, "shift", 0.06);
  finish(p, [4, 0], f, 6, { size: 0.5, decay: 2.5, mix: 0.2 }, ["l", "r"], 6);
  return p;
}

function stereoRotation() {
  const p = patch("Freq Shifter: Stereo Rotation", {
    module: "freq-shifter", tempo: 88,
    description: "A mono arpeggio on the left input is shifted in opposite directions left and right by Spread at 100 %, so the sound slowly rotates around the head. Change Fine to rotate faster or slower.",
    tags: ["stereo", "rotation", "spread", "arpeggio"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 11, 14, 11, 7, 4], { rate: "1/8", shape: 0.9, root: "F", scale: "Lydian", gatelength: 0.55, env: { decay: 0.3, sustain: 0.3, release: 0.3 } });
  const f = p.add("freq-shifter", [3, 0], { shift: 0, fine: 0.25, spread: 1, mix: 1, range: "±10 Hz" });
  p.cable(m.amp, "l", f, "l");
  finish(p, [4, 0], f, -1, { size: 0.5, decay: 2.5, mix: 0.25 });
  return p;
}

function rhythmicShift() {
  const p = patch("Freq Shifter: Tempo Phaser", {
    module: "freq-shifter", tempo: 110,
    description: "Sync on one bar locks the shifter's rate to the song, so a drum loop and bass get a slow, feedback-laden phaser that sweeps once per bar. Try shorter Sync values, or Shift negative.",
    tags: ["sync", "drums", "phaser", "tempo"],
  });
  const drums = beat(p, [0, 0], { style: "four", level: -5 });
  const m = melody(p, [0, 3], [0, 0, 7, 0, 5, 0, 3, 5], { rate: "1/8", shape: 0.4, root: "A", scale: "Minor Pentatonic", octave: -1, gatelength: 0.5 });
  const mix = p.add("audio-mixer", [3, 0], { level1: 0, level2: -6, master: -1 }, { name: "Source Mix" });
  p.stereo(drums, mix, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).cable(m.amp, "l", mix, "in2l").cable(m.amp, "l", mix, "in2r");
  const f = p.add("freq-shifter", [4, 0], { shift: 0.04, feedback: 0.5, mix: 0.55, range: "±200 Hz", sync: "1 bar" });
  p.stereo(mix, f, { from: ["outl", "outr"] });
  finish(p, [5, 0], f, 3, { size: 0.3, decay: 1.2, mix: 0.1 });
  return p;
}

export default [barberPole, padBells, spiralEchoes, stereoRotation, rhythmicShift];
