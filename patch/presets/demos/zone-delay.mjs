// SPDX-License-Identifier: MIT
// Zone Delay: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

// Zone Delay's stereo outs -> a mixer (gain in dB) -> Out 1/2.
function toOut(p, z, at, db) {
  const m = p.add("audio-mixer", at, { level1: db, pan1: -1, level2: db, pan2: 1, master: 0 }, { name: "Output" });
  p.cable(z, "l", m, "in1l").cable(z, "r", m, "in2l").stereo(m, p.out, { from: ["outl", "outr"] });
}

function dubEcho() {
  const p = patch("Zone Delay: Dub Echo", {
    module: "zone-delay", tempo: 90,
    description: "Zone 3 locked to the transport gives a warm dotted echo with a tape Character; Ping-Pong from a slow square LFO flips the repeats between a straight tail and a bouncing one. Ride Feedback and Tone to dub it live.",
    tags: ["dub", "echo", "tape", "ping-pong"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, ".", 3, ".", 5, "."], { rate: "1/8", shape: 0.9, root: "A", scale: "Minor Pentatonic",
    env: { decay: 0.15, sustain: 0, release: 0.1 }, gatelength: 0.3 });
  const z = p.add("zone-delay", [3, 0], { zone: 3, time: 0.62, feedback: 0.6, character: 0.3, tone: -0.2, wobble: 0.2, mix: 0.45, sync: "Transport" });
  const pp = p.add("lfo", [2, 1], { wave: "Square", sync: "2 bars", polarity: "Unipolar" }, { name: "Ping-Pong" });
  p.cable(m.amp, "l", z, "l").cable(m.amp, "l", z, "r").cable(pp, "out", z, "pingpong");
  toOut(p, z, [4, 0], 3);
  return p;
}

function combPluck() {
  const p = patch("Zone Delay: Tuned Combs", {
    module: "zone-delay", tempo: 100,
    description: "In the Comb zone the delay is tuned by the Pitch input, so a sequencer plays a resonant, string-like ring from short noise-free pulses of a saw. Feedback sets how long each note rings; Character shapes its colour.",
    tags: ["comb", "karplus", "pitch", "resonant"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 3, 7, 10, 7], { rate: "1/8", shape: 1, root: "D", scale: "Dorian", octave: 1,
    env: { decay: 0.08, sustain: 0, release: 0.05 }, gatelength: 0.2 });
  const z = p.add("zone-delay", [3, 0], { zone: 1, time: 0.5, feedback: 0.9, character: 0.2, tone: 0.1, wobble: 0.05, mix: 0.45, timechange: "Crossfade" });
  p.cable(m.amp, "l", z, "l").cable(m.amp, "l", z, "r").cable(m.seq, "pitch", z, "pitch");
  toOut(p, z, [4, 0], -3);
  return p;
}

function vastLooper() {
  const p = patch("Zone Delay: Vast Hold Loop", {
    module: "zone-delay", tempo: 80,
    description: "Zone 5 is a multi-bar loop: a Hold gate from an LFO freezes the buffer for a few bars, then releases it, while Reverse flips the held phrase. Change Zone or Time to shorten the loop, or hold it by hand.",
    tags: ["looper", "hold", "reverse", "long"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 4, 9, 7, 4, 2], { rate: "1/8", shape: 0.5, root: "G", scale: "Major Pentatonic",
    env: { decay: 0.3, sustain: 0.1, release: 0.3 } });
  const z = p.add("zone-delay", [3, 0], { zone: 5, time: 0.3, feedback: 0.7, character: 0.3, diffuse: 0.3, wobble: 0.15, mix: 0.6, sync: "Transport" });
  const hold = p.add("lfo", [2, 1], { wave: "Square", sync: "8 bars", polarity: "Unipolar", pw: 0.5, phase: 180 }, { name: "Hold" });
  const rev = p.add("lfo", [2, 2], { wave: "Square", sync: "4 bars", polarity: "Unipolar", pw: 0.3 }, { name: "Reverse" });
  p.cable(m.amp, "l", z, "l").cable(m.amp, "l", z, "r").cable(hold, "out", z, "hold").cable(rev, "out", z, "reverse");
  toOut(p, z, [4, 0], 5);
  return p;
}

function tapeWobble() {
  const p = patch("Zone Delay: Tape Dive", {
    module: "zone-delay", tempo: 78,
    description: "A stepped random source jumps Time around in Tape mode, so every change bends the echoes up or down in pitch like a tape machine being thrown about. Lower Glide for sharper swoops, or switch Time Change to Crossfade for stepped echoes.",
    tags: ["tape", "pitch bend", "random", "wobble"],
  });
  const m = melody(p, [0, 0], [0, ".", 5, ".", 7, ".", 3, "."], { rate: "1/4", shape: 0.5, root: "E", scale: "Natural Minor",
    env: { attack: 0.01, decay: 0.5, sustain: 0.2, release: 0.4 } });
  const z = p.add("zone-delay", [3, 0], { zone: 4, time: 0.4, feedback: 0.7, character: 0.35, tone: -0.1, wobble: 0.5, mix: 0.55,
    timechange: "Tape", glide: 0.4 });
  const rnd = p.add("random", [2, 1], { sync: "1 bar", spread: 0.6, seed: 7 }, { name: "Time Jumps" });
  p.cable(m.amp, "l", z, "l").cable(m.amp, "l", z, "r").cable(rnd, "out", z, "time", 0.25);
  toOut(p, z, [4, 0], 3);
  return p;
}

function diffuseDrums() {
  const p = patch("Zone Delay: Diffuse Cloud", {
    module: "zone-delay", tempo: 112,
    description: "A drum groove runs through a Long-zone delay with full Diffuse and high Feedback: the first echo is clear, then the repeats melt into a reverb-like cloud behind the kit. Reduce Diffuse for distinct repeats, or try Offset for a wider image.",
    tags: ["diffuse", "drums", "cloud", "reverb-like"],
  });
  const mix = beat(p, [0, 0], { style: "four", level: -5 });
  const z = p.add("zone-delay", [3, 0], { zone: 4, time: 0.35, feedback: 0.82, character: 0.5, tone: -0.2, diffuse: 1, offset: 0.12, wobble: 0.3, mix: 0.35 });
  p.cable(mix, "outl", z, "l").cable(mix, "outr", z, "r");
  toOut(p, z, [4, 0], 3);
  return p;
}

export default [dubEcho, combPluck, vastLooper, tapeWobble, diffuseDrums];
