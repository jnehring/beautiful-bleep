// SPDX-License-Identifier: MIT
// Cartesian Seq: factory presets (grid size, playhead directions/rates, mode, scale).
export default [
  ["Four by Four", { mode: "Clocks", columns: 4, rows: 4, xrate: "1/16", yrate: "Wrap", scale: "Major" }, "A 4 x 4 grid read left to right, row by row."],
  ["Eight by Eight", { mode: "Clocks", columns: 8, rows: 8, xrate: "1/16", yrate: "Wrap", scale: "Minor Pentatonic" }, "The full grid: sixty-four steps of melody."],
  ["Single Row", { mode: "Clocks", columns: 8, rows: 1, xrate: "1/16", yrate: "Off", scale: "Natural Minor" }, "Just one row: a plain eight-step sequence."],
  ["Slow Rows", { mode: "Clocks", columns: 4, rows: 4, xrate: "1/8", yrate: "1/2", scale: "Dorian" }, "X steps fast, Y creeps slowly: rows change every half note."],
  ["Backward Walk", { mode: "Clocks", columns: 4, rows: 4, xdirection: "Backward", ydirection: "Backward", scale: "Phrygian" }, "Both playheads run in reverse."],
  ["Ping-Pong Grid", { mode: "Clocks", columns: 5, rows: 3, xdirection: "Ping-Pong", ydirection: "Ping-Pong", scale: "Lydian" }, "Both playheads bounce back and forth."],
  ["Random Walk", { mode: "Clocks", columns: 8, rows: 8, xdirection: "Random", ydirection: "Random", gatelength: 0.3, scale: "Minor Pentatonic" }, "Playheads jump about at random: a shuffled melody."],
  ["Polymetric 5x3", { mode: "Clocks", columns: 5, rows: 3, xrate: "1/16", yrate: "1/16", scale: "Mixolydian" }, "Two clocks at the same rate on uneven sizes: patterns drift."],
  ["Swung Grid", { mode: "Clocks", columns: 4, rows: 4, swing: 0.62, gatelength: 0.45, scale: "Dorian" }, "A swung four by four."],
  ["Triplet Grid", { mode: "Clocks", columns: 6, rows: 4, xrate: "1/8T", yrate: "Wrap", scale: "Blues" }, "Triplet steps across six columns."],
  ["Manual Cartesian", { mode: "Cartesian", columns: 8, rows: 8, x: 0.3, y: 0.6, sample: "Change", scale: "Major Pentatonic" }, "Pick notes with X and Y: modulate them with LFOs."],
  ["Smooth Mod Walk", { mode: "Cartesian", columns: 8, rows: 8, modslew: 0.4, sample: "Clock", scale: "Natural Minor" }, "X/Y control with a slewed mod output for a smooth line."],
  ["Low Drone Grid", { mode: "Clocks", columns: 4, rows: 2, xrate: "1/4", octave: -2, gatelength: 1, scale: "Natural Minor", root: "D" }, "A slow, held low-octave pattern."],
];
