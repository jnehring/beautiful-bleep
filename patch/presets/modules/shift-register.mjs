// SPDX-License-Identifier: MIT
// Shift Register: factory presets (lock, length, rate/sync, scale, octaves, weights).
export default [
  ["Frozen Loop", { lock: 1, length: 8, sync: "1/16", scale: "Minor Pentatonic" }, "The pattern repeats exactly every eight steps."],
  ["Slowly Mutating", { lock: 0.8, length: 8, sync: "1/16", scale: "Minor Pentatonic" }, "Mostly stable, with an occasional note changing."],
  ["Restless", { lock: 0.4, length: 8, sync: "1/16", scale: "Dorian" }, "Changes often but keeps a recognisable contour."],
  ["Pure Random", { lock: 0, length: 16, sync: "1/16", scale: "Chromatic", octaves: 3 }, "Every bit is a coin toss: random melodies."],
  ["Inverted Echo", { lock: -1, length: 6, sync: "1/8", scale: "Natural Minor" }, "Repeats every twelve steps, the second half inverted."],
  ["Short Four", { lock: 1, length: 4, sync: "1/16", gatelength: 0.4, scale: "Phrygian" }, "A four-step loop for a hypnotic riff."],
  ["Odd Seven", { lock: 1, length: 7, sync: "1/16", gatelength: 0.5, scale: "Minor Pentatonic" }, "Seven steps: the loop slides across the bar."],
  ["Long Sixteen", { lock: 0.9, length: 16, sync: "1/16", scale: "Major Pentatonic", octaves: 2 }, "A long register that drifts slowly over time."],
  ["Slow Eighths", { lock: 0.85, length: 8, sync: "1/8", gatelength: 0.8, scale: "Lydian", octaves: 2 }, "Slower steps with long gates for a calm line."],
  ["Staccato Burst", { lock: 0.6, length: 8, sync: "1/32", gatelength: 0.2, scale: "Hirajoshi", octaves: 3 }, "Fast, short notes in an Eastern scale."],
  ["Wide Four Octaves", { lock: 0.75, length: 8, sync: "1/16", scale: "Whole Tone", octaves: 4 }, "The pitch spreads over four octaves: big leaps."],
  ["Free Running", { lock: 0.7, length: 8, sync: "Free", rate: 6, scale: "Minor Pentatonic" }, "Ignores the song tempo and steps at a set rate."],
  ["Gate Weights", { lock: 0.9, length: 8, sync: "1/16", w1: 0.2, w2: 1, w3: -0.6, w4: 0.8, w5: 0.5, w6: -1 }, "Different weights make the Mix output stepped and uneven."],
  ["All-Bits Combo", { lock: 0.8, length: 8, sync: "1/16", combine: "All" }, "Combo goes high only when every chosen bit is 1: sparse rhythms."],
  ["Odd-Parity Combo", { lock: 0.7, length: 12, sync: "1/16", combine: "Odd", gatelength: 0.3 }, "Combo of an odd number of bits: busy, shifting gate patterns."],
];
