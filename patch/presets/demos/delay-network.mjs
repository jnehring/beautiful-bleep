// SPDX-License-Identifier: MIT
// Delay Net: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody } from "../demo-kit.mjs";

// Mono source into both inputs of an effect, through a gain stage (dB) so the demo sits at a sensible level.
const mono = (p, from, to, db = 0) => {
  const g = p.add("audio-mixer", [2, 2], { level1: Math.min(db, 6), master: db > 6 ? db - 6 : 0 }, { name: "Level" });
  p.cable(from, "l", g, "in1l").cable(g, "outl", to, "l").cable(g, "outl", to, "r");
};

function ringCloud() {
  const p = patch("Delay Net: Ring Cloud", {
    module: "delay-network", tempo: 76,
    description: "Six taps pass the signal round a ring, so a sparse melody dissolves into a drifting cloud of repeats. Try Taps, Scatter and Character, or switch Routing to Parallel to hear the ring unravel.",
    tags: ["ring", "ambient", "cloud", "feedback"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, ".", ".", 4, ".", "."], { rate: "1/4", shape: 0.4, root: "E", scale: "Major Pentatonic",
    env: { attack: 0.02, decay: 0.5, sustain: 0.1, release: 0.5 } });
  const d = p.add("delay-network", [3, 0], { routing: "Ring", time: 0.45, taps: 6, scatter: 0.4, feedback: 0.6, character: 0.3, tone: -0.2, width: 0.9, mix: 0.55 });
  mono(p, m.amp, d, 3); p.stereo(d, p.out);
  return p;
}

function parallelTaps() {
  const p = patch("Delay Net: Parallel Rhythm Taps", {
    module: "delay-network", tempo: 108,
    description: "In Parallel routing each tap is a separate echo, locked to a dotted eighth so the taps spread into a rhythm around a bright pluck. Change Sync, Scatter or Taps to re-space the pattern.",
    tags: ["parallel", "tempo sync", "rhythm", "plucks"],
  });
  const m = melody(p, [0, 0], [0, ".", ".", 7, ".", ".", 5, "."], { rate: "1/8", shape: 0.9, root: "C", scale: "Minor Pentatonic",
    env: { decay: 0.12, sustain: 0, release: 0.1 }, gatelength: 0.3 });
  const d = p.add("delay-network", [3, 0], { routing: "Parallel", sync: "1/8.", taps: 4, scatter: 0.5, feedback: 0.25, character: 0.1, width: 1, mix: 0.5 });
  mono(p, m.amp, d, 8); p.stereo(d, p.out);
  return p;
}

function reverseTide() {
  const p = patch("Delay Net: Reverse Tide", {
    module: "delay-network", tempo: 70,
    description: "Chain routing with a large Reverse amount turns the repeats backwards, so every note swells in before it arrives. Lower Reverse for normal echoes, or raise Jitter to blur the swells.",
    tags: ["reverse", "chain", "swell", "ambient"],
  });
  const m = melody(p, [0, 0], [0, ".", ".", ".", 5, ".", ".", ".", 3, ".", ".", ".", 7, ".", ".", "."], { rate: "1/8", shape: 0.3, root: "A",
    scale: "Natural Minor", env: { attack: 0.01, decay: 0.4, sustain: 0.1, release: 0.4 } });
  const d = p.add("delay-network", [3, 0], { routing: "Chain", time: 0.9, taps: 4, reverse: 0.7, feedback: 0.5, character: 0.25, jitter: 0.15, mix: 0.6 });
  mono(p, m.amp, d, 6); p.stereo(d, p.out);
  return p;
}

function meshSwarm() {
  const p = patch("Delay Net: Mesh Swarm", {
    module: "delay-network", tempo: 92,
    description: "Mesh routing lets every line feed every other, and a slow LFO sweeps Scatter so the swarm of repeats keeps rearranging itself. Try more Jitter and Character for a rougher texture, or less Feedback to calm it.",
    tags: ["mesh", "swarm", "evolving", "texture"],
  });
  const m = melody(p, [0, 0], [0, 7, 3, ".", 10, ".", 5, "."], { rate: "1/8", shape: 0.75, root: "D", scale: "Dorian",
    env: { decay: 0.14, sustain: 0, release: 0.1 }, gatelength: 0.3 });
  const d = p.add("delay-network", [3, 0], { routing: "Mesh", time: 0.25, taps: 8, scatter: 0.2, jitter: 0.4, feedback: 0.7, character: 0.45, tone: 0.1, mix: 0.5 });
  const l = p.add("lfo", [2, 1], { rate: 0.07, wave: "Triangle" }, { name: "Scatter LFO" });
  mono(p, m.amp, d, 6); p.stereo(d, p.out); p.cable(l, "out", d, "scatter", 0.6);
  return p;
}

function frozenMoment() {
  const p = patch("Delay Net: Frozen Moment", {
    module: "delay-network", tempo: 80,
    description: "A square LFO closes the Freeze gate every few bars, trapping the network's contents as a sustained wash while the melody carries on over it. Change the LFO's Sync, or latch the gate with your own control.",
    tags: ["freeze", "hold", "pad", "ambient"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 11, 9, 7, 4, 2], { rate: "1/8", shape: 0.5, root: "F", scale: "Major Pentatonic",
    env: { decay: 0.35, sustain: 0.1, release: 0.3 } });
  const d = p.add("delay-network", [3, 0], { routing: "Ring", sync: "1/4", taps: 5, scatter: 0.3, feedback: 0.8, character: 0.2, width: 1, mix: 0.6 });
  const hold = p.add("lfo", [2, 1], { wave: "Square", sync: "4 bars", polarity: "Unipolar", phase: 180 }, { name: "Freeze Gate" });
  mono(p, m.amp, d, -3); p.stereo(d, p.out); p.cable(hold, "out", d, "freeze");
  return p;
}

export default [ringCloud, parallelTaps, reverseTide, meshSwarm, frozenMoment];
