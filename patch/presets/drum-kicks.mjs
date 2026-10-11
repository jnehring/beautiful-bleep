// SPDX-License-Identifier: MIT
// Kicks: one-shot bass drums. Trig and Velocity in, Out L/R.
import { category } from "./kit.mjs";
import { drum, layer, effect } from "./drum-kit.mjs";

const boom808 = () => drum("808 Boom", {
  description: "A long, round 808-style boom: a low sine with a gentle pitch drop and a hint of drive.",
  tags: ["kick", "808", "sub"],
  help: "A Ring Kick: a low sine with a gentle pitch sweep, little tone and a touch of drive. Decay is long " +
         "(1.8 s) and Tune is 45 Hz.\n\n" +
         "Patch a trigger into Trig and Out L/R to the output. A signal into Velocity sets how hard it hits.\n\n" +
         "Tip: keep other bass out of its way, it rings into the next beat.",
  layers: [layer("ring-kick", "Kick", { tune: 45, decay: 1.8, sweep: 0.35, tone: 0.15, drive: 0.1 })],
});

const punch909 = () => drum("909 Punch", {
  description: "A short, punchy 909-style kick with a fast sweep and a clicky attack.",
  tags: ["kick", "909", "house"],
  help: "A Punch Kick: a fast pitch sweep with a high Attack setting for a clicky front, and moderate drive. " +
         "Decay is short (0.45 s).\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity scales the hit.\n\n" +
         "Tip: play it on every quarter note for a house pulse, then lengthen Decay to leave room for a bass.",
  layers: [layer("punch-kick", "Kick", { tune: 55, decay: 0.45, sweep: 0.6, attack: 0.7, drive: 0.35 })],
});

const techno = () => drum("Techno Kick", {
  description: "A hard, driven kick through a saturating ladder filter: thick, warehouse-ready.",
  tags: ["kick", "techno", "distorted"],
  help: "A Punch Kick with heavy drive and a high Attack, run into a Ladder Tanh filter at 4.5 kHz with some " +
         "drive of its own. The saturation thickens the body.\n\n" +
         "Patch a trigger into Trig and Out L/R to your output. Velocity sets the level.\n\n" +
         "Tip: lower the filter cutoff to darken it, or raise Drive for more grit.",
  layers: [layer("punch-kick", "Kick", { tune: 50, decay: 0.7, sweep: 0.7, attack: 0.9, drive: 0.85 })],
  effects: [effect("filter", "Filter", { cutoff: 4500, resonance: 0.1, drive: 0.4, type: "Ladder Tanh" })],
});

const subDrop = () => drum("Sub Drop", {
  description: "A very low, long kick that dives into the sub range, low-passed to pure weight.",
  tags: ["kick", "sub", "boom"],
  help: "A Ring Kick tuned to 34 Hz with a long 2.6 s decay and a deep sweep (0.8), no tone or drive, then a " +
         "300 Hz low-pass so only weight is left.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity scales it.\n\n" +
         "Tip: play it sparingly, on a downbeat or a drop. It is mostly felt on big speakers.",
  layers: [layer("ring-kick", "Kick", { tune: 34, decay: 2.6, sweep: 0.8, tone: 0, drive: 0 })],
  effects: [effect("filter", "Low-pass", { cutoff: 300, resonance: 0.05 })],
});

const layered = () => drum("Layered Kick", {
  description: "A short, bright click kick on top of a rounder body kick: punch and weight together.",
  tags: ["kick", "layered"],
  help: "Two Kick layers in one mixer: a short, bright Punch Kick click (6 dB down, Tune 70 Hz) and a rounder " +
         "Ring Kick body at 48 Hz.\n\n" +
         "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both layers.\n\n" +
         "Tip: raise the click layer's level for more attack, or lower it to keep just the body.",
  layers: [layer("punch-kick", "Click", { tune: 70, decay: 0.2, sweep: 0.9, attack: 1, drive: 0.5 }, { gain: -6 }),
           layer("ring-kick", "Body", { tune: 48, decay: 0.9, sweep: 0.3, tone: 0.2 })],
});

