// SPDX-License-Identifier: MIT
// Quantizer: factory presets (scale, root, range, hysteresis, glide, rounding).
export default [
  ["C Major", { scale: "Major", root: "C" }, "Snaps any pitch to C major: the safe, bright default."],
  ["Natural Minor", { scale: "Natural Minor", root: "A" }, "A natural minor: melancholic and familiar."],
  ["Minor Pentatonic", { scale: "Minor Pentatonic", root: "E" }, "Five notes that can't clash: great for random melodies."],
  ["Major Pentatonic", { scale: "Major Pentatonic", root: "G" }, "Open and folky: nothing sounds wrong."],
  ["Dorian Walk", { scale: "Dorian", root: "D" }, "Minor with a lifted sixth: cool, jazzy lines."],
  ["Lydian Float", { scale: "Lydian", root: "F" }, "A major scale with a raised fourth: dreamy and airy."],
  ["Phrygian Dark", { scale: "Phrygian", root: "E" }, "Flat second gives a tense, Spanish-tinged colour."],
  ["Harmonic Minor", { scale: "Harmonic Minor", root: "A" }, "Dramatic minor with a leading tone."],
  ["Blues", { scale: "Blues", root: "C" }, "Blue notes for gritty, soulful lines."],
  ["Whole Tone Dream", { scale: "Whole Tone", root: "C" }, "Six equal steps: ambiguous, floating melodies."],
  ["Hirajoshi", { scale: "Hirajoshi", root: "D" }, "A five-note scale with an east-Asian flavour."],
  ["Gliding Major", { scale: "Major", root: "C", glide: 0.15 }, "A little slide between notes for a singing feel."],
  ["Wide Range", { scale: "Minor Pentatonic", root: "A", range: 3, hysteresis: 0.2 }, "Stretches the input over three octaves with a steadier hold."],
  ["Round Down", { scale: "Natural Minor", root: "C", rounding: "Down" }, "Always rounds down to the scale note below."],
  ["Round Up Chromatic", { scale: "Chromatic", root: "C", rounding: "Up", hysteresis: 0 }, "Chromatic, rounding up: plain semitone steps with no hold."],
];
