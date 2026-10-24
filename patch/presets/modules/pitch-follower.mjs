// SPDX-License-Identifier: GPL-3.0-only
// Pitch Follower: factory presets (see ../build-modules.mjs).
export default [
  ["Voice", { low: 80, high: 1000, glide: 0.03, hold: 0.25, confidence: 0.75, guard: "Light", vote: "Off", release: 0.15 }, "All-round setting for a singing or speaking voice."],
  ["Bass", { low: 35, high: 400, glide: 0.04, hold: 0.3, confidence: 0.8, guard: "Firm", vote: "Off", release: 0.2 }, "Low range for a bass; the firm guard ignores octave mix-ups on heavy low notes."],
  ["Guitar", { low: 75, high: 1300, glide: 0.02, hold: 0.2, confidence: 0.8, guard: "Light", vote: "3", release: 0.25 }, "Plucked strings: a vote of three evens out the first wobbly cycles."],
  ["Flute and Whistle", { low: 250, high: 3000, glide: 0.02, hold: 0.15, confidence: 0.7, guard: "Light", vote: "Off", release: 0.1 }, "High and pure sounds with a quick response."],
  ["Fast and Twitchy", { low: 100, high: 2000, glide: 0.005, hold: 0.05, confidence: 0.6, guard: "Off", vote: "Off", release: 0.05 }, "No stabilisers and almost no glide: every little movement reaches the output."],
  ["Smooth Glide", { low: 80, high: 1200, glide: 0.25, hold: 0.3, confidence: 0.75, guard: "Light", vote: "3", release: 0.3 }, "Notes slide into each other, a portamento from any voice."],
  ["Rock Steady", { low: 70, high: 1000, glide: 0.06, hold: 0.3, confidence: 0.8, guard: "Firm", vote: "9", release: 0.2 }, "A firm guard and a vote of nine: slow to believe, then very stable."],
  ["Long Hold", { low: 80, high: 1000, glide: 0.04, hold: 1.5, confidence: 0.75, guard: "Light", vote: "Off", release: 0.5 }, "The gate stays open for a second and a half after the sound stops."],
  ["Strict Confidence", { low: 80, high: 1500, glide: 0.03, hold: 0.2, confidence: 0.92, guard: "Firm", vote: "5", release: 0.15 }, "Only clean, clearly pitched sound counts. For dirty input."],
  ["Loose Tracker", { low: 60, high: 2000, glide: 0.05, hold: 0.25, confidence: 0.45, guard: "Light", vote: "3", release: 0.15 }, "Follows rough and breathy sounds, at the price of the odd wrong note."],
  ["Pad Follower", { low: 80, high: 1000, glide: 0.12, hold: 0.6, confidence: 0.7, guard: "Light", vote: "5", release: 1.2 }, "Slow envelope and gate for driving pads and drones from a voice."],
  ["Deep Range", { low: 30, high: 250, glide: 0.05, hold: 0.4, confidence: 0.8, guard: "Firm", vote: "3", release: 0.3 }, "Sub-bass territory; the longest analysis window, so the slowest to answer."],
];
