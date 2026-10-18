// SPDX-License-Identifier: MIT
// Envelope Follower: five demo patches. Each plays by itself with the transport.
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

function autoWah() {
  const p = patch("Envelope Follower: Auto Wah", {
    module: "envelope-follower", tempo: 100,
    description: "A plucked bass line is followed by the Envelope Follower, and the result opens a resonant filter on every note, so the tone speaks with the playing. Try a longer Release for a lazier wah, or more Gain for a wider sweep.",
    tags: ["auto-wah", "filter", "dynamics", "bass"],
  });
  const m = melody(p, [0, 0], [0, ".", 0, 3, ".", 7, ".", 5], { rate: "1/8", shape: 1, root: "E", octave: -1, scale: "Natural Minor",
    env: { decay: 0.3, sustain: 0.1, release: 0.15 } });
  const f = p.add("envelope-follower", [3, 1], { attack: 0.005, release: 0.18, gain: 3 });
  const flt = p.add("filter", [4, 0], { cutoff: 250, resonance: 0.65, type: "SVF Multimode", mode: "LP", drive: 0.2 });
  p.cable(m.amp, "l", f, "in").cable(m.amp, "l", flt, "l").cable(m.amp, "l", flt, "r").cable(f, "env", flt, "cutoff", 0.7);
  toOut(p, [5, 0], [[flt, "l", -10, -0.2], [flt, "r", -10, 0.2]], 0);
  return p;
}

function kickDucker() {
  const p = patch("Envelope Follower: Kick Ducker", {
    module: "envelope-follower", tempo: 118,
    description: "The kick drum is followed and its Inverted output closes a VCA on a sustained pad, so the pad ducks on every beat and swells back in between. Lengthen Release for a slower pump, or shorten it for a tight, subtle push.",
    tags: ["sidechain", "ducking", "pump", "dance"],
  });
  const mix = beat(p, [0, 0], { style: "four", level: -6 });
  const m = melody(p, [0, 4], [0, "_", "_", "_", 7, "_", "_", "_"], { rate: "1/4", shape: 0.6, root: "A", scale: "Minor Pentatonic",
    env: { attack: 0.05, decay: 0.4, sustain: 0.9, release: 0.4 }, gatelength: 1 });
  const f = p.add("envelope-follower", [3, 3], { attack: 0.004, release: 0.22, gain: 3 });
  const duck = p.add("vca", [4, 3], {}, { name: "Duck" });
  p.cable(mix, "outl", f, "in").cable(m.amp, "l", duck, "l").cable(f, "inverted", duck, "gain");
  toOut(p, [5, 0], [[mix, "outl", 0, 0], [duck, "l", -6, 0]], 0);
  return p;
}

function notesFireClaps() {
  const p = patch("Envelope Follower: Notes Fire Claps", {
    module: "envelope-follower", tempo: 108,
    description: "The follower listens to a melody and its Trigger output fires a clap every time a note rises above the Threshold, so the drum part is written by the tune. Raise Threshold to skip the softer notes, or change Detector to RMS.",
    tags: ["trigger", "audio to gate", "clap", "threshold"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, 5, ".", 3, 7, "."], { rate: "1/8", shape: 0.6, root: "D", scale: "Dorian",
    env: { decay: 0.25, sustain: 0.1, release: 0.15 }, vel: [127, 70, 110, 60] });
  const f = p.add("envelope-follower", [3, 1], { attack: 0.002, release: 0.08, gain: 2, threshold: 0.55 });
  const clap = p.add("punch-clap", [4, 1], { level: 0.7 });
  p.cable(m.amp, "l", f, "in").cable(f, "trigger", clap, "trig");
  toOut(p, [5, 0], [[m.amp, "l", 0, -0.2], [clap, "out", 0, 0.2]], 0);
  return p;
}

function droneSwell() {
  const p = patch("Envelope Follower: Drone Swell", {
    module: "envelope-follower", tempo: 92,
    description: "A slow Attack and long Release turn a sparse drum loop into a gentle level that fades a drone in and out, so the drone breathes with how busy the drums are. Shorten both times to make it follow each hit instead.",
    tags: ["swell", "slow", "drone", "loudness"],
  });
  const mix = beat(p, [0, 0], { style: "sparse", level: -4 });
  const osc = p.add("oscillator", [0, 4], { shape: 0.4, octave: "-1", fine: -6 }, { name: "Drone A" });
  const osc2 = p.add("oscillator", [0, 5], { shape: 0.4, octave: "-1", coarse: 7, fine: 5 }, { name: "Drone B" });
  const f = p.add("envelope-follower", [3, 3], { attack: 0.6, release: 1.8, gain: 6, detector: "RMS" });
  const amp = p.add("vca", [4, 4], {}, { name: "Swell" });
  const sum = p.add("audio-mixer", [2, 4], { level1: -6, level2: -6 }, { name: "Drone Sum" });
  p.cable(osc, "out", sum, "in1l").cable(osc2, "out", sum, "in2l").cable(sum, "outl", amp, "l").cable(mix, "outl", f, "in").cable(f, "env", amp, "gain");
  toOut(p, [5, 0], [[mix, "outl", 0, 0], [amp, "l", 0, 0]], 0);
  return p;
}

function slewedPitch() {
  const p = patch("Envelope Follower: Slewed Pitch", {
    module: "envelope-follower", tempo: 90,
    description: "With Rectify set to None (signed), the follower becomes a slew limiter: stepped random values glide into one another and bend a voice's pitch. Raise Attack for slow climbs and Release for slow falls, or play with the Gain.",
    tags: ["slew", "glide", "random", "cv"],
  });
  const r = p.add("random", [0, 0], { sync: "1/4", spread: 0.5, quantize: true, seed: 11 }, { name: "Pitch Steps" });
  const f = p.add("envelope-follower", [1, 0], { attack: 0.25, release: 0.45, gain: 1, rectify: "None (signed)" });
  const osc = p.add("oscillator", [2, 0], { shape: 0.7, octave: "-1" });
  const flt = p.add("filter", [3, 0], { cutoff: 1400, resonance: 0.3 });
  p.cable(r, "out", f, "in").cable(f, "env", osc, "pitch", 0.4).cable(osc, "out", flt, "l").cable(osc, "out", flt, "r");
  toOut(p, [4, 0], [[flt, "l", -18, -0.3], [flt, "r", -18, 0.3]], 0);
  return p;
}

export default [autoWah, kickDucker, notesFireClaps, droneSwell, slewedPitch];
