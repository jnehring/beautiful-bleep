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

const floorBoom = () => drum("Floor Tom Boom", {
  description: "A big, low floor tom with a deep thump and a long, round ring-out.",
  tags: ["tom", "floor", "low", "rock"],
  help: "A Punch Tom at 85 Hz with a long decay and a moderate bend, into a medium Reverb.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity scales the hit.\n\n" +
        "Tip: use it with the Rack Tom Dive for a full fill.",
  layers: [layer("punch-tom", "Tom", { tune: 85, decay: 0.9, bend: 0.4, noise: 0.2 })],
  effects: [effect("reverb", "Room", { size: 0.4, decay: 0.9, damping: 0.5, mix: 0.18 })],
});

const electroTom = () => drum("Electro Tom", {
  description: "A synthetic tom with a steep, laser-like pitch fall: the classic electro drum fill.",
  tags: ["tom", "electro", "synthetic", "zap"],
  help: "A Punch Tom at 160 Hz with the Bend at its top and a short decay, into a Crunch at 10 bits for a bit of edge.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
        "Tip: lower the Bend for a calmer tom.",
  layers: [layer("punch-tom", "Tom", { tune: 160, decay: 0.3, bend: 1, noise: 0.05 })],
  effects: [effect("crunch", "Edge", { drive: 0.2, bits: 10, tone: 20000, level: 1, mix: 0.6 })],
});

const hallTom = () => drum("Hall Tom", {
  description: "A mid tom in a huge hall: the hit is clean and the room does the rest.",
  tags: ["tom", "hall", "reverb", "cinematic"],
  help: "A Ring Tom at 130 Hz with a medium decay into a big Reverb at 40 percent mix.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the hit.\n\n" +
        "Tip: shorten the Reverb Decay for a smaller hall.",
  layers: [layer("ring-tom", "Tom", { tune: 130, decay: 0.5, bend: 0.3, noise: 0.2 })],
  effects: [effect("reverb", "Hall", { size: 0.85, decay: 2.4, damping: 0.4, mix: 0.4 })],
});

const roto = () => drum("Roto Tom", {
  description: "A pitched, bouncy tom that sounds like a tuned drum head: high, round and short.",
  tags: ["tom", "roto", "tonal", "pitched"],
  help: "A Ring Tom at 270 Hz with a low Bend and a short decay, plus a quieter Perc Voice in its Modal engine for the head.\n\n" +
        "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both layers.\n\n" +
        "Tip: copy it and retune the Ring Tom to play melodies.",
  layers: [layer("ring-tom", "Tom", { tune: 270, decay: 0.25, bend: 0.15, noise: 0.1 }),
           layer("perc-voice", "Head", { engine: "Modal", pitch: 270, tone: 0.05, click: 0.1, decay: 0.2, sweep: 0.05, damp: 0.5 }, { gain: -10 })],
});

const midRing = () => drum("Mid Ring Tom", {
  description: "A warm, resonant tom with a long tone that keeps singing after the hit.",
  tags: ["tom", "mid", "resonant", "warm"],
  help: "A Ring Tom at 150 Hz with a long decay and a little noise, into a short EQ boost at 200 Hz.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
        "Tip: use it as the top of a three-tom set.",
  layers: [layer("ring-tom", "Tom", { tune: 150, decay: 1.1, bend: 0.25, noise: 0.15 })],
  effects: [effect("eq", "Warmth", { b2On: false, b3On: true, b3Type: "Bell", b3Hz: 200, b3Gain: 3, b3Q: 1, b4On: false, b5On: false })],
});

const tribalLow = () => drum("Tribal Low Tom", {
  description: "A deep hand-hit drum with a rounded, hollow sound: a ritual pulse.",
  tags: ["tom", "tribal", "hand drum", "deep"],
  help: "A Perc Voice in its Modal engine at 90 Hz with a soft Click and a long Damp, plus a Ring Tom 8 dB down for the body.\n\n" +
        "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both layers.\n\n" +
        "Tip: play it in groups of three or five for a driving pulse.",
  layers: [layer("perc-voice", "Skin", { engine: "Modal", pitch: 90, tone: 0.2, click: 0.35, decay: 0.7, sweep: 0.3, damp: 0.5 }),
           layer("ring-tom", "Body", { tune: 80, decay: 0.6, bend: 0.3, noise: 0.1 }, { gain: -8 })],
  effects: [effect("reverb", "Cave", { size: 0.5, decay: 1.2, damping: 0.6, mix: 0.2 })],
});

const cowbell = () => drum("Cowbell Classic", {
  description: "A bright, clanking cowbell with a short ring: more cowbell.",
  tags: ["percussion", "cowbell", "metal", "disco"],
  help: "A Ring Cowbell at its default tuning with a medium decay and a lively Tone, high-passed at 500 Hz.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
        "Tip: tune it down a few semitones for a larger, duller bell.",
  layers: [layer("ring-cowbell", "Bell", { tune: 0, decay: 0.35, tone: 0.6 })],
  effects: [effect("filter", "High-pass", { cutoff: 500, mode: HP })],
});

