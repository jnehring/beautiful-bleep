// SPDX-License-Identifier: MIT
// Hats & Cymbals: hi-hats (Closed and Open in) and cymbals (Trig in); Velocity in, Out L/R.
import { category } from "./kit.mjs";
import { drum, layer, effect, HP } from "./drum-kit.mjs";

const hats808 = () => drum("808 Hats", {
  description: "808-style hi-hats from six square waves: Closed and Open, and Closed cuts the open hat.",
  tags: ["hats", "808"],
  help: "A Ring Hats module: six square waves through a filter. It has two trigger inputs, Closed and Open. A " +
         "Closed trigger also cuts a ringing open hat.\n\n" +
         "Patch one trigger into Closed and another into Open, then Out L/R. Velocity scales both.\n\n" +
         "Tip: put the open hat on the off-beats and closed hats on the other 8ths or 16ths.",
  hats: true,
  layers: [layer("ring-hats", "Hats", { tune: 0, closed: 0.06, open: 0.5, tone: 0.5 })],
});

const hats909 = () => drum("909 Hats", {
  description: "Crisp 909-style hi-hats with a little crunch: Closed and Open, and Closed cuts the open hat.",
  tags: ["hats", "909", "house"],
  help: "A Punch Hats module with a Crunch control for a slightly gritty edge. Closed is 0.05 s and Open 0.45 " +
         "s. A Closed trigger cuts the open hat.\n\n" +
         "Patch triggers into Closed and Open, and take Out L/R. Velocity sets the level.\n\n" +
         "Tip: raise Crunch for a dirtier, more lo-fi feel.",
  hats: true,
  layers: [layer("punch-hats", "Hats", { tune: 0, closed: 0.05, open: 0.45, tone: 0.6, crunch: 0.4 })],
});

const tight = () => drum("Tight Hats", {
  description: "Very short, bright hats high-passed at 7 kHz: ticks for fast patterns.",
  tags: ["hats", "tight", "minimal"],
  help: "A Punch Hats module with a very short closed time (0.025 s), a bright Tone and a high Tune, followed " +
         "by a 7 kHz high-pass that removes the body.\n\n" +
         "Patch triggers into Closed and Open and take Out L/R. Velocity scales the hit.\n\n" +
         "Tip: use it on fast 16ths or 32nds, where a longer hat would blur.",
  hats: true,
  layers: [layer("punch-hats", "Hats", { tune: 2, closed: 0.025, open: 0.25, tone: 0.85, crunch: 0.2 })],
  effects: [effect("filter", "High-pass", { cutoff: 7000, mode: HP })],
});

const trashy = () => drum("Trashy Hats", {
  description: "Detuned, fully crunched hats with a long, washy open hat.",
  tags: ["hats", "dirty", "lo-fi"],
  help: "A Punch Hats module tuned down three semitones with Crunch at maximum and a long Open time (0.9 s). " +
         "The open hat washes out; Closed still cuts it.\n\n" +
         "Patch triggers into Closed and Open and take Out L/R. Velocity sets the level.\n\n" +
         "Tip: use open hats sparingly, since they run on for most of a bar.",
  hats: true,
  layers: [layer("punch-hats", "Hats", { tune: -3, closed: 0.08, open: 0.9, tone: 0.4, crunch: 1 })],
});

const noise = () => drum("Noise Hats", {
  description: "Hats from two noise-bank voices, high-passed; Closed chokes the open hat.",
  tags: ["hats", "noise"],
  help: "Two Perc Voices in the Noise Bank engine, one short for Closed (0.04 s) and one longer for Open (0.4 " +
         "s), then a 5 kHz high-pass. The Closed trigger also chokes the open voice.\n\n" +
         "Patch triggers into Closed and Open and take Out L/R. Velocity feeds both voices.\n\n" +
         "Tip: raise the Pitch of either voice for a thinner, hissier hat.",
  hats: true,
  layers: [layer("perc-voice", "Closed", { engine: "Noise Bank", pitch: 3000, tone: 0.9, click: 0.2, decay: 0.04,
                                           sweep: 0, damp: 0.2 }, { on: "closed" }),
           layer("perc-voice", "Open", { engine: "Noise Bank", pitch: 3200, tone: 0.9, click: 0.1, decay: 0.4,
                                         sweep: 0, damp: 0.2 }, { on: "open", gain: 3 })],
  effects: [effect("filter", "High-pass", { cutoff: 5000, mode: HP })],
  patch: (p, [, open]) => p.cable(p.cin, "closed", open, "choke"),
});

