// SPDX-License-Identifier: MIT
// Modal Voice: factory presets (see ../build-modules.mjs).
export default [
  ["Soft Mallet", { strike: 0.7, strikeTimbre: 0.4, geometry: 0.25, brightness: 0.5, damping: 0.4, position: 0.3, space: 0.2 }, "A gentle mallet on a resonant bar: a mellow mallet instrument."],
  ["Plucked String", { strike: 0.9, strikeTimbre: 0.7, geometry: 0, brightness: 0.65, damping: 0.5, position: 0.2, size: 0.4, space: 0.15 }, "Bright pluck on a string body; fast, natural decay."],
  ["Bowed String", { bow: 0.7, bowTimbre: 0.5, strike: 0, geometry: 0, brightness: 0.55, damping: 0.3, position: 0.25, space: 0.25 }, "A sustained bow on a string: patch Gate to hold the note."],
  ["Flute Breath", { blow: 0.65, blowTimbre: 0.45, strike: 0, geometry: 0, brightness: 0.45, damping: 0.45, size: 0.3, space: 0.2 }, "Breath through a tube-like string body: airy, sustained."],
  ["Glass Bell", { strike: 0.8, strikeTimbre: 0.6, geometry: 0.8, brightness: 0.75, damping: 0.2, position: 0.35, size: 0.35, space: 0.3 }, "Inharmonic bell body with long ring."],
  ["Wood Block", { strike: 1, strikeTimbre: 0.8, geometry: 0.35, brightness: 0.4, damping: 0.85, position: 0.4, size: 0.2, space: 0.1 }, "Short, dry knock: heavily damped bar."],
  ["Vibraphone", { strike: 0.75, strikeTimbre: 0.35, geometry: 0.3, brightness: 0.6, damping: 0.25, position: 0.5, size: 0.45, space: 0.3 }, "Long metal bar with a rounded mallet and some room."],
  ["Plate Gong", { strike: 0.85, strikeTimbre: 0.3, geometry: 0.6, brightness: 0.6, damping: 0.1, position: 0.3, size: 0.8, space: 0.4 }, "Large plate struck softly: a slow, crashing bloom."],
  ["Bowed Plate Drone", { bow: 0.55, bowTimbre: 0.6, strike: 0, geometry: 0.55, brightness: 0.5, damping: 0.15, size: 0.6, space: 0.5 }, "Bowed metal plate: eerie, evolving drone."],
  ["Dark Marimba", { strike: 0.8, strikeTimbre: 0.3, geometry: 0.2, brightness: 0.3, damping: 0.55, position: 0.15, size: 0.5, space: 0.15 }, "Woody, dark bar with short sustain."],
  ["Tiny Chimes", { strike: 0.7, strikeTimbre: 0.8, geometry: 0.7, brightness: 0.9, damping: 0.3, size: 0.1, coarse: 12, space: 0.35 }, "High, small, bright chimes an octave up."],
  ["Bowed Bell", { bow: 0.5, bowTimbre: 0.4, geometry: 0.85, brightness: 0.7, damping: 0.2, size: 0.5, space: 0.45 }, "Singing bowl-like sustained tone: hold the gate."],
  ["Blown Bottle", { blow: 0.8, blowTimbre: 0.7, strike: 0.3, geometry: 0.1, brightness: 0.4, damping: 0.5, size: 0.25, space: 0.25, contour: 0.5 }, "Breathy, hollow bottle tone with a soft attack."],
  ["Ext Resonator", { strike: 0, extLevel: 1, geometry: 0.3, brightness: 0.6, damping: 0.35, position: 0.3, size: 0.4, space: 0.25 }, "Patch any audio into Ext: it rings through the modal body."],
  ["Big Hall Strike", { strike: 0.9, strikeTimbre: 0.5, geometry: 0.5, brightness: 0.65, damping: 0.3, size: 0.7, space: 0.8 }, "A struck body in a very large room."],
];
