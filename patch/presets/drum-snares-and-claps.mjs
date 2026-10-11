// SPDX-License-Identifier: MIT
// Snares & Claps: one-shot snares and handclaps. Trig and Velocity in, Out L/R.
import { category } from "./kit.mjs";
import { drum, layer, effect } from "./drum-kit.mjs";

const snare808 = () => drum("808 Snare", {
  description: "A classic 808-style snare: two tuned heads and a short burst of noise.",
  tags: ["snare", "808"],
  help: "A Ring Snare: two tuned heads at 180 Hz plus a short noise burst. Snappy sets how much noise there " +
         "is.\n\n" +
         "Patch a trigger into Trig and take Out L/R. A signal into Velocity changes the level of each hit.\n\n" +
         "Tip: lower Snappy for a drier, more tonal snare.",
  layers: [layer("ring-snare", "Snare", { tune: 180, tone: 0.4, snappy: 0.55, decay: 0.25 })],
});

const snare909 = () => drum("909 Snare", {
  description: "A bright, snappy 909-style snare with plenty of rattle.",
  tags: ["snare", "909", "house"],
  help: "A Punch Snare at 200 Hz with a high Tone and a lot of Snappy, so the noise rattle is prominent. " +
         "Decay is short (0.3 s).\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity scales the hit.\n\n" +
         "Tip: play ghost notes with a low Velocity between the backbeats.",
  layers: [layer("punch-snare", "Snare", { tune: 200, tone: 0.6, snappy: 0.75, decay: 0.3 })],
});

const fat = () => drum("Fat Snare", {
  description: "A low, long snare with a quiet clap underneath for width and body.",
  tags: ["snare", "layered", "fat"],
  help: "Two layers: a Punch Snare at 160 Hz with a 0.45 s decay, and a Ring Clap 8 dB down underneath it.\n\n" +
         "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both layers.\n\n" +
         "Tip: raise the clap layer's level in the mixer to widen the hit.",
  layers: [layer("punch-snare", "Snare", { tune: 160, tone: 0.45, snappy: 0.7, decay: 0.45 }),
           layer("ring-clap", "Clap", { tone: 1200, decay: 0.3 }, { gain: -8 })],
});

const bigRoom = () => drum("Big Room Snare", {
  description: "A snappy snare into a big, damped room: an arena backbeat.",
  tags: ["snare", "reverb", "big"],
  help: "A Punch Snare with a long 0.5 s decay into a Reverb with a big size and damped tail, 35 percent mix.\n\n" +
         "Patch a trigger into Trig and Out L/R to the output. Velocity sets the hit strength.\n\n" +
         "Tip: the reverb tail fills gaps, so it works best on sparse backbeats; lower the reverb mix for " +
         "busier patterns.",
  layers: [layer("punch-snare", "Snare", { tune: 190, tone: 0.55, snappy: 0.8, decay: 0.5 })],
  effects: [effect("reverb", "Room", { size: 0.7, decay: 1.8, damping: 0.5, mix: 0.35 })],
});

const macro = () => drum("Macro Snare", {
  description: "The Macro Osc snare model: a synthetic snare with a tight, papery body.",
  tags: ["snare", "synthetic"],
  help: "A Macro Osc in its Snare model, an octave down, with tone and shape set for a papery body. Blend " +
         "mixes the noise.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity feeds the oscillator's accent.\n\n" +
         "Tip: open the Macro Osc and sweep Shape and Blend to move between a tight crack and a soft slap.",
  layers: [layer("macro-osc", "Snare", { model: "Snare", octave: -1, tone: 0.7, shape: 0.5, blend: 0.3, decay: 0.35 })],
});

const noise = () => drum("Noise Snare", {
  description: "A noise-bank snare: a cloud of filtered noise with a sharp click and almost no tone.",
  tags: ["snare", "noise", "electro"],
  help: "A Perc Voice in the Noise Bank engine at 220 Hz with a strong Click and a short decay. It is mostly " +
         "filtered noise, with very little tone.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity feeds the voice's accent.\n\n" +
         "Tip: raise Pitch for a thinner, hissier snare and lower Damp for a brighter one.",
  layers: [layer("perc-voice", "Snare", { engine: "Noise Bank", pitch: 220, tone: 0.6, click: 0.6, decay: 0.3,
                                          damp: 0.3, sweep: 0.3 }, { gain: -3 })],
});

const clap808 = () => drum("808 Clap", {
  description: "An 808-style handclap: four quick noise bursts and a short tail.",
  tags: ["clap", "808"],
  help: "A Ring Clap: four quick noise bursts, followed by a short tail. Tone sets the filter at " +
         "1.1 kHz.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
         "Tip: raise Spread for a looser, sloppier clap.",
  layers: [layer("ring-clap", "Clap", { tone: 1100, decay: 0.3, spread: 0.011, bursts: 4 })],
});

const clap909 = () => drum("909 Clap", {
  description: "A brighter, tighter 909-style handclap.",
  tags: ["clap", "909", "house"],
  help: "A Punch Clap: four close bursts, filtered at 1.5 kHz, with a slightly longer tail.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity scales the hit.\n\n" +
         "Tip: layer it with a snare on the same trigger for a house backbeat.",
  layers: [layer("punch-clap", "Clap", { tone: 1500, decay: 0.35, spread: 0.008, bursts: 4 })],
});

const wide = () => drum("Wide Clap", {
  description: "Two differently tuned claps panned hard left and right: a wide, crowd-like clap.",
  tags: ["clap", "stereo", "wide"],
  help: "Two claps in one mixer: a Punch Clap panned left (1.4 kHz, four bursts) and a Ring Clap panned right " +
         "(1.7 kHz, five bursts). The different tunings and spacings make a stereo spread.\n\n" +
         "Patch a trigger into Trig and use both Out L and Out R. Velocity reaches both.\n\n" +
         "Tip: keep both outputs connected, or the width is lost.",
  layers: [layer("punch-clap", "Clap L", { tone: 1400, decay: 0.3, spread: 0.007, bursts: 4 }, { pan: -0.6 }),
           layer("ring-clap", "Clap R", { tone: 1700, decay: 0.35, spread: 0.014, bursts: 5 }, { pan: 0.6 })],
});

const room = () => drum("Room Clap", {
  description: "A clap in a small, live room.",
  tags: ["clap", "reverb"],
  help: "A Punch Clap (1.3 kHz, 0.4 s decay) into a small Reverb with moderate damping and 30 percent mix, as " +
         "if clapped in a live room.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
         "Tip: raise the reverb mix for a more distant clap.",
  layers: [layer("punch-clap", "Clap", { tone: 1300, decay: 0.4, spread: 0.01, bursts: 4 })],
  effects: [effect("reverb", "Room", { size: 0.4, decay: 1, damping: 0.4, mix: 0.3 })],
});

export default category("Drums/Snares & Claps", "One-shot snares and handclaps for the backbeat: patch a trigger into Trig.",
  [snare808, snare909, fat, bigRoom, macro, noise, clap808, clap909, wide, room]);
