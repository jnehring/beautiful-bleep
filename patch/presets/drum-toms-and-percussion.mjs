// SPDX-License-Identifier: MIT
// Toms & Percussion: toms, hand drums and small percussion. Trig and Velocity in, Out L/R.
import { category } from "./kit.mjs";
import { drum, layer, effect, HP } from "./drum-kit.mjs";

const tom808 = () => drum("808 Tom", {
  description: "A deep 808-style tom with a soft pitch bend; retune it for high, mid and low toms.",
  tags: ["tom", "808"],
  layers: [layer("ring-tom", "Tom", { tune: 90, decay: 0.6, bend: 0.3, noise: 0.2 })],
});

const tom909 = () => drum("909 Tom", {
  description: "A punchy 909-style mid tom with a strong pitch bend.",
  tags: ["tom", "909"],
  layers: [layer("punch-tom", "Tom", { tune: 140, decay: 0.45, bend: 0.5, noise: 0.2 })],
});

const syn = () => drum("Syn Tom", {
  description: "An FM syn-tom with a steep downward sweep: the classic electronic pew.",
  tags: ["tom", "fm", "syndrum", "80s"],
  layers: [layer("perc-voice", "Tom", { engine: "FM", pitch: 120, tone: 0.1, morph: 0.2, click: 0.3, decay: 0.5,
                                        sweep: 0.8, damp: 0.3 })],
});

const floor = () => drum("Floor Tom", {
  description: "A low, long floor tom in a small room.",
  tags: ["tom", "floor", "reverb"],
  layers: [layer("punch-tom", "Tom", { tune: 70, decay: 1, bend: 0.3, noise: 0.3 })],
  effects: [effect("reverb", "Room", { size: 0.35, decay: 0.8, mix: 0.2 })],
});

const conga = () => drum("Conga", {
  description: "A modal conga: a warm, slightly bending skin with a palm slap.",
  tags: ["percussion", "conga", "latin", "modal"],
  layers: [layer("perc-voice", "Conga", { engine: "Modal", pitch: 220, tone: 0.3, click: 0.4, decay: 0.3, sweep: 0.15,
                                          damp: 0.5 })],
});

const cowbell = () => drum("Cowbell", {
  description: "An 808-style cowbell: two detuned square waves through a band-pass.",
  tags: ["percussion", "cowbell", "808"],
  layers: [layer("ring-cowbell", "Cowbell", { tune: 0, decay: 0.4, tone: 0.5 })],
});

const clave = () => drum("Clave", {
  description: "A short, woody clave click.",
  tags: ["percussion", "clave", "latin"],
  layers: [layer("ring-rim", "Clave", { voice: "Clave", tune: 0, decay: 1 })],
});

const rimshot = () => drum("Rimshot", {
  description: "A sharp, short rimshot.",
  tags: ["percussion", "rim"],
  layers: [layer("punch-rim", "Rim", { tune: 0, decay: 1.2 })],
});

const shaker = () => drum("Shaker", {
  description: "A short burst of high noise-bank grains, high-passed: a shaker for 16ths.",
  tags: ["percussion", "shaker", "noise"],
  layers: [layer("perc-voice", "Shaker", { engine: "Noise Bank", pitch: 3500, tone: 0.9, click: 0, decay: 0.09,
                                           sweep: 0, damp: 0.3 }, { gain: 5 })],
  effects: [effect("filter", "High-pass", { cutoff: 4000, mode: HP })],
});

const tambourine = () => drum("Tambourine", {
  description: "Jingles from a bright open hat over a quiet, low clave for the skin.",
  tags: ["percussion", "tambourine"],
  layers: [layer("punch-hats", "Jingles", { tune: 4, open: 0.3, tone: 0.9, crunch: 0.1 }, { on: { open: "trig" } }),
           layer("ring-rim", "Skin", { voice: "Clave", tune: -5, decay: 0.5 }, { gain: -10 })],
});

export default category("Drums/Toms & Percussion", "Toms, hand drums and small percussion: patch a trigger into Trig.",
  [tom808, tom909, syn, floor, conga, cowbell, clave, rimshot, shaker, tambourine]);
