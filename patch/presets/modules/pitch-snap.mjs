// SPDX-License-Identifier: GPL-3.0-only
// Pitch Snap: factory presets (see ../build-modules.mjs).
export default [
  ["Hard Snap", { amount: 1, speed: 1, drift: 0, scale: "Chromatic", formant: true, offset: 0, tracking: "Steady", latency: "Aligned" }, "Every note jumps straight to the nearest semitone: the classic stepped sound."],
  ["Natural Major", { amount: 1, speed: 0.55, drift: 0.2, drifttime: 0.3, root: "C", scale: "Major", formant: true }, "A gentle pull toward the C major scale that still sounds sung."],
  ["Gentle Nudge", { amount: 0.5, speed: 0.35, drift: 0.3, scale: "Chromatic", formant: true }, "Half the error is corrected, slowly: a tired voice gets a little help."],
  ["Keep the Vibrato", { amount: 1, speed: 0.85, drift: 1, drifttime: 0.35, scale: "Chromatic", formant: true }, "The average pitch lands on the note while the vibrato around it survives."],
  ["Drifty Slide", { amount: 1, speed: 0.2, drift: 0.6, drifttime: 0.5, scale: "Chromatic", formant: true }, "Slow retune with plenty of drift: notes wander in from the side."],
  ["Pentatonic Lock", { amount: 1, speed: 0.8, drift: 0.25, root: "A", scale: "Minor Pentatonic", formant: true }, "Whatever you sing ends up on an A minor pentatonic note."],
  ["Blues Voice", { amount: 1, speed: 0.7, drift: 0.3, root: "E", scale: "Blues", formant: true }, "Pulls toward the E blues scale, with the speed of a bent note."],
  ["Whole Tone Dream", { amount: 1, speed: 0.9, drift: 0, root: "C", scale: "Whole Tone", formant: true }, "Hard retune onto a whole-tone scale: floating, unresolved."],
  ["Octave Up", { amount: 1, speed: 1, offset: 12, scale: "Chromatic", formant: true }, "Snaps, then sings an octave higher with the vowel left where it was."],
  ["Fifth Above", { amount: 1, speed: 0.9, offset: 7, root: "C", scale: "Major", formant: true }, "A harmony voice a fifth above the corrected note."],
  ["Octave Down", { amount: 1, speed: 1, offset: -12, scale: "Chromatic", formant: true, low: 100, high: 1200 }, "A second voice an octave below, which keeps the vowel."],
  ["Chipmunk", { amount: 1, speed: 1, offset: 12, scale: "Chromatic", formant: false }, "Formant Preserve off: raising the pitch drags the vowel up too."],
  ["Follow the Band", { amount: 1, speed: 0.7, drift: 0.3, source: "Bus A", target: "Chord + Scale", formant: true }, "Takes its notes from a Harmony Master on bus A: chord tones first, then the scale."],
  ["Chord Tones Only", { amount: 1, speed: 0.9, drift: 0.2, source: "Bus A", target: "Chord", formant: true }, "Only the notes of the current chord are allowed."],
  ["Bass Corrector", { amount: 1, speed: 0.8, drift: 0.2, scale: "Chromatic", low: 35, high: 400, tracking: "Rock Solid", latency: "Aligned" }, "Low range and a firm tracker for a bass."],
  ["Quick Monitor", { amount: 1, speed: 0.9, drift: 0, scale: "Chromatic", low: 100, high: 900, tracking: "Fast", latency: "Quick" }, "As little delay as it can: for monitoring a voice while singing."],
];
