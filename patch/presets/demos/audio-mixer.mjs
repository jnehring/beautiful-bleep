// SPDX-License-Identifier: MIT
// Audio Mixer (audio-mixer): five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
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

/// A saw/square voice from a sequencer, ending in a VCA: mono audio on "l".
function voice(p, at, notes, o = {}) {
  return melody(p, at, notes, { rate: "1/8", gatelength: 0.5, ...o });
}

function band() {
  const p = patch("Audio Mixer: Four-Piece Band", {
    module: "audio-mixer", tempo: 108,
    description: "Drums, a bass, a chord line and a lead each sit on their own channel with their own level and pan: bass in the middle, chords left, lead right. Pull a Level down or move a Pan to rebalance the band.",
    tags: ["mixing", "pan", "levels", "band", "balance"],
  });
  const d = beat(p, [0, 6], { style: "four", level: -6 });
  const b = voice(p, [0, 0], [0, ".", 0, 7, ".", 0, 5, ".", 0, ".", 3, 0, 10, ".", 7, 5], { root: "A", scale: "Minor Pentatonic", octave: -2, shape: 0.9, env: { decay: 0.2, sustain: 0.5 }, oscName: "Bass" });
  const c = voice(p, [0, 2], [0, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_"], { rate: "1/4", gatelength: 1, root: "A", scale: "Minor Pentatonic", octave: 0, shape: 0.3, env: { attack: 0.05, sustain: 0.8, release: 0.5 }, oscName: "Chords" });
  const l = voice(p, [0, 4], [12, ".", 10, 12, ".", 15, 12, 10, ".", 7, ".", 10, 12, ".", ".", "."], { root: "A", scale: "Minor Pentatonic", octave: 1, shape: 0.5, env: { decay: 0.3, sustain: 0.1 }, oscName: "Lead" });
  const mix = p.add("audio-mixer", [4, 0], { level1: -3, pan1: 0, level2: -9, pan2: -0.5, level3: -9, pan3: 0.5, level4: -6, pan4: 0, master: -1 }, { name: "Band" });
  p.cable(b.amp, "l", mix, "in1l").cable(b.amp, "l", mix, "in1r").cable(c.amp, "l", mix, "in2l").cable(c.amp, "l", mix, "in2r")
    .cable(l.amp, "l", mix, "in3l").cable(l.amp, "l", mix, "in3r").stereo(d, mix, { from: ["outl", "outr"], to: ["in4l", "in4r"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function sends() {
  const p = patch("Audio Mixer: Send to Reverb", {
    module: "audio-mixer", tempo: 90,
    description: "Each channel's Send feeds one reverb whose output returns on Return: the lead is awash in it, the bass stays dry. Raise Send 1 for more space, and switch Send Point to Pre-Fader to keep the reverb when a channel's Level is turned down.",
    tags: ["send", "return", "reverb", "aux", "space"],
  });
  const b = melody(p, [0, 0], [0, ".", ".", 0, ".", 7, ".", ".", 5, ".", ".", 5, ".", 3, ".", "."], { rate: "1/8", root: "D", scale: "Dorian", octave: -2, shape: 0.9, gatelength: 0.6, env: { decay: 0.25, sustain: 0.5 }, oscName: "Bass" });
  const l = melody(p, [0, 2], [12, 14, 17, 14, 12, ".", 9, ".", 12, 14, 17, 21, 19, ".", ".", "."], { rate: "1/8", root: "D", scale: "Dorian", octave: 0, shape: 0.4, gatelength: 0.4, env: { decay: 0.35, sustain: 0 }, oscName: "Lead" });
  const d = beat(p, [0, 4], { style: "sparse", level: -8 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -4, send1: -60, level2: -8, send2: -4, level3: -6, send3: -14, master: -1, return: -3, sendpoint2: "Pre-Fader" }, { name: "Mixer" });
  const verb = p.add("reverb", [5, 0], { size: 0.75, decay: 4.5, damping: 0.5, mix: 1, quality: "Eco (8 lines)" });
  p.cable(b.amp, "l", mix, "in1l").cable(b.amp, "l", mix, "in1r").cable(l.amp, "l", mix, "in2l").cable(l.amp, "l", mix, "in2r")
    .stereo(d, mix, { from: ["outl", "outr"], to: ["in3l", "in3r"] });
  p.stereo(mix, verb, { from: ["sendl", "sendr"], to: ["l", "r"] }).stereo(verb, mix, { from: ["l", "r"], to: ["returnl", "returnr"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function muteArrangement() {
  const p = patch("Audio Mixer: Muting Arrangement", {
    module: "audio-mixer", tempo: 120,
    description: "Mute inputs are fed from drum-grid tracks, so the hats, the chord stabs and the bass drop in and out of the mix on their own in a repeating pattern. Switch a Solo on to isolate one part, or turn a Mute on by hand.",
    tags: ["mute", "solo", "arrangement", "gate", "automation"],
  });
  const b = melody(p, [0, 0], [0, ".", 0, 7, ".", 0, 5, ".", 0, ".", 3, 0, 10, ".", 7, 5], { rate: "1/8", root: "C", scale: "Natural Minor", octave: -2, shape: 0.9, gatelength: 0.6, env: { decay: 0.2, sustain: 0.5 }, oscName: "Bass" });
  const c = melody(p, [0, 2], [12, "_", "_", "_", 15, "_", "_", "_", 10, "_", "_", "_", 14, "_", "_", "_"], { rate: "1/4", root: "C", scale: "Natural Minor", octave: 0, shape: 0.4, gatelength: 0.9, env: { attack: 0.02, sustain: 0.7, release: 0.3 }, oscName: "Stabs" });
  const d = beat(p, [0, 4], { style: "four", level: -6 });
  const arr = p.add("drum-grid", [3, 5], {}, { name: "Mute Pattern", data: drumGrid(["Bass", "Stabs", "", "", "", "", "", ""], [pattern("Arrange", [
    "XXXXXXXX........", "........XXXXXXXX", "", "", "", "", "", ""], 16)]) });
  const mix = p.add("audio-mixer", [4, 0], { level1: -3, level2: -9, level3: -5, master: -1 }, { name: "Mixer" });
  p.cable(b.amp, "l", mix, "in1l").cable(b.amp, "l", mix, "in1r").cable(c.amp, "l", mix, "in2l").cable(c.amp, "l", mix, "in2r")
    .stereo(d, mix, { from: ["outl", "outr"], to: ["in3l", "in3r"] }).cable(arr, "gate1", mix, "mute1in").cable(arr, "gate2", mix, "mute2in");
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function limiterSquash() {
  const p = patch("Audio Mixer: Limiter Squash", {
    module: "audio-mixer", tempo: 128,
    description: "All four channels are driven hot, well above 0 dB, and the built-in Limiter holds the master bus below full scale, giving a loud, dense and slightly pumping sound. Turn the Limiter setting off to hear how far past clipping the inputs are, and lower Master to keep it safe.",
    tags: ["limiter", "loudness", "headroom", "master", "drums"],
  });
  const d = beat(p, [0, 0], { style: "broken", level: 2 });
  const b = melody(p, [0, 4], [0, 0, ".", 7, 0, ".", 5, ".", 0, 0, ".", 3, 10, ".", 7, 5], { rate: "1/8", root: "G", scale: "Minor Pentatonic", octave: -2, shape: 1, gatelength: 0.6, env: { decay: 0.2, sustain: 0.6 }, oscName: "Bass" });
  const c = melody(p, [0, 6], [12, "_", "_", "_", 15, "_", "_", "_", 10, "_", "_", "_", 14, "_", "_", "_"], { rate: "1/4", root: "G", scale: "Minor Pentatonic", octave: 0, shape: 1, gatelength: 1, env: { attack: 0.02, sustain: 0.8, release: 0.3 }, oscName: "Chords" });
  const mix = p.add("audio-mixer", [4, 0], { level1: 3, level2: 1, level3: 0, master: -9, limiter: true }, { name: "Hot Mixer" });
  p.stereo(d, mix, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).cable(b.amp, "l", mix, "in2l").cable(b.amp, "l", mix, "in2r")
    .cable(c.amp, "l", mix, "in3l").cable(c.amp, "l", mix, "in3r");
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function monoFold() {
  const p = patch("Audio Mixer: Mono Check", {
    module: "audio-mixer", tempo: 100,
    description: "Two arpeggios are panned hard left and hard right with wide detune, then summed to the middle by the Mono setting: a quick way to hear what happens to a wide mix on a single speaker. Switch Mono off to open them back out, or change the Pan values.",
    tags: ["mono", "pan", "stereo", "check", "arpeggio"],
  });
  const a = melody(p, [0, 0], [0, 7, 12, 7, 3, 10, 15, 10, 5, 12, 17, 12, 7, 14, 19, 14], { rate: "1/8", root: "A", scale: "Natural Minor", octave: 0, shape: 0.7, gatelength: 0.5, env: { decay: 0.2, sustain: 0.1 }, oscName: "Left" });
  const b = melody(p, [0, 3], [12, 10, 7, 10, 15, 12, 7, 3, 17, 15, 12, 10, 19, 17, 14, 12], { rate: "1/8", root: "A", scale: "Natural Minor", octave: 0, shape: 0.2, gatelength: 0.5, osc: { fine: 14 }, env: { decay: 0.3, sustain: 0.1 }, oscName: "Right" });
  const d = beat(p, [0, 6], { style: "half", level: -8 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -3, pan1: -1, level2: -3, pan2: 1, level3: -4, master: -1, mono: true }, { name: "Mixer" });
  p.cable(a.amp, "l", mix, "in1l").cable(a.amp, "l", mix, "in1r").cable(b.amp, "l", mix, "in2l").cable(b.amp, "l", mix, "in2r")
    .stereo(d, mix, { from: ["outl", "outr"], to: ["in3l", "in3r"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

export default [band, sends, muteArrangement, limiterSquash, monoFold];
