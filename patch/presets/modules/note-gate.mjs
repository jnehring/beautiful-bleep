// SPDX-License-Identifier: MIT
// Note Gate: factory presets (range, velocity, remap, rule lanes). A fourth entry is the node's data.
const identity = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const linear = Array.from({ length: 17 }, (_, i) => i / 16);
const steps = (...on) => Array.from({ length: 16 }, (_, i) => (on.includes(i) ? 1 : 0));
const data = (o = {}) => ({ remap: identity, curve: linear, steps: new Array(16).fill(1), ...o });
export default [
  ["Low Register", { low: 0, high: 59 }, "Only notes below middle C get through."],
  ["Upper Register", { low: 60, high: 127 }, "Only notes from middle C up."],
  ["Notch Out The Middle", { low: 55, high: 67, rangemode: "Block Inside" }, "A hole in the middle of the keyboard: lows and highs pass."],
  ["Soft Notes Out", { floor: 0.3, floormode: "Drop" }, "Notes played softer than 30 % are dropped: ghost notes disappear."],
  ["Lift The Floor", { floor: 0.45, floormode: "Lift" }, "Soft notes are raised to 45 % instead of dropped."],
  ["Ceiling Squash", { ceiling: 0.6 }, "Nothing plays harder than 60 %."],
  ["Compress Curve", { bend: 0.6 }, "Soft notes come out louder: an even, compressed touch."],
  ["Expand Curve", { bend: -0.6 }, "Soft notes get softer, hard notes stay: more dynamics."],
  ["Hard Hits Only", { curvemode: "Drawn", floor: 0.1 }, "A drawn curve that mutes everything below the middle and jumps to full above it.", data({ curve: linear.map((_, i) => (i < 9 ? 0.05 : 0.7 + 0.3 * ((i - 9) / 7))) })],
  ["Naturals Only", { remap: "On" }, "Sharps and flats fall down to the natural below: a C-major-ish keyboard.", data({ remap: [0, 0, 2, 2, 4, 5, 5, 7, 7, 9, 9, 11] })],
  ["Major To Minor", { remap: "On" }, "E, A and B drop a semitone: the same tune in a minor mood.", data({ remap: [0, 1, 2, 3, 3, 5, 6, 7, 8, 8, 10, 10] })],
  ["Mute Black Keys", { remap: "On" }, "Every black key is blocked: only the white keys play.", data({ remap: [0, -1, 2, -1, 4, 5, -1, 7, -1, 9, -1, 11] })],
  ["Fifths Swap", { remap: "On" }, "Every note moves up a fifth within its octave.", data({ remap: [7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6] })],
  ["Downbeats Only", { stepsrule: "On" }, "Notes pass only on the four beats of the bar.", data({ steps: steps(0, 4, 8, 12) })],
  ["Offbeat Eighths", { stepsrule: "On" }, "Notes pass only on the 'and' of each beat.", data({ steps: steps(2, 6, 10, 14) })],
  ["Every Other Note", { every: 2, offset: 0 }, "Passes the 1st, 3rd, 5th note and so on: halves a busy line."],
  ["Thin Out Busy Runs", { density: 3, window: "1 beat" }, "At most three notes per beat get through, however fast you play."],
];
