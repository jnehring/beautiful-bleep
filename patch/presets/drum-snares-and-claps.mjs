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
  effects: [effect("filter", "Band", { cutoff: 9000, resonance: 0.05, mode: 0 }),
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

export default category("Drums/Snares & Claps", "One-shot snares and handclaps, from brushed to gated: patch a trigger into Trig.",
  [crack, brush, gated, piccolo, crushed, skinWires, tripleStack, slap, slapback, folded]);
