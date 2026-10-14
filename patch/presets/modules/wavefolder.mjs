// SPDX-License-Identifier: MIT
// Folder (wavefolder): factory presets.
export default [
  ["Soft Fold", { fold: 0.25, tap: 6, level: 0.9 }, "Mild folding that adds a few bright harmonics."],
  ["Classic Fold", { fold: 0.5, tap: 6, level: 0.8 }, "The classic folded-sine timbre."],
  ["Hollow Fold", { fold: 0.55, tap: 3, symmetry: 0.4, level: 0.8 }, "Asymmetry adds even harmonics for a reedy sound."],
  ["Vocal Folds", { fold: 0.75, tap: 4, symmetry: 0.2, level: 0.7 }, "Formant-like tone when the fold is swept."],
  ["Metal Bright", { fold: 1, tap: 6, level: 0.6 }, "Deep folding: bright, metallic and inharmonic."],
  ["Low Tap Tame", { fold: 0.9, tap: 2, level: 0.9 }, "Heavy fold but only the early stages, so it stays smooth."],
  ["Wide Folder", { fold: 0.5, tap: 5, spread: 0.7, level: 0.8 }, "Spread decorrelates left and right: a mono source becomes wide."],
  ["Internal Sine Lead", { source: "Internal", wave: 0, fold: 0.6, tap: 5, level: 0.7 }, "Use the built-in oscillator; play it from Pitch."],
  ["Triangle Fold", { source: "Internal", wave: 1, fold: 0.5, tap: 6, level: 0.7 }, "Folded triangle from the internal oscillator: softer and rounder."],
  ["FM Fold", { source: "Internal", fold: 0.45, tap: 6, fm: 0.4, coarse: 12, level: 0.6 }, "FM adds sidebands before the folder for glassy tones."],
  ["Detuned Growl", { source: "Internal", fold: 0.8, tap: 6, symmetry: -0.5, coarse: -12, fine: 15, level: 0.6 }, "An octave down with asymmetric folding: a growling bass."],
  ["Parallel Fold", { fold: 0.7, tap: 6, mix: 0.4, level: 0.8 }, "Folded signal mixed under the dry one."],
  ["Eco Chaos", { fold: 1, tap: 6, symmetry: 0.8, spread: 1, quality: "Eco (2×)", level: 0.5 }, "Extreme settings with cheaper oversampling; aliasing is part of it."],
];
