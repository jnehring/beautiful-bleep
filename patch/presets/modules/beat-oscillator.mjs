// SPDX-License-Identifier: MIT
// Beat Oscillator: factory presets (see ../build-modules.mjs). Beat is cubic: on ±2 kHz, 0.5 is about 250 Hz.
export default [
  ["Lab Tone", { carrier: 10000, beat: 0.5076, drift: 0.1 }, "Classic heterodyne sine around 260 Hz, slightly alive."],
  ["Pure Low", { carrier: 8000, beat: 0.3, drift: 0, mixer: "Ideal" }, "A steady, drift-free low sine tone, good for sub and tests."],
  ["Bright Whistle", { carrier: 12000, beat: 0.85, drift: 0.08 }, "High beat tone around 1.2 kHz, thin and whistly."],
  ["Diode Buzz", { carrier: 9000, beat: 0.55, mixer: "Diode", drift: 0.12 }, "Brighter, buzzy beat from a diode mixer: a reedy lead."],
  ["Overdriven Triangle", { carrier: 9000, beat: 0.5, mixer: "Overdriven", drift: 0.1 }, "Squared-off carriers give a triangle-like beat with a little leak."],
  ["Slow Tremolo", { carrier: 10000, beat: 0.2, range: "±200 Hz", coupling: "AC", drift: 0.05 }, "Beat of a few hertz: the tone swells and fades like a tremolo."],
  ["Slow Pulse", { carrier: 10000, beat: 0.35, range: "±20 Hz", coupling: "DC", drift: 0 }, "Sub-audio beat of about one hertz; use as a smooth LFO."],
  ["Wandering Zero", { carrier: 10000, beat: 0.05, fine: 0.3, drift: 0.6 }, "Near zero beat with strong drift: the pitch lurches unpredictably."],
  ["Locking Stutter", { carrier: 10000, beat: 0.55, range: "±200 Hz", pull: 0.5, drift: 0.3 }, "Coupled carriers try to lock: uneven blips between near-silences."],
  ["Hard Lock", { carrier: 10000, beat: 0.4, range: "±200 Hz", pull: 0.9, drift: 0.2 }, "Strong coupling: the beat vanishes and returns as drift moves across the lock edge."],
  ["Open Detector", { carrier: 6000, beat: 0.5, detector: 0.8, drift: 0.1 }, "Opening the detector lets the sum tone whistle through above the beat."],
  ["Cold Valve", { carrier: 10000, beat: 0.5, warmup: "30 s", drift: 0.3 }, "Starts flat and glides into tune like a cold instrument."],
  ["Hand Capacity", { carrier: 11000, beat: 0.5076, detuneRange: 120, drift: 0.1 }, "Wide Detune range: patch a slow control to it for theremin-like hand moves."],
  ["FM Siren", { carrier: 10000, beat: 0.7, drift: 0.2, mixer: "Diode", fine: 1 }, "Mid-high buzzing beat to patch an LFO into FM for sirens."],
];
