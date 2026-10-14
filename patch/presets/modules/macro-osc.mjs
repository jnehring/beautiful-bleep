// SPDX-License-Identifier: MIT
// Macro Osc: factory presets (see ../build-modules.mjs). Tone/Shape/Blend change meaning with the model.
export default [
  ["Fat VA Pair", { model: "VA Pair", tone: 0.5, shape: 0.2, blend: 0 }, "Two detuned saws: a fat classic analog voice."],
  ["Sync Sweep", { model: "VA Pair", tone: 0.3, shape: 0.1, blend: 0.6 }, "Hard-synced pair: move Blend for the classic sync sweep."],
  ["Wavefold Sine", { model: "Fold", tone: 0.5, shape: 0.5, blend: 0.2 }, "A sine folded back on itself: bright, harmonic timbre."],
  ["FM Bell Tone", { model: "FM", tone: 0.5, shape: 0.4, blend: 0 }, "Two-operator FM with a bell-like ratio."],
  ["Phase Warp Bass", { model: "Phase Warp", octave: -1, tone: 0.5, shape: 0.3, blend: 0 }, "A bent cosine: a warm, saw-like bass."],
  ["Vowel Voice", { model: "Vowel", tone: 0.15, shape: 0.5, blend: 0.1 }, "A sung vowel: sweep Tone from a to u."],
  ["Hollow Harmonics", { model: "Harmonic", tone: 0.3, shape: 0.4, blend: 0.5 }, "Odd harmonics only: a hollow, clarinet-like tone."],
  ["Chord Stack", { model: "Chord", tone: 0.5, shape: 0.5, blend: 0.5 }, "A minor-seventh chord from one note: Aux plays the root."],
  ["Wavetable Walk", { model: "Table", tone: 0.1, shape: 0.4, blend: 0.3 }, "An analog table: move Shape and Blend across the grid."],
  ["Grain Formant", { model: "Grain", tone: 0.5, shape: 0.4, blend: 0.3 }, "Windowed sine bursts: a vocal, filter-like peak."],
  ["Plucked String", { model: "Pluck", tone: 0.5, shape: 0.3, blend: 0.3, decay: 1.5 }, "A plucked string: patch triggers to play it."],
  ["Struck Bell", { model: "Modal", tone: 0.9, shape: 0.6, blend: 0.3, decay: 3 }, "A struck bell with stretched modes: trigger it."],
  ["Sub Kick", { model: "Kick", octave: -2, tone: 0.5, shape: 0.6, blend: 0.2, decay: 0.5 }, "A swept-sine kick: patch triggers."],
  ["Snare Hit", { model: "Snare", tone: 0.6, shape: 0.5, blend: 0.5, decay: 0.3 }, "Two heads plus noise: a classic synthetic snare."],
  ["Closed Hat", { model: "Metal", tone: 0.9, shape: 0.6, blend: 0.1, decay: 0.05 }, "Six metallic squares, very short: a closed hat."],
  ["Dust Rain", { model: "Dust", tone: 0.4, shape: 0.6, blend: 0.3 }, "Random clicks like rain or crackle; no trigger needed."],
];
