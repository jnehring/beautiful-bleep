// SPDX-License-Identifier: MIT
// Toms & Percussion: toms, hand drums and small percussion. Trig and Velocity in, Out L/R.
import { category } from "./kit.mjs";
import { drum, layer, effect, HP, BP } from "./drum-kit.mjs";

const rackDive = () => drum("Rack Tom Dive", {
  description: "A tight rack tom with a big pitch dive and a hint of room; retune it for a whole kit of toms.",
  tags: ["tom", "dive", "rock", "fill"],
  help: "A Punch Tom at 180 Hz with a strong bend and a medium decay, into a small, quiet Reverb.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity scales the hit.\n\n" +
         "Tip: copy the cell three times and set Tune of the Punch Tom to 180, 130 and 95 for a descending fill.",
  layers: [layer("punch-tom", "Tom", { tune: 180, decay: 0.35, bend: 0.7, noise: 0.15 })],
  effects: [effect("reverb", "Room", { size: 0.25, decay: 0.6, mix: 0.12 })],
});

const logDrum = () => drum("Hollow Log Drum", {
  description: "A hollow, woody log drum with a soft attack, good for tuned percussion lines.",
  tags: ["percussion", "log drum", "wood", "tonal"],
  help: "A Perc Voice in its Modal engine at 160 Hz. Low Tone keeps the partials close to a hollow wooden tube, " +
         "and Damp ends the ring quickly.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity feeds the voice's accent.\n\n" +
         "Tip: patch a sequencer's pitch into the voice's Pitch for a bubbling marimba-like bass line.",
  layers: [layer("perc-voice", "Log", { engine: "Modal", pitch: 160, tone: 0.45, click: 0.2, decay: 0.45, sweep: 0.05,
                                        damp: 0.6 }, { gain: 2 })],
});

const bongo = () => drum("High Bongo", {
  description: "A bright, short bongo with a dry slap on the skin.",
  tags: ["percussion", "bongo", "latin", "dry"],
  help: "A Perc Voice in its Modal engine at 480 Hz with a strong Click for the slap and a short decay.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity feeds the accent.\n\n" +
         "Tip: pair it with a copy tuned down a fourth (Pitch 360) and play the two in alternation.",
  layers: [layer("perc-voice", "Bongo", { engine: "Modal", pitch: 480, tone: 0.25, click: 0.55, decay: 0.18, sweep: 0.1,
                                          damp: 0.7 })],
});

const timbale = () => drum("Steel Timbale", {
  description: "A ringing timbale: a tight shell tone with a rim crack on top.",
  tags: ["percussion", "timbale", "latin", "salsa"],
  help: "Two layers: a Ring Tom tuned high with little bend and a short decay for the shell, and a Punch Rim " +
         "for the crack.\n\n" +
         "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both.\n\n" +
         "Tip: lower the rim's gain for a softer hit, and play fast fills on the off-beats.",
  layers: [layer("ring-tom", "Shell", { tune: 340, decay: 0.3, bend: 0.1, noise: 0.35 }),
           layer("punch-rim", "Crack", { tune: 4, decay: 0.6 }, { gain: -9 })],
});

const woodblock = () => drum("Hard Woodblock", {
  description: "A high woodblock tick with a touch of body.",
  tags: ["percussion", "woodblock", "wood", "click"],
  help: "A Ring Rim on its Clave voice, tuned up seven semitones, plus a very short Modal Perc Voice tone " +
         "underneath for body.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity reaches both layers.\n\n" +
         "Tip: use it as a hi-fi metronome click or for dry 8th-note ostinatos.",
  layers: [layer("ring-rim", "Block", { voice: "Clave", tune: 7, decay: 0.6 }),
           layer("perc-voice", "Body", { engine: "Modal", pitch: 900, tone: 0.2, click: 0.1, decay: 0.07, sweep: 0,
                                         damp: 0.8 }, { gain: -8 })],
});

