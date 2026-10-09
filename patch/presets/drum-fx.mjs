// SPDX-License-Identifier: MIT
// Drum FX: zaps, metal, bells and noise hits. Trig and Velocity in, Out L/R.
import { category } from "./kit.mjs";
import { drum, layer, effect, BP } from "./drum-kit.mjs";

const zap = () => drum("Zap", {
  description: "A short FM zap: a high pitch that falls to nothing in 150 ms.",
  tags: ["fx", "zap", "electro"],
  layers: [layer("perc-voice", "Zap", { engine: "FM", pitch: 1500, tone: 0, morph: 0.3, click: 0, decay: 0.15, sweep: 1 })],
});

const laser = () => drum("Laser", {
  description: "A longer, brighter FM sweep into a wide space: a sci-fi laser shot.",
  tags: ["fx", "laser", "sci-fi"],
  layers: [layer("perc-voice", "Laser", { engine: "FM", pitch: 2500, tone: 0.5, morph: 0.7, click: 0, decay: 0.35, sweep: 1 })],
  effects: [effect("reverb", "Space", { size: 0.6, decay: 2, mix: 0.25 })],
});

const metal = () => drum("Metal Hit", {
  description: "The Macro Osc metal model, ringing for most of a second: a clangy industrial hit.",
  tags: ["fx", "metallic", "industrial"],
  layers: [layer("macro-osc", "Metal", { model: "Metal", octave: 0, tone: 0.6, shape: 0.7, blend: 0.5, decay: 0.8 })],
});

const bell = () => drum("Bell", {
  description: "A struck modal bell an octave up, into a hall.",
  tags: ["fx", "bell", "modal"],
  layers: [layer("modal-voice", "Bell", { coarse: 12, geometry: 0.7, brightness: 0.7, damping: 0.25, position: 0.2 })],
  effects: [effect("reverb", "Hall", { size: 0.7, decay: 3, mix: 0.3 })],
});

const anvil = () => drum("Anvil", {
  description: "A metallic modal bar with a rimshot strike: a hard, ringing anvil.",
  tags: ["fx", "metallic", "anvil"],
  layers: [layer("perc-voice", "Anvil", { engine: "Modal", pitch: 700, tone: 0.9, click: 0.6, decay: 1.2, sweep: 0,
                                          damp: 0.2 }, { gain: -3 }),
           layer("punch-rim", "Strike", { tune: 0, decay: 1 }, { gain: -6 })],
});

const glitch = () => drum("Glitch Burst", {
  description: "A short burst of dust, wavefolded and band-passed: digital crackle for glitchy fills.",
  tags: ["fx", "glitch", "noise"],
  layers: [layer("macro-osc", "Dust", { model: "Dust", octave: 1, tone: 0.9, shape: 0.5, decay: 0.12 })],
  effects: [effect("wavefolder", "Folder", { fold: 0.5, source: "Input" }),
            effect("filter", "Band-pass", { cutoff: 2000, resonance: 0.4, mode: BP }),
            effect("vca", "Trim", { gain: 0.4, response: "Linear" })],
});

const resonator = () => drum("Struck Resonator", {
  description: "A rim click rings a bank of modal resonators: a tuned, wide, glassy hit.",
  tags: ["fx", "resonator", "modal", "tuned"],
  layers: [layer("ring-rim", "Click", { voice: "Rim", tune: 0, decay: 0.5 })],
  effects: [effect("resonator", "Resonator", { frequency: 0, structure: 0.6, brightness: 0.7, damping: 0.5, model: "Modal" })],
});

const impact = () => drum("Impact", {
  description: "A deep, driven boom with a crash on top, into a big hall: a transition hit.",
  tags: ["fx", "impact", "cinematic", "transition"],
  layers: [layer("ring-kick", "Boom", { tune: 32, decay: 3, sweep: 1, tone: 0.2, drive: 0.6 }, { gain: -2 }),
           layer("punch-cymbal", "Crash", { voice: "Crash", tune: -3, decay: 4, tone: 0.4, crunch: 0.5 }, { gain: -8 })],
  effects: [effect("reverb", "Hall", { size: 0.85, decay: 4, damping: 0.5, mix: 0.3 })],
});

const noiseSweep = () => drum("Noise Sweep", {
  description: "A falling noise-bank whoosh into a long space: a downlifter on every hit.",
  tags: ["fx", "noise", "sweep", "transition"],
  layers: [layer("perc-voice", "Noise", { engine: "Noise Bank", pitch: 1500, tone: 0.7, click: 0, decay: 1.5, sweep: 1,
                                          damp: 0.1 })],
  effects: [effect("reverb", "Space", { size: 0.7, decay: 3, mix: 0.35 })],
});

const blip = () => drum("Blip", {
  description: "A tiny, pure FM blip: a short tonal tick for percussive melodies.",
  tags: ["fx", "blip", "tonal"],
  layers: [layer("perc-voice", "Blip", { engine: "FM", pitch: 1200, tone: 0.2, morph: 0.2, click: 0, decay: 0.05,
                                         sweep: 0.2, damp: 0.5 })],
});

export default category("Drums/FX", "Zaps, lasers, metal, bells and noise hits for fills and transitions.",
  [zap, laser, metal, bell, anvil, glitch, resonator, impact, noiseSweep, blip]);
