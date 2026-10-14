// SPDX-License-Identifier: MIT
// Swarm: factory presets (see ../build-modules.mjs).
export default [
  ["Minor Cloud", { chord: "Minor 7", count: 8, spread: 0.3, detune: 8, drift: 0.2, width: 0.6 }, "The default pad: eight oscillators over a minor 7, gently drifting."],
  ["Unison Supersaw", { chord: "Unison", count: 12, spread: 0, detune: 18, drift: 0.1, width: 0.9 }, "A pile of detuned voices on one note: classic wide lead or pad."],
  ["Octave Choir", { chord: "Octaves", count: 8, spread: 0.5, range: 3, detune: 6, drift: 0.25, width: 0.7 }, "Voices spread over octaves: big, huge, simple."],
  ["Fifths Shimmer", { chord: "Fifths", count: 10, spread: 0.6, detune: 5, drift: 0.3, width: 0.8 }, "Stacked fifths: open and bright."],
  ["Major Bloom", { chord: "Major 9", count: 10, spread: 0.7, detune: 10, drift: 0.25, glide: 1.5, width: 0.8 }, "Slow glide lets the chord bloom out from the root; major 9 colour."],
  ["Dark Quartal", { chord: "Quartal", count: 8, spread: 0.5, detune: 6, warp: 0.2, drift: 0.3, width: 0.6 }, "Stacked fourths with a little warp: ambiguous and cold."],
  ["Pentatonic Rain", { chord: "Minor Pentatonic", count: 12, spread: 0.8, range: 3, pattern: "Random", detune: 7, drift: 0.4, width: 1 }, "Notes of the scale scattered randomly: soft, safe, endless."],
  ["Blues Haze", { chord: "Blues", count: 9, spread: 0.6, pattern: "Alternate", detune: 9, drift: 0.35, width: 0.8 }, "Blues-scale swarm: gritty and a little sad."],
  ["Whole Tone Dream", { chord: "Whole Tone", count: 10, spread: 0.7, detune: 8, drift: 0.3, warp: 0.15, width: 0.9 }, "Floating, directionless whole-tone cloud."],
  ["Hirajoshi Garden", { chord: "Hirajoshi", count: 8, spread: 0.7, pattern: "Outer", detune: 5, drift: 0.2, width: 0.7 }, "Pentatonic Japanese scale; Outer pattern fills from the edges in."],
  ["Warped Glass", { chord: "Major 7", count: 8, spread: 0.4, warp: 0.6, detune: 6, drift: 0.3, width: 0.7, quality: "High (2×)" }, "Warp bends the oscillator shapes: glassy, metallic colour."],
  ["Cross-FM Bells", { chord: "Minor 9", count: 6, spread: 0.5, crossfm: 0.35, detune: 3, drift: 0.2, width: 0.6, quality: "High (2×)" }, "Voices modulate each other for bell-like, inharmonic shimmer."],
  ["Cluster Wall", { chord: "Cluster", count: 14, spread: 0.6, detune: 15, drift: 0.5, crossfm: 0.1, width: 1 }, "Tight semitone cluster: dense, tense texture."],
  ["Chromatic Swarm", { chord: "Chromatic", count: 16, spread: 1, range: 4, detune: 25, drift: 0.7, crossfm: 0.2, glide: 0.8, width: 1 }, "All sixteen voices running through the chromatic scale: a insect-like storm."],
  ["Sub Swarm", { chord: "Unison", count: 6, octave: -2, spread: 0, detune: 12, drift: 0.2, stack: "Up", width: 0.4 }, "Low detuned swarm for fat, moving sub bass."],
];
