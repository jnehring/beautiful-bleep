// SPDX-License-Identifier: MIT
// Freq Shifter: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

const feed = (p, amp, f) => p.cable(amp, "l", f, "l").cable(amp, "l", f, "r");
function out(p, at, src, trim = 0, jacks = ["l", "r"], master = 0) {
  const t = p.add("audio-mixer", at, { level1: trim, master }, { name: "Trim" });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, p.out, { from: ["outl", "outr"] });
  return t;
}
const pad = (p, notes, o = {}) => melody(p, [0, 0], notes,
  { rate: "1/4", shape: 1, gatelength: 0.98, env: { attack: 0.3, decay: 0.4, sustain: 0.9, release: 1.0 }, ...o });

function risingSweep() {
  const p = patch("Freq Shifter: Endless Rising Sweep", {
    module: "freq-shifter", tempo: 80,
    description: "A saw pad is shifted up by a tiny Fine amount, and strong Feedback sends it round again, so the phasing sweep seems to climb forever. Make Fine negative and it falls forever; raise Mix to hear more of the swirl.",
    tags: ["barber pole", "feedback", "rising", "phasing"],
  });
  const m = pad(p, [0, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_"], { root: "E", scale: "Dorian" });
  const f = p.add("freq-shifter", [3, 0], { shift: 0, fine: 0.4, feedback: 0.7, mix: 0.5, range: "±10 Hz" });
  feed(p, m.amp, f);
  out(p, [4, 0], f, -12);
  return p;
}

function metalBells() {
  const p = patch("Freq Shifter: Pad into Bells", {
    module: "freq-shifter", tempo: 66,
    description: "With Shift raised on the 200 Hz range and Mix at 100 %, the harmonics of a pad move by a fixed number of Hz instead of staying in tune, so it turns into clanging, inharmonic bells. Reduce Shift toward zero to bring the pad back to a normal pitch.",
    tags: ["inharmonic", "bells", "metallic", "ring"],
  });
  const m = pad(p, [0, "_", "_", "_", 7, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_"], { root: "C", scale: "Natural Minor", shape: 0.8 });
  const f = p.add("freq-shifter", [3, 0], { shift: 0.3, mix: 1, range: "±200 Hz", spread: 0.2 });
  feed(p, m.amp, f);
  out(p, [4, 0], f, -6);
  return p;
}

function wideDetune() {
  const p = patch("Freq Shifter: Opposite Shifts Widener", {
    module: "freq-shifter", tempo: 92,
    description: "Spread sends the left channel up and the right channel down by the same few Hz, so a mono riff becomes wide and slowly beating without any delay. Close Spread to hear the plain mono sound again.",
    tags: ["stereo", "spread", "detune", "widening"],
  });
  const m = melody(p, [0, 0], [0, 3, 7, 10, 12, 10, 7, 3, 5, 8, 12, 15, 12, 8, 5, 3],
    { rate: "1/8", shape: 1, root: "G", scale: "Natural Minor", gatelength: 0.8, env: { attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.15 } });
  const f = p.add("freq-shifter", [3, 0], { shift: 0, fine: 3, spread: 1, mix: 0.6, range: "±10 Hz" });
  feed(p, m.amp, f);
  out(p, [4, 0], f, -6);
  return p;
}

function downshiftDrums() {
  const p = patch("Freq Shifter: Robot Drum Downshift", {
    module: "freq-shifter", tempo: 104,
    description: "A broken beat is shifted down a few hundred Hz with some Feedback, so the kick loses its pitch and the snare and hats turn into clanking robot hits. Move Shift through zero and up to hear the effect change character.",
    tags: ["drums", "downshift", "robot", "feedback"],
  });
  const d = beat(p, [0, 0], { style: "broken", level: -6 });
  const f = p.add("freq-shifter", [3, 0], { shift: -0.2, feedback: 0.35, fbDelay: 0.2, mix: 0.6, range: "±2 kHz" });
  p.stereo(d, f, { from: ["outl", "outr"] });
  out(p, [4, 0], f, 1);
  return p;
}

function quadratureLfo() {
  const p = patch("Freq Shifter: Quadrature Wobble", {
    module: "freq-shifter", tempo: 110,
    description: "The Shifter's own Sin output, a control signal that runs at the shift rate, opens and closes a filter on the same riff, so the phasing and the filter wobble stay locked together. Change Fine to speed up or slow down both.",
    tags: ["sin output", "modulation", "filter", "quadrature"],
  });
  const m = melody(p, [0, 0], [0, 0, 7, 0, 10, 0, 12, 10, 0, 0, 7, 0, 5, 3, 5, 7],
    { rate: "1/8", shape: 1, root: "A", scale: "Minor Pentatonic", gatelength: 0.7, env: { attack: 0.003, decay: 0.2, sustain: 0.7, release: 0.1 } });
  const f = p.add("freq-shifter", [3, 0], { shift: 0, fine: 2.5, feedback: 0.3, mix: 0.5, range: "±10 Hz" });
  const flt = p.add("filter", [4, 0], { cutoff: 1100, resonance: 0.4 });
  feed(p, m.amp, f);
  p.stereo(f, flt).cable(f, "sin", flt, "cutoff", 0.5);
  out(p, [5, 0], flt, -8);
  return p;
}

export default [risingSweep, metalBells, wideDetune, downshiftDrums, quadratureLfo];