const claveStick = () => drum("Clave Stick", {
  description: "Two hardwood sticks struck together: a high, dry, ringing click.",
  tags: ["percussion", "clave", "wood", "latin"],
  help: "A Ring Rim in Clave mode with a medium decay, into a tiny Reverb.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
        "Tip: tune it up or down a few semitones for a pair of different claves.",
  layers: [layer("ring-rim", "Clave", { voice: "Clave", tune: 0, decay: 1 })],
  effects: [effect("reverb", "Room", { size: 0.15, decay: 0.3, damping: 0.5, mix: 0.1 })],
});

const conga = () => drum("Conga Open", {
  description: "An open conga tone: a round, ringing hit from the centre of the skin.",
  tags: ["percussion", "conga", "latin", "hand drum"],
  help: "A Perc Voice in its Modal engine at 300 Hz with a short Click and a medium Damp, plus a Ring Tom 10 dB down.\n\n" +
        "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both layers.\n\n" +
        "Tip: use two cells at different pitches for a conga pair.",
  layers: [layer("perc-voice", "Skin", { engine: "Modal", pitch: 300, tone: 0.2, click: 0.3, decay: 0.4, sweep: 0.2, damp: 0.5 }),
           layer("ring-tom", "Body", { tune: 290, decay: 0.3, bend: 0.2, noise: 0.1 }, { gain: -10 })],
});

const maracas = () => drum("Maracas Pair", {
  description: "Two maracas shaken one after the other: a short hiss with a gentle swell.",
  tags: ["percussion", "maracas", "shaker", "latin"],
  help: "A Perc Voice in its Noise Bank engine with a slow-ish attack and a short decay, panned left, plus a second one panned right with a longer decay.\n\n" +
        "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both layers.\n\n" +
        "Tip: lower the Click for a softer shake.",
  layers: [layer("perc-voice", "Left", { engine: "Noise Bank", pitch: 3500, tone: 0.8, click: 0.05, decay: 0.09, sweep: 0, damp: 0.5 }, { pan: -0.5 }),
           layer("perc-voice", "Right", { engine: "Noise Bank", pitch: 3900, tone: 0.8, click: 0.05, decay: 0.15, sweep: 0, damp: 0.5 }, { pan: 0.5, gain: -3 })],
  effects: [effect("filter", "High-pass", { cutoff: 3000, mode: HP })],
});

const guiro = () => drum("Guiro Scrape", {
  description: "A ridged gourd scraped with a stick: a quick, rasping run of clicks.",
  tags: ["percussion", "guiro", "scrape", "latin"],
  help: "A Perc Voice in its Noise Bank engine with a lot of Spread and a medium decay, through a band-pass at 3 kHz, with a Chorus in Flanger mode for the ridges.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity feeds the accent.\n\n" +
        "Tip: raise the flanger Rate for a faster scrape.",
  layers: [layer("perc-voice", "Scrape", { engine: "Noise Bank", pitch: 3000, tone: 0.6, click: 0.4, decay: 0.3, sweep: 0.2, damp: 0.3, spread: 0.8 })],
  effects: [effect("filter", "Band", { cutoff: 3000, resonance: 0.3, mode: BP }),
            effect("chorus", "Ridges", { rate: 9, depth: 0.8, delay: 2, feedback: 0.5, mode: "Flanger", mix: 0.6 })],
});

const tabla = () => drum("Tabla Tone", {
  description: "A tuned hand drum with a bending, singing tone: a tabla-like pitched hit.",
  tags: ["percussion", "tabla", "tonal", "hand drum"],
  help: "A Perc Voice in its Modal engine at 200 Hz with a rising Sweep and a long decay, into a small Reverb.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity feeds the accent.\n\n" +
        "Tip: patch a pitch cable into the voice's Pitch for a melodic tabla.",
  layers: [layer("perc-voice", "Tabla", { engine: "Modal", pitch: 200, tone: 0.15, click: 0.25, decay: 0.8, sweep: 0.4, damp: 0.3 })],
  effects: [effect("reverb", "Room", { size: 0.25, decay: 0.6, mix: 0.12 })],
});

const castanet = () => drum("Castanet Click", {
  description: "A tiny, dry wooden clack: two shells meeting.",
  tags: ["percussion", "castanet", "wood", "click"],
  help: "A Ring Rim in Clave mode tuned up nine semitones with a short decay, and a Punch Rim 6 dB down for a second click.\n\n" +
        "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both layers.\n\n" +
        "Tip: play two quick hits in a row for a flamenco-style roll.",
  layers: [layer("ring-rim", "Shell", { voice: "Clave", tune: 9, decay: 0.4 }),
           layer("punch-rim", "Clack", { tune: 6, decay: 0.3 }, { gain: -6 })],
});

export default category("Drums/Toms & Percussion", "Toms, hand drums and small percussion: patch a trigger into Trig.",
  [rackDive, logDrum, bongo, timbale, woodblock, agogo, cabasa, djembe, taiko, triangle,
  floorBoom, electroTom, hallTom, roto, midRing, tribalLow, cowbell, claveStick, conga, maracas, guiro, tabla, castanet]);
