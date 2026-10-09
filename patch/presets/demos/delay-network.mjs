// SPDX-License-Identifier: MIT
// Delay Net: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

function ringPad() {
  const p = patch("Delay Net: Ring Pad", {
    module: "delay-network", tempo: 72,
    description: "Six taps in a Ring feed each other with a dark, tape-like Character, so single soft notes smear into a slowly turning pad. Move Scatter and Width to change where the taps sit, or Routing to Chain to hear a straighter line.",
    tags: ["pad", "ring", "ambient", "feedback"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, ".", 5, ".", 9, "."], { rate: "1/4", shape: 0.4, root: "F", scale: "Major Pentatonic",
    env: { attack: 0.02, decay: 0.6, sustain: 0.2, release: 0.5 } });
  const d = p.add("delay-network", [3, 0], { time: 0.9, taps: 6, scatter: 0.5, jitter: 0.15, feedback: 0.78, character: 0.4, tone: -0.2,
    width: 0.9, mix: 0.6, routing: "Ring" });
  p.cable(m.amp, "l", d, "l").cable(m.amp, "l", d, "r").stereo(d, p.out);
  return p;
}

function rhythmicParallel() {
  const p = patch("Delay Net: Dotted Pluck Grid", {
    module: "delay-network", tempo: 110,
    description: "With Sync on a dotted eighth and Parallel routing, four taps place echoes on a rhythmic grid around a short plucked tune; Scatter nudges them off it. Try Taps, Scatter and Feedback for denser or sparser patterns.",
    tags: ["rhythm", "parallel", "sync", "plucks"],
  });
  const m = melody(p, [0, 0], [0, ".", 3, ".", 7, ".", 5, 3], { rate: "1/8", shape: 0.9, root: "G", scale: "Minor Pentatonic",
    env: { decay: 0.15, sustain: 0, release: 0.1 }, gatelength: 0.3 });
  const d = p.add("delay-network", [3, 0], { time: 0.4, taps: 4, scatter: 0.25, jitter: 0, feedback: 0.55, character: 0.15, width: 1, mix: 0.5,
    routing: "Parallel", sync: "1/8." });
  p.cable(m.amp, "l", d, "l").cable(m.amp, "l", d, "r").stereo(d, p.out);
  return p;
}

function reverseMesh() {
  const p = patch("Delay Net: Reverse Mesh", {
    module: "delay-network", tempo: 84,
    description: "In Mesh routing every line feeds every other, and Reverse plays part of the echoes backwards, so each note blooms into swelling, reversed clouds. Raise Jitter to blur the timing further; Time Change decides if time moves bend the pitch.",
    tags: ["reverse", "mesh", "swell", "texture"],
  });
  const m = melody(p, [0, 0], [0, 4, ".", 7, ".", 9, ".", 4], { rate: "1/8", shape: 0.6, root: "A", scale: "Dorian",
    env: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 0.3 } });
  const d = p.add("delay-network", [3, 0], { time: 1.2, taps: 8, scatter: -0.4, jitter: 0.3, reverse: 0.5, feedback: 0.4, character: 0.25,
    tone: 0.1, width: 1, mix: 0.25, routing: "Mesh", timechange: "Tape" });
  const lfo = p.add("lfo", [2, 1], { rate: 0.06, wave: "Triangle" }, { name: "Time Drift" });
  const trim = p.add("audio-mixer", [4, 0], { level1: -3, pan1: -1, level2: -3, pan2: 1, master: 3 }, { name: "Trim" });
  p.cable(m.amp, "l", d, "l").cable(m.amp, "l", d, "r").cable(lfo, "out", d, "time", 0.08)
    .cable(d, "l", trim, "in1l").cable(d, "r", trim, "in2l").stereo(trim, p.out, { from: ["outl", "outr"] });
  return p;
}

function drumEchoes() {
  const p = patch("Delay Net: Drum Echoes", {
    module: "delay-network", tempo: 96,
    description: "A drum beat goes through a Chain of lines locked to the tempo; Jitter and Scatter make the repeats a loose, dubby shadow of the groove. Pull Mix down for a subtle effect or up for a wall of echoes.",
    tags: ["drums", "dub", "chain", "echo"],
  });
  const mix = beat(p, [0, 0], { style: "half", level: -4 });
  const d = p.add("delay-network", [3, 0], { time: 0.5, taps: 3, scatter: 0.3, jitter: 0.2, feedback: 0.6, character: 0.45, tone: -0.3,
    mix: 0.4, routing: "Chain", sync: "1/8." });
  p.cable(mix, "outl", d, "l").cable(mix, "outr", d, "r").stereo(d, p.out);
  return p;
}

function freezeDrone() {
  const p = patch("Delay Net: Overdriven Loop", {
    module: "delay-network", tempo: 60,
    description: "Feedback is almost at its limit, so the network sustains into a self-holding drone around a sparse bass line; a slow LFO on Character shifts it from clean to gritty. Lower Feedback to hear it settle, or push it past 100 %.",
    tags: ["drone", "feedback", "character", "freeze"],
  });
  const m = melody(p, [0, 0], [0, ".", ".", ".", 7, ".", ".", "."], { rate: "1/4", shape: 0.3, root: "C", scale: "Natural Minor", octave: -1,
    env: { attack: 0.05, decay: 0.8, sustain: 0.3, release: 0.8 } });
  const d = p.add("delay-network", [3, 0], { time: 0.35, taps: 5, scatter: 0.2, jitter: 0.1, feedback: 0.93, character: 0.5, tone: -0.15,
    width: 0.8, mix: 0.35, routing: "Ring" });
  const lfo = p.add("lfo", [2, 1], { rate: 0.04, wave: "Triangle" }, { name: "Grit" });
  p.cable(m.amp, "l", d, "l").cable(m.amp, "l", d, "r").stereo(d, p.out).cable(lfo, "out", d, "character", 0.4);
  return p;
}

export default [ringPad, rhythmicParallel, reverseMesh, drumEchoes, freezeDrone];
