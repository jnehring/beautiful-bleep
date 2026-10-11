// SPDX-License-Identifier: MIT
// Drum FX: zaps, metal, bells and noise hits. Trig and Velocity in, Out L/R.
import { category } from "./kit.mjs";
import { drum, layer, effect, BP } from "./drum-kit.mjs";

const zap = () => drum("Zap", {
  description: "A short FM zap: a high pitch that falls to nothing in 150 ms.",
  tags: ["fx", "zap", "electro"],
  help: "A Perc Voice in its FM engine at 1.5 kHz, with Sweep at maximum and a 0.15 s decay. The pitch falls " +
         "away quickly.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity feeds the voice's accent.\n\n" +
         "Tip: lower Sweep for a shorter blip, or raise Decay for a longer descent.",
  layers: [layer("perc-voice", "Zap", { engine: "FM", pitch: 1500, tone: 0, morph: 0.3, click: 0, decay: 0.15, sweep: 1 })],
});

const laser = () => drum("Laser", {
  description: "A longer, brighter FM sweep into a wide space: a sci-fi laser shot.",
  tags: ["fx", "laser", "sci-fi"],
  help: "A Perc Voice in its FM engine starting at 2.5 kHz with Sweep at maximum and a 0.35 s decay, then a " +
         "Reverb for space.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
         "Tip: raise Morph for a harsher shot, or lower the reverb mix to keep it dry.",
  layers: [layer("perc-voice", "Laser", { engine: "FM", pitch: 2500, tone: 0.5, morph: 0.7, click: 0, decay: 0.35, sweep: 1 })],
  effects: [effect("reverb", "Space", { size: 0.6, decay: 2, mix: 0.25 })],
});

const metal = () => drum("Metal Hit", {
  description: "The Macro Osc metal model, ringing for most of a second: a clangy industrial hit.",
  tags: ["fx", "metallic", "industrial"],
  help: "A Macro Osc in its Metal model with a decay of 0.8 s. Tone and Shape set how clangy and inharmonic " +
         "it sounds.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity feeds the accent.\n\n" +
         "Tip: lower the Macro Osc's Octave for heavier, more industrial hits.",
  layers: [layer("macro-osc", "Metal", { model: "Metal", octave: 0, tone: 0.6, shape: 0.7, blend: 0.5, decay: 0.8 })],
});

const bell = () => drum("Bell", {
  description: "A struck modal bell an octave up, into a hall.",
  tags: ["fx", "bell", "modal"],
  help: "A Modal Voice struck once, an octave up (Coarse 12), with Geometry and Brightness fairly high and " +
         "moderate damping, into a Hall reverb.\n\n" +
         "Patch a trigger into Trig (it feeds the voice's strike) and take Out L/R. Velocity sets the strike " +
         "strength.\n\n" +
         "Tip: vary Coarse to tune the bell, and use Velocity for brightness.",
  layers: [layer("modal-voice", "Bell", { coarse: 12, geometry: 0.7, brightness: 0.7, damping: 0.25, position: 0.2 })],
  effects: [effect("reverb", "Hall", { size: 0.7, decay: 3, mix: 0.3 })],
});

const anvil = () => drum("Anvil", {
  description: "A metallic modal bar with a rimshot strike: a hard, ringing anvil.",
  tags: ["fx", "metallic", "anvil"],
  help: "Two layers: a Perc Voice in its Modal engine at 700 Hz with strong click for the metal bar, and a " +
         "Punch Rim for the strike.\n\n" +
         "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both.\n\n" +
         "Tip: lower Damp for a longer ring, raise Pitch for a smaller anvil.",
  layers: [layer("perc-voice", "Anvil", { engine: "Modal", pitch: 700, tone: 0.9, click: 0.6, decay: 1.2, sweep: 0,
                                          damp: 0.2 }, { gain: -3 }),
           layer("punch-rim", "Strike", { tune: 0, decay: 1 }, { gain: -6 })],
});

