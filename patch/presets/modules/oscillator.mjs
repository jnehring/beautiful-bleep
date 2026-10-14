// SPDX-License-Identifier: MIT
// Oscillator: factory presets (see ../build-modules.mjs). Shape: 0 sine, 0.33 triangle, 0.67 saw, 1 square.
export default [
  ["Bright Saw", { shape: 0.67 }, "The classic sawtooth: a rich, bright starting point for any filter."],
  ["Pure Sine", { shape: 0 }, "A clean sine for sub bass, tones and as an FM carrier."],
  ["Soft Triangle", { shape: 0.33 }, "Mellow triangle with only odd, quiet harmonics."],
  ["Hollow Square", { shape: 1, pw: 0.5 }, "A 50 % square: woody, clarinet-like and hollow."],
  ["Reedy Pulse", { shape: 1, pw: 0.25 }, "A narrower pulse with a nasal, reed-like colour."],
  ["Thin Pulse", { shape: 1, pw: 0.1 }, "Very narrow pulse: thin and buzzy, great for chiptune leads."],
  ["Sub Sine", { shape: 0, octave: "-2" }, "Two octaves down sine for deep, clean sub bass."],
  ["Fat Bass Saw", { shape: 0.67, octave: "-1", fine: -6 }, "A saw an octave down, slightly flat: pair it with a second oscillator."],
  ["Sine To Saw", { shape: 0.5 }, "Half-way between triangle and saw: a soft, round buzz; sweep Shape with an LFO."],
  ["Octave Lead", { shape: 0.8, octave: "+1" }, "A bright saw-to-square blend one octave up for cutting leads."],
  ["Detuned Fifth", { shape: 0.67, coarse: 7, fine: 8 }, "Saw set a fifth up and slightly sharp: layer it with a root oscillator."],
  ["Gentle FM", { shape: 0, fm: 0.25 }, "A sine with the FM input open: patch a modulator in for bell tones."],
  ["Strong FM", { shape: 0.33, fm: 0.7 }, "Deep through-zero FM for metallic, clangorous timbres."],
  ["Sync Sweep Base", { shape: 0.67, coarse: 5 }, "Saw for hard sync: patch a gate or a faster oscillator into Sync and sweep Coarse."],
  ["Low Rumble", { shape: 1, pw: 0.3, octave: "-3" }, "Very low pulse: use as a drone, or slow rhythmic modulation."],
];
