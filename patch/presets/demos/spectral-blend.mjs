// SPDX-License-Identifier: GPL-3.0-only
// Spectral Blend: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

// A mixer to Out 1/2: channels are [node, jack, dB, pan] (mono sources).
function toOut(p, at, chans, master = 0) {
  const v = { master };
  chans.forEach(([, , db, pan], i) => { v["level" + (i + 1)] = db; v["pan" + (i + 1)] = pan ?? 0; });
  const g = p.add("audio-mixer", at, v, { name: "Out Mix" });
  chans.forEach(([n, j], i) => p.cable(n, j, g, "in" + (i + 1) + "l"));
  p.stereo(g, p.out, { from: ["outl", "outr"] });
  return g;
}

// A small room on a mono source; returns the reverb (stereo "l"/"r").
function room(p, at, src, jack, o = {}) {
  const v = p.add("reverb", at, { size: 0.6, decay: 3, mix: 0.3, quality: "Eco (8 lines)", ...o });
  p.cable(src, jack, v, "l").cable(src, jack, v, "r");
  return v;
}

function drumsInPad() {
  const p = patch("Spectral Blend: Drums Wear a Pad", {
    module: "spectral-blend", tempo: 112,
    description: "A drum loop in A and a sustained minor chord in B: it keeps the pad's colour while every hit chops it into the beat's spectral shape. Swap Magnitude and Phase (0/1 against 1/0) to hear which sound lends the rhythm and which the tone.",
    tags: ["cross-synthesis", "drums", "pad", "rhythm"],
  });
  const mix = beat(p, [0, 0], { style: "broken", level: -3 });
  const ch = p.add("chord-osc", [0, 4], { chord: "Minor 7", key: "A", octave: "-1", shape: 0.9, detune: 14, stereo: 0.3 }, { name: "Pad Chord" });
  const sb = p.add("spectral-blend", [4, 1], { magnitude: 1, phase: 0, blur: 0.12, size: "2048", level: -4 });
  p.cable(mix, "outl", sb, "a").cable(ch, "l", sb, "b");
  const lfo = p.add("lfo", [3, 4], { rate: 0.08, wave: "Triangle", polarity: "Unipolar" }, { name: "Who Leads" });
  p.cable(lfo, "out", sb, "phase", 0.5);
  const v = room(p, [5, 1], sb, "out", { mix: 0.25 });
  toOut(p, [6, 0], [[sb, "out", 0, 0], [v, "l", -8, -0.6], [v, "r", -8, 0.6], [mix, "outl", -9, 0]], -3);
  return p;
}

function tiltSplit() {
  const p = patch("Spectral Blend: Bass Below, Arp Above", {
    module: "spectral-blend", tempo: 104,
    description: "A bass line in A and a bright arpeggio in B are joined at a pivot frequency: with Tilt up, the lows come from the bass and the highs from the arp, so one sound seems to play both. A slow LFO moves the Pivot up and down; try a Tilt of -1 to turn the roles around.",
    tags: ["tilt", "pivot", "split", "two sounds"],
  });
  const a = melody(p, [0, 0], [0, ".", 0, 0, ".", 7, ".", 5, 0, ".", 0, 3, ".", 7, 5, "."], { rate: "1/8", shape: 0.9, root: "E", octave: -1,
    scale: "Natural Minor", env: { decay: 0.25, sustain: 0.5, release: 0.12 }, gatelength: 0.6 });
  const b = melody(p, [0, 4], [0, 7, 12, 7, 10, 7, 12, 15, 0, 7, 12, 7, 10, 14, 12, 7], { rate: "1/16", shape: 1, root: "E", octave: 1,
    scale: "Natural Minor", env: { decay: 0.12, sustain: 0.05, release: 0.08 }, oscName: "Arp Source" });
  const sb = p.add("spectral-blend", [4, 2], { magnitude: 0, phase: 0, tilt: 1, pivot: 600, level: 3 });
  const lfo = p.add("lfo", [3, 7], { rate: 0.07, wave: "Triangle" }, { name: "Pivot Sweep" });
  p.cable(a.amp, "l", sb, "a").cable(b.amp, "l", sb, "b").cable(lfo, "out", sb, "pivot", 0.35);
  const v = room(p, [5, 2], sb, "out", { mix: 0.2 });
  toOut(p, [6, 1], [[sb, "out", -2, 0], [v, "l", -9, -0.6], [v, "r", -9, 0.6]], 0);
  return p;
}

