// SPDX-License-Identifier: MIT
// Multi Filter: factory presets (see ../build-modules.mjs). The Mode knob: 0 LP, 0.33 BP, 0.67 HP, 1 notch.
export default [
  ["Warm Low-Pass", { type: "SVF Multimode", cutoff: 900, resonance: 0.15 }, "Gentle, round low-pass for taking the fizz off a saw."],
  ["Dark Room", { type: "1-Pole Low-pass", cutoff: 400 }, "A soft 6 dB slope that darkens everything without a peak."],
  ["Ladder Bass", { type: "Ladder Tanh", cutoff: 260, resonance: 0.55, drive: 0.3 }, "Fat ladder low-pass with some bite from the resonance."],
  ["Acid Squelch", { type: "Diode Ladder Tanh", cutoff: 500, resonance: 0.8, drive: 0.4, keytrack: 0.5 }, "Screaming diode ladder: sweep the cutoff and add an envelope."],
  ["Self-Oscillating Ladder", { type: "Ladder Linear", cutoff: 1200, resonance: 0.97 }, "Resonance at the top makes the ladder ring as a sine; play it with Key Track."],
  ["Telephone", { type: "SVF Multimode", mode: "BP", cutoff: 1500, resonance: 0.35 }, "Narrow band-pass: a thin, nasal voice."],
  ["Thin Air", { type: "SVF Multimode", mode: "HP", cutoff: 3500, resonance: 0.2 }, "High-pass that leaves just the sparkle."],
  ["Rumble Cut", { type: "1-Pole High-pass", cutoff: 90 }, "Clears out the sub-bass below 90 Hz."],
  ["Notch Sweep", { type: "SVF Multimode", mode: "Notch", cutoff: 1800, resonance: 0.6 }, "A notch you can sweep for a hollow, phasing colour."],
  ["Vocal Peak", { type: "SVF Peaking", cutoff: 1100, resonance: 0.65 }, "A resonant peak with the lows and highs still intact."],
  ["Presence Boost", { type: "SVF Band Shelf", cutoff: 4000, resonance: 0.3, gain: 6 }, "Lifts the upper mids by 6 dB."],
  ["Bass Shelf", { type: "1-Pole Low Shelf", cutoff: 200, gain: 8 }, "Adds weight under 200 Hz."],
  ["Air Shelf", { type: "1-Pole High Shelf", cutoff: 7000, gain: 6 }, "A little air on top."],
  ["Slow Phaser", { type: "Phaser 2-Pole ×2", cutoff: 900, resonance: 0.6, mode: "BP", mix: 0.5 }, "Notches that sound best when you modulate the cutoff with an LFO."],
  ["Jet Flanger", { type: "Flanger", cutoff: 700, resonance: 0.75, mix: 0.5 }, "Comb filtering: sweep the cutoff slowly for a jet sound."],
  ["Gritty Drive", { type: "SVF Saturating (Rough)", cutoff: 1400, resonance: 0.4, drive: 0.75 }, "Overdriven, saturating state-variable filter."],
];
