// SPDX-License-Identifier: MIT
// Harmony Master: factory presets (key, scale, chord quality, source, advance, octave).
export default [
  ["C Major Home", { key: "C", scale: "Major", quality: "Diatonic Triad", degree: 1 }, "The board in C major on the tonic triad."],
  ["A Minor Home", { key: "A", scale: "Natural Minor", quality: "Diatonic Triad", degree: 1 }, "A natural minor, tonic triad: a sad, simple centre."],
  ["Seventh Colours", { key: "C", scale: "Major", quality: "Diatonic Seventh", degree: 2 }, "Diatonic sevenths on the second degree: soft and jazzy."],
  ["Dorian Groove", { key: "D", scale: "Dorian", quality: "Minor 7", degree: 1 }, "D Dorian with a minor seventh chord."],
  ["Lydian Lift", { key: "F", scale: "Lydian", quality: "Major 7♯11", degree: 1 }, "A bright, floating Lydian centre."],
  ["Phrygian Tension", { key: "E", scale: "Phrygian", quality: "Minor", degree: 1 }, "E Phrygian with a minor chord: dark and tense."],
  ["Harmonic Minor Drama", { key: "A", scale: "Harmonic Minor", quality: "Diatonic Seventh", degree: 5 }, "The dominant of A harmonic minor: ready to resolve."],
  ["Blues Dominant", { key: "A", scale: "Blues", quality: "Dominant 7", degree: 1 }, "Dominant seventh in an A blues scale."],
  ["Pentatonic Open", { key: "G", scale: "Major Pentatonic", quality: "Sus2", degree: 1 }, "Open pentatonic sus2: nothing to resolve."],
  ["Progression Stepper", { key: "C", scale: "Major", source: "Progression", advance: "Transport", quality: "Diatonic Triad" }, "Plays its stored progression, moving with the song."],
  ["Triggered Changes", { key: "C", scale: "Natural Minor", source: "Progression", advance: "Trigger", quality: "Diatonic Seventh" }, "Steps the progression on each pulse into Next."],
  ["Chord Detector", { key: "C", scale: "Major", source: "Detect", octave: 0 }, "Follows chords you play into Notes."],
  ["Low Bass Root", { key: "F", scale: "Major", quality: "Fifth", octave: -1, degree: 4 }, "Fourth degree power chord, an octave down: a strong bass centre."],
  ["Quartal Mood", { key: "D", scale: "Dorian", quality: "Quartal", degree: 1 }, "Stacked fourths over D Dorian for modern pads."],
  ["Bus B Whole Tone", { key: "C", scale: "Whole Tone", quality: "Augmented", bus: "B", degree: 1 }, "Floating whole-tone harmony on bus B."],
];
