// SPDX-License-Identifier: MIT
// Envelope Follower: factory presets (see ../build-modules.mjs).
export default [
  ["Smooth Follow", { attack: 0.01, release: 0.2, gain: 1, threshold: 0.3 }, "General loudness follower for modulation."],
  ["Fast Peak", { attack: 0.001, release: 0.05, gain: 1.5, threshold: 0.3, detector: "Peak" }, "Snappy peak tracking that catches every hit."],
  ["Drum Trigger", { attack: 0.001, release: 0.08, gain: 2, threshold: 0.5, detector: "Peak" }, "Use the trigger output to fire envelopes from drums."],
  ["Ducker", { attack: 0.002, release: 0.4, gain: 2.5, threshold: 0.2 }, "Use the inverted output to duck a pad under a kick."],
  ["Slow Swell", { attack: 0.5, release: 1.5, gain: 1.5, threshold: 0.3, detector: "RMS" }, "Slow average level for gentle, musical movement."],
  ["RMS Level", { attack: 0.05, release: 0.3, gain: 1, threshold: 0.3, detector: "RMS" }, "Smooth perceived-loudness meter."],
  ["Hot Gain", { attack: 0.005, release: 0.15, gain: 5, threshold: 0.3 }, "Boosts quiet signals to a strong control range."],
  ["Gate Sense", { attack: 0.003, release: 0.12, gain: 3, threshold: 0.6, detector: "Peak" }, "High threshold gate for loud passages only."],
  ["Low Threshold Gate", { attack: 0.005, release: 0.3, gain: 2, threshold: 0.08 }, "Gate that opens on almost any signal."],
  ["Positive Half", { attack: 0.01, release: 0.2, gain: 2, threshold: 0.3, rectify: "Positive" }, "Follows only positive swings of the input."],
  ["Signed Follow", { attack: 0.02, release: 0.1, gain: 1, threshold: 0.3, rectify: "None (signed)" }, "Passes the signal with smoothing, handy for CV."],
  ["Long Tail", { attack: 0.02, release: 4, gain: 1.5, threshold: 0.3 }, "Slowly falling level for lingering effects."],
];
