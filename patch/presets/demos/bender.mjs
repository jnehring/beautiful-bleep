// SPDX-License-Identifier: MIT
// Bender: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mixer of a drum beat (stereo) and a mono melody; returns the mixer (outl/outr).
function band(p, at, drums, m, lv = [-2, -6]) {
  const mix = p.add("audio-mixer", at, { level1: lv[0], level2: lv[1], master: -1 }, { name: "Source Mix" });
  p.stereo(drums, mix, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).cable(m.amp, "l", mix, "in2l").cable(m.amp, "l", mix, "in2r");
  return mix;
}
/// Source (stereo jacks) → trim mixer → reverb → Out.
function finish(p, at, src, trim = 0, verb = {}, jacks = ["l", "r"], master = 0) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.2, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}
const into = (p, mix, b) => p.stereo(mix, b, { from: ["outl", "outr"] });

function stutterBeat() {
  const p = patch("Bender: Stutter Beat", {
    module: "bender", tempo: 120,
    description: "A drum loop and riff pass through Bender at 1/16 with a low Chance: now and then a slice repeats twice and stutters before the groove carries on. Raise Chance for more, or Repeats for longer stutters.",
    tags: ["stutter", "beat", "repeat", "glitch"],
  });
  const drums = beat(p, [0, 0], { style: "four", level: -5 });
  const m = melody(p, [0, 3], [0, 0, 7, ".", 5, 3, ".", 0], { rate: "1/8", shape: 0.5, root: "A", scale: "Minor Pentatonic", octave: -1 });
  const mix = band(p, [3, 0], drums, m);
  const b = p.add("bender", [4, 0], { chance: 0.22, repeats: 3, bend: 1, mix: 1, sync: "1/16", mode: "Crush", seed: 4 });
  into(p, mix, b);
  finish(p, [5, 0], b, 4, { size: 0.3, decay: 1.2, mix: 0.1 });
  return p;
}

function ratchetArp() {
  const p = patch("Bender: Ratchet Arp", {
    module: "bender", tempo: 100,
    description: "An arpeggio goes through Bender at 1/8 with Slice at 40 %: repeated fragments cut into ratchets while Chance picks which beats get them. Change Seed to hear another set of decisions.",
    tags: ["ratchet", "arpeggio", "slice", "rhythm"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 12, 7, 4, 9, 5], { rate: "1/8", shape: 0.8, root: "D", scale: "Major Pentatonic", gatelength: 0.5, env: { decay: 0.25, sustain: 0.2, release: 0.2 } });
  const b = p.add("bender", [3, 0], { chance: 0.35, repeats: 2, slice: 0.4, bend: 1, mix: 1, sync: "1/8", mode: "Crush", seed: 11 });
  p.cable(m.amp, "l", b, "l").cable(m.amp, "l", b, "r");
  finish(p, [4, 0], b, 6, { size: 0.45, decay: 2, mix: 0.25 }, ["l", "r"], 6);
  return p;
}

function tapeStopPad() {
  const p = patch("Bender: Tape-Stop Pad", {
    module: "bender", tempo: 72,
    description: "A slow chord pad is re-pitched downward in Smear mode with Bend at one half and some Bend Var: pieces of the sound sag and slur like a tape machine losing speed. Try Bend Steps on Free for a continuous slide.",
    tags: ["tape stop", "pitch", "smear", "pad"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 4, "_", "_", "_", 7, "_", "_", "_", 5, "_", "_", "_"], { rate: "1/4", shape: 0.9, root: "G", scale: "Major Pentatonic", gatelength: 0.97, env: { attack: 0.3, decay: 0.4, sustain: 0.9, release: 1 } });
  const b = p.add("bender", [3, 0], { time: 0.4, chance: 0.5, repeats: 1, bend: 0.5, bendvar: 0.5, mix: 1, sync: "1/2", mode: "Smear", bendsteps: "Octaves", seed: 3 });
  p.cable(m.amp, "l", b, "l").cable(m.amp, "l", b, "r");
  finish(p, [4, 0], b, -9, { size: 0.65, decay: 4, mix: 0.35 });
  return p;
}

function shredder() {
  const p = patch("Bender: Shredder", {
    module: "bender", tempo: 132,
    description: "Mode Shuffle with Chance at 70 %, Corrupt at 80 % and a little Slice cuts a beat and bass line into constantly rearranged, crumbling pieces. Pull Chance down to keep the groove, or try Fold and Dropout modes.",
    tags: ["shuffle", "corrupt", "breakcore", "chaotic"],
  });
  const drums = beat(p, [0, 0], { style: "broken", level: -5 });
  const m = melody(p, [0, 3], [0, 0, 3, 0, 7, 5, 0, 10], { rate: "1/16", shape: 1, root: "F", scale: "Phrygian Dominant", octave: -1, gatelength: 0.4 });
  const mix = band(p, [3, 0], drums, m, [-2, -8]);
  const b = p.add("bender", [4, 0], { chance: 0.7, repeats: 4, slice: 0.3, corrupt: 0.8, bend: 1, bendvar: 0.4, mix: 1, sync: "1/16", mode: "Shuffle", corruptwhen: "Glitches only", seed: 21 });
  into(p, mix, b);
  finish(p, [5, 0], b, 0, { size: 0.3, decay: 1.2, mix: 0.1 });
  return p;
}

function glitchOnDemand() {
  const p = patch("Bender: Glitch Triggers", {
    module: "bender", tempo: 96,
    description: "Chance is zero, so Bender stays clean until a sequencer's trigger hits the Glitch input: only those steps are Folded, and the Random output jumps a filter's cutoff along with each decision. Change the sequencer steps to move the glitches.",
    tags: ["trigger", "glitch input", "fold", "random output"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 3, 7, 10, 7], { rate: "1/8", shape: 0.9, root: "E", scale: "Natural Minor", gatelength: 0.5, env: { decay: 0.3, sustain: 0.3, release: 0.3 } });
  const trg = p.add("step-sequencer", [0, 2], { length: 16, rate: "1/16", root: "C", scale: "Chromatic", gatelength: 0.3 },
    { data: steps([".", ".", ".", 0, ".", ".", ".", ".", ".", 0, ".", ".", 0, ".", ".", "."]) });
  const b = p.add("bender", [2, 0], { chance: 0, repeats: 3, corrupt: 0.5, bend: 1, slice: 0.2, mix: 1, sync: "1/16", mode: "Fold", seed: 8 });
  const f = p.add("filter", [3, 0], { cutoff: 2500, resonance: 0.3 });
  p.cable(m.amp, "l", b, "l").cable(m.amp, "l", b, "r").cable(trg, "trigger", b, "glitch").stereo(b, f).cable(b, "random", f, "cutoff", 0.3);
  finish(p, [4, 0], f, -10, { size: 0.5, decay: 2.5, mix: 0.25 });
  return p;
}

export default [stutterBeat, ratchetArp, tapeStopPad, shredder, glitchOnDemand];
