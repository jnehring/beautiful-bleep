// SPDX-License-Identifier: MIT
// Snares & Claps: one-shot snares and handclaps. Trig and Velocity in, Out L/R.
import { category } from "./kit.mjs";
import { drum, layer, effect, HP } from "./drum-kit.mjs";

/// A shared "Tone" input that opens the effect `at` (an index into the nodes) by up to `amount` of the cutoff range.
const toneDial = (at, amount = 0.4, jack = "cutoff") => (p, nodes) => {
  p.input("tone", "Tone", "control");
  p.cable(p.cin, "tone", nodes[at], jack, amount);
};

const crack = () => drum("Rim Crack Snare", {
  description: "A tight snare with a sharp rim crack on top: a dry, cutting backbeat for rock and pop.",
  tags: ["snare", "rim", "crack", "rock"],
  help: "Two layers: a Punch Snare at 230 Hz with a short decay and a Ring Rim 4 dB down that adds the hard " +
        "wooden crack at the front.\n\n" +
        "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both layers.\n\n" +
        "Tip: lower the Rim level in the mixer for a more ordinary snare, or raise it for a rim shot.",
  layers: [layer("punch-snare", "Snare", { tune: 230, tone: 0.5, snappy: 0.55, decay: 0.2 }),
           layer("ring-rim", "Rim", { voice: "Rim", tune: 2, decay: 0.6 }, { gain: -4 })],
});

const brush = () => drum("Brush Sweep Snare", {
  description: "A soft, hissy snare like a brush dragged over a head: quiet, airy, with almost no attack.",
  tags: ["snare", "brush", "jazz", "soft"],
  help: "A Perc Voice in the Noise Bank engine with a low Click and a slow-ish decay, so the noise swells in " +
        "instead of snapping, high-passed at 1.2 kHz and rolled off above 9 kHz. A faint Modal head sits under it.\n\n" +
        "Patch a trigger into Trig and take Out L/R. The Tone input opens the low-pass on the noise.\n\n" +
        "Tip: play it with low Velocity on every beat for a brushed pulse.",
  layers: [layer("perc-voice", "Wires", { engine: "Noise Bank", pitch: 4000, tone: 0.8, click: 0.05, decay: 0.28,
                                          sweep: 0, damp: 0.5 }),
           layer("perc-voice", "Head", { engine: "Modal", pitch: 190, tone: 0.1, click: 0.1, decay: 0.15,
                                         sweep: 0.2, damp: 0.7, spread: 0 }, { gain: -14 })],
  effects: [effect("filter", "Band", { cutoff: 9000, resonance: 0.05, mode: "LP" }),
            effect("filter", "Rumble Cut", { cutoff: 1200, mode: HP })],
  patch: toneDial(2, 0.3),
});

const gated = () => drum("Gated Wall Snare", {
  description: "A huge snare in a dense room that is cut off abruptly: the big, flat-topped eighties wall.",
  tags: ["snare", "gated", "reverb", "80s"],
  help: "A Punch Snare into a large Reverb at nearly full mix, followed by a Compressor with a very fast attack " +
        "and release that chops the tail short. The result is a loud snare wash with a hard edge.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the hit strength.\n\n" +
        "Tip: shorten the Reverb Decay for a tighter gate, lengthen it for a longer wall.",
  layers: [layer("punch-snare", "Snare", { tune: 185, tone: 0.55, snappy: 0.85, decay: 0.3 })],
  effects: [effect("reverb", "Room", { size: 0.75, decay: 1.1, damping: 0.3, diffusion: 0.9, mix: 0.8, width: 1.2 }),
            effect("compressor", "Gate", { threshold: -24, ratio: 20, attack: 0.5, release: 50, knee: 0, makeup: 6 })],
});

const piccolo = () => drum("Piccolo Snare", {
  description: "A small, high, very tight snare: a bright pop with a quick rattle, good for fast patterns.",
  tags: ["snare", "piccolo", "tight", "bright"],
  help: "A Punch Snare tuned up to 340 Hz with a high Tone, very short decay (0.12 s) and plenty of Snappy.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity scales the hit.\n\n" +
        "Tip: use it for ghost notes and rolls, where a larger snare would smear.",
  layers: [layer("punch-snare", "Snare", { tune: 340, tone: 0.75, snappy: 0.7, decay: 0.12 })],
});

