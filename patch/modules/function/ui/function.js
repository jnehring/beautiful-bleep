// SPDX-License-Identifier: MIT
// Function UI: adds a slope preview (Rise/Fall ratio and Shape, including live modulation).
(function () {
  "use strict";
  const f = (id, name, def, input = name) => ({ id, name, kind: "float", default: def, steps: 0, input });
  const SYNC = ["Free", "1/32", "1/16", "1/8", "1/4", "1/2", "1 bar", "2 bars", "4 bars", "8 bars"];

  // Inverse of the parameter's skewed range (1 ms .. 10 s, centre 250 ms).
  const skew = Math.log(0.5) / Math.log((0.25 - 0.001) / (10 - 0.001));
  const seconds = (v) => 0.001 + (10 - 0.001) * Math.exp(Math.log(Math.max(v, 1e-6)) / skew);
  const curve = (u, s) => (s >= 0 ? Math.pow(u, 1 + 3 * s) : 1 - Math.pow(1 - u, 1 - 3 * s));
  const value = (st, id) => (st.mods[id] && st.mods[id].active ? st.mods[id].v : st.params[id].v);

  window.BleepModule = {
    demo: {
      product: "Function", vendor: "Brilliant Bleep", colour: "#4fd1c5",
      params: [f("rise", "Rise", 0.5), f("fall", "Fall", 0.5), f("shape", "Shape", 0.5), f("spread", "Spread", 0),
        { id: "cycle", name: "Cycle", kind: "bool", default: 1, steps: 2 },
        { id: "sync", name: "Sync", kind: "choice", default: 0, steps: 10, choices: SYNC }],
      inputs: [{ name: "Trig", type: "gate" }],
      outputs: ["A", "B", "C", "D"].map((name) => ({ name, type: "control", bipolar: false }))
        .concat([{ name: "EOC", type: "trigger", bipolar: false }]),
    },
    onState(st) {
      const c = document.getElementById("slope");
      if (!c || !st.params.rise) return;
      const rise = seconds(value(st, "rise")), fall = seconds(value(st, "fall"));
      const shape = value(st, "shape") * 2 - 1;
      const r = rise / (rise + fall);
      const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const g = c.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent");
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= w; x++) {
        const p = x / w, u = p < r ? p / r : 1 - (p - r) / (1 - r);
        const y = h - 4 - curve(u, shape) * (h - 8);
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    },
  };
})();
