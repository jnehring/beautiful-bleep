// SPDX-License-Identifier: MIT
// Formant Osc: factory presets (see ../build-modules.mjs).
export default [
  ["Vowel Tone", { formant: 1.5, narrow: 0.3, body: 0.7, tracking: "Fixed" }, "A sung vowel: the peak stays fixed while the note moves."],
  ["Talking Bass", { octave: -1, formant: 2, narrow: 0.4, body: 0.8 }, "Bass with a resonant peak: put an envelope on Formant."],
  ["Wah Lead", { formant: 1.5, narrow: 0.35, body: 0.9 }, "Sweep Formant with an LFO for a wah-pedal lead."],
  ["Filter-less Squelch", { octave: -1, formant: 3, narrow: 0.6, body: 0.5 }, "Acid-like squelch with no filter: envelope the Formant."],
  ["Hollow Ghost", { octave: -1, formant: 0, narrow: 0.2, body: 0.5, start: "Cosine" }, "Formant near zero: a hollow, soft pulse; sweep through it."],
  ["Reverse Formant", { formant: -2, narrow: 0.3, body: 0.6 }, "Negative formant runs backwards: a different, hollow colour."],
  ["Wide Choir", { formant: 1.5, narrow: 0.25, body: 0.6, spread: 0.12, reset: 0.8, tracking: "Fixed" }, "Spread and drifting reset: a wide, breathy choir pad."],
  ["Two Peaks", { formant: 2, spread: 0.7, narrow: 0.3, body: 0.5 }, "Left and right ears get different formants for a two-peak sound."],
  ["Buzzy Saw", { formant: 3, narrow: 0.8, body: 0.3 }, "Narrow, bright bursts: a buzzy, sawlike tone."],
  ["Soft Sine Voice", { formant: 1, narrow: 0.05, body: 0.8 }, "A wide, smooth burst: mellow and almost sinelike."],
  ["Phasing Roll", { formant: 2, narrow: 0.4, body: 0.5, roll: 0.35 }, "Roll moves the window; modulate it for phasing against the square."],
  ["Inharmonic Ring", { formant: 2.3, narrow: 0.3, body: 0.5, reset: 0.3 }, "Low reset lets the formant drift: ring-modulated, bell-like colours."],
  ["FM Formant", { formant: 2, narrow: 0.3, body: 0.6, fmDepth: 0.3 }, "Open FM depth: patch an audio source to Formant FM for growling timbre."],
  ["Pinging Sub", { octave: -4, formant: 3, narrow: 0.5, body: 0.9 }, "Very low note turns into rhythmic pings: odd modulation or percussion."],
  ["Bright Bell High", { octave: 1, formant: 2, narrow: 0.3, body: 0.7, quality: "High (2×)" }, "Clean high register thanks to High quality."],
];