const glitch = () => drum("Glitch Burst", {
  description: "A short burst of dust, wavefolded and band-passed: digital crackle for glitchy fills.",
  tags: ["fx", "glitch", "noise"],
  help: "A Macro Osc in its Dust model (octave up, short 0.12 s decay) through a Wavefolder, a band-pass at 2 " +
         "kHz and a trimmed VCA. The result is a crackle.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity feeds the oscillator's accent.\n\n" +
         "Tip: fire it in bursts of 16ths at the end of a bar, and raise Fold for harsher crackle.",
  layers: [layer("macro-osc", "Dust", { model: "Dust", octave: 1, tone: 0.9, shape: 0.5, decay: 0.12 })],
  effects: [effect("wavefolder", "Folder", { fold: 0.5, source: "Input" }),
            effect("filter", "Band-pass", { cutoff: 2000, resonance: 0.4, mode: BP }),
            effect("vca", "Trim", { gain: 0.4, response: "Linear" })],
});

const resonator = () => drum("Struck Resonator", {
  description: "A rim click rings a bank of modal resonators: a tuned, wide, glassy hit.",
  tags: ["fx", "resonator", "modal", "tuned"],
  help: "A Ring Rim click on its Rim voice is fed into a Resonator in Modal mode. The click excites the " +
         "resonator, which rings at the pitch set by Frequency; Structure and Brightness shape the timbre.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity sets the click strength.\n\n" +
         "Tip: change the resonator's Frequency to play a different tuned hit.",
  layers: [layer("ring-rim", "Click", { voice: "Rim", tune: 0, decay: 0.5 })],
  effects: [effect("resonator", "Resonator", { frequency: 0, structure: 0.6, brightness: 0.7, damping: 0.5, model: "Modal" })],
});

const impact = () => drum("Impact", {
  description: "A deep, driven boom with a crash on top, into a big hall: a transition hit.",
  tags: ["fx", "impact", "cinematic", "transition"],
  help: "Two layers: a deep Ring Kick boom (32 Hz, 3 s decay, full sweep, driven) and a Punch Cymbal crash, 8 " +
         "dB down. A big Hall reverb joins them.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity reaches both layers.\n\n" +
         "Tip: trigger it once at a section change, and turn the reverb mix down if it clouds the next " +
         "downbeat.",
  layers: [layer("ring-kick", "Boom", { tune: 32, decay: 3, sweep: 1, tone: 0.2, drive: 0.6 }, { gain: -2 }),
           layer("punch-cymbal", "Crash", { voice: "Crash", tune: -3, decay: 4, tone: 0.4, crunch: 0.5 }, { gain: -8 })],
  effects: [effect("reverb", "Hall", { size: 0.85, decay: 4, damping: 0.5, mix: 0.3 })],
});

const noiseSweep = () => drum("Noise Sweep", {
  description: "A falling noise-bank whoosh into a long space: a downlifter on every hit.",
  tags: ["fx", "noise", "sweep", "transition"],
  help: "A Perc Voice in its Noise Bank engine starting at 1.5 kHz, with Sweep at maximum and a 1.5 s decay, " +
         "so the noise falls. A big Reverb extends it.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity feeds the voice's accent.\n\n" +
         "Tip: trigger it on the last beat of a bar so the downlift lands on the next downbeat.",
  layers: [layer("perc-voice", "Noise", { engine: "Noise Bank", pitch: 1500, tone: 0.7, click: 0, decay: 1.5, sweep: 1,
                                          damp: 0.1 })],
  effects: [effect("reverb", "Space", { size: 0.7, decay: 3, mix: 0.35 })],
});

const blip = () => drum("Blip", {
  description: "A tiny, pure FM blip: a short tonal tick for percussive melodies.",
  tags: ["fx", "blip", "tonal"],
  help: "A Perc Voice in its FM engine at 1.2 kHz with a 0.05 s decay and a small sweep. It makes a short " +
         "tonal tick.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity feeds the voice's accent.\n\n" +
         "Tip: change Pitch from a sequencer between hits to play percussive melodies.",
  layers: [layer("perc-voice", "Blip", { engine: "FM", pitch: 1200, tone: 0.2, morph: 0.2, click: 0, decay: 0.05,
                                         sweep: 0.2, damp: 0.5 })],
});

export default category("Drums/FX", "Zaps, lasers, metal, bells and noise hits for fills and transitions.",
  [zap, laser, metal, bell, anvil, glitch, resonator, impact, noiseSweep, blip]);
