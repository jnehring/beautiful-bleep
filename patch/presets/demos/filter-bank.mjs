// SPDX-License-Identifier: MIT
// Filter Bank (filter-bank): five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// src (stereo jacks) → trim mixer → reverb → Out.
function finish(p, at, src, trim = 0, verb = {}, jacks = ["l", "r"]) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.2, damping: 0.5, mix: 0.2, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}
/// Mono jack of a node into both inputs of a stereo module.
function mono(p, from, jack, to, l = "l", r = "r") { p.cable(from, jack, to, l).cable(from, jack, to, r); }
/// Two stereo sources blended into Out.
function blend(p, at, a, b, la = -3, lb = -6, aj = ["l", "r"], bj = ["outl", "outr"]) {
  const mix = p.add("audio-mixer", at, { level1: la, level2: lb, master: -1 });
  p.stereo(a, mix, { from: aj, to: ["in1l", "in1r"] }).stereo(b, mix, { from: bj, to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return mix;
}

function chordSource(p, at, notes, opts = {}) {
  // Two detuned saws on one sequencer: a thick carrier. Returns the VCA with mono audio on "l".
  const m = melody(p, at, notes, { shape: 1, rate: "1/4", gatelength: 1, env: { attack: 0.05, decay: 0.5, sustain: 0.9, release: 0.6 }, ...opts });
  const o2 = p.add("oscillator", [at[0] + 1, at[1] + 2], { shape: 1, fine: 9, coarse: 7 }, { name: "Fifth" });
  p.cable(m.seq, "pitch", o2, "pitch");
  const g = p.add("audio-mixer", [at[0] + 2, at[1] + 2], { level1: -2, level2: -8, master: 0 }, { name: "Blend" });
  p.cable(m.osc, "out", g, "in1l").cable(o2, "out", g, "in2l");
  const amp2 = p.add("vca", [at[0] + 2, at[1] + 3], {}, { name: "VCA 2" });
  p.cable(g, "outl", amp2, "l").cable(m.env, "env", amp2, "gain");
  return amp2;
}

function drumVocoder() {
  const p = patch("Filter Bank: Drum Vocoder", {
    module: "filter-bank", tempo: 110,
    description: "A held saw chord goes into the bank while a drum loop drives the Sidechain: with Vocode up, each band opens only when the drums have energy in that range, so the chord chatters in the rhythm of the beat. Change Vocode, Release or Q to tighten or smear it.",
    tags: ["vocoder", "sidechain", "drums", "rhythm", "carrier"],
  });
  const c = chordSource(p, [0, 0], [0, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_"], { root: "E", scale: "Natural Minor", octave: -1 });
  const d = beat(p, [0, 4], { style: "broken", level: -4 });
  const fb = p.add("filter-bank", [4, 0], { vocode: 1, q: 5, attack: 0.002, release: 0.09, tuning: "Spectral", level1: 3, level2: 3, level3: 3, level4: 3, level5: 3, level6: 3, level7: 3, level8: 3, level9: 3, level10: 3 });
  mono(p, c, "l", fb);
  p.cable(d, "outl", fb, "sidechain");
  finish(p, [5, 0], fb, -12, { mix: 0.2 });
  return p;
}

function scanWindow() {
  const p = patch("Filter Bank: Scanning Window", {
    module: "filter-bank", tempo: 90,
    description: "A bright, buzzy drone passes through only a few neighbouring bands; an LFO on Scan slides that window up and down the spectrum like a slow wah. Widen Width for a fuller sound, or raise Q for whistling.",
    tags: ["scan", "width", "drone", "sweep", "lfo"],
  });
  const c = chordSource(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 7, "_", "_", "_", "_", "_", "_", "_"], { root: "D", scale: "Dorian", octave: -1 });
  const fb = p.add("filter-bank", [4, 0], { scan: 0.5, width: 3, q: 4, level1: 4, level2: 4, level3: 4, level4: 4, level5: 4, level6: 4, level7: 4, level8: 4, level9: 4, level10: 4 });
  const lfo = p.add("lfo", [4, 1], { rate: 0.1, wave: "Triangle", polarity: "Unipolar" }, { name: "Scan" });
  mono(p, c, "l", fb);
  p.cable(lfo, "out", fb, "scan", 0.9);
  finish(p, [5, 0], fb, -6, { size: 0.65, decay: 3.5, mix: 0.28 });
  return p;
}

function scaleResonator() {
  const p = patch("Filter Bank: Noise Chimes", {
    module: "filter-bank", tempo: 84,
    description: "Plain noise goes into ten very narrow bands tuned to a minor pentatonic scale (Tuning set to Scale), so it rings as a soft, wind-like chord. Change Root or Scale, move Shift to transpose the whole set, or lower Q to lose the pitch.",
    tags: ["resonator", "tuning", "scale", "noise", "chimes"],
  });
  const n = p.add("noise", [0, 0], { colour: 0.2, level: 0.8 });
  const gate = p.add("lfo", [0, 1], { wave: "Triangle", sync: "Tempo", division: "2 bars", polarity: "Unipolar" }, { name: "Swell" });
  const amp = p.add("vca", [1, 0], {});
  p.cable(n, "out", amp, "l").cable(gate, "out", amp, "gain");
  const fb = p.add("filter-bank", [3, 0], { tuning: "Scale", root: "A", scale: "Minor Pentatonic", q: 26, shift: 0, level1: 10, level2: 10, level3: 10, level4: 10, level5: 10, level6: 10, level7: 10, level8: 10, level9: 10, level10: 10 });
  const sh = p.add("random", [3, 1], { sync: "1 bar", spread: 0.5, quantize: true, smooth: 0.2, seed: 7 }, { name: "Shift" });
  mono(p, amp, "l", fb);
  p.cable(sh, "out", fb, "shift", 0.12);
  finish(p, [4, 0], fb, -12, { size: 0.8, decay: 5, mix: 0.35 });
  return p;
}

function oddEvenSplit() {
  const p = patch("Filter Bank: Odd-Even Stereo", {
    module: "filter-bank", tempo: 100,
    description: "Odd bands go left and even bands go right, so one saw arpeggio is pulled apart into two interlocking halves. Swing Odd/Even with the LFO and the sound moves between the speakers; set Stereo to Normal to hear it fold back to the middle.",
    tags: ["odd even", "stereo", "arpeggio", "comb", "width"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 3, 10, 15, 10, 5, 12, 17, 12, 7, 14, 19, 14], {
    rate: "1/8", root: "G", scale: "Natural Minor", octave: -1, shape: 1, gatelength: 0.5, env: { decay: 0.22, sustain: 0.2, release: 0.15 } });
  const fb = p.add("filter-bank", [3, 0], { stereo: "Odd/Even split", q: 3, oddEven: 0, level1: 3, level2: 3, level3: 3, level4: 3, level5: 3, level6: 3, level7: 3, level8: 3, level9: 3, level10: 3 });
  const lfo = p.add("lfo", [3, 1], { wave: "Sine", rate: 0.2 }, { name: "Balance" });
  mono(p, m.amp, "l", fb);
  p.cable(lfo, "out", fb, "oddEven", 0.6);
  finish(p, [4, 0], fb, -5, { size: 0.55, decay: 2.5, mix: 0.25 });
  return p;
}

function bandPan() {
  const p = patch("Filter Bank: Band Split Mixer", {
    module: "filter-bank", tempo: 106,
    description: "Jacks is set to Bands: four of the ten band outputs go to their own mixer channels, panned from left to right, so the low end of a drum-and-bass loop sits in the middle and brighter bands spread out. Change the mixer levels to rebalance the spectrum, or tilt the bank with Tilt.",
    tags: ["band outputs", "split", "pan", "mix", "spectrum"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, 0, ".", 10, 7, ".", 0, ".", 12, 7, ".", 5, 3, ".", ], {
    rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: -1, shape: 1, gatelength: 0.55, env: { decay: 0.25, sustain: 0.4, release: 0.15 } });
  const d = beat(p, [0, 4], { style: "shuffle", level: -6 });
  const sum = p.add("audio-mixer", [3, 3], { level1: -3, level2: 0, master: 0 }, { name: "Source" });
  p.cable(m.amp, "l", sum, "in1l").cable(m.amp, "l", sum, "in1r").stereo(d, sum, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const fb = p.add("filter-bank", [4, 0], { jacks: "Bands", q: 2.5, tilt: 0.5, level1: 4, level2: 4, level3: 4, level4: 4, level5: 4, level6: 4, level7: 4, level8: 4, level9: 4, level10: 4 });
  p.stereo(sum, fb, { from: ["outl", "outr"] });
  const mix = p.add("audio-mixer", [5, 0], { level1: 0, level2: 0, level3: 0, level4: 0, pan1: 0, pan2: -0.7, pan3: 0.4, pan4: 0.9, master: -3 }, { name: "Bands" });
  p.cable(fb, "band2", mix, "in1l").cable(fb, "band4", mix, "in2l").cable(fb, "band7", mix, "in3l").cable(fb, "band9", mix, "in4l");
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

export default [drumVocoder, scanWindow, scaleResonator, oddEvenSplit, bandPan];
