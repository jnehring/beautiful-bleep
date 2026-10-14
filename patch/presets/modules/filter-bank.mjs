// SPDX-License-Identifier: MIT
// Filter Bank: factory presets (see ../build-modules.mjs).
export default [
  ["Flat Bank", { q: 2.2, mix: 1 }, "All ten bands at unity: a transparent starting point."],
  ["Warm Tilt", { tilt: -2.5, q: 1.5 }, "Tilts the spectrum darker."],
  ["Bright Tilt", { tilt: 2.5, q: 1.5 }, "Tilts the spectrum brighter."],
  ["Scooped Mids", { level4: -14, level5: -18, level6: -14, q: 1.2 }, "Classic smile curve: mids pulled down."],
  ["Telephone Bands", { level1: -40, level2: -30, level3: -6, level4: 3, level5: 3, level6: -6, level7: -20, level8: -40, level9: -60, level10: -60, q: 2 }, "Only the speech range survives."],
  ["Odd Harmonics", { oddEven: -1, q: 6 }, "Only odd bands: hollow, clarinet-like colour."],
  ["Even Harmonics", { oddEven: 1, q: 6 }, "Only even bands: octave-ish, reedy colour."],
  ["Scanning Window", { width: 2, scan: 0.3, q: 5 }, "Two-band window: sweep Scan with an LFO or sequencer."],
  ["Single Band Pinger", { width: 1, scan: 0.5, q: 12, attack: 0.001 }, "One band at a time: sequence Scan for a melodic filter."],
  ["Phaser Sweep", { q: 4, shift: 0.5, oddEven: 0.3, width: 6 }, "Modulate Shift with an LFO to slide the bands like a phaser."],
  ["Harmonic Comb", { tuning: "Harmonic", q: 14, mix: 0.8 }, "Bands on harmonics of the pitch input: resonant comb tones."],
  ["Scale Chimes", { tuning: "Scale", scale: "Minor Pentatonic", root: "A", q: 20, mix: 0.8 }, "Bands snapped to a scale: noise and pads ring with chords."],
  ["Robot Vocoder", { vocode: 1, q: 8, attack: 0.002, release: 0.06 }, "Patch a voice into the sidechain and a buzzy synth into the input."],
  ["Soft Vocoder", { vocode: 0.8, q: 4, release: 0.15, tilt: 1 }, "Smoother vocoder for pads and choirs."],
  ["Stretched Bands", { spacing: 1.6, shift: -0.3, q: 10, tilt: -1 }, "Wider band spacing: inharmonic, metallic resonances."],
];