const crushed = () => drum("Crushed Snare", {
  description: "A ring snare ground through a bit crusher and drive: a harsh, digital, broken backbeat.",
  tags: ["snare", "crushed", "digital", "industrial"],
  help: "A Ring Snare at 200 Hz into a Crunch module with strong drive, 6 bits and sample-rate reduction. The " +
        "aliasing adds a rough, metallic bite.\n\n" +
        "Patch a trigger into Trig and take Out L/R. The Tone input opens the Crunch low-pass.\n\n" +
        "Tip: raise Bits slightly if it is too harsh for your mix.",
  layers: [layer("ring-snare", "Snare", { tune: 200, tone: 0.55, snappy: 0.7, decay: 0.28 })],
  effects: [effect("crunch", "Crusher", { drive: 0.6, bits: 6, rate: 0.45, tone: 6000, level: 0.9, mix: 1 })],
  patch: toneDial(1, 0.35, "tone"),
});

const skinWires = () => drum("Skin and Wires Snare", {
  description: "A snare built from a modal drum head and a separate noise-bank wire layer: organic and balanced.",
  tags: ["snare", "modal", "acoustic", "layered"],
  help: "Two Perc Voices: a Modal head at 195 Hz with moderate damping, and a Noise Bank layer for the wires, " +
        "high-passed at 2.5 kHz.\n\n" +
        "One Trig fires both. Patch a trigger there and take Out L/R. Velocity feeds the accent of both.\n\n" +
        "Tip: change the level of the Wires layer in the mixer to go from a loosely wound snare to a tight one.",
  layers: [layer("perc-voice", "Head", { engine: "Modal", pitch: 195, tone: 0.2, click: 0.45, decay: 0.2,
                                         sweep: 0.4, damp: 0.45, spread: 0.1 }),
           layer("perc-voice", "Wires", { engine: "Noise Bank", pitch: 3600, tone: 0.9, click: 0.3, decay: 0.22,
                                          sweep: 0, damp: 0.3 }, { gain: -5 })],
  effects: [effect("filter", "Wire Cut", { cutoff: 160, mode: HP })],
});

const tripleStack = () => drum("Triple Clap Stack", {
  description: "Three different claps on one trigger, spread across the stereo field: a big, thick handclap.",
  tags: ["clap", "layered", "stereo", "big"],
  help: "Three claps in one mixer: a Ring Clap at 1 kHz on the left, a Punch Clap at 1.6 kHz in the middle and " +
        "another Ring Clap at 2.2 kHz on the right, each with a different burst spacing.\n\n" +
        "One Trig fires all three. Patch a trigger there and use both Out L and Out R. Velocity reaches every layer.\n\n" +
        "Tip: it is thick and loud, so lower the centre clap's level if it sits on top of a snare.",
  layers: [layer("ring-clap", "Low Clap", { tone: 1000, decay: 0.32, spread: 0.014, bursts: 4 }, { pan: -0.7, gain: -4 }),
           layer("punch-clap", "Mid Clap", { tone: 1600, decay: 0.36, spread: 0.008, bursts: 5 }, { gain: -4 }),
           layer("ring-clap", "High Clap", { tone: 2200, decay: 0.28, spread: 0.019, bursts: 3 }, { pan: 0.7, gain: -4 })],
});

const slap = () => drum("Single Slap Clap", {
  description: "One crisp hand slap with no bursts: a dry, snappy click for sparse, minimal patterns.",
  tags: ["clap", "slap", "dry", "minimal"],
  help: "A Punch Clap with a single burst, a high 2.4 kHz tone and a very short decay (0.12 s), so it is one " +
        "clean slap rather than a flutter.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity scales the hit.\n\n" +
        "Tip: raise Bursts on the clap to turn it into a classic flam.",
  layers: [layer("punch-clap", "Clap", { tone: 2400, decay: 0.12, spread: 0.005, bursts: 1 })],
});

const slapback = () => drum("Slapback Clap", {
  description: "A handclap with a short ping-pong echo: a dubby clap that doubles itself across the stereo field.",
  tags: ["clap", "echo", "dub", "stereo"],
  help: "A Ring Clap at 1.3 kHz into a Delay at 110 ms on the left and 165 ms on the right, in ping-pong mode with " +
        "low feedback and a high cut that darkens each repeat.\n\n" +
        "Patch a trigger into Trig and use both Out L and Out R. The Tone input opens the echo's high cut.\n\n" +
        "Tip: raise the Delay feedback for more repeats, but the clap will then run into the next beat.",
  layers: [layer("ring-clap", "Clap", { tone: 1300, decay: 0.3, spread: 0.012, bursts: 4 })],
  effects: [effect("delay", "Slap", { timel: 110, timer: 165, feedback: 0.3, lowcut: 300, highcut: 5000, mix: 0.4,
                                       sync: "Free", mode: "Ping-Pong" })],
  patch: (p, nodes) => {
    p.input("tone", "Tone", "control");
    p.cable(p.cin, "tone", nodes[1], "highcut", 0.3);
  },
});

