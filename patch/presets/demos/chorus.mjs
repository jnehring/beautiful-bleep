// SPDX-License-Identifier: MIT
// Chorus: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

const feed = (p, amp, f) => p.cable(amp, "l", f, "l").cable(amp, "l", f, "r");
function out(p, at, src, trim = 0, jacks = ["l", "r"], master = 0) {
  const t = p.add("audio-mixer", at, { level1: trim, master }, { name: "Trim" });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, p.out, { from: ["outl", "outr"] });
  return t;
}

function lushPad() {
  const p = patch("Chorus: Lush Pad", {
    module: "chorus", tempo: 76,
    description: "A mono saw pad is turned into a wide, slowly shimmering ensemble by the Chorus: slow Rate, plenty of Depth and full Spread. Raise Rate for a faster wobble or lower Spread to hear the stereo image collapse.",
    tags: ["pad", "ensemble", "wide", "stereo"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 7, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_"],
    { rate: "1/4", shape: 1, root: "A", scale: "Dorian", gatelength: 0.98, env: { attack: 0.4, decay: 0.4, sustain: 0.9, release: 1.0 } });
  const c = p.add("chorus", [3, 0], { rate: 0.4, depth: 0.65, delay: 12, spread: 1, mode: "Chorus", mix: 0.55 });
  feed(p, m.amp, c);
  out(p, [4, 0], c, -6);
  return p;
}

function jetFlanger() {
  const p = patch("Chorus: Jet Flanger", {
    module: "chorus", tempo: 120,
    description: "In Flanger mode with strong Feedback and a short Delay, a beat and a hat-heavy groove get a slow jet-engine sweep through every sound. Lower Feedback for a mild swirl or raise Depth for a wider sweep.",
    tags: ["flanger", "feedback", "drums", "sweep"],
  });
  const d = beat(p, [0, 0], { style: "four", level: -6 });
  const c = p.add("chorus", [3, 0], { rate: 0.15, depth: 0.7, delay: 3, feedback: 0.7, spread: 0.6, mode: "Flanger", mix: 0.5 });
  p.stereo(d, c, { from: ["outl", "outr"] });
  out(p, [4, 0], c, 3);
  return p;
}

function pluckEnsemble() {
  const p = patch("Chorus: Detuned Pluck Ensemble", {
    module: "chorus", tempo: 100,
    description: "A bright pluck melody gets a gentle Chorus with a short Delay and small Depth: it thickens like a doubled instrument without obvious wobble. Increase Depth to push it toward a seasick vibrato.",
    tags: ["pluck", "doubling", "subtle", "thickening"],
  });
  const m = melody(p, [0, 0], [0, 3, 7, 12, 10, 7, 3, 7, 5, 8, 12, 10, 8, 5, 3, "."],
    { rate: "1/8", shape: 0.8, root: "D", scale: "Natural Minor", gatelength: 0.6, env: { attack: 0.003, decay: 0.5, sustain: 0.3, release: 0.3 } });
  const c = p.add("chorus", [3, 0], { rate: 0.9, depth: 0.3, delay: 7, spread: 0.8, mode: "Chorus", mix: 0.5 });
  feed(p, m.amp, c);
  out(p, [4, 0], c, 3, ["l", "r"], 3);
  return p;
}

function tapeVibrato() {
  const p = patch("Chorus: Wobbly Vibrato", {
    module: "chorus", tempo: 88,
    description: "With Mix at 100 % only the moving delay is heard, which wobbles the pitch like a warped tape: a fast Rate gives vibrato, a slow one a seasick drift. Lower Mix to blend the dry sound back in as a chorus.",
    tags: ["vibrato", "pitch wobble", "tape", "100% wet"],
  });
  const m = melody(p, [0, 0], [0, "_", 7, "_", 5, "_", 3, "_", 7, "_", 10, "_", 12, "_", 7, "_"],
    { rate: "1/4", shape: 0.3, root: "C", scale: "Major Pentatonic", gatelength: 0.9, env: { attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.4 } });
  const c = p.add("chorus", [3, 0], { rate: 4.8, depth: 0.35, delay: 6, spread: 0.3, mode: "Chorus", mix: 1 });
  feed(p, m.amp, c);
  out(p, [4, 0], c, -1);
  return p;
}

function metalComb() {
  const p = patch("Chorus: Metallic Comb Sweep", {
    module: "chorus", tempo: 90,
    description: "A flanger with negative Feedback hollows out a sustained saw, and an LFO slowly moves its Delay, so the tone sweeps through metallic, hollow resonances. Flip Feedback positive for a brighter, ringing comb.",
    tags: ["flanger", "negative feedback", "delay modulation", "comb filter"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 5, "_", "_", "_", 7, "_", "_", "_", 3, "_", "_", "_"],
    { rate: "1/4", shape: 1, root: "E", scale: "Minor Pentatonic", gatelength: 0.98, env: { attack: 0.1, decay: 0.3, sustain: 0.9, release: 0.5 } });
  const l = p.add("lfo", [2, 2], { wave: "Triangle", sync: "Tempo", division: "2 bars", polarity: "Unipolar" }, { name: "Delay Sweep" });
  const c = p.add("chorus", [3, 0], { rate: 0.05, depth: 0.1, delay: 4, feedback: -0.75, spread: 0.5, mode: "Flanger", mix: 0.6 });
  feed(p, m.amp, c);
  p.cable(l, "out", c, "delay", 0.5);
  out(p, [4, 0], c, -13);
  return p;
}

export default [lushPad, jetFlanger, pluckEnsemble, tapeVibrato, metalComb];
