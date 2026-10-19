// SPDX-License-Identifier: MIT
// Automata: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

const oct = (n) => (n > 0 ? "+" : "") + n;
/// Oscillator -> ADSR -> VCA (optional filter), played by a pitch jack and a gate jack: [node, jack] pairs.
function voice(p, at, pitch, gate, o = {}) {
  const [c, r] = at, name = o.name || "Voice";
  const osc = p.add("oscillator", [c, r], { shape: o.shape ?? 0.6, octave: oct(o.octave ?? 0), ...(o.osc || {}) }, { name });
  const env = p.add("adsr", [c, r + 1], { attack: 0.004, decay: 0.3, sustain: 0, release: 0.2, ...(o.env || {}) }, { name: `${name} Env` });
  const amp = p.add("vca", [c + 1, r], {}, { name: `${name} VCA` });
  if (pitch) p.cable(pitch[0], pitch[1], osc, "pitch");
  p.cable(gate[0], gate[1], env, "gate").cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  if (!o.filter) return { osc, env, amp, out: amp, jack: "l" };
  const filter = p.add("filter", [c + 2, r], o.filter, { name: `${name} Filter` });
  p.cable(amp, "l", filter, "l");
  return { osc, env, amp, filter, out: filter, jack: "l" };
}
/// Mono jack to both sides of a stereo input pair.
const both = (p, from, jack, to, l = "l", r = "r") => p.cable(from, jack, to, l).cable(from, jack, to, r);
/// A reverb after a stereo mixer (outl/outr) and then the patch output.
function finish(p, mixer, at, verb = {}) {
  const v = p.add("reverb", at, { size: 0.4, decay: 1.4, mix: 0.15, ...verb });
  p.stereo(mixer, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

function ringMelody() {
  const p = patch("Automata: Ring Melody", {
    module: "automata", tempo: 108,
    description: "A ring of sixteen cells grows under rule 30 from a single seed cell; the read head sweeps round the ring, so the lit cells become notes and the dark ones rests. Change Rule (90 mirrors itself, 110 drifts) or raise Interference to nudge the pattern off its course; Reset returns to the seed.",
    tags: ["cellular", "ring", "melody", "generative"],
  });
  const am = p.add("automata", [0, 0], { mode: "Ring", rule: 30, cells: 16, density: 0, sync: "1/16", root: "D", scale: "Minor Pentatonic", octaves: 2, seed: 5, gatelength: 0.55, interference: 0.08 });
  const lead = voice(p, [2, 0], [am, "pitch"], [am, "gate"], { name: "Lead", shape: 0.4, env: { decay: 0.25, sustain: 0.05, release: 0.2 }, filter: { cutoff: 2600, resonance: 0.2 } });
  const drums = beat(p, [2, 3], { style: "half", level: -6 });
  const fin = p.add("audio-mixer", [5, 0], { level1: 0, level2: -1, pan1: 0.15, master: 0 }, { name: "Final" });
  both(p, lead.out, "l", fin, "in1l", "in1r");
  p.stereo(drums, fin, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  finish(p, fin, [6, 0], { size: 0.45, decay: 1.8, mix: 0.2 });
  return p;
}

function gridGarden() {
  const p = patch("Automata: Grid Garden", {
    module: "automata", tempo: 96,
    description: "An 8 by 8 wrapping world: colonies grow, collide and die. Gate and Pitch play a bell-like lead, every birth of a cell triggers a soft hat, and Density, how alive the grid is, opens a filter. Try the other Grid Rule choices, or raise Density for a crowded start.",
    tags: ["life", "grid", "birth", "density"],
  });
  const am = p.add("automata", [0, 0], { mode: "Grid", gridrule: "B3/S23", density: 0.35, sync: "1/16", root: "A", scale: "Lydian", octaves: 2, seed: 12, gatelength: 0.4 });
  const lead = voice(p, [2, 0], [am, "pitch"], [am, "gate"], { name: "Bells", shape: 0.15, env: { decay: 0.5, sustain: 0, release: 0.4 }, filter: { cutoff: 900, resonance: 0.25 } });
  p.cable(am, "density", lead.filter, "cutoff", 0.7);
  const hats = p.add("punch-hats", [2, 3], { level: 0.35, closed: 0.03 });
  p.cable(am, "birth", hats, "closed");
  const mix = p.add("audio-mixer", [5, 0], { level1: 0, level2: -9, master: -2 }, { name: "Mix" });
  both(p, lead.out, "l", mix, "in1l", "in1r");
  both(p, hats, "out", mix, "in2l", "in2r");
  finish(p, mix, [6, 0], { size: 0.55, decay: 2.4, mix: 0.3 });
  return p;
}

function learningChain() {
  const p = patch("Automata: Chain Learns a Tune", {
    module: "automata", tempo: 104,
    description: "A frozen eight-note loop plays on the left and is patched into the chain's Learn input; the chain on the right listens, adds the moves it hears to its transition table and improvises in the same style. Turn Learn down to hear the plain, stepwise table, or open the module to edit the table by hand.",
    tags: ["markov", "learn", "improvise", "chain"],
  });
  const src = p.add("shift-register", [0, 0], { lock: 1, length: 8, sync: "1/8", octaves: 2, root: "E", scale: "Minor Pentatonic", seed: 21, gatelength: 0.5 }, { name: "Teacher" });
  const am = p.add("automata", [0, 3], { mode: "Chain", learn: 0.8, sync: "1/8", root: "E", scale: "Minor Pentatonic", octaves: 2, seed: 4, gatelength: 0.7 }, { name: "Student" });
  p.cable(src, "pitch", am, "learn");
  const teach = voice(p, [2, 0], [src, "pitch"], [src, "bit1"], { name: "Teacher", shape: 0.7, octave: -1, env: { decay: 0.3, sustain: 0.1, release: 0.25 }, filter: { cutoff: 1500, resonance: 0.1 } });
  const stud = voice(p, [2, 3], [am, "pitch"], [am, "gate"], { name: "Student", shape: 0.3, env: { decay: 0.35, sustain: 0.15, release: 0.3 }, filter: { cutoff: 3200, resonance: 0.2 } });
  const fin = p.add("audio-mixer", [5, 0], { level1: -3, level2: -1, pan1: -0.3, pan2: 0.3, master: 0 }, { name: "Final" });
  both(p, teach.out, "l", fin, "in1l", "in1r");
  both(p, stud.out, "l", fin, "in2l", "in2r");
  finish(p, fin, [6, 0], { size: 0.4, decay: 1.6, mix: 0.2 });
  return p;
}

function walkerRhythm() {
  const p = patch("Automata: Walker Drums", {
    module: "automata", tempo: 118,
    description: "A walker with four turn rules roams an 8 by 8 wrapping grid; it plays a note whenever it steps onto a marked cell and fires Birth when it lays a fresh mark. Gate drives a bass, Birth drives hats and a snare, and the walker's route repeats until Interference nudges it somewhere new.",
    tags: ["walker", "ant", "rhythm", "bass"],
  });
  const am = p.add("automata", [0, 0], { mode: "Walker", turns: "RLLR", density: 0.45, sync: "1/16", root: "G", scale: "Phrygian", octaves: 2, seed: 9, gatelength: 0.45, interference: 0.04 });
  const bass = voice(p, [2, 0], [am, "pitch"], [am, "gate"], { name: "Bass", shape: 0.85, octave: -2, env: { decay: 0.2, sustain: 0.4, release: 0.15 }, filter: { cutoff: 700, resonance: 0.3 } });
  const hats = p.add("punch-hats", [2, 3], { level: 0.4, closed: 0.03 });
  const snare = p.add("punch-snare", [2, 4], { level: 0.5 });
  const kick = p.add("punch-kick", [3, 3], { level: 0.8, decay: 0.4 });
  p.cable(am, "birth", hats, "closed").cable(am, "step", kick, "trig");
  const div = p.add("clock-divider", [1, 3], { div1: 4 }, { name: "Backbeat" });
  p.cable(am, "step", div, "clock");
  p.cable(div, "out1", snare, "trig");
  const mix = p.add("audio-mixer", [5, 0], { level1: -2, level2: -10, level3: -8, level4: -9, master: 0 }, { name: "Mix" });
  both(p, bass.out, "l", mix, "in1l", "in1r");
  both(p, hats, "out", mix, "in2l", "in2r");
  both(p, snare, "out", mix, "in3l", "in3r");
  both(p, kick, "out", mix, "in4l", "in4r");
  finish(p, mix, [6, 0], { size: 0.3, decay: 1.0, mix: 0.12 });
  return p;
}

function rewriteRewind() {
  const p = patch("Automata: Rewrite and Rewind", {
    module: "automata", tempo: 90,
    description: "A phrase rewrites itself each time it ends, growing longer and then starting over. A slow square LFO patched into Rewind pulls the system four generations back every few seconds, so the phrase keeps returning to something it has played, but never exactly the same way. Change Rewind By or the Rules choice.",
    tags: ["rewrite", "rewind", "phrase", "evolving"],
  });
  const am = p.add("automata", [0, 0], { mode: "Rewrite", rules: "Climb", sync: "1/16", root: "C", scale: "Dorian", octaves: 2, seed: 33, gatelength: 0.6, interference: 0.25, rewindby: 6 });
  const lfo = p.add("lfo", [0, 3], { wave: "Square", rate: 0.22, polarity: "Unipolar" }, { name: "Rewinder" });
  p.cable(lfo, "out", am, "rewind");
  const lead = voice(p, [2, 0], [am, "pitch"], [am, "gate"], { name: "Pluck", shape: 0.5, env: { decay: 0.3, sustain: 0.1, release: 0.3 }, filter: { cutoff: 2200, resonance: 0.3 } });
  const pad = p.add("oscillator", [2, 3], { shape: 0.2, octave: "-1" }, { name: "Drone" });
  const padAmp = p.add("vca", [3, 3], { gain: 0.25 }, { name: "Drone Level" });
  p.cable(pad, "out", padAmp, "l");
  const mix = p.add("audio-mixer", [5, 0], { level1: -1, level2: -14, master: 0 }, { name: "Mix" });
  both(p, lead.out, "l", mix, "in1l", "in1r");
  both(p, padAmp, "l", mix, "in2l", "in2r");
  const dly = p.add("delay", [6, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/4", feedback: 0.4, mix: 0.25, highcut: 6000 });
  p.stereo(mix, dly, { from: ["outl", "outr"] });
  const v = p.add("reverb", [7, 0], { size: 0.5, decay: 2.2, mix: 0.2 });
  p.stereo(dly, v).stereo(v, p.out);
  return p;
}

export default [ringMelody, gridGarden, learningChain, walkerRhythm, rewriteRewind];
