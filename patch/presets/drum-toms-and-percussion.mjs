// SPDX-License-Identifier: MIT
// Toms & Percussion: toms, hand drums and small percussion. Trig and Velocity in, Out L/R.
import { category } from "./kit.mjs";
import { drum, layer, effect, HP } from "./drum-kit.mjs";

const tom808 = () => drum("808 Tom", {
  description: "A deep 808-style tom with a soft pitch bend; retune it for high, mid and low toms.",
  tags: ["tom", "808"],
  help: "A Ring Tom at 90 Hz with a gentle pitch bend, a 0.6 s decay and a little noise.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity scales the hit.\n\n" +
         "Tip: use three copies tuned to different Tune values for high, mid and low toms.",
  layers: [layer("ring-tom", "Tom", { tune: 90, decay: 0.6, bend: 0.3, noise: 0.2 })],
});

const tom909 = () => drum("909 Tom", {
  description: "A punchy 909-style mid tom with a strong pitch bend.",
  tags: ["tom", "909"],
  help: "A Punch Tom at 140 Hz with a strong pitch bend (0.5), a 0.45 s decay and a bit of noise.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
         "Tip: lower Tune for a floor tom, or lengthen Bend for more drop.",
  layers: [layer("punch-tom", "Tom", { tune: 140, decay: 0.45, bend: 0.5, noise: 0.2 })],
});

const syn = () => drum("Syn Tom", {
  description: "An FM syn-tom with a steep downward sweep: the classic electronic pew.",
  tags: ["tom", "fm", "syndrum", "80s"],
  help: "A Perc Voice in its FM engine at 120 Hz with a steep downward sweep (0.8). The pitch falls fast, " +
         "giving the classic electronic pew.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity feeds the voice's accent.\n\n" +
         "Tip: play a descending run of hits with falling Velocity for the 80s fill.",
  layers: [layer("perc-voice", "Tom", { engine: "FM", pitch: 120, tone: 0.1, morph: 0.2, click: 0.3, decay: 0.5,
                                        sweep: 0.8, damp: 0.3 })],
});

const floor = () => drum("Floor Tom", {
  description: "A low, long floor tom in a small room.",
  tags: ["tom", "floor", "reverb"],
  help: "A Punch Tom at 70 Hz with a 1 s decay and extra noise, into a small Reverb with 20 percent mix.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity scales the hit.\n\n" +
         "Tip: let it ring on a downbeat after a fill; the reverb will add a little air.",
  layers: [layer("punch-tom", "Tom", { tune: 70, decay: 1, bend: 0.3, noise: 0.3 })],
  effects: [effect("reverb", "Room", { size: 0.35, decay: 0.8, mix: 0.2 })],
});

const conga = () => drum("Conga", {
  description: "A modal conga: a warm, slightly bending skin with a palm slap.",
  tags: ["percussion", "conga", "latin", "modal"],
  help: "A Perc Voice in its Modal engine at 220 Hz. Click is the palm slap; Sweep gives the skin a small " +
         "pitch bend; Damp shortens the ring.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity feeds the voice's accent.\n\n" +
         "Tip: add a second one with a lower Pitch for a high/low pair.",
  layers: [layer("perc-voice", "Conga", { engine: "Modal", pitch: 220, tone: 0.3, click: 0.4, decay: 0.3, sweep: 0.15,
                                          damp: 0.5 })],
});

const cowbell = () => drum("Cowbell", {
  description: "An 808-style cowbell: two detuned square waves through a band-pass.",
  tags: ["percussion", "cowbell", "808"],
  help: "A Ring Cowbell: two detuned square waves through a band-pass filter. Decay is short (0.4 s).\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity scales it.\n\n" +
         "Tip: shorten Decay for a dry 808 clank, lengthen it for an open bell.",
  layers: [layer("ring-cowbell", "Cowbell", { tune: 0, decay: 0.4, tone: 0.5 })],
});

const clave = () => drum("Clave", {
  description: "A short, woody clave click.",
  tags: ["percussion", "clave", "latin"],
  help: "A Ring Rim set to its Clave voice: a short woody click at the default tune. Decay is turned up to 1.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity sets the level.\n\n" +
         "Tip: it suits 3-2 or 2-3 clave patterns; change Tune to get a higher or lower block.",
  layers: [layer("ring-rim", "Clave", { voice: "Clave", tune: 0, decay: 1 })],
});

const rimshot = () => drum("Rimshot", {
  description: "A sharp, short rimshot.",
  tags: ["percussion", "rim"],
  help: "A Punch Rim: a sharp, short click with a little body. Decay is set to 1.2.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity scales it.\n\n" +
         "Tip: use it in place of the snare on quiet verses.",
  layers: [layer("punch-rim", "Rim", { tune: 0, decay: 1.2 })],
});

const shaker = () => drum("Shaker", {
  description: "A short burst of high noise-bank grains, high-passed: a shaker for 16ths.",
  tags: ["percussion", "shaker", "noise"],
  help: "A Perc Voice in the Noise Bank engine at 3.5 kHz with a very short 0.09 s decay, then a 4 kHz " +
         "high-pass. A 5 dB gain keeps it present.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity feeds the voice's accent.\n\n" +
         "Tip: play steady 16ths and vary Velocity for a natural shake.",
  layers: [layer("perc-voice", "Shaker", { engine: "Noise Bank", pitch: 3500, tone: 0.9, click: 0, decay: 0.09,
                                           sweep: 0, damp: 0.3 }, { gain: 5 })],
  effects: [effect("filter", "High-pass", { cutoff: 4000, mode: HP })],
});

const tambourine = () => drum("Tambourine", {
  description: "Jingles from a bright open hat over a quiet, low clave for the skin.",
  tags: ["percussion", "tambourine"],
  help: "Two layers: a Punch Hats open hat for the jingles (bright, Tone high) and a quiet Ring Rim on its " +
         "Clave voice, tuned down, for the skin.\n\n" +
         "Trig feeds the open input of the hat and the rim together. Patch a trigger there and take Out L/R. " +
         "Velocity reaches both.\n\n" +
         "Tip: play it on the off-beats, where it fits like a tambourine on 2 and 4.",
  layers: [layer("punch-hats", "Jingles", { tune: 4, open: 0.3, tone: 0.9, crunch: 0.1 }, { on: { open: "trig" } }),
           layer("ring-rim", "Skin", { voice: "Clave", tune: -5, decay: 0.5 }, { gain: -10 })],
});

export default category("Drums/Toms & Percussion", "Toms, hand drums and small percussion: patch a trigger into Trig.",
  [tom808, tom909, syn, floor, conga, cowbell, clave, rimshot, shaker, tambourine]);