const folded = () => drum("Folded Snare", {
  description: "A metallic, wavefolded snare from the Macro Osc: a clanging, hard-edged industrial hit.",
  tags: ["snare", "wavefolder", "metallic", "experimental"],
  help: "A Macro Osc in its Snare model pushed into a Folder, then a high-pass at 150 Hz. The folding adds a " +
        "bright, inharmonic edge to the noise.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity feeds the oscillator's accent. The Tone input opens " +
        "a low-pass on the result.\n\n" +
        "Tip: increase the Folder's Fold for a more ringing, metallic snare.",
  layers: [layer("macro-osc", "Snare", { model: "Snare", octave: 0, tone: 0.6, shape: 0.6, blend: 0.5, decay: 0.3 })],
  effects: [effect("wavefolder", "Folder", { fold: 0.45, symmetry: 0, tap: 5, source: "Input", level: 0.8 }),
            effect("filter", "Low Cut", { cutoff: 150, mode: HP }),
            effect("filter", "Top Cut", { cutoff: 9000, resonance: 0.05 })],
  patch: toneDial(3, 0.3),
});

const fatBackbeat = () => drum("Fat Backbeat Snare", {
  description: "A full, round snare with a body you can feel and a medium room: the standard pop and rock backbeat.",
  tags: ["snare", "fat", "backbeat", "pop"],
  help: "A Punch Snare at 190 Hz with a medium decay and a lot of Snappy, into a small Reverb and a Compressor that evens out the hit.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the hit strength.\n\n" +
        "Tip: raise the Reverb mix for a bigger room.",
  layers: [layer("punch-snare", "Snare", { tune: 190, tone: 0.5, snappy: 0.7, decay: 0.32 })],
  effects: [effect("reverb", "Room", { size: 0.35, decay: 0.7, damping: 0.5, mix: 0.18 }),
            effect("compressor", "Even", { threshold: -16, ratio: 3, attack: 8, release: 100, makeup: 2 })],
});

const trapTick = () => drum("Trap Tick Snare", {
  description: "A tight, high snare with a hard tick and a short tail: it sits on the two and four of a trap beat.",
  tags: ["snare", "trap", "tight", "tick"],
  help: "A Ring Snare at 260 Hz with a short decay, plus a Punch Rim 6 dB down for the tick, then a high-pass at 150 Hz.\n\n" +
        "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both layers.\n\n" +
        "Tip: add the Slapback Clap on the same beat for a layered trap snare.",
  layers: [layer("ring-snare", "Snare", { tune: 260, tone: 0.6, snappy: 0.6, decay: 0.15 }),
           layer("punch-rim", "Tick", { tune: 3, decay: 0.5 }, { gain: -6 })],
  effects: [effect("filter", "Rumble Cut", { cutoff: 150, mode: HP })],
});

const electroNoise = () => drum("Electro Noise Snare", {
  description: "A bright, synthetic snare made mostly of noise with a thin pitched body: 1980s electro.",
  tags: ["snare", "electro", "synthetic", "noise"],
  help: "A Macro Osc in its Snare model, crunched to 8 bits, into a short, bright Reverb.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity feeds the accent.\n\n" +
        "Tip: change Shape on the Macro Osc to move between a pitched and a noisy snare.",
  layers: [layer("macro-osc", "Snare", { model: "Snare", octave: 0, tone: 0.75, shape: 0.8, blend: 0.6, decay: 0.28 })],
  effects: [effect("crunch", "Edge", { drive: 0.3, bits: 8, rate: 0.1, tone: 20000, level: 1, mix: 0.7 }),
            effect("reverb", "Plate", { size: 0.3, decay: 0.5, damping: 0.2, mix: 0.15 })],
});

const lofiDust = () => drum("Lo-fi Dust Snare", {
  description: "A soft, rounded snare with a slow dusty tail, rolled off at the top: it sits behind a sample loop.",
  tags: ["snare", "lo-fi", "dusty", "soft"],
  help: "A Punch Snare at 175 Hz with a low Tone and a long-ish decay, crunched to 11 bits and low-passed at 5 kHz.\n\n" +
        "Patch a trigger into Trig and take Out L/R. The Tone input opens the low-pass.\n\n" +
        "Tip: lower Bits for a rougher sound.",
  layers: [layer("punch-snare", "Snare", { tune: 175, tone: 0.3, snappy: 0.5, decay: 0.38 })],
  effects: [effect("crunch", "Dust", { drive: 0.15, bits: 11, rate: 0.2, tone: 20000, level: 1, mix: 1 }),
            effect("filter", "Low-pass", { cutoff: 5000, resonance: 0.05 })],
  patch: toneDial(2, 0.3),
});

