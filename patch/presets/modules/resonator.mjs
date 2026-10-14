// SPDX-License-Identifier: MIT
// Resonator: factory presets.
export default [
  ["Glass Bar", { model: "Modal", frequency: 0, structure: 0.4, brightness: 0.7, damping: 0.5, position: 0.3, exciter: 0.5 }, "A struck bar: bell-like tuned percussion."],
  ["Hollow String", { model: "String", structure: 0.3, brightness: 0.5, damping: 0.55, position: 0.4 }, "A plucked string with a round body."],
  ["Bright Harp", { model: "String", structure: 0.2, brightness: 0.8, damping: 0.4, position: 0.2, polyphony: "4" }, "Four plucked strings: arpeggios turn harp-like."],
  ["Tuned Plate", { model: "Modal", structure: 0.7, brightness: 0.6, damping: 0.35, position: 0.5 }, "A metallic plate ring."],
  ["Bell Tower", { model: "Modal", frequency: -12, structure: 0.9, brightness: 0.8, damping: 0.7, position: 0.35, modes: "64" }, "Low, long bell with many partials."],
  ["Sympathetic Drone", { model: "Sympathetic", structure: 0.3, brightness: 0.5, damping: 0.8, dry: 0.3 }, "Strings that ring along with a melody fed in."],
  ["Sitar Shimmer", { model: "Sympathetic", structure: 0.6, brightness: 0.7, damping: 0.7, dry: 0.4, width: 1 }, "Buzzing sympathetic strings."],
  ["Drum Tuner", { model: "Modal", structure: 0.5, brightness: 0.5, damping: 0.2, exciter: 0.7, inputgain: 6 }, "Short tuned ring for drum loops."],
  ["Damped Marimba", { model: "Modal", structure: 0.35, brightness: 0.4, damping: 0.15, position: 0.25 }, "Short, woody mallet tone."],
  ["Kalimba Pluck", { model: "String", frequency: 7, structure: 0.5, brightness: 0.45, damping: 0.25, position: 0.6 }, "Fast-decaying plucks."],
  ["Eternal String", { model: "String", structure: 0.2, brightness: 0.6, damping: 0.95, position: 0.3 }, "A very long-ringing string."],
  ["Wide Chord Body", { model: "Modal", structure: 0.55, brightness: 0.6, damping: 0.6, polyphony: "4", width: 1, dry: 0.2 }, "Four voices spread wide for chord-like clouds."],
  ["Octave Metal", { model: "Modal", frequency: 12, structure: 1, brightness: 0.9, damping: 0.4, position: 0.7, modes: "64" }, "High, clangy metal, bright and inharmonic."],
  ["Onset Strummer", { model: "String", structure: 0.3, brightness: 0.6, damping: 0.5, strumsource: "Input onsets", exciter: 0.6 }, "Plays the string on every hit in the input; no strum cable needed."],
];