const metal = () => drum("Metal Hats", {
  description: "Hats from the Macro Osc metal model: clangy, ring-modulated and inharmonic.",
  tags: ["hats", "metallic", "industrial"],
  help: "Two Macro Osc voices in the Metal model, two octaves up: one very short for Closed (0.05 s), one " +
         "long for Open (0.5 s). The sound is clangy and inharmonic.\n\n" +
         "Patch triggers into Closed and Open and take Out L/R. Velocity feeds both. There is no choke here, " +
         "so a closed hit does not cut the open one.\n\n" +
         "Tip: change Shape on each voice to taste.",
  hats: true,
  layers: [layer("macro-osc", "Closed", { model: "Metal", octave: 2, tone: 0.7, shape: 0.6, decay: 0.05 },
                 { on: "closed", gain: 3 }),
           layer("macro-osc", "Open", { model: "Metal", octave: 2, tone: 0.7, shape: 0.6, decay: 0.5 }, { on: "open" })],
});

const crash = () => drum("Crash", {
  description: "A bright crash cymbal with a three-second wash.",
  tags: ["cymbal", "crash"],
  help: "A Punch Cymbal in its Crash voice with a 3 second decay, bright tone and some crunch.\n\n" +
         "Patch a trigger into Trig and Out L/R to your output. Velocity scales the hit.\n\n" +
         "Tip: play it on the first beat of a new section, and shorten Decay if it smears into the next bar.",
  layers: [layer("punch-cymbal", "Crash", { voice: "Crash", tune: 0, decay: 3, tone: 0.6, crunch: 0.3 })],
});

const ride = () => drum("Ride", {
  description: "A ride cymbal: a defined ping over a long, quiet shimmer.",
  tags: ["cymbal", "ride"],
  help: "A Punch Cymbal in its Ride voice: a defined ping with a long, quiet shimmer over a 2.5 s decay.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
         "Tip: play steady 8ths with varying Velocity so the bell-like ping stays in front.",
  layers: [layer("punch-cymbal", "Ride", { voice: "Ride", tune: 0, decay: 2.5, tone: 0.5, crunch: 0.2 })],
});

const cymbal808 = () => drum("808 Cymbal", {
  description: "An 808-style cymbal: square-wave metal with a long, hissy decay.",
  tags: ["cymbal", "808"],
  help: "A Ring Cymbal: square-wave metal with a long 3 s decay and noisy hiss. Tone shifts the brightness.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity scales it.\n\n" +
         "Tip: it is great for accents on the 1; lower Decay for something closer to a hat.",
  layers: [layer("ring-cymbal", "Cymbal", { tune: 0, decay: 3, tone: 0.5 })],
});

const splash = () => drum("Splash", {
  description: "A small, high, short crash for accents.",
  tags: ["cymbal", "splash", "accent"],
  help: "A Punch Cymbal on its Crash voice, tuned five semitones up with a short 0.9 s decay, high Tone and " +
         "crunch.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
         "Tip: use it for quick accents at the end of a fill, where a full crash would be too much.",
  layers: [layer("punch-cymbal", "Splash", { voice: "Crash", tune: 5, decay: 0.9, tone: 0.8, crunch: 0.4 })],
});

export default category("Drums/Hats & Cymbals", "Hi-hats with Closed and Open triggers, and crash, ride and splash cymbals.",
  [hats808, hats909, tight, trashy, noise, metal, crash, ride, cymbal808, splash]);