const crossStick = () => drum("Cross Stick", {
  description: "A short, woody click like the stick laid across the rim: the quiet alternative to a snare.",
  tags: ["snare", "rim", "cross stick", "woody"],
  help: "A Ring Rim in Rim mode, tuned up three semitones with a short decay, and a faint Modal head from a Perc Voice under it.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity scales both layers.\n\n" +
        "Tip: use it on the backbeat of a ballad or a bossa nova.",
  layers: [layer("ring-rim", "Rim", { voice: "Rim", tune: 3, decay: 0.6 }),
           layer("perc-voice", "Head", { engine: "Modal", pitch: 220, tone: 0.1, click: 0.2, decay: 0.1, sweep: 0.1, damp: 0.7 }, { gain: -14 })],
});

const tomSnare = () => drum("Tom Snare", {
  description: "A low, thick snare with a lot of tom in it: heavy, dark and slow, for half-time grooves.",
  tags: ["snare", "low", "heavy", "half-time"],
  help: "A Punch Snare at 135 Hz with a long decay and lots of body, joined by a Punch Tom 6 dB down at 120 Hz.\n\n" +
        "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both layers.\n\n" +
        "Tip: tune the Punch Tom up to make the snare brighter.",
  layers: [layer("punch-snare", "Snare", { tune: 135, tone: 0.35, snappy: 0.55, decay: 0.45 }),
           layer("punch-tom", "Body", { tune: 120, decay: 0.3, bend: 0.4, noise: 0.1 }, { gain: -6 })],
  effects: [effect("reverb", "Room", { size: 0.4, decay: 0.9, damping: 0.6, mix: 0.2 })],
});

const industrialSlam = () => drum("Industrial Slam Snare", {
  description: "A violent, distorted snare that hits like a hammer on a steel plate.",
  tags: ["snare", "industrial", "distorted", "loud"],
  help: "A Punch Snare with Tone at its top and long Snappy, plus a Ring Cymbal 14 dB down for the metallic wash, through a Crunch with a lot of drive and a fast Compressor.\n\n" +
        "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both layers.\n\n" +
        "Tip: lower the Crunch Drive for a more usable but still aggressive snare.",
  layers: [layer("punch-snare", "Snare", { tune: 210, tone: 0.9, snappy: 0.9, decay: 0.35 }),
           layer("ring-cymbal", "Plate", { tune: 2, decay: 0.8, tone: 0.7 }, { gain: -14 })],
  effects: [effect("crunch", "Hammer", { drive: 0.8, bits: 12, tone: 10000, level: 0.8, mix: 1 }),
            effect("compressor", "Squash", { threshold: -20, ratio: 10, attack: 1, release: 80, makeup: 5 })],
});

const plateSnare = () => drum("Plate Snare", {
  description: "A clean snare thrown into a long, smooth plate reverb: an open, spacious backbeat.",
  tags: ["snare", "plate", "reverb", "spacious"],
  help: "A Punch Snare at 205 Hz with a medium decay into a Reverb with a long decay and low damping at 35 percent mix.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the hit strength.\n\n" +
        "Tip: raise Pre-delay on the Reverb to keep the attack in front of the plate.",
  layers: [layer("punch-snare", "Snare", { tune: 205, tone: 0.55, snappy: 0.65, decay: 0.25 })],
  effects: [effect("reverb", "Plate", { size: 0.7, decay: 2.2, preDelay: 0.03, damping: 0.25, diffusion: 0.95, mix: 0.35 })],
});

const bigRoomClap = () => drum("Big Room Clap", {
  description: "A wide, loud clap with a long room behind it: festival-sized.",
  tags: ["clap", "big", "room", "edm"],
  help: "A Punch Clap with four bursts and a long decay, into a large Reverb at 35 percent mix.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
        "Tip: shorten the Reverb Decay if the clap starts to blur with the hats.",
  layers: [layer("punch-clap", "Clap", { tone: 1700, decay: 0.55, spread: 0.012, bursts: 4 })],
  effects: [effect("reverb", "Hall", { size: 0.8, decay: 1.8, damping: 0.4, mix: 0.35, width: 1.3 })],
});

const tightTrapClap = () => drum("Tight Trap Clap", {
  description: "A short, snappy clap with only three quick bursts: it fits fast hi-hat rolls.",
  tags: ["clap", "trap", "tight", "short"],
  help: "A Punch Clap with three bursts that are close together and a short decay, high-passed at 400 Hz.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
        "Tip: raise Spread on the Punch Clap to loosen the bursts.",
  layers: [layer("punch-clap", "Clap", { tone: 2000, decay: 0.2, spread: 0.006, bursts: 3 })],
  effects: [effect("filter", "High-pass", { cutoff: 400, mode: HP })],
});