const loFi = () => drum("Lo-Fi Kick", {
  description: "The Macro Osc kick model, darkened and crunched by a driven ladder filter.",
  tags: ["kick", "lo-fi", "dusty"],
  help: "A Macro Osc in its Kick model, two octaves down, into a Ladder Tanh filter at 1.8 kHz with drive. " +
         "The filter darkens it and adds crunch.\n\n" +
         "Patch a trigger into Trig and Out L/R to the output. Velocity feeds the oscillator's accent.\n\n" +
         "Tip: the Macro Osc's Tone and Shape knobs change the character a lot; try them before reaching for " +
         "the filter.",
  layers: [layer("macro-osc", "Kick", { model: "Kick", octave: -2, tone: 0.6, shape: 0.7, blend: 0.5, decay: 0.5 })],
  effects: [effect("filter", "Filter", { cutoff: 1800, resonance: 0.2, drive: 0.5, type: "Ladder Tanh" })],
});

const membrane = () => drum("Membrane Kick", {
  description: "A modal drum head tuned low: an acoustic-leaning kick with a soft beater click.",
  tags: ["kick", "acoustic", "modal"],
  help: "A Perc Voice in its Modal engine, tuned to 50 Hz with a bend sweep and a click control for the " +
         "beater. Damping shortens the ring.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity feeds the voice's accent.\n\n" +
         "Tip: raise Click for a harder beater, or lower Damp for a longer, more drum-like tail.",
  layers: [layer("perc-voice", "Kick", { engine: "Modal", pitch: 50, tone: 0.05, click: 0.5, decay: 0.7,
                                         sweep: 0.6, damp: 0.5, spread: 0 })],
});

const gabber = () => drum("Gabber Kick", {
  description: "A fully driven kick, wavefolded and low-passed: the distorted hardcore thump.",
  tags: ["kick", "gabber", "hardcore", "distorted"],
  help: "A fully driven Punch Kick (Drive at max, long sweep) into a Wavefolder, a 5 kHz low-pass and a " +
         "Linear VCA that trims the level.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity sets the level.\n\n" +
         "Tip: it is very loud. Lower the Trim gain before it meets the rest of the mix, and raise Fold for " +
         "more bite.",
  layers: [layer("punch-kick", "Kick", { tune: 60, decay: 0.9, sweep: 0.9, attack: 1, drive: 1 })],
  effects: [effect("wavefolder", "Folder", { fold: 0.35, source: "Input" }),
            effect("filter", "Low-pass", { cutoff: 5000, resonance: 0.1 }),
            effect("vca", "Trim", { gain: 0.7, response: "Linear" })],
});

const deep = () => drum("Deep Kick", {
  description: "A warm, mid-length kick, rolled off above 2.5 kHz for deep house and dub.",
  tags: ["kick", "deep house", "dub"],
  help: "A Ring Kick at 52 Hz with a medium 0.6 s decay and some tone, then a 2.5 kHz low-pass that removes " +
         "the click and leaves a warm thump.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity scales it.\n\n" +
         "Tip: open the low-pass a little if it gets lost under pads and chords.",
  layers: [layer("ring-kick", "Kick", { tune: 52, decay: 0.6, sweep: 0.4, tone: 0.4, drive: 0.15 })],
  effects: [effect("filter", "Low-pass", { cutoff: 2500, resonance: 0.15 })],
});

const fm = () => drum("FM Kick", {
  description: "An FM kick: a low carrier with a fast-falling index for a rubbery, electronic thud.",
  tags: ["kick", "fm", "electro"],
  help: "A Perc Voice in its FM engine at 45 Hz. The sweep is fairly strong (0.7), so the pitch and the FM " +
         "index fall quickly into a rubbery thud.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity feeds the voice's accent.\n\n" +
         "Tip: raise Morph to make the thud more metallic.",
  layers: [layer("perc-voice", "Kick", { engine: "FM", pitch: 45, tone: 0.05, morph: 0.4, click: 0.4, decay: 0.5,
                                         sweep: 0.7, damp: 0.4, spread: 0 })],
});

export default category("Drums/Kicks", "One-shot bass drums, from 808 boom to distorted gabber: patch a trigger into Trig.",
  [boom808, punch909, techno, subDrop, layered, loFi, membrane, gabber, deep, fm]);
