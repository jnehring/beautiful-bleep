// SPDX-License-Identifier: MIT
// Filter UI: adds a magnitude response of the current (modulated) settings.
(function () {
  "use strict";
  const f = (id, name, def) => ({ id, name, kind: "float", default: def, steps: 0, input: name });
  const value = (st, id) => (st.mods[id] && st.mods[id].active ? st.mods[id].v : st.params[id].v);

  // Analog prototype of the SVF: LP 1, BP s/Q, HP s², notch s²+1, over s² + s/Q + 1.
  function magnitude(freq, fc, q, morph) {
    const w = freq / fc;                       // s = j·w
    const den = [1 - w * w, w / q];            // complex: re, im
    const outs = [[1, 0], [0, w / q], [-w * w, 0], [1 - w * w, 0]];
    const m = Math.min(Math.max(morph, 0), 1) * 3;
    const i = Math.min(Math.floor(m), 2), t = m - i;
    const num = [outs[i][0] + t * (outs[i + 1][0] - outs[i][0]), outs[i][1] + t * (outs[i + 1][1] - outs[i][1])];
    return Math.hypot(num[0], num[1]) / Math.hypot(den[0], den[1]);
  }

  window.BleepModule = {
    demo: {
      product: "Filter", vendor: "Brilliant Bleep", colour: "#f472b6",
      params: [f("cutoff", "Cutoff", 0.667), f("resonance", "Resonance", 0.2), f("drive", "Drive", 0),
        f("mode", "Mode", 0), f("mix", "Mix", 1), f("keytrack", "Key Track", 0)],
      inputs: [{ name: "Pitch", type: "pitch" }],
      outputs: [{ name: "Env", type: "control", bipolar: false }],
    },
    onState(st) {
      const c = document.getElementById("response");
      if (!c || !st.params.cutoff) return;
      const fc = 20 * Math.pow(1000, value(st, "cutoff"));
      const q = 0.5 * Math.pow(50, value(st, "resonance"));
      const morph = value(st, "mode"), mix = value(st, "mix");
      const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const g = c.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const top = 24, bottom = -36;              // dB
      const y = (db) => (top - Math.min(top, Math.max(bottom, db))) / (top - bottom) * h;
      g.strokeStyle = "#333845";
      g.beginPath(); g.moveTo(0, y(0)); g.lineTo(w, y(0)); g.stroke();
      g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent");
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= w; x++) {
        const freq = 20 * Math.pow(1000, x / w);
        const lin = mix * magnitude(freq, fc, q, morph) + (1 - mix);  // dry/wet, phase ignored
        const yy = y(20 * Math.log10(Math.max(lin, 1e-6)));
        x ? g.lineTo(x, yy) : g.moveTo(x, yy);
      }
      g.stroke();
    },
  };
})();
