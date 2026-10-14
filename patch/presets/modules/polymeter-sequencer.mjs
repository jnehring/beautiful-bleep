// SPDX-License-Identifier: MIT
// Polymeter Seq: factory presets (rate, gate scale, probability bias, ratchet, swing, scale).
export default [
  ["Straight Sixteenths", { rate: "1/16", gatescale: 1, swing: 0.5, scale: "Minor Pentatonic" }, "Plain sixteenth notes: the neutral setup."],
  ["Tight Gates", { rate: "1/16", gatescale: 0.3, scale: "Minor Pentatonic" }, "Short gates for plucks and percussion."],
  ["Long Gates", { rate: "1/16", gatescale: 1.8, scale: "Dorian" }, "Gates stretch past the step so notes overlap."],
  ["Swung Shuffle", { rate: "1/16", swing: 0.64, gatescale: 0.8, scale: "Dorian" }, "A loose swing across all six tracks."],
  ["Slow Eighths", { rate: "1/8", gatescale: 1, scale: "Natural Minor", octave: 0 }, "Eighth notes: a roomier polymeter."],
  ["Triplet Polymeter", { rate: "1/8T", gatescale: 0.9, scale: "Mixolydian" }, "Triplet steps against the bar for a rolling feel."],
  ["Sparse Chance", { rate: "1/16", probbias: -0.5, scale: "Minor Pentatonic" }, "Lowers every step's probability: only some notes play."],
  ["Always Play", { rate: "1/16", probbias: 1, scale: "Minor Pentatonic" }, "Raises every probability so all steps fire."],
  ["Heavy Ratchets", { rate: "1/16", ratchetamt: 1, gatescale: 0.5, scale: "Phrygian" }, "Ratchet steps repeat at full strength: stuttering hits."],
  ["No Ratchets", { rate: "1/16", ratchetamt: 0, scale: "Minor Pentatonic" }, "Ratchets switched off: clean single notes."],
  ["Wide Spread", { rate: "1/16", spread: 0.8, scale: "Lydian", gatescale: 0.7 }, "Spreads the tracks across pitch and velocity for a lively line."],
  ["Soft Velocity", { rate: "1/8", velocity: 0.4, gatescale: 1.2, scale: "Major Pentatonic" }, "Quiet notes for a gentle background pattern."],
  ["Low Octave Bass", { rate: "1/16", octave: -2, gatescale: 0.6, scale: "Natural Minor", root: "E" }, "Two octaves down in E minor: a bass polymeter."],
  ["Blues Polymeter", { rate: "1/16", scale: "Blues", root: "A", swing: 0.58, gatescale: 0.7 }, "A blues scale with light swing."],
];
