// SPDX-License-Identifier: MIT
// Random UI: standard layout; this file holds the browser demo description.
(function () {
  "use strict";
  const f = (id, name, def) => ({ id, name, kind: "float", default: def, steps: 0, input: name });
  window.BleepModule = {
    demo: {
      product: "Random", vendor: "Brilliant Bleep", colour: "#f6a85b",
      params: [f("rate", "Rate", 0.5), f("spread", "Spread", 1), f("bias", "Bias", 0.5), f("smooth", "Smooth", 0),
        f("loop", "Loop", 0),
        { id: "sync", name: "Sync", kind: "choice", default: 4 / 9, steps: 10,
          choices: ["Free", "1/32", "1/16", "1/8", "1/4", "1/2", "1 bar", "2 bars", "4 bars", "8 bars"] },
        { id: "length", name: "Length", kind: "choice", default: 5 / 8, steps: 9,
          choices: [2, 3, 4, 5, 6, 8, 12, 16, 32].map((n) => n + " steps") },
        { id: "quantize", name: "Semitones", kind: "bool", default: 0, steps: 2 },
        { id: "seed", name: "Seed", kind: "int", default: 0.001, steps: 1000 }],
      inputs: [{ name: "Clock", type: "gate" }],
      outputs: [{ name: "Out", type: "control", bipolar: true }, { name: "Trig", type: "trigger", bipolar: false }],
    },
  };
})();
