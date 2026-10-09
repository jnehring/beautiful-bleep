// SPDX-License-Identifier: MIT
// Kicks: one-shot bass drums. Trig and Velocity in, Out L/R.
import { category } from "./kit.mjs";
import { drum, layer, effect } from "./drum-kit.mjs";

const boom808 = () => drum("808 Boom", {
  description: "A long, round 808-style boom: a low sine with a gentle pitch drop and a hint of drive.",
  tags: ["kick", "808", "sub"],
  layers: [layer("ring-kick", "Kick", { tune: 45, decay: 1.8, sweep: 0.35, tone: 0.15, drive: 0.1 })],
});

const punch909 = () => drum("909 Punch", {
  description: "A short, punchy 909-style kick with a fast sweep and a clicky attack.",
  tags: ["kick", "909", "house"],
  layers: [layer("punch-kick", "Kick", { tune: 55, decay: 0.45, sweep: 0.6, attack: 0.7, drive: 0.35 })],
});

const techno = () => drum("Techno Kick", {
  description: "A hard, driven kick through a saturating ladder filter: thick, warehouse-ready.",
  tags: ["kick", "techno", "distorted"],
  layers: [layer("punch-kick", "Kick", { tune: 50, decay: 0.7, sweep: 0.7, attack: 0.9, drive: 0.85 })],
  effects: [effect("filter", "Filter", { cutoff: 4500, resonance: 0.1, drive: 0.4, type: "Ladder Tanh" })],
});

const subDrop = () => drum("Sub Drop", {
  description: "A very low, long kick that dives into the sub range, low-passed to pure weight.",
  tags: ["kick", "sub", "boom"],
  layers: [layer("ring-kick", "Kick", { tune: 34, decay: 2.6, sweep: 0.8, tone: 0, drive: 0 })],
  effects: [effect("filter", "Low-pass", { cutoff: 300, resonance: 0.05 })],
});

const layered = () => drum("Layered Kick", {
  description: "A short, bright click kick on top of a rounder body kick: punch and weight together.",
  tags: ["kick", "layered"],
  layers: [layer("punch-kick", "Click", { tune: 70, decay: 0.2, sweep: 0.9, attack: 1, drive: 0.5 }, { gain: -6 }),
           layer("ring-kick", "Body", { tune: 48, decay: 0.9, sweep: 0.3, tone: 0.2 })],
});

const loFi = () => drum("Lo-Fi Kick", {
  description: "The Macro Osc kick model, darkened and crunched by a driven ladder filter.",
  tags: ["kick", "lo-fi", "dusty"],
  layers: [layer("macro-osc", "Kick", { model: "Kick", octave: -2, tone: 0.6, shape: 0.7, blend: 0.5, decay: 0.5 })],
  effects: [effect("filter", "Filter", { cutoff: 1800, resonance: 0.2, drive: 0.5, type: "Ladder Tanh" })],
});

const membrane = () => drum("Membrane Kick", {
  description: "A modal drum head tuned low: an acoustic-leaning kick with a soft beater click.",
  tags: ["kick", "acoustic", "modal"],
  layers: [layer("perc-voice", "Kick", { engine: "Modal", pitch: 50, tone: 0.05, click: 0.5, decay: 0.7,
                                         sweep: 0.6, damp: 0.5, spread: 0 })],
});

const gabber = () => drum("Gabber Kick", {
  description: "A fully driven kick, wavefolded and low-passed: the distorted hardcore thump.",
  tags: ["kick", "gabber", "hardcore", "distorted"],
  layers: [layer("punch-kick", "Kick", { tune: 60, decay: 0.9, sweep: 0.9, attack: 1, drive: 1 })],
  effects: [effect("wavefolder", "Folder", { fold: 0.35, source: "Input" }),
            effect("filter", "Low-pass", { cutoff: 5000, resonance: 0.1 }),
            effect("vca", "Trim", { gain: 0.7, response: "Linear" })],
});

const deep = () => drum("Deep Kick", {
  description: "A warm, mid-length kick, rolled off above 2.5 kHz for deep house and dub.",
  tags: ["kick", "deep house", "dub"],
  layers: [layer("ring-kick", "Kick", { tune: 52, decay: 0.6, sweep: 0.4, tone: 0.4, drive: 0.15 })],
  effects: [effect("filter", "Low-pass", { cutoff: 2500, resonance: 0.15 })],
});

const fm = () => drum("FM Kick", {
  description: "An FM kick: a low carrier with a fast-falling index for a rubbery, electronic thud.",
  tags: ["kick", "fm", "electro"],
  layers: [layer("perc-voice", "Kick", { engine: "FM", pitch: 45, tone: 0.05, morph: 0.4, click: 0.4, decay: 0.5,
                                         sweep: 0.7, damp: 0.4, spread: 0 })],
});

export default category("Drums/Kicks", "One-shot bass drums, from 808 boom to distorted gabber: patch a trigger into Trig.",
  [boom808, punch909, techno, subDrop, layered, loFi, membrane, gabber, deep, fm]);
