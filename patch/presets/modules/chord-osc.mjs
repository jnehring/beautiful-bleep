// SPDX-License-Identifier: MIT
// Chord Osc: factory presets (see ../build-modules.mjs).
export default [
  ["Major Triad", { chord: "Major", voices: 3, shape: 0.6667, detune: 6, stereo: 0.4 }, "A plain major triad of saws, gently widened."],
  ["Minor Seventh", { chord: "Minor 7", voices: 4, shape: 0.6667, detune: 8, stereo: 0.5 }, "Warm four-note minor 7 stack for pads and stabs."],
  ["Power Fifth", { chord: "Fifth", voices: 2, shape: 0.8, detune: 5, rootLevel: 0.8 }, "Root and fifth with extra edge: rock-style power chord."],
  ["Suspended Pad", { chord: "Sus4", voices: 4, shape: 0.5, detune: 12, stereo: 0.8, glide: 0.2 }, "Open, unresolved sus4 with wide stereo and a little glide."],
  ["Dream Nine", { chord: "Major 9", voices: 5, voicing: "Open", shape: 0.3, detune: 10, stereo: 0.9 }, "Airy major 9 in open voicing with soft waves."],
  ["Hollow Fifths", { chord: "Quartal", voices: 4, voicing: "Wide", shape: 0.4, pw: 0.3, detune: 4, stereo: 0.6 }, "Stacked fourths spread wide: modern, ambiguous."],
  ["Dominant Stab", { chord: "Dominant 7", voices: 4, shape: 0.85, detune: 5, rootLevel: 0.7 }, "Buzzy dominant 7 for punchy organ-like stabs."],
  ["Jazz Voicing", { chord: "Minor 9", voices: 5, voicing: "Drop 2", shape: 0.2, detune: 3, stereo: 0.5 }, "Drop 2 minor 9 with near-sine tone: soft electric-piano colour."],
  ["First Inversion", { chord: "Major", voices: 3, inversion: 1, shape: 0.6667, detune: 6, stereo: 0.4 }, "Major triad with the third in the bass."],
  ["Sine Organ", { chord: "Major 7", voices: 4, shape: 0, detune: 2, stereo: 0.3 }, "Pure sines on a major 7: a clean drawbar-like chord."],
  ["Pulse Stack", { chord: "Minor", voices: 3, shape: 1, pw: 0.2, detune: 7, stereo: 0.6 }, "Narrow pulse minor chord: thin, nasal and synthetic."],
  ["Scale Harmony", { mode: "Scale", key: "A", scale: "Natural Minor", stack: "Seventh", voices: 4, shape: 0.6667, detune: 6, stereo: 0.5 }, "Diatonic mode: plays the matching seventh chord of A minor on each note."],
  ["Pentatonic Cloud", { mode: "Scale", key: "D", scale: "Minor Pentatonic", stack: "Ninth", voices: 5, shape: 0.5, detune: 14, stereo: 1 }, "Wide, forgiving cloud on D minor pentatonic."],
  ["Diminished Dread", { chord: "Diminished 7", voices: 4, shape: 0.9, detune: 15, stereo: 0.7 }, "Symmetrical, tense diminished 7 with heavy detune."],
  ["Sub Octaves", { chord: "Unison", voices: 3, octave: "-1", shape: 0.75, detune: 20, stereo: 0.8 }, "Detuned unison saws an octave down: thick mono-compatible bass."],
];