const crowd = () => drum("Loose Crowd Clap", {
  description: "Many people clapping out of time: six bursts spread widely, with a soft room around them.",
  tags: ["clap", "crowd", "loose", "live"],
  help: "A Ring Clap with six bursts and a wide Spread, plus a second one a little lower and 4 dB down panned to the side, into a small Reverb.\n\n" +
        "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both layers.\n\n" +
        "Tip: use it for a single gospel-style clap on the downbeat.",
  layers: [layer("ring-clap", "Hands", { tone: 1300, decay: 0.45, spread: 0.028, bursts: 6 }, { pan: -0.3 }),
           layer("ring-clap", "Crowd", { tone: 1000, decay: 0.55, spread: 0.03, bursts: 6 }, { gain: -4, pan: 0.4 })],
  effects: [effect("reverb", "Room", { size: 0.4, decay: 0.8, mix: 0.2 })],
});

const dryFunk = () => drum("Dry Funk Clap", {
  description: "A tiny, dry, cracking clap with no tail: close-miked and punchy.",
  tags: ["clap", "dry", "funk", "close"],
  help: "A Ring Clap with a very short decay and four bursts, high-passed at 600 Hz.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
        "Tip: use the same clap on the offbeat for a disco feel.",
  layers: [layer("ring-clap", "Clap", { tone: 1800, decay: 0.1, spread: 0.009, bursts: 4 })],
  effects: [effect("filter", "High-pass", { cutoff: 600, mode: HP })],
});

const fingerSnap = () => drum("Finger Snap", {
  description: "A bright, light snap with a short airy tail: fingers, not palms.",
  tags: ["clap", "snap", "finger", "light"],
  help: "A Punch Rim tuned up seven semitones for the snap and a single-burst Ring Clap 6 dB down for the air, high-passed at 1 kHz.\n\n" +
        "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both layers.\n\n" +
        "Tip: it works well on the offbeats of a quiet groove.",
  layers: [layer("punch-rim", "Snap", { tune: 7, decay: 0.3 }, { gain: -4 }),
           layer("ring-clap", "Air", { tone: 3200, decay: 0.12, spread: 0.005, bursts: 1 }, { gain: -6 })],
  effects: [effect("filter", "High-pass", { cutoff: 1000, mode: HP })],
});

const gatedHallClap = () => drum("Gated Hall Clap", {
  description: "A clap in a huge hall that is cut off sharply: a big, hard-edged eighties clap.",
  tags: ["clap", "gated", "80s", "hall"],
  help: "A Punch Clap into a large Reverb at almost full mix, followed by a Compressor with a fast attack and release that chops the tail off.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
        "Tip: lengthen the Compressor Release for a softer gate.",
  layers: [layer("punch-clap", "Clap", { tone: 1500, decay: 0.4, spread: 0.01, bursts: 4 })],
  effects: [effect("reverb", "Hall", { size: 0.8, decay: 1.2, damping: 0.3, diffusion: 0.9, mix: 0.75 }),
            effect("compressor", "Gate", { threshold: -22, ratio: 20, attack: 0.5, release: 40, knee: 0, makeup: 6 })],
});

const tapeClap = () => drum("Tape Echo Clap", {
  description: "A soft clap with a dark ping-pong echo that fades into the background: dub-style.",
  tags: ["clap", "echo", "dub", "tape"],
  help: "A Ring Clap with a medium decay into a Delay in ping-pong mode with a dark High Cut and moderate feedback.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
        "Tip: set the delay's Sync to Tempo to make the echoes land on the beat.",
  layers: [layer("ring-clap", "Clap", { tone: 1200, decay: 0.3, spread: 0.012, bursts: 3 })],
  effects: [effect("delay", "Echo", { timel: 280, timer: 420, feedback: 0.45, highcut: 3000, lowcut: 300, mix: 0.35, mode: "Ping-Pong" })],
});

export default category("Drums/Snares & Claps", "One-shot snares and handclaps, from brushed to gated: patch a trigger into Trig.",
  [crack, brush, gated, piccolo, crushed, skinWires, tripleStack, slap, slapback, folded,
  fatBackbeat, trapTick, electroNoise, lofiDust, crossStick, tomSnare, industrialSlam, plateSnare, bigRoomClap, tightTrapClap, crowd, dryFunk, fingerSnap, gatedHallClap, tapeClap]);
