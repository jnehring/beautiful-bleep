// SPDX-License-Identifier: MIT
// Pulse Generator: factory presets (see ../build-modules.mjs).
export default [
  ["Clock 1/16", { sync: "1/16", width: 0.01, amplitude: 1 }, "Exact 1/16 clock pulse locked to the song position."],
  ["Slow Gate", { period: 1, width: 0.25, rise: 0.05, fall: 0.2 }, "Gentle one-second gate with softened edges: a rhythmic envelope source."],
  ["Square Wave", { period: 0.005, width: 0.0025, amplitude: 0.7 }, "A 200 Hz square tone."],
  ["Narrow Pulse", { period: 0.005, width: 0.0006, amplitude: 0.7 }, "Thin 200 Hz pulse: nasal and bright."],
  ["Click Train", { period: 0.04, width: 0.00005, amplitude: 0.8 }, "A train of 25 Hz clicks: granular and tick-like."],
  ["Cable Ping", { sync: "1/8", width: 0.0002, ring: 0.8, ringfreq: 1800, damping: 0.6 }, "Short pulses ringing like a mistuned cable."],
  ["Small Drum", { sync: "1/4", width: 0.0004, ring: 0.9, ringfreq: 120, damping: 0.4 }, "Low ringing resonance: a tiny tuned drum on every beat."],
  ["Metal Tick", { sync: "1/16", width: 0.0001, ring: 0.7, ringfreq: 6000, damping: 0.7 }, "High, tight ring for hat-like ticks."],
  ["Burst Triggered", { mode: "Triggered", period: 0.02, width: 0.001, burst: 8, ring: 0.4, ringfreq: 900, damping: 0.5 }, "Each trigger fires eight fast pulses: a flam or roll."],
  ["Double Pulse", { sync: "1/8", width: 0.004, delay: 0.02, double: true, ring: 0.3, ringfreq: 1500 }, "Two pulses per period for flams and double clocks."],
  ["Jittery Clock", { sync: "1/16", width: 0.01, jitter: 0.35 }, "Human-ish wobble on each pulse while the grid stays put."],
  ["Gated Pulses", { mode: "Gated", period: 0.02, width: 0.004, amplitude: 0.7, ring: 0.3 }, "Pulses run while the gate is high: a buzzy gated tone."],
  ["Complement Gate", { period: 0.5, width: 0.1, polarity: "Complement", offset: 0 }, "Inverted pulse: high most of the time, dips on the beat."],
  ["Percent Width", { units: "% of Period", period: 0.02, widthpct: 0.15, delaypct: 0.0, amplitude: 0.7 }, "Width follows the period, so the timbre stays put as you sweep pitch."],
  ["Soft Edges", { period: 0.004, width: 0.0015, rise: 0.6, fall: 0.6, amplitude: 0.7 }, "Slewed edges round a pulse into a soft, nearly triangle tone."],
];
