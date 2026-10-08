// SPDX-License-Identifier: MIT
// Factory cell presets (spec §8.3.3), shown under Add → Cell next to the
// user's own. Params left out take their defaults.
(function () {
  "use strict";
  const n = (id, type, name, x, y, params, extra) =>
    Object.assign({ id, type, name, x, y, parent: "root", params: params || {} }, extra || {});
  const k = (fn, fj, tn, tj, amount) => ({ id: "k" + fn + fj + tn + tj, from: { node: fn, jack: fj },
                                          to: { node: tn, jack: tj }, amount: amount === undefined ? 1 : amount });

  // Basic Poly: Oscillator → Multi Filter (SVF Saturating) → VCA, an ADSR each for filter and VCA,
  // key tracking, and shared inputs Cutoff and Bend (±2 semitones).
  const basicPoly = {
    format: 1,
    root: "root",
    category: "Synthesizers",
    nodes: [
      { id: "root", type: "voice-cell", name: "Basic Poly", x: 0, y: 0, parent: "", params: {},
        inputs: [{ id: "cut", name: "Cutoff", type: "control" }, { id: "bend", name: "Bend", type: "control" }],
        outputs: [] },
      n("vi", "voice-in", "Voice In", 40, 60),
      n("ci", "cell-in", "Cell In", 40, 480),
      n("osc", "oscillator", "Oscillator", 320, 40),
      n("envf", "adsr", "Filter Env", 320, 300, { sustain: 0.3 }),
      n("flt", "filter", "Multi Filter", 620, 40, { cutoff: 0.42, resonance: 0.35, keytrack: 0.5, type: 1 }),  // type 1: the last type, SVF Saturating
      n("enva", "adsr", "Amp Env", 620, 320),
      n("amp", "vca", "VCA", 920, 60),
      n("vo", "voice-out", "Voice Out", 1200, 80),
      n("co", "cell-out", "Cell Out", 1200, 480),
    ],
    cables: [
      k("vi", "pitch", "osc", "pitch"),
      k("ci", "bend", "osc", "pitch", 2 / 12),
      k("osc", "out", "flt", "l"),
      k("vi", "pitch", "flt", "pitch"),
      k("envf", "env", "flt", "cutoff", 0.45),
      k("ci", "cut", "flt", "cutoff", 0.5),
      k("vi", "gate", "envf", "gate"),
      k("vi", "trigger", "envf", "retrig"),
      k("vi", "velocity", "envf", "velocity"),
      k("vi", "gate", "enva", "gate"),
      k("vi", "trigger", "enva", "retrig"),
      k("vi", "velocity", "enva", "velocity"),
      k("flt", "l", "amp", "l"),
      k("flt", "r", "amp", "r"),
      k("enva", "env", "amp", "gain"),
      k("amp", "l", "vo", "l"),
      k("amp", "r", "vo", "r"),
      k("enva", "active", "vo", "active"),
    ],
  };

  window.BleepFactoryPresets = [{ name: "Basic Poly", category: "Synthesizers", preset: basicPoly }];
})();
