// SPDX-License-Identifier: MIT
// Hats & Cymbals: hi-hats (Closed and Open in) and cymbals (Trig in); Velocity in, Out L/R.
import { category } from "./kit.mjs";
import { drum, layer, effect, HP } from "./drum-kit.mjs";

/// A shared "Tone" input that opens the effect `at` (an index into the nodes) by up to `amount` of the cutoff range.
const toneDial = (at, amount = 0.4, jack = "cutoff") => (p, nodes) => {
  p.input("tone", "Tone", "control");
  p.cable(p.cin, "tone", nodes[at], jack, amount);
};

const glass = () => drum("Glass Hats", {
  description: "Very bright, thin hats with an airy sparkle: closed ticks and a short, shimmering open hat.",
  tags: ["hats", "bright", "thin", "airy"],
  help: "A Punch Hats module tuned up four semitones with a bright Tone and a high-pass at 8 kHz, so only the " +
        "sparkle is left. A small, short Reverb adds air. Closed cuts the open hat.\n\n" +
        "Patch triggers into Closed and Open and take Out L/R. The Tone input moves the high-pass.\n\n" +
        "Tip: keep the open hat short (the Open Decay) in busy patterns, since the reverb adds to its tail.",
  hats: true,
  layers: [layer("punch-hats", "Hats", { tune: 4, closed: 0.035, open: 0.3, tone: 0.9, crunch: 0.1 })],
  effects: [effect("filter", "High-pass", { cutoff: 8000, mode: HP }),
            effect("reverb", "Air", { size: 0.25, decay: 0.5, damping: 0.2, mix: 0.12 })],
  patch: toneDial(1, 0.15),
});

const crate = () => drum("Dusty Crate Hats", {
  description: "Hats from an old, worn record: crushed, low-passed and a little loose, for boom-bap and lo-fi.",
  tags: ["hats", "lo-fi", "dusty", "boom bap"],
  help: "A Ring Hats module into a Crunch with 9 bits and some sample-rate reduction, then a low-pass at " +
        "7 kHz to take the digital edge off. Closed cuts the open hat.\n\n" +
        "Patch triggers into Closed and Open and take Out L/R. The Tone input opens the low-pass.\n\n" +
        "Tip: lower Bits on the Crunch for a more worn-out sound.",
  hats: true,
  layers: [layer("ring-hats", "Hats", { tune: -2, closed: 0.07, open: 0.35, tone: 0.45 })],
  effects: [effect("crunch", "Wear", { drive: 0.25, bits: 9, rate: 0.3, tone: 20000, level: 1, mix: 1 }),
            effect("filter", "Low-pass", { cutoff: 7000, resonance: 0.05 })],
  patch: toneDial(2, 0.3),
});

const sizzle = () => drum("Sizzle Layer Hats", {
  description: "Two hat modules stacked: a metallic ring layer for body and a crunchy punch layer for sizzle.",
  tags: ["hats", "layered", "sizzle", "full"],
  help: "A Ring Hats layer (6 dB down) and a Punch Hats layer with Crunch, both listening to Closed and Open. " +
        "A high-pass at 4 kHz keeps the low end clean. Each module cuts its own open hat on Closed.\n\n" +
        "Patch triggers into Closed and Open and take Out L/R. Velocity reaches both layers.\n\n" +
        "Tip: use the mixer levels to move between a darker metallic hat and a crisper, brighter one.",
  hats: true,
  layers: [layer("ring-hats", "Metal", { tune: 1, closed: 0.08, open: 0.5, tone: 0.55 }, { gain: -6, pan: -0.2 }),
           layer("punch-hats", "Sizzle", { tune: 0, closed: 0.05, open: 0.4, tone: 0.6, crunch: 0.6 }, { pan: 0.2 })],
  effects: [effect("filter", "High-pass", { cutoff: 4000, mode: HP })],
});

const pedal = () => drum("Pedal Chick Hats", {
  description: "Dark, short, woody hats like a hi-hat pedal chick: a soft, low tick instead of a bright sizzle.",
  tags: ["hats", "pedal", "dark", "jazz"],
  help: "A Ring Hats module with very short decays and a low Tone, band-passed around 3 kHz so it has a dry, " +
        "papery chick rather than a long hiss. Closed cuts the open hat.\n\n" +
        "Patch triggers into Closed and Open and take Out L/R. The Tone input moves the band-pass.\n\n" +
        "Tip: play it on beats 2 and 4 for a classic swing feel.",
  hats: true,
  layers: [layer("ring-hats", "Hats", { tune: -5, closed: 0.03, open: 0.14, tone: 0.2 })],
  effects: [effect("filter", "Band", { cutoff: 3000, resonance: 0.3, mode: "BP" })],
  patch: toneDial(1, 0.25),
});

const sand = () => drum("Sand Shaker Hats", {
  description: "A shaker instead of a hat: a quick grain of noise for Closed and a longer swish for Open.",
  tags: ["shaker", "noise", "percussion", "latin"],
  help: "Two Perc Voices in the Noise Bank engine: a very short one for Closed and a longer one with a gradual " +
        "feel for Open, both high-passed at 3 kHz. A Closed trigger chokes the open swish.\n\n" +
        "Patch triggers into Closed and Open and take Out L/R. Velocity feeds both voices.\n\n" +
        "Tip: alternate Closed and Open on 16ths for a shaker groove; a raised Pitch makes it sound finer.",
  hats: true,
  layers: [layer("perc-voice", "Short Shake", { engine: "Noise Bank", pitch: 2600, tone: 0.8, click: 0.05, decay: 0.07,
                                                sweep: 0, damp: 0.5 }, { on: "closed", gain: -2 }),
           layer("perc-voice", "Long Swish", { engine: "Noise Bank", pitch: 2200, tone: 0.8, click: 0, decay: 0.3,
                                               sweep: 0, damp: 0.6 }, { on: "open", gain: -3 })],
  effects: [effect("filter", "High-pass", { cutoff: 3000, mode: HP })],
  patch: (p, [, open]) => p.cable(p.cin, "closed", open, "choke"),
});

