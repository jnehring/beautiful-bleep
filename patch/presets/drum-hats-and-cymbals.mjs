// SPDX-License-Identifier: MIT
// Hats & Cymbals: hi-hats (Closed and Open in) and cymbals (Trig in); Velocity in, Out L/R.
import { category } from "./kit.mjs";
import { drum, layer, effect, HP } from "./drum-kit.mjs";

const hats808 = () => drum("808 Hats", {
  description: "808-style hi-hats from six square waves: Closed and Open, and Closed cuts the open hat.",
  tags: ["hats", "808"],
  hats: true,
  layers: [layer("ring-hats", "Hats", { tune: 0, closed: 0.06, open: 0.5, tone: 0.5 })],
});

const hats909 = () => drum("909 Hats", {
  description: "Crisp 909-style hi-hats with a little crunch: Closed and Open, and Closed cuts the open hat.",
  tags: ["hats", "909", "house"],
  hats: true,
  layers: [layer("punch-hats", "Hats", { tune: 0, closed: 0.05, open: 0.45, tone: 0.6, crunch: 0.4 })],
});

const tight = () => drum("Tight Hats", {
  description: "Very short, bright hats high-passed at 7 kHz: ticks for fast patterns.",
  tags: ["hats", "tight", "minimal"],
  hats: true,
  layers: [layer("punch-hats", "Hats", { tune: 2, closed: 0.025, open: 0.25, tone: 0.85, crunch: 0.2 })],
  effects: [effect("filter", "High-pass", { cutoff: 7000, mode: HP })],
});

const trashy = () => drum("Trashy Hats", {
  description: "Detuned, fully crunched hats with a long, washy open hat.",
  tags: ["hats", "dirty", "lo-fi"],
  hats: true,
  layers: [layer("punch-hats", "Hats", { tune: -3, closed: 0.08, open: 0.9, tone: 0.4, crunch: 1 })],
});

const noise = () => drum("Noise Hats", {
  description: "Hats from two noise-bank voices, high-passed; Closed chokes the open hat.",
  tags: ["hats", "noise"],
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
  hats: true,
  layers: [layer("macro-osc", "Closed", { model: "Metal", octave: 2, tone: 0.7, shape: 0.6, decay: 0.05 },
                 { on: "closed", gain: 3 }),
           layer("macro-osc", "Open", { model: "Metal", octave: 2, tone: 0.7, shape: 0.6, decay: 0.5 }, { on: "open" })],
});

const crash = () => drum("Crash", {
  description: "A bright crash cymbal with a three-second wash.",
  tags: ["cymbal", "crash"],
  layers: [layer("punch-cymbal", "Crash", { voice: "Crash", tune: 0, decay: 3, tone: 0.6, crunch: 0.3 })],
});

const ride = () => drum("Ride", {
  description: "A ride cymbal: a defined ping over a long, quiet shimmer.",
  tags: ["cymbal", "ride"],
  layers: [layer("punch-cymbal", "Ride", { voice: "Ride", tune: 0, decay: 2.5, tone: 0.5, crunch: 0.2 })],
});

const cymbal808 = () => drum("808 Cymbal", {
  description: "An 808-style cymbal: square-wave metal with a long, hissy decay.",
  tags: ["cymbal", "808"],
  layers: [layer("ring-cymbal", "Cymbal", { tune: 0, decay: 3, tone: 0.5 })],
});

const splash = () => drum("Splash", {
  description: "A small, high, short crash for accents.",
  tags: ["cymbal", "splash", "accent"],
  layers: [layer("punch-cymbal", "Splash", { voice: "Crash", tune: 5, decay: 0.9, tone: 0.8, crunch: 0.4 })],
});

export default category("Drums/Hats & Cymbals", "Hi-hats with Closed and Open triggers, and crash, ride and splash cymbals.",
  [hats808, hats909, tight, trashy, noise, metal, crash, ride, cymbal808, splash]);
