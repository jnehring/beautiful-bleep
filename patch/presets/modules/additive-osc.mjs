// SPDX-License-Identifier: MIT
// Additive Osc: factory presets (see ../build-modules.mjs).
export default [
  ["Soft Saw", { base: "Saw", partials: 24, tilt: -3 }, "A smooth, slightly darkened additive saw."],
  ["Organ Drawbars", { base: "Square", partials: 10, tilt: 0, phases: "Aligned" }, "Odd partials with a limited count: a hollow organ."],
  ["Clarinet", { base: "Saw", partials: 16, oddEven: -0.9, tilt: -4 }, "Mostly odd partials: hollow and woody."],
  ["Even Glass", { base: "Flat", partials: 14, oddEven: 0.8, tilt: -6 }, "Even partials only: a thin, glassy octave-like tone."],
  ["Dark Sine Pad", { base: "Saw", partials: 8, tilt: -12, width: 0.5, chorus: 8 }, "Few, quiet upper partials: a dark, near-sine pad."],
  ["Bright Buzz", { base: "Flat", partials: 64, tilt: 6 }, "Strong high partials: a very bright, buzzing tone."],
  ["Ensemble Pad", { base: "Saw", partials: 32, tilt: -4, chorus: 20, chorusRate: 0.5, width: 0.7 }, "Detuned partials and stereo spread: a shimmering ensemble pad."],
  ["Bell", { base: "Saw", partials: 20, stretch: 0.6, phases: "Aligned", decay: 3, damp: 0.6, tilt: -2 }, "Stretched partials struck by a trigger: patch the note gate to Trigger."],
  ["Pluck", { base: "Saw", partials: 32, decay: 0.4, damp: 0.8, tilt: -3 }, "A short, plucked string-like tone; needs a trigger from the note."],
  ["Metal Shift", { base: "Flat", partials: 24, shift: 0.3, tilt: -4, width: 0.4 }, "Shifted, inharmonic partials: ring-modulated and metallic."],
  ["Comb Notches", { base: "Saw", partials: 48, comb: 0.8, combSpacing: 4, combPhase: 0.2 }, "Notches carved in the spectrum: modulate Comb Phase with a slow LFO."],
  ["Squeezed Choir", { base: "Saw", partials: 28, stretch: -0.4, tilt: -3, chorus: 12, width: 0.6 }, "Compressed partials: dense, vocal and choir-like."],
  ["Stiff Strings", { base: "Saw", partials: 40, stretch: 0.2, tilt: -2, decay: 1.5, damp: 0.5 }, "A slightly stretched, piano-like struck tone."],
  ["Fundamental Whisper", { base: "Saw", partials: 3, tilt: -6 }, "Just the first few partials: a pure, flute-like tone."],
  ["Random Phase Cloud", { base: "Flat", partials: 40, tilt: -3, phases: "Random", chorus: 35, chorusRate: 1.2, width: 1 }, "Heavily detuned partials: a wide, cloudy texture."],
];
