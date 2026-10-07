// SPDX-License-Identifier: MIT
// Utility UI: standard layout; this file holds the browser demo description.
(function () {
  "use strict";
  const f = (id, name, def) => ({ id, name, kind: "float", default: def, steps: 0, input: name });
  window.BleepModule = {
    demo: {
      product: "Utility", vendor: "Brilliant Bleep", colour: "#a78bfa",
      params: [f("scalex", "Scale X", 1), f("scaley", "Scale Y", 0.5), f("offset", "Offset", 0.5), f("slew", "Slew", 0),
        f("threshold", "Threshold", 0.5),
        { id: "mode", name: "Mode", kind: "choice", default: 0, steps: 5,
          choices: ["Through", "Rectify", "Fold", "Quantize", "Sample & Hold"] }],
      inputs: [{ name: "X", type: "control" }, { name: "Y", type: "control" }, { name: "Clock", type: "gate" }],
      outputs: [{ name: "Out", type: "control", bipolar: true }, { name: "Gate", type: "gate", bipolar: false },
        { name: "Inv", type: "control", bipolar: true }],
    },
  };
})();
