// SPDX-License-Identifier: MIT
// Step Sequencer: factory presets for the feel and rules (rate, direction, gate, swing, scale, variation); step content is saved data.
export default [
  ["Straight Sixteenths", { rate: "1/16", gatelength: 0.5, swing: 0.5, direction: "Forward", scale: "Major" }, "Plain forward sixteenth notes in C major: the neutral starting point."],
  ["Tight Staccato", { rate: "1/16", gatelength: 0.15, direction: "Forward", scale: "Minor Pentatonic" }, "Short, clipped gates in minor pentatonic for plucks and bass."],
  ["Legato Eighths", { rate: "1/8", gatelength: 1, direction: "Forward", scale: "Natural Minor" }, "Full-length gates in eighths so the notes run together."],
  ["Swung Shuffle", { rate: "1/16", gatelength: 0.45, swing: 0.62, scale: "Dorian" }, "Sixteenths with a loose swing in Dorian for a laid-back groove."],
  ["Triplet Roll", { rate: "1/8T", gatelength: 0.5, scale: "Mixolydian" }, "Eighth-note triplets for a rolling, rounded feel."],
  ["Slow Pendulum", { rate: "1/8", direction: "Ping-Pong", gatelength: 0.7, scale: "Lydian", length: 8 }, "Eight steps bouncing back and forth in Lydian: dreamy and floating."],
  ["Backward Run", { rate: "1/16", direction: "Backward", gatelength: 0.4, scale: "Natural Minor" }, "Plays the pattern in reverse for a falling line."],
  ["Short Loop Eight", { rate: "1/16", length: 8, gatelength: 0.5, scale: "Phrygian" }, "A tight eight-step loop in Phrygian for driving basslines."],
  ["Odd Five", { rate: "1/16", length: 5, gatelength: 0.4, scale: "Minor Pentatonic" }, "Five steps against a four-beat bar: the pattern keeps shifting."],
  ["Dense Random", { rate: "1/32", direction: "Random", gatelength: 0.25, scale: "Chromatic" }, "Thirty-second notes in random order across the whole scale."],
  ["Gentle Drift", { rate: "1/8", variation: 0.35, varrange: 5, gatelength: 0.6, scale: "Major Pentatonic" }, "Notes wander a few semitones from the written pitches."],
  ["Wild Variation", { rate: "1/16", variation: 0.8, varrange: 12, gatelength: 0.35, scale: "Dorian" }, "Heavy variation of up to an octave: the sequence never plays the same twice."],
  ["Blues Walk", { rate: "1/8.", gatelength: 0.55, swing: 0.58, scale: "Blues", root: "A" }, "Dotted eighths in an A blues scale with a little swing."],
  ["Eastern Lines", { rate: "1/16T", gatelength: 0.5, scale: "Phrygian Dominant", root: "D", direction: "Forward" }, "Sixteenth triplets in a Phrygian dominant scale."],
  ["Low Octave Drone", { rate: "1/4", gatelength: 1, octave: -2, scale: "Natural Minor", root: "F" }, "Slow, held quarter notes two octaves down for a sub line."],
];
