// SPDX-License-Identifier: MIT
// Chord Quantizer: factory presets (chord type, voicing, voice leading, strum). Chromatic uses Chord, Diatonic uses Stack.
export default [
  ["Major Triads", { mode: "Chromatic", chord: "Major", voicing: "Close" }, "Plain major triads on whatever root comes in."],
  ["Minor Seventh Stabs", { mode: "Chromatic", chord: "Minor 7", voicing: "Drop 2" }, "Minor sevenths in Drop 2 voicing: warm, jazzy stabs."],
  ["Dominant Seventh", { mode: "Chromatic", chord: "Dominant 7", voicing: "Close", inversion: 1 }, "Bluesy dominant chords, first inversion."],
  ["Diatonic Triads", { mode: "Diatonic", stack: "Triad", scale: "Major", root: "C" }, "Triads that follow the key: major, minor and diminished as the scale dictates."],
  ["Diatonic Sevenths", { mode: "Diatonic", stack: "Seventh", scale: "Natural Minor", root: "A", voicing: "Drop 2" }, "Seventh chords built from A natural minor."],
  ["Smooth Pad", { mode: "Diatonic", stack: "Seventh", scale: "Natural Minor", root: "A", voicing: "Spread", lead: "Smooth + Top" }, "Voice leading with a wide spread for a flowing pad."],
  ["Dorian Ninths", { mode: "Diatonic", stack: "Ninth", scale: "Dorian", root: "D", voicing: "Open", strum: 0.04 }, "Open ninth chords in Dorian, gently strummed."],
  ["Suspended Air", { mode: "Chromatic", chord: "Sus4", voicing: "Open", lead: "Smooth" }, "Unresolved sus4 chords that glide between roots."],
  ["Quartal Voicing", { mode: "Chromatic", chord: "Quartal", voicing: "Close" }, "Stacked fourths: modern, open and unresolved."],
  ["Power Fifths", { mode: "Chromatic", chord: "Fifth", voices: 2, voicing: "Close" }, "Two-note fifths for heavy, simple riffs."],
  ["Slow Harp Strum", { mode: "Chromatic", chord: "Add9", voicing: "Open", strum: 0.09, strumorder: "Up" }, "A wide strum rolling the chord upward like a harp."],
  ["Downward Strum", { mode: "Chromatic", chord: "Minor 9", voicing: "Drop 3", strum: 0.06, strumorder: "Down" }, "Minor ninths strummed from the top down."],
  ["Whole-Tone Augmented", { mode: "Diatonic", stack: "Triad", scale: "Whole Tone", root: "C", voicing: "Close" }, "Every chord is augmented: ambiguous and shimmering."],
  ["Top Voice Anchor", { mode: "Chromatic", chord: "Major 7", voicing: "Close", anchor: "Top", lead: "Smooth + Top" }, "Keeps the top voice near the melody while the chords change underneath."],
  ["Follow the Key", { mode: "Follow", voicing: "Drop 2", lead: "Smooth" }, "Takes the chord from a Harmony Master (set Harmony to its bus)."],
];
