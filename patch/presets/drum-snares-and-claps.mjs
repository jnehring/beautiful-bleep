// SPDX-License-Identifier: MIT
// Snares & Claps: one-shot snares and handclaps. Trig and Velocity in, Out L/R.
import { category } from "./kit.mjs";
import { drum, layer, effect } from "./drum-kit.mjs";

const snare808 = () => drum("808 Snare", {
  description: "A classic 808-style snare: two tuned heads and a short burst of noise.",
  tags: ["snare", "808"],
  layers: [layer("ring-snare", "Snare", { tune: 180, tone: 0.4, snappy: 0.55, decay: 0.25 })],
});

const snare909 = () => drum("909 Snare", {
  description: "A bright, snappy 909-style snare with plenty of rattle.",
  tags: ["snare", "909", "house"],
  layers: [layer("punch-snare", "Snare", { tune: 200, tone: 0.6, snappy: 0.75, decay: 0.3 })],
});

const fat = () => drum("Fat Snare", {
  description: "A low, long snare with a quiet clap underneath for width and body.",
  tags: ["snare", "layered", "fat"],
  layers: [layer("punch-snare", "Snare", { tune: 160, tone: 0.45, snappy: 0.7, decay: 0.45 }),
           layer("ring-clap", "Clap", { tone: 1200, decay: 0.3 }, { gain: -8 })],
});

const bigRoom = () => drum("Big Room Snare", {
  description: "A snappy snare into a big, damped room: an arena backbeat.",
  tags: ["snare", "reverb", "big"],
  layers: [layer("punch-snare", "Snare", { tune: 190, tone: 0.55, snappy: 0.8, decay: 0.5 })],
  effects: [effect("reverb", "Room", { size: 0.7, decay: 1.8, damping: 0.5, mix: 0.35 })],
});

const macro = () => drum("Macro Snare", {
  description: "The Macro Osc snare model: a synthetic snare with a tight, papery body.",
  tags: ["snare", "synthetic"],
  layers: [layer("macro-osc", "Snare", { model: "Snare", octave: -1, tone: 0.7, shape: 0.5, blend: 0.3, decay: 0.35 })],
});

const noise = () => drum("Noise Snare", {
  description: "A noise-bank snare: a cloud of filtered noise with a sharp click and almost no tone.",
  tags: ["snare", "noise", "electro"],
  layers: [layer("perc-voice", "Snare", { engine: "Noise Bank", pitch: 220, tone: 0.6, click: 0.6, decay: 0.3,
                                          damp: 0.3, sweep: 0.3 }, { gain: -3 })],
});

const clap808 = () => drum("808 Clap", {
  description: "An 808-style handclap: four quick noise bursts and a short tail.",
  tags: ["clap", "808"],
  layers: [layer("ring-clap", "Clap", { tone: 1100, decay: 0.3, spread: 0.011, bursts: 4 })],
});

const clap909 = () => drum("909 Clap", {
  description: "A brighter, tighter 909-style handclap.",
  tags: ["clap", "909", "house"],
  layers: [layer("punch-clap", "Clap", { tone: 1500, decay: 0.35, spread: 0.008, bursts: 4 })],
});

const wide = () => drum("Wide Clap", {
  description: "Two differently tuned claps panned hard left and right: a wide, crowd-like clap.",
  tags: ["clap", "stereo", "wide"],
  layers: [layer("punch-clap", "Clap L", { tone: 1400, decay: 0.3, spread: 0.007, bursts: 4 }, { pan: -0.6 }),
           layer("ring-clap", "Clap R", { tone: 1700, decay: 0.35, spread: 0.014, bursts: 5 }, { pan: 0.6 })],
});

const room = () => drum("Room Clap", {
  description: "A clap in a small, live room.",
  tags: ["clap", "reverb"],
  layers: [layer("punch-clap", "Clap", { tone: 1300, decay: 0.4, spread: 0.01, bursts: 4 })],
  effects: [effect("reverb", "Room", { size: 0.4, decay: 1, damping: 0.4, mix: 0.3 })],
});

export default category("Drums/Snares & Claps", "One-shot snares and handclaps for the backbeat: patch a trigger into Trig.",
  [snare808, snare909, fat, bigRoom, macro, noise, clap808, clap909, wide, room]);
