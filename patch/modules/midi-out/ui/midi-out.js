// SPDX-License-Identifier: MIT
// MIDI Out UI: standard layout; this file holds the browser demo description.
(function () {
  "use strict";
  const f = (id, name, def) => ({ id, name, kind: "float", default: def, steps: 0, input: name });
  window.BleepModule = {
    demo: {
      product: "MIDI Out", vendor: "Brilliant Bleep", colour: "#60a5fa",
      params: [f("velocity", "Velocity", 0.8), f("cca", "CC A", 0), f("ccb", "CC B", 0), f("bend", "Bend", 0.5),
        { id: "channel", name: "Channel", kind: "int", default: 0, steps: 16 },
        { id: "ccanum", name: "CC A #", kind: "int", default: 1 / 127, steps: 128 },
        { id: "ccbnum", name: "CC B #", kind: "int", default: 74 / 127, steps: 128 },
        { id: "transpose", name: "Transpose", kind: "int", default: 0.5, steps: 49 },
        { id: "sendcc", name: "Send CC + Bend", kind: "bool", default: 1, steps: 2 }],
      inputs: [{ name: "Gate", type: "gate" }, { name: "Pitch", type: "pitch" }],
      outputs: [],
    },
  };
})();
