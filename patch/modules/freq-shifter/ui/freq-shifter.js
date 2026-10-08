// SPDX-License-Identifier: MIT
// Freq Shifter view (specs/modules/frequency-shifter.md §5): the input and
// output spectra (live arrays from FreqShifterModule::liveArrays, 20 Hz …
// 20 kHz, log axis), a phase dial with the left and right oscillators, and
// the shift in hertz (or the synced note value).
(function () {
  "use strict";
  const RANGES = [10, 200, 2000, 10000];
  const SYNC = ["Free", "1/32", "1/16", "1/8", "1/4", "1/2", "1 bar", "2 bars", "4 bars", "8 bars"];
  const TOP = 0, BOTTOM = -90;

  function setting(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    const v = view.node.params[id] ?? p.default;
    return Math.round(p.min + v * (p.max - p.min));
  }
  function hzText(hz) {
    const a = Math.abs(hz);
    if (a >= 1000) return (hz / 1000).toFixed(2) + " kHz";
    return hz.toFixed(a < 10 ? 2 : 1) + " Hz";
  }
  function canvas(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }
  function curve(g, bins, w, h, colour, width) {
    const y = (db) => (TOP - Math.min(TOP, Math.max(BOTTOM, db))) / (TOP - BOTTOM) * h;
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.beginPath();
    for (let i = 0; i < bins.length; i++) {
      const x = (i + 0.5) / bins.length * w;
      i ? g.lineTo(x, y(bins[i])) : g.moveTo(x, y(bins[i]));
    }
    g.stroke();
  }

  BleepViews.register("freq-shifter", {
    template:
      '<div class="bv-panel"><h2>Spectrum <span class="fs-shift" style="float:right;font-weight:normal"></span></h2>' +
      '<div style="display:flex;gap:8px;align-items:center">' +
      '<canvas class="fs-spectrum" style="flex:1;height:80px;min-width:0"></canvas>' +
      '<canvas class="fs-dial" style="width:56px;height:56px;flex:none"></canvas></div></div>',
    onState(st, view) {
      const css = getComputedStyle(view.root);
      const accent = css.getPropertyValue("--accent"), line = css.getPropertyValue("--line");
      const muted = css.getPropertyValue("--muted") || line, text = css.getPropertyValue("--text");
      const sync = setting(view, "sync");
      const label = view.root.querySelector(".fs-shift");
      if (label) {
        const shift = (view.value(st, "shift") * 2 - 1);
        if (sync > 0) label.textContent = (shift >= 0 ? "▲ " : "▼ ") + "1 cycle / " + SYNC[sync];
        else {
          const hz = st && typeof st.shiftHz === "number" ? st.shiftHz
            : shift * RANGES[setting(view, "range")] + (view.value(st, "fine") * 20 - 10);
          label.textContent = (hz > 0 ? "+" : "") + hzText(hz);
        }
      }
      const sc = view.root.querySelector(".fs-spectrum");
      if (sc && sc.clientWidth) {
        const { g, w, h } = canvas(sc);
        g.strokeStyle = line;
        g.lineWidth = 1;
        g.beginPath();
        for (const f of [100, 1000, 10000]) {
          const x = Math.log(f / 20) / Math.log(1000) * w;
          g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h);
        }
        g.stroke();
        const arrays = (st && st.arrays) || {};
        if (arrays.spectrumIn) curve(g, arrays.spectrumIn, w, h, muted, 1);
        if (arrays.spectrumOut) curve(g, arrays.spectrumOut, w, h, accent, 2);
      }
      const dc = view.root.querySelector(".fs-dial");
      if (dc && dc.clientWidth) {
        const { g, w, h } = canvas(dc);
        const r = Math.min(w, h) / 2 - 5, cx = w / 2, cy = h / 2;
        g.strokeStyle = line;
        g.lineWidth = 1;
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
        const dot = (phase, colour, size) => {
          if (typeof phase !== "number") return;
          const a = phase * Math.PI * 2 - Math.PI / 2;
          g.fillStyle = colour;
          g.beginPath(); g.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), size, 0, Math.PI * 2); g.fill();
        };
        dot(st && st.phaseR, text, 3);
        dot(st && st.phaseL, accent, 4);
      }
    },
  });
})();
