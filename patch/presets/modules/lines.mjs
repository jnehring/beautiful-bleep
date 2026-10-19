// SPDX-License-Identifier: MIT
// Lines: factory presets (pattern data plus per-track speed and length).
// Cells are [row, note, velocity, gate, effect, parameter]; effects 1 R, 2 S, 3 P, 4 T, 5 J, 6 K.

const cell = (row, note, vel = 0, gate = 0, fx = 0, fxp = 0) => [row, note, vel, gate, fx, fxp];
const pattern = (rows, tracks) => ({ rows, tracks: [0, 1, 2, 3].map((k) => tracks[k] || []) });
const data = (patterns, order = [0]) => {
  const all = [...patterns];
  while (all.length < 16) all.push(pattern(16, []));
  return { pattern: 0, octave: 4, edit: 1, order, patterns: all };
};
/// Cells for a list of notes on rows given by `rows` (null entries rest).
const line = (notes, step = 1, start = 0, gate = 0, vel = 0) => notes.flatMap((x, i) => (x === null ? [] : [cell(start + i * step, x, vel, gate)]));

const bass16 = line([36, null, 36, null, 43, null, 36, 39, 36, null, 36, null, 46, 43, null, 41], 1, 0, 5);
const lead5 = line([72, 75, 79, 77, 74], 1, 0, 6);
const arp7 = line([60, 63, 67, 70, 67, 63, 65], 1, 0, 4);
const stab9 = line([48, null, 51, null, 55, null, null, 53, null], 1, 0, 5);

