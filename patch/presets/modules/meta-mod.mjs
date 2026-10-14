// SPDX-License-Identifier: MIT
// Meta Mod: factory presets (see ../build-modules.mjs). Algorithm: 0 crossfade, 1 fold, 2 analog ring, 3 digital ring, 4 bitwise, 5 comparator, 6 vocoder, 7 Chebyshev.
export default [
  ["Analog Ring", { algorithm: 2, timbre: 0.2, oscTune: 0 }, "Diode-style ring modulation with the internal oscillator."],
  ["Ring Bells", { algorithm: 2, timbre: 0.3, oscTune: 7, oscShape: 0, oscOctave: "+1" }, "Inharmonic, bell-like sidebands from a sine carrier."],
  ["Tremolo AM", { algorithm: 3, timbre: 1, oscTune: -12, oscOctave: "-3", mix: 1 }, "Amplitude modulation: slow oscillator wobbles the sound."],
  ["Crossfade Blend", { algorithm: 0, timbre: 0.5 }, "Equal-power mix of carrier and modulator; sweep Timbre."],
  ["Folded Input", { algorithm: 1, timbre: 0.6, modLevel: 1.2 }, "Wavefolded carrier with the modulator as fold source."],
  ["Digital Ring", { algorithm: 3, timbre: 0, oscTune: 5 }, "Clean digital ring modulation: only sum and difference tones."],
  ["Bitwise XOR", { algorithm: 4, timbre: 0.5, bitwiseOp: "XOR" }, "Gritty digital combination of two sources."],
  ["Bitwise AND", { algorithm: 4, timbre: 0.4, bitwiseOp: "AND", carrierLevel: 1.3, modLevel: 1.3 }, "Hollow, buzzy intersection of the two waveforms."],
  ["Comparator Edge", { algorithm: 5, timbre: 0.5, oscShape: 0.5 }, "Hard-edged comparator tones that follow the input."],
  ["Robot Vocoder", { algorithm: 6, timbre: 0.5, quality: "High (4×)" }, "Voice or drums in Modulator talk through a buzzy Carrier."],
  ["Harmonic Pick", { algorithm: 7, timbre: 0.3 }, "Chebyshev: turns a sine into its Nth harmonic; sweep Timbre."],
  ["Harmonic Shimmer", { algorithm: 7, timbre: 0.7, mix: 0.6 }, "Added harmonics blended under the dry signal."],
  ["Algorithm Drift", { algorithm: 3.5, timbre: 0.5, oscTune: 3 }, "Between two algorithms: modulate Algorithm for morphing."],
  ["Sub Osc Ring", { algorithm: 2, timbre: 0.1, oscOctave: "-2", oscShape: 0.3, oscTune: 0 }, "Low internal oscillator ring-modulates for growling bass."],
  ["Metallic Clang", { algorithm: 2, timbre: 0.8, oscTune: 13, oscOctave: "+2", oscShape: 0.7, mix: 0.8 }, "Mismatched diodes and a bright oscillator: clangorous metal."],
];