const agogo = () => drum("Agogo Pair", {
  description: "Two metal bells in one hit, a high and a low, panned apart.",
  tags: ["percussion", "agogo", "bell", "samba"],
  help: "Two Ring Cowbell layers, one tuned up seven semitones and panned right, the other tuned down two " +
         "and panned left, both with a short decay.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity scales both.\n\n" +
         "Tip: set the two Tune knobs to a different interval for another character, a fourth is classic.",
  layers: [layer("ring-cowbell", "High Bell", { tune: 7, decay: 0.3, tone: 0.65 }, { pan: 0.4, gain: -3 }),
           layer("ring-cowbell", "Low Bell", { tune: -2, decay: 0.35, tone: 0.5 }, { pan: -0.4, gain: -3 })],
});

const cabasa = () => drum("Cabasa Shake", {
  description: "A scratchy, band-passed noise burst like beads on a metal drum.",
  tags: ["percussion", "cabasa", "shaker", "noise"],
  help: "A Perc Voice in the Noise Bank engine at 4 kHz with a very short decay, through a band-pass around 5 kHz " +
         "that removes the hiss above and the thump below.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity feeds the accent.\n\n" +
         "Tip: shift the band-pass Cutoff up for a smaller, brighter shaker.",
  layers: [layer("perc-voice", "Beads", { engine: "Noise Bank", pitch: 4000, tone: 0.8, click: 0.4, decay: 0.11,
                                          sweep: 0, damp: 0.2 }, { gain: -2 })],
  effects: [effect("filter", "Band-pass", { cutoff: 5000, resonance: 0.3, mode: BP })],
});

const djembe = () => drum("Djembe Slap", {
  description: "A goblet drum slap: sharp edge, open skin and a short wooden resonance.",
  tags: ["percussion", "djembe", "hand drum", "world"],
  help: "A Perc Voice in its Modal engine at 260 Hz with a high Click and a gentle sweep, plus a short noise " +
         "burst high-passed for the slap of the hand.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity feeds both layers.\n\n" +
         "Tip: lower the Pitch of the first layer for a bass tone.",
  layers: [layer("perc-voice", "Skin", { engine: "Modal", pitch: 260, tone: 0.35, click: 0.6, decay: 0.28, sweep: 0.2,
                                         damp: 0.5 }),
           layer("perc-voice", "Slap", { engine: "Noise Bank", pitch: 3000, tone: 0.8, click: 0.2, decay: 0.05,
                                         sweep: 0, damp: 0.3 }, { gain: -9 })],
});

const taiko = () => drum("Taiko Thunder", {
  description: "A huge, slow ceremonial drum with a long boom and a stadium tail.",
  tags: ["tom", "taiko", "cinematic", "huge"],
  help: "A Ring Tom at 62 Hz with a one-and-a-half second decay and a lot of noise, into a Hall reverb.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity sets the level of the strike.\n\n" +
         "Tip: play it on the first beat of a section in a slow tempo and let the reverb fill the gap.",
  layers: [layer("ring-tom", "Drum", { tune: 62, decay: 1.5, bend: 0.2, noise: 0.5 })],
  effects: [effect("reverb", "Hall", { size: 0.8, decay: 3, damping: 0.5, mix: 0.25 })],
});

const triangle = () => drum("Bright Triangle", {
  description: "A tiny, high, long-ringing metal triangle.",
  tags: ["percussion", "triangle", "bell", "orchestral"],
  help: "A Perc Voice in its Modal engine at 3.2 kHz with the Tone knob at maximum and a long, lightly damped " +
         "decay, high-passed to keep it thin.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity feeds the accent.\n\n" +
         "Tip: use a shorter Decay and play it on the off-beat for a dry disco ting.",
  layers: [layer("perc-voice", "Triangle", { engine: "Modal", pitch: 3200, tone: 1, click: 0.3, decay: 2.5, sweep: 0,
                                             damp: 0.05 }, { gain: -4 })],
  effects: [effect("filter", "High-pass", { cutoff: 1800, mode: HP })],
});

export default category("Drums/Toms & Percussion", "Toms, hand drums and small percussion: patch a trigger into Trig.",
  [rackDive, logDrum, bongo, timbale, woodblock, agogo, cabasa, djembe, taiko, triangle]);