export default [
  ["Drifting Four", { length1: 16, length2: 5, length3: 7, length4: 9, scale: "Natural Minor" }, "Four lines of 16, 5, 7 and 9 rows slide against each other.", data([pattern(16, [bass16, lead5, arp7, stab9])])],
  ["Locked Lines", { length1: 16, length2: 16, length3: 16, length4: 16 }, "All tracks the same length: a plain four-part pattern.", data([pattern(16, [bass16, line([60, 63, 67, 63], 4, 0, 6), line([75, null, 72, null, 79, null, 77, null], 2, 0, 3), []])])],
  ["Double and Half", { speed1: "x1/2", speed2: "x2", speed3: "x1", length1: 16, length2: 8, length3: 16 }, "Bass at half speed, a line at double, one at normal.", data([pattern(16, [line([36, 43, 41, 39], 4, 0, 12), line([72, 75, 79, 75, 72, 70, 67, 70], 1, 0, 3), line([60, null, 63, null, 67, null, 65, null], 2, 0, 4)])])],
  ["Thirds and Fifths", { speed1: "x1", speed2: "x2/3", speed3: "x3/2", speed4: "x3/4", length1: 12, length2: 12, length3: 12, length4: 12 }, "Same length, speeds in simple ratios: a slow phase shift.", data([pattern(16, [line([48, 55, 51, 58], 3, 0, 8), line([72, 75, 74, 70, 67, 70], 2, 0, 5), line([60, 63, 67, 72, 67, 63], 2, 0, 3), line([84, null, 79, null, 75, null], 2, 0, 3)])])],
  ["Ratchet Row", { length1: 16, length2: 16 }, "Retrigger effects fill rows with quick repeats.", data([pattern(16, [[cell(0, 36, 110, 4, 1, 3), cell(4, 36, 0, 4), cell(8, 38, 0, 4, 1, 4), cell(12, 36, 0, 4, 1, 2)], [cell(2, 72, 0, 3, 1, 4), cell(6, 75, 0, 3), cell(10, 79, 0, 3, 1, 6), cell(14, 77, 0, 3, 1, 3)]])])],
  ["Slide Line", { length1: 8, scale: "Phrygian", root: "E" }, "Slide cells tie notes together with a glide.", data([pattern(16, [[cell(0, 40, 0, 12), cell(2, 43, 0, 12, 2, 120), cell(4, 47, 0, 12, 2, 200), cell(6, 45, 0, 8, 2, 60), cell(8, 40, 0, 12), cell(10, 52, 0, 12, 2, 160), cell(12, 47, 0, 12, 2, 90), cell(14, 43, 0, 6)]])])],
  ["Maybe Melody", { length1: 16, seed: 3, scale: "Minor Pentatonic", root: "A" }, "Every note carries a probability, so the tune varies.", data([pattern(16, [[0, 2, 4, 6, 8, 10, 12, 14].map((r, i) => cell(r, [69, 72, 74, 76, 79, 76, 74, 72][i], 0, 5, 3, [255, 200, 160, 120, 255, 180, 140, 100][i])), [1, 5, 9, 13].map((r, i) => cell(r, [57, 60, 62, 64][i], 70, 3, 3, 110))])])],
  ["Transposed Echo", { length1: 8, length2: 8 }, "Track 2 plays track 1's notes shifted by an effect column.", data([pattern(16, [line([60, 63, 67, 70, 67, 63, 65, 60], 1, 0, 4), line([60, 63, 67, 70, 67, 63, 65, 60], 1, 0, 4).map((c) => [c[0], c[1], 60, c[3], 4, 12])])])],
  ["Jump Around", { length1: 16, scale: "Dorian", root: "D" }, "Jump and skip effects make the row order unpredictable.", data([pattern(16, [[cell(0, 62, 0, 5), cell(1, 65, 0, 5), cell(2, 69, 0, 5, 5, 6), cell(3, 72), cell(6, 74, 0, 5), cell(7, 72, 0, 5, 6, 3), cell(8, 69, 0, 5), cell(11, 65, 0, 5, 5, 0), cell(12, 60)]])])],
  ["Two Patterns", { length1: 16, length2: 16 }, "An order of two patterns: verse and variation.", data([pattern(16, [bass16, lead5.map((c) => [c[0], c[1], c[2], c[3], 0, 0])]), pattern(16, [bass16.map((c) => [c[0], c[1] + (c[0] > 7 ? 5 : 0), c[2], c[3], 0, 0]), line([79, 77, 75, 72, 74], 1, 0, 6)])], [0, 0, 1])],
  ["Per-Pattern Restart", { drift: "Per pattern", length1: 16, length2: 5, length3: 7 }, "Tracks restart with each pattern instead of drifting on.", data([pattern(16, [bass16, lead5, arp7]), pattern(16, [bass16, line([75, 74, 72, 70, 67], 1, 0, 5), line([55, 58, 62, 58, 55, 53, 50], 1, 0, 4)])], [0, 1])],
  ["Long Thirty-Two", { rate: "1/8", length1: 32, length2: 24, length3: 20, length4: 28, scale: "Natural Minor" }, "Four slow lines of 32, 24, 20 and 28 rows: very long drift.", data([pattern(32, [line([36, null, null, null, 43, null, null, null, 41, null, null, null, 39, null, null, null], 2, 0, 12), line([72, 75, 79, 75, 72, 70], 4, 0, 8), line([60, null, 63, null, 67, null, 65, null, 62, null], 2, 0, 12), line([84, 82, 79, 77, 75, 72, 70], 4, 0, 8)])])],
  ["Octave Layers", { octave1: -1, octave2: 1, octave3: 0, speed2: "x2", length1: 8, length2: 8, length3: 8 }, "One motif on three tracks, an octave apart and at two speeds.", data([pattern(16, [line([60, 63, 67, 63, 65, 62, 58, 62], 1, 0, 4), line([60, 63, 67, 63, 65, 62, 58, 62], 1, 0, 4), line([60, 63, 67, 63, 65, 62, 58, 62], 1, 0, 4)])])],
  ["Gate Lengths", { length1: 8, gate: 0.3 }, "The gate column from a short tick to nearly two rows.", data([pattern(16, [[1, 2, 3, 4, 5, 6, 7, 8].map((g, i) => cell(i, [60, 63, 67, 70, 72, 70, 67, 63][i], 0, [1, 2, 4, 8, 12, 15, 3, 6][i]))])])],
  ["Scale-Snapped Run", { quantize: "To scale", scale: "Whole Tone", root: "C", length1: 12, length2: 12, length3: 12 }, "Plain chromatic notes pulled into the scale on playing.", data([pattern(16, [line([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71], 1, 0, 5), line([72, 73, 75, 76, 78, 79, 81, 82], 1, 0, 4), []])])],
  ["Row Jumper", { length1: 10, length2: 6, speed2: "x3/2", length3: 4, speed3: "x3" }, "Short loops at odd speeds: fast cells over a slow base.", data([pattern(16, [line([43, 43, 46, 41, 43, null, 48, 46, 41, 38], 1, 0, 6), line([67, 70, 74, 70, 72, 69], 1, 0, 3), line([79, 82, 79, 77], 1, 0, 2)])])],
];
