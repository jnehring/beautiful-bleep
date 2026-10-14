// SPDX-License-Identifier: MIT
// Low Pass Gate: factory presets (see ../build-modules.mjs).
export default [
  ["Classic Pluck", { level: 0, response: 0.5, ping: 0.8, brightness: 0.75, mode: "Both", cell: "Classic" }, "Ping it with a trigger for a natural, darkening pluck."],
  ["Short Blip", { response: 0.15, ping: 0.9, brightness: 0.8, cell: "Fast" }, "Tight, percussive blips for rhythmic lines."],
  ["Bongo Tone", { response: 0.25, ping: 1, resonance: 0.4, brightness: 0.6, cell: "Fast" }, "Short resonant knock: good on sine and triangle."],
  ["Soft Mallet", { response: 0.45, ping: 0.6, brightness: 0.5, mode: "Both" }, "Rounded, mellow hit."],
  ["Long Decay", { response: 0.85, ping: 0.8, brightness: 0.7, cell: "Slow memory" }, "Slow, ringing close with a long dark tail."],
  ["Dark Pad Gate", { response: 0.9, ping: 0.5, brightness: 0.3, cell: "Slow memory", mode: "Both" }, "Slow swells and fades from a CV."],
  ["Filter Only", { mode: "LP", level: 0.6, brightness: 0.5, response: 0.5 }, "Just the low-pass: a vactrol-style filter on a steady tone."],
  ["VCA Only", { mode: "VCA", level: 0.5, response: 0.4 }, "Just the amplitude gate with vactrol smoothing."],
  ["Resonant Ping", { response: 0.45, ping: 0.9, resonance: 0.65, brightness: 0.7 }, "Resonance gives the pluck a vocal, ringing pitch."],
  ["Driven Hit", { response: 0.35, ping: 1, drive: 0.6, brightness: 0.8 }, "Saturated, punchy attack."],
  ["Leaky Gate", { response: 0.5, ping: 0.7, bleed: 0.2, brightness: 0.6 }, "Never fully closes: a muffled signal always leaks through."],
  ["Open Bright", { level: 0.8, brightness: 1, response: 0.3, mode: "Both" }, "Mostly open and bright, nudged by CV."],
  ["Slow Memory Pluck", { response: 0.7, ping: 0.85, resonance: 0.3, cell: "Slow memory", brightness: 0.65 }, "The vactrol remembers earlier hits, so fast repeats bloom."],
];
