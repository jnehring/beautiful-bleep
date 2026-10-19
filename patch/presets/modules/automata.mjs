// SPDX-License-Identifier: MIT
// Automata: factory presets (system, rule/grid/turn/rewrite sets, density, interference, scale).
export default [
  ["Rule 30 Ring", { mode: "Ring", rule: 30, cells: 16, density: 0, sync: "1/16", scale: "Minor Pentatonic" }, "One seed cell grows into a lopsided, never-quite-repeating pattern."],
  ["Rule 90 Lace", { mode: "Ring", rule: 90, cells: 16, density: 0, sync: "1/16", scale: "Dorian", gatelength: 0.4 }, "A symmetrical lattice: the melody mirrors itself as it grows."],
  ["Rule 110 Drift", { mode: "Ring", rule: 110, cells: 24, density: 0.3, sync: "1/16", scale: "Natural Minor", octaves: 2 }, "Structures drift sideways through a longer ring."],
  ["Rule 184 Traffic", { mode: "Ring", rule: 184, cells: 12, density: 0.4, sync: "1/8", scale: "Major Pentatonic" }, "Cells move along the ring like cars in traffic: slow, flowing lines."],
  ["Garden Grid", { mode: "Grid", gridrule: "B3/S23", density: 0.35, sync: "1/16", scale: "Lydian" }, "A small wrapping world: colonies grow, collide and die out."],
  ["Mazy Grid", { mode: "Grid", gridrule: "B3/S12345", density: 0.2, sync: "1/16", scale: "Minor Pentatonic" }, "Structures build up slowly into a maze of long-lived notes."],
  ["Seeds Burst", { mode: "Grid", gridrule: "B2/S", density: 0.15, sync: "1/16", gatelength: 0.25, scale: "Hirajoshi" }, "Every cell lives one step: a restless, sparkling grid."],
  ["Gentle Chain", { mode: "Chain", sync: "1/8", scale: "Major Pentatonic", gatelength: 0.8, octaves: 2 }, "Mostly stepwise motion with occasional rests."],
  ["Student Chain", { mode: "Chain", learn: 0.6, sync: "1/8", scale: "Dorian", octaves: 2 }, "Patch a melody into Learn: the chain picks up its habits."],
  ["Wandering Walker", { mode: "Walker", turns: "RL", density: 0, sync: "1/16", scale: "Minor Pentatonic" }, "A walker with two turn rules draws a looping highway."],
  ["Crowded Walker", { mode: "Walker", turns: "RLLR", density: 0.6, sync: "1/16", scale: "Phrygian" }, "A walker among old marks: gaps and bursts."],
  ["Wide Walker", { mode: "Walker", turns: "RRLLRL", density: 0.3, sync: "1/16", octaves: 3, scale: "Whole Tone" }, "Six turn rules: a sprawling, unpredictable path over three octaves."],
  ["Cascade Phrase", { mode: "Rewrite", rules: "Cascade", sync: "1/16", scale: "Natural Minor" }, "A phrase that rewrites itself every time it ends."],
  ["Climbing Phrase", { mode: "Rewrite", rules: "Climb", sync: "1/16", octaves: 2, scale: "Dorian" }, "Rising lines with octave jumps."],
  ["Breathing Tide", { mode: "Rewrite", rules: "Tide", sync: "1/8", gatelength: 0.7, scale: "Major Pentatonic" }, "Slow phrases with rests that breathe."],
  ["Restless Ring", { mode: "Ring", rule: 90, cells: 20, density: 0.2, interference: 0.5, sync: "1/16", scale: "Hirajoshi" }, "Interference keeps nudging the ring: it never settles into a pattern."],
  ["Fork Phrase", { mode: "Rewrite", rules: "Fork", interference: 0.3, sync: "1/16", scale: "Blues" }, "A rewriting phrase with a few mutations each pass."],
  ["Free Grid", { mode: "Grid", density: 0.4, sync: "Free", rate: 7, scale: "Minor Pentatonic" }, "Ignores the song tempo and steps at a set rate."],
];
