// SPDX-License-Identifier: MIT
// Oscillator: factory presets (see ../build-modules.mjs). Waveform and Secondary: Sine, Triangle, Saw, Square;
// Morph 0 plays the Waveform, 1 the Secondary, crossfading in between.
export default [
  ["Bright Saw", { wave: "Saw" }, "The classic sawtooth: a rich, bright starting point for any filter."],
  ["Pure Sine", { wave: "Sine" }, "A clean sine for sub bass, tones and as an FM carrier."],
  ["Soft Triangle", { wave: "Triangle" }, "Mellow triangle with only odd, quiet harmonics."],
  ["Hollow Square", { wave: "Square", pw: 0.5 }, "A 50 % square: woody, clarinet-like and hollow."],
  ["Reedy Pulse", { wave: "Square", pw: 0.25 }, "A narrower pulse with a nasal, reed-like colour."],
  ["Thin Pulse", { wave: "Square", pw: 0.1 }, "Very narrow pulse: thin and buzzy, great for chiptune leads."],
  ["Sub Sine", { wave: "Sine", octave: "-2" }, "Two octaves down sine for deep, clean sub bass."],
  ["Fat Bass Saw", { wave: "Saw", octave: "-1", fine: -6 }, "A saw an octave down, slightly flat: pair it with a second oscillator."],
  ["Triangle To Saw", { wave: "Triangle", wave2: "Saw", morph: 0.5 }, "Half-way between triangle and saw: a soft, round buzz; sweep Morph with an LFO."],
  ["Sine To Square", { wave: "Sine", wave2: "Square", morph: 0.35 }, "A sine with some square mixed in: round with a hollow edge; sweep Morph for a filter-like opening."],
  ["Octave Lead", { wave: "Saw", wave2: "Square", morph: 0.4, octave: "+1" }, "A bright saw-to-square blend one octave up for cutting leads."],
  ["Detuned Fifth", { wave: "Saw", coarse: 7, fine: 8 }, "Saw set a fifth up and slightly sharp: layer it with a root oscillator."],
  ["Gentle FM", { wave: "Sine", fmdepth: 0.25 }, "A sine with the FM input open: patch a modulator in for bell tones."],
  ["Strong FM", { wave: "Triangle", fmdepth: 0.7 }, "Deep through-zero FM for metallic, clangorous timbres."],
  ["Clamped FM", { wave: "Sine", fmdepth: 0.6, tzfm: false }, "Linear FM that stops at 0 Hz instead of running backwards: grittier, slightly out of tune under deep modulation."],
  ["Exponential FM", { wave: "Sine", fmdepth: 0.3, fmmode: "Exponential" }, "FM in octaves: the pitch swings up and down with the modulator, from vibrato to a snarling, inharmonic growl as the depth rises."],
  ["Sync Sweep Base", { wave: "Saw", coarse: 5 }, "Saw for hard sync: patch a gate or a faster oscillator into Sync and sweep Coarse."],
  ["Low Rumble", { wave: "Square", pw: 0.3, octave: "-3" }, "Very low pulse: use as a drone, or slow rhythmic modulation."],
];
