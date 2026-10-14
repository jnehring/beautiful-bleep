// SPDX-License-Identifier: MIT
// Dual Osc: factory presets (see ../build-modules.mjs).
export default [
  ["Fat Saw Pair", { shapeA: 0.67, shapeB: 0.67, octaveB: 0, fineB: 9, balance: 0.5, width: 0.4 }, "Two slightly detuned saws: the classic fat analog voice."],
  ["Octave Bass", { shapeA: 0.67, shapeB: 1, octaveA: -1, octaveB: -2, balance: 0.4 }, "A saw over a square sub octave for a solid bass."],
  ["Hollow Pulse Duo", { shapeA: 1, widthA: 0.3, shapeB: 1, octaveB: 0, fineB: -7, balance: 0.5, width: 0.5 }, "Two pulses with different widths and slight detune: hollow and wide."],
  ["Sync Lead", { shapeA: 0.67, shapeB: 0.67, octaveB: -1, sync: 1, tuneA: 5, balance: 0.2, bTrack: true }, "Hard sync: sweep Tune A for the classic tearing lead."],
  ["Soft Sync Voice", { shapeA: 0.4, shapeB: 0.33, octaveB: -1, sync: 0.35, tuneA: 3, balance: 0.3 }, "Gentle reversing sync: a vocal, slightly nasal colour."],
  ["FM Bell", { shapeA: 0, shapeB: 0, octaveB: 1, tuneB: 7, fmDepth: 0.4, balance: 0.1, fmMode: "Linear" }, "Sine FM with a non-integer ratio: patch an envelope on FM Depth."],
  ["Electric Piano", { shapeA: 0, shapeB: 0, octaveB: 0, tuneB: 0, fmDepth: 0.25, balance: 0.15 }, "Soft 1:1 FM: a warm, tine-like electric piano tone."],
  ["Brass FM", { shapeA: 0, shapeB: 0, octaveB: 0, fmDepth: 0.5, balance: 0.1, fold: 0.1 }, "Harmonic FM with a touch of fold: a punchy brass-like tone."],
  ["Growl", { shapeA: 0.67, shapeB: 0, octaveB: -2, fmDepth: 0.35, fmMode: "Exponential", balance: 0.2, fold: 0.15 }, "Exponential FM from a low sine: growling, siren-like bass."],
  ["West Coast Fold", { shapeA: 0, shapeB: 0.33, balance: 0.3, fold: 0.6, symmetry: 0.2 }, "A sine pushed into the wavefolder: bright, harmonic. Modulate Fold."],
  ["Folded Pad", { shapeA: 0.33, shapeB: 0.33, fineB: 6, fold: 0.35, symmetry: 0.3, width: 0.8, drift: 0.3 }, "Soft waves with gentle folding and wide drift: a moving pad."],
  ["Wide Stereo Saw", { shapeA: 0.67, shapeB: 0.67, octaveB: 0, fineB: 12, width: 1, drift: 0.25, quality: "High (4×)" }, "Wide, drifting saw pair for pads and chords."],
  ["Slow Growl Mod", { shapeA: 0.5, shapeB: 0, octaveB: -4, bRange: "Low", fmDepth: 0.3, balance: 0.1 }, "B in Low range as a slow vibrato-rate FM for wobbling tone."],
  ["Metallic Clang", { shapeA: 0.33, shapeB: 0.67, octaveB: 0, tuneB: 6.5, fmDepth: 0.7, balance: 0.3, fold: 0.3 }, "Strong inharmonic FM and fold: metal, gongs and noise-like hits."],
  ["Drifting Duo", { shapeA: 0.5, shapeB: 0.5, octaveB: 0, fineB: 4, drift: 0.8, balance: 0.5 }, "Two soft waves with strong analog drift: unstable, vintage."],
];
