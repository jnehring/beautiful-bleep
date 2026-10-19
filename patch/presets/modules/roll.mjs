// SPDX-License-Identifier: MIT
// Roll: factory presets (a pattern in slot 1 or more slots, plus the knobs that suit it).
// Notes are [start, length, pitch, velocity, chance, ratchet]; start and length are in beats here (96 ticks each).

const T = 96;
const n = (beat, len, pitch, vel = 100, chance = 100, ratchet = 1) => [Math.round(beat * T), Math.max(1, Math.round(len * T)), pitch, vel, chance, ratchet];
const slot = (bars, notes, loop) => ({ bars, loop: loop || [0, bars * 4 * T], notes });
const data = (slots, extra = {}) => {
  const all = [...slots];
  while (all.length < 8) all.push(slot(2, []));
  return { slot: 0, grid: 24, ghost: true, slots: all, ...extra };
};
/// A chord at `beat`: one note per pitch.
const chord = (beat, len, pitches, vel = 90) => pitches.map((p, i) => n(beat, len, p, vel - i * 4));
/// A run of equal notes from a list of pitches, `step` beats apart.
const run = (start, step, len, pitches, vel = 100) => pitches.map((p, i) => n(start + i * step, len, p, vel));

const progression = [
  chord(0, 3.8, [48, 55, 60, 63, 67]),
  chord(4, 3.8, [44, 51, 56, 60, 63]),
  chord(8, 3.8, [46, 53, 58, 62, 65]),
  chord(12, 3.8, [43, 50, 55, 59, 62]),
].flat();

const walk = [];
for (let i = 0; i < 16; i++) walk.push(n(i * 0.5, 0.45, [36, 36, 43, 36, 39, 36, 46, 43, 36, 36, 43, 39, 41, 43, 38, 34][i], i % 4 === 0 ? 110 : 85));

const pad = [
  n(0, 7.5, 57, 80), n(0.5, 7.5, 60, 72), n(1, 6.5, 64, 66), n(8, 7.5, 53, 80), n(8.5, 7.5, 57, 72), n(9, 7, 60, 66),
  n(16, 7.5, 55, 80), n(16.5, 7.5, 59, 72), n(17, 7, 62, 66), n(24, 7.5, 52, 80), n(24.5, 7.5, 56, 72), n(25, 7, 59, 66),
];

const arp16 = [];
for (let i = 0; i < 16; i++) arp16.push(n(i * 0.25, 0.22, [60, 64, 67, 72, 67, 64, 60, 55][i % 8], i % 4 === 0 ? 105 : 80));

const triplets = [];
for (let i = 0; i < 12; i++) triplets.push(n(i / 3, 0.3, [62, 65, 69, 72, 69, 65, 62, 57, 60, 64, 67, 64][i], 90));

const eightBars = [
  ...run(0, 1, 0.9, [69, 72, 76, 72]),
  ...run(4, 1, 0.9, [67, 71, 74, 71]),
  ...run(8, 1, 0.9, [65, 69, 72, 69]),
  ...run(12, 1, 0.9, [64, 67, 71, 67]),
  ...run(16, 1, 0.9, [69, 72, 76, 81]),
  n(20, 3.5, 79, 100), n(24, 1.5, 77, 95), n(25.5, 0.5, 76, 80), n(26, 2, 72, 90), n(28, 3.8, 69, 100),
];

const clusterNotes = [n(0, 2, 60, 90), n(0.25, 2, 61, 80), n(0.5, 2, 63, 80), n(1, 2, 66, 80), n(1.5, 1.5, 68, 76), n(2.5, 1.5, 70, 80), n(3, 1, 73, 90)];

export default [
  ["Rising Line", {}, "A short rising line, the starting point.", data([slot(1, [n(0, 0.75, 60), n(0.5, 0.75, 63), n(1, 0.75, 67), n(1.5, 0.75, 70)])])],
  ["Minor Chords", { scale: "Natural Minor", root: "C" }, "Four overlapping five-note chords, a bar each.", data([slot(4, progression)])],
  ["Walking Bass", { length: 0.8, scale: "Natural Minor", root: "C" }, "Eight-note bass line over two bars.", data([slot(2, walk)])],
  ["Held Pad Stack", { length: 1, humanise: 0.25 }, "Long notes starting a little apart and ringing through each other.", data([slot(4, pad)])],
  ["Ratchet Pulse", { length: 0.9 }, "Notes that split into 2-6 quick repeats.", data([slot(1, [n(0, 1, 60, 100, 100, 4), n(1, 0.5, 63, 90, 100, 2), n(1.5, 0.5, 67, 90, 100, 2), n(2, 1, 70, 100, 100, 6), n(3, 1, 67, 95, 100, 3)])])],
  ["Chance Garden", { seed: 7, scale: "Minor Pentatonic", root: "A" }, "Sixteen notes that each play only some of the time.", data([slot(2, [...arp16.map((x, i) => [x[0], x[1], x[2] + 9, x[3], [100, 70, 45, 60][i % 4], 1]), ...arp16.map((x, i) => [x[0] + 384, x[1], x[2] + 5, x[3], [90, 50, 35, 65][i % 4], 1])])])],
  ["Humanised Keys", { humanise: 0.7, length: 1.2 }, "Chords that arrive a hair late and uneven.", data([slot(4, progression.map((x) => [x[0], x[1], x[2] + 12, x[3], 100, 1]))])],
  ["Triplet Roll", { length: 1 }, "A rolling run on the triplet grid.", data([slot(1, triplets)], { grid: 32 })],
  ["Morph Pair", { morph: 0.5, morphto: 2, scale: "Dorian", root: "D" }, "Two arps; Morph 50 % sits halfway between them.", data([slot(1, arp16), slot(1, run(0, 0.5, 0.45, [74, 77, 81, 86, 81, 77, 74, 69]))])],
  ["Eight Bars", { length: 1, humanise: 0.1 }, "A long melody that takes eight bars to come round.", data([slot(8, eightBars)])],
  ["Swung Arp", { swing: 0.66, length: 0.7 }, "A sixteenth-note arpeggio with a rolling swing.", data([slot(1, arp16)])],
  ["Half-Time Drift", { speed: "x1/2", length: 1.3 }, "Everything at half speed: a slow, stretched pattern.", data([slot(2, walk.map((x) => [x[0], x[1], x[2] + 24, x[3], 100, 1]))])],
  ["Double-Time Run", { speed: "x2", scale: "Major Pentatonic", root: "G", quantize: "To scale", length: 0.6 }, "The pattern at twice the speed, snapped to the scale.", data([slot(1, arp16.map((x) => [x[0], x[1], x[2] + 1, x[3], 100, 1]))])],
  ["Loop Window", { length: 1 }, "Four bars drawn, only the second one loops.", data([slot(4, [...run(0, 1, 0.9, [60, 62, 64, 65]), ...run(4, 1, 0.9, [67, 69, 71, 72]), ...run(8, 1, 0.9, [72, 71, 69, 67]), ...run(12, 1, 0.9, [65, 64, 62, 60])], [384, 768])])],
  ["Scale Snap Cluster", { quantize: "To scale", scale: "Dorian", root: "D", length: 1.1 }, "A chromatic cluster pulled into Dorian when played.", data([slot(1, clusterNotes)])],
  ["Ghost Answer", { change: "Loop end", slot: 1 }, "Slot 1 calls, slot 2 answers; the ghost shows the call.", data([slot(1, run(0, 1, 0.8, [64, 67, 71, 74])), slot(1, run(0, 1, 0.8, [76, 72, 69, 67]))], { slot: 1 })],
];
