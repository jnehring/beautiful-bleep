// SPDX-License-Identifier: MIT
// Bender: factory presets (see ../build-modules.mjs).
export default [
  ["Stutter Repeats", { time: 0.125, chance: 0.25, repeats: 4, bend: 0, mode: "Crush", sync: "1/16", bendsteps: "Octaves" }, "Occasional clean repeats of a sixteenth slice."],
  ["Octave Jumps", { chance: 0.35, repeats: 3, bend: 1, bendvar: 0.5, bendsteps: "Octaves", sync: "1/8" }, "Slices randomly hop up or down octaves."],
  ["Fifths Glitch", { chance: 0.4, repeats: 3, bend: 1, bendvar: 0.6, bendsteps: "Fifths + octaves", sync: "1/16" }, "Re-pitched slices in musical fifths and octaves."],
  ["Tape Stop Fall", { time: 0.5, chance: 0.2, repeats: 1, bend: -2, bendsteps: "Free", sync: "1/4", edge: 0.5 }, "Occasional downward pitch dives."],
  ["Reverse Slices", { chance: 0.3, repeats: 2, bend: -1, bendsteps: "Octaves", sync: "1/8", mode: "Shuffle" }, "Shuffled slices that play back reversed."],
  ["Dropouts", { chance: 0.35, repeats: 1, mode: "Dropout", sync: "1/16", edge: 0.8 }, "Pieces of the signal drop out like a bad connection."],
  ["Smear Clouds", { time: 0.25, chance: 0.5, repeats: 6, mode: "Smear", sync: "1/8", edge: 0.9, mix: 0.7 }, "Smeared, blurred repeats for soft textures."],
  ["Fold Mangle", { chance: 0.4, repeats: 4, mode: "Fold", corrupt: 0.4, corruptwhen: "Glitches only", sync: "1/16" }, "Folded, harsher glitches."],
  ["Bit Crush Bursts", { chance: 0.3, repeats: 4, mode: "Crush", corrupt: 0.6, corruptwhen: "Glitches only", sync: "1/16" }, "Crushed bursts on random sixteenths."],
  ["Slicer", { chance: 0.5, repeats: 2, slice: 0.6, sync: "1/16", mode: "Shuffle" }, "Chopped, rearranged slices for rhythmic breaks."],
  ["Constant Corruption", { chance: 0.2, corrupt: 0.5, corruptwhen: "Always", mode: "Crush", sync: "1/8" }, "Always-on digital damage with occasional glitches."],
  ["Free Roll", { time: 0.08, chance: 0.5, repeats: 8, bend: 0.5, bendvar: 0.4, bendsteps: "Free", sync: "Free" }, "Unsynced rolls with wandering pitch."],
  ["Semitone Chaos", { chance: 0.7, repeats: 5, bend: 2, bendvar: 1, bendsteps: "Semitones", sync: "1/32", mode: "Shuffle", corrupt: 0.3 }, "Dense, random, chromatic glitch storm."],
  ["Half-Time Freeze", { time: 1, chance: 0.15, repeats: 2, bend: -1, sync: "1/2", mode: "Smear", mix: 0.8 }, "Rare long, slowed-down grabs."],
];
