// SPDX-License-Identifier: MIT
// Bender: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

// Mono source into both inputs of an effect, through a gain stage (dB, up to +12) so the demo sits at a sensible level.
const mono = (p, from, jack, to, db = 0) => {
  const g = p.add("audio-mixer", [2, 2], { level1: Math.min(db, 6), master: db > 6 ? db - 6 : 0 }, { name: "Level" });
  p.cable(from, jack, g, "in1l").cable(g, "outl", to, "l").cable(g, "outl", to, "r");
};

function beatCrusher() {
  const p = patch("Bender: Beat Crusher", {
    module: "bender", tempo: 110,
    description: "Crush mode grabs sixteenth-note pieces of a drum loop and repeats them, with pitch steps by octave and a little corruption. Raise Chance for a busier mess, or lower Repeats for a gentler stutter.",
    tags: ["glitch", "drums", "stutter", "crush"],
  });
  const mix = beat(p, [0, 0], { style: "four", level: -6 });
  const b = p.add("bender", [3, 0], { mode: "Crush", sync: "1/16", chance: 0.4, repeats: 4, bend: 1, bendvar: 0.3, corrupt: 0.25, edge: 0.7, mix: 1, seed: 7 });
  mono(p, mix, "outl", b, 6); p.stereo(b, p.out);
  return p;
}

function dropoutMelody() {
  const p = patch("Bender: Dropout Tune", {
    module: "bender", tempo: 96,
    description: "Dropout mode punches holes into an arpeggio, as if the signal kept losing contact. Move Chance for more or fewer gaps, Time for the length of each hole, and try another Seed.",
    tags: ["dropout", "melody", "gaps", "broken"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 3, 7, 10, 7], { rate: "1/8", shape: 0.6, root: "A", scale: "Minor Pentatonic",
    env: { decay: 0.3, sustain: 0.5, release: 0.2 }, gatelength: 0.8 });
  const b = p.add("bender", [3, 0], { mode: "Dropout", sync: "1/16", chance: 0.5, repeats: 2, edge: 0.4, mix: 1, seed: 21 });
  mono(p, m.amp, "l", b, 1); p.stereo(b, p.out);
  return p;
}

function fifthsFall() {
  const p = patch("Bender: Fifths and Octaves", {
    module: "bender", tempo: 84,
    description: "Fold mode with Bend steps set to Fifths + octaves repeats short pieces of a slow melody a fifth or an octave away, so the glitches stay musical. Switch Bend Steps to Free for wild slides, or raise Bend Var.",
    tags: ["pitch", "bend", "harmonic", "glitch"],
  });
  const m = melody(p, [0, 0], [0, "_", 7, "_", 4, "_", 9, "_"], { rate: "1/8", shape: 0.5, root: "D", scale: "Major Pentatonic",
    env: { attack: 0.01, decay: 0.4, sustain: 0.6, release: 0.3 }, gatelength: 0.9 });
  const b = p.add("bender", [3, 0], { mode: "Fold", sync: "1/8", chance: 0.45, repeats: 3, bend: 1, bendvar: 0.6, bendsteps: "Fifths + octaves", edge: 0.8, mix: 0.9, seed: 3 });
  mono(p, m.amp, "l", b, -3); p.stereo(b, p.out);
  return p;
}

function shuffleSlicer() {
  const p = patch("Bender: Shuffle Slicer", {
    module: "bender", tempo: 100,
    description: "Shuffle mode with Slice cuts a swung beat into small pieces and reorders them, so the groove is always almost the same and never quite. Turn Slice down for longer chunks, or Chance up for more reshuffling.",
    tags: ["shuffle", "slice", "drums", "rearrange"],
  });
  const mix = beat(p, [0, 0], { style: "shuffle", level: -6 });
  const b = p.add("bender", [3, 0], { mode: "Shuffle", sync: "1/8", chance: 0.55, repeats: 2, slice: 0.65, corrupt: 0.1, mix: 1, seed: 12 });
  mono(p, mix, "outl", b, 8); p.stereo(b, p.out);
  return p;
}

function smearFreeze() {
  const p = patch("Bender: Smear and Freeze", {
    module: "bender", tempo: 76,
    description: "Smear mode melts a chord arpeggio together while a square LFO holds Freeze for a bar at a time, looping one grain until the gate lets go. Try the LFO's rate, or latch Freeze on and off by hand.",
    tags: ["smear", "freeze", "ambient", "texture"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 11, 7, 4, 2, 4], { rate: "1/8", shape: 0.5, root: "E", scale: "Dorian",
    env: { decay: 0.4, sustain: 0.4, release: 0.3 }, gatelength: 0.8 });
  const b = p.add("bender", [3, 0], { mode: "Smear", sync: "1/4", time: 0.2, chance: 0.5, repeats: 6, corrupt: 0.3, corruptwhen: "Always", edge: 0.9, mix: 0.8, seed: 5 });
  const hold = p.add("lfo", [2, 1], { wave: "Square", sync: "Tempo", division: "2 bars", polarity: "Unipolar" }, { name: "Freeze Gate" });
  mono(p, m.amp, "l", b, 0); p.stereo(b, p.out).cable(hold, "out", b, "freeze");
  return p;
}

export default [beatCrusher, dropoutMelody, fifthsFall, shuffleSlicer, smearFreeze];