function freezeDrone() {
  const p = patch("Spectral Blend: Frozen Moments", {
    module: "spectral-blend", tempo: 90,
    description: "A pluck melody runs through Spectral Blend while a gate from a clock divider freezes the spectrum on every other bar, turning a single note into a long drone under the live line. Change the divider for shorter or longer holds, or add Blur to soften the frozen chord.",
    tags: ["freeze", "drone", "clock", "pad"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 10, 7, 3, 5, 7, 0, 3, 7, 10, 12, 10, 7, 5], { rate: "1/8", shape: 0.6, root: "D", scale: "Dorian",
    env: { decay: 0.5, sustain: 0.05, release: 0.4 }, gatelength: 0.4 });
  const clk = p.add("clock-divider", [0, 4], { div1: 24, base: "1/8", output: "Gate", syncto: "Transport", gatelength: "Division" }, { name: "Freeze Clock" });
  const sb = p.add("spectral-blend", [4, 1], { magnitude: 0, phase: 0, blur: 0.25, smear: 0.2, size: "4096", level: 3 });
  p.cable(m.amp, "l", sb, "a").cable(clk, "out1", sb, "freezegate");
  const v = room(p, [5, 1], sb, "out", { size: 0.8, decay: 5, mix: 0.4 });
  toOut(p, [6, 0], [[sb, "out", -2, 0], [m.amp, "l", -8, 0.3], [v, "l", -8, -0.7], [v, "r", -8, 0.7]], 3);
  return p;
}

function gateWash() {
  const p = patch("Spectral Blend: Partials Come and Go", {
    module: "spectral-blend", tempo: 100,
    description: "A drum loop goes into In A alone, and the spectral gate removes every frequency bin below a threshold while Smear leaves a spectral afterglow; a slow LFO on the mid gate lets partials appear and vanish. Raise Smear for a bigger wash or turn on Invert Gate to keep only what is quiet.",
    tags: ["spectral gate", "smear", "blur", "drums"],
  });
  const mix = beat(p, [0, 0], { style: "shuffle", level: -2 });
  const sb = p.add("spectral-blend", [4, 1], { magnitude: 0, phase: 0, gatelow: -50, gatemid: -40, gatehigh: -45, blur: 0.2, smear: 0.45,
    splitlow: 300, splithigh: 3500, level: 6 });
  const lfo = p.add("lfo", [3, 4], { rate: 0.11, wave: "Triangle", polarity: "Unipolar" }, { name: "Threshold Sweep" });
  const lfo2 = p.add("lfo", [3, 5], { rate: 0.07, wave: "Triangle", polarity: "Unipolar", phase: 120 }, { name: "High Sweep" });
  p.cable(mix, "outl", sb, "a").cable(lfo, "out", sb, "gatemid", 0.4).cable(lfo2, "out", sb, "gatehigh", 0.3);
  const v = room(p, [5, 1], sb, "out", { size: 0.7, decay: 3.5, mix: 0.3 });
  toOut(p, [6, 0], [[sb, "out", 0, 0], [v, "l", -8, -0.7], [v, "r", -8, 0.7], [mix, "outl", -8, 0]], -4);
  return p;
}

function geometricMorph() {
  const p = patch("Spectral Blend: Geometric Morph", {
    module: "spectral-blend", tempo: 84,
    description: "Two different melodies, a soft sine line in A and a buzzy saw line in B, are morphed in the geometric law, where a partial only one of them has stays quiet halfway, so the change is smooth. Slow random values move Magnitude and Phase; try Linear for a cruder cross-fade.",
    tags: ["morph", "geometric", "melody", "timbre"],
  });
  const a = melody(p, [0, 0], [0, ".", 7, ".", 5, ".", 3, ".", 0, ".", 3, 5, 7, ".", 10, "."], { rate: "1/8", shape: 0, root: "C", octave: 0,
    scale: "Natural Minor", env: { attack: 0.02, decay: 0.4, sustain: 0.6, release: 0.3 }, gatelength: 0.8, oscName: "Sine Line" });
  const b = melody(p, [0, 4], [12, ".", 10, 7, ".", 3, 5, ".", 7, ".", 12, 10, ".", 7, 3, "."], { rate: "1/8", shape: 1, root: "C", octave: -1,
    scale: "Natural Minor", env: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.25 }, gatelength: 0.7, oscName: "Saw Line" });
  const sb = p.add("spectral-blend", [4, 2], { law: "Geometric", magnitude: 0.5, phase: 0.5, size: "2048", blur: 0.1, level: 4 });
  const r1 = p.add("random", [3, 7], { rate: 0.3, smooth: 1, seed: 5, spread: 1 }, { name: "Magnitude Drift" });
  const r2 = p.add("random", [3, 8], { rate: 0.2, smooth: 1, seed: 17, spread: 1 }, { name: "Phase Drift" });
  p.cable(a.amp, "l", sb, "a").cable(b.amp, "l", sb, "b").cable(r1, "out", sb, "magnitude", 0.5).cable(r2, "out", sb, "phase", 0.5);
  const v = room(p, [5, 2], sb, "out", { size: 0.7, decay: 3.5, mix: 0.3 });
  toOut(p, [6, 1], [[sb, "out", -2, 0], [v, "l", -8, -0.6], [v, "r", -8, 0.6]], 0);
  return p;
}

export default [drumsInPad, tiltSplit, freezeDrone, gateWash, geometricMorph];