const darkRide = () => drum("Dark Ride", {
  description: "A low, dry ride with a muted ping: a jazz ride that sits quietly behind other instruments.",
  tags: ["cymbal", "ride", "dark", "jazz"],
  help: "A Punch Cymbal in its Ride voice tuned down five semitones with low Tone and little crunch, then a " +
        "low-pass at 6 kHz so the shimmer stays soft.\n\n" +
        "Patch a trigger into Trig and take Out L/R. The Tone input opens the low-pass.\n\n" +
        "Tip: play steady 8ths with changing Velocity; the quiet hits keep it from standing out.",
  layers: [layer("punch-cymbal", "Ride", { voice: "Ride", tune: -5, decay: 1.8, tone: 0.25, crunch: 0.05 })],
  effects: [effect("filter", "Low-pass", { cutoff: 6000, resonance: 0.05 })],
  patch: toneDial(1, 0.3),
});

const gong = () => drum("Gong Wash", {
  description: "A deep, long gong-like crash: a low metallic clang that blooms into a slow wash.",
  tags: ["cymbal", "gong", "wash", "cinematic"],
  help: "A Ring Cymbal tuned an octave down with a 5 s decay, over a Perc Voice in its Modal engine for the " +
        "low clang, into a Reverb with a long tail.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity scales both layers.\n\n" +
        "Tip: use it for transitions and drops. Its tail is long, so give it a bar of space.",
  layers: [layer("ring-cymbal", "Wash", { tune: -12, decay: 5, tone: 0.3 }, { gain: -4 }),
           layer("perc-voice", "Clang", { engine: "Modal", pitch: 170, tone: 0.9, morph: 0.6, click: 0.2, decay: 3,
                                          sweep: 0, damp: 0.1, spread: 0.5 }, { gain: -8 })],
  effects: [effect("reverb", "Hall", { size: 0.7, decay: 2.4, damping: 0.5, mix: 0.25 })],
});

const trash = () => drum("Trash Crash", {
  description: "A broken, saturated crash: a noisy, distorted cymbal for aggressive music.",
  tags: ["cymbal", "crash", "distorted", "trashy"],
  help: "A Punch Cymbal in its Crash voice with Crunch at maximum, into a Crunch module with drive and 8 bits, " +
        "then a high-pass at 500 Hz.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
        "Tip: it is harsh and bright, so it works best as an accent rather than a constant ride.",
  layers: [layer("punch-cymbal", "Crash", { voice: "Crash", tune: 2, decay: 2.2, tone: 0.7, crunch: 1 })],
  effects: [effect("crunch", "Trash", { drive: 0.6, bits: 8, rate: 0.2, tone: 12000, level: 0.8, mix: 1 }),
            effect("filter", "High-pass", { cutoff: 500, mode: HP })],
});

const choked = () => drum("Choked Crash", {
  description: "A short crash cut off almost at once: a quick, splashy accent that never rings on.",
  tags: ["cymbal", "crash", "choked", "short"],
  help: "A Ring Cymbal with a short 0.45 s decay and a high Tone, shaped with a Compressor that clamps the " +
        "tail, like a crash grabbed by the hand.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity scales the hit.\n\n" +
        "Tip: use it before a pause for an accent that stops dead.",
  layers: [layer("ring-cymbal", "Crash", { tune: 3, decay: 0.45, tone: 0.75 })],
  effects: [effect("compressor", "Clamp", { threshold: -28, ratio: 20, attack: 1, release: 40, knee: 2, makeup: 6 }),
            effect("filter", "High-pass", { cutoff: 1200, mode: HP })],
});

const bell = () => drum("Ride Bell Ping", {
  description: "A clear, bell-like ping: a short, pitched ride bell for accents and cowbell-style parts.",
  tags: ["cymbal", "bell", "ping", "accent"],
  help: "A Perc Voice in its FM engine at 1.2 kHz with a short, damped decay for the ping, plus a Punch Cymbal " +
        "Ride layer, quietly, for the sizzle behind it. A high-pass at 400 Hz keeps it clean.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity feeds both layers.\n\n" +
        "Tip: change the voice's Morph to move from a clean bell to a harsher, clangier one.",
  layers: [layer("perc-voice", "Bell", { engine: "FM", pitch: 1200, tone: 0.7, morph: 0.45, click: 0.3, decay: 0.7,
                                         sweep: 0, damp: 0.5, spread: 0.2 }, { gain: -3 }),
           layer("punch-cymbal", "Ride", { voice: "Ride", tune: 4, decay: 0.8, tone: 0.6, crunch: 0.1 }, { gain: -10 })],
  effects: [effect("filter", "High-pass", { cutoff: 400, mode: HP })],
});

export default category("Drums/Hats & Cymbals", "Hi-hats with Closed and Open triggers, shakers, and crash, ride and gong cymbals.",
  [glass, crate, sizzle, pedal, sand, darkRide, gong, trash, choked, bell]);
