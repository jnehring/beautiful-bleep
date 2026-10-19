// SPDX-License-Identifier: GPL-3.0-or-later
// Freq Shifter view (doc/specs/modules/frequency-shifter.md §5): the input and
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

  const xOf = (f, w) => Math.log(Math.max(f, 20) / 20) / Math.log(1000) * w;

  BleepViews.register("freq-shifter", {
    width: 800,
    layout: [
      { title: "Shift", params: ["shift", "fine", "range", "sync"] },
      { title: "Feedback", params: ["feedback", "fbDelay"] },
      { title: "Stereo / Quality", params: ["spread", "antiAlias"] },
      { title: "Output", params: ["mix"] },
    ],
    template:
      '<div class="bv-panel"><h2>Spectrum <span class="fs-shift" style="float:right;font-weight:normal"></span></h2>' +
      '<div style="display:flex;gap:10px;align-items:center">' +
      '<canvas class="fs-spectrum" style="flex:1;height:130px;min-width:0"></canvas>' +
      '<canvas class="fs-dial" style="width:84px;height:84px;flex:none"></canvas></div></div>',
    onState(st, view) {
      const th = BleepView.theme(view.root);
      const accent = th.accent, line = th.line, muted = th.muted || th.line, text = th.text;
      const sync = setting(view, "sync");
      const shift = view.value(st, "shift") * 2 - 1;
      const range = RANGES[setting(view, "range")];
      let hzNow = shift * range + (view.value(st, "fine") * 20 - 10);
      if (st && typeof st.shiftHz === "number") hzNow = st.shiftHz;
      const label = view.root.querySelector(".fs-shift");
      if (label) {
        if (sync > 0) label.textContent = (shift >= 0 ? "▲ " : "▼ ") + "1 cycle / " + SYNC[sync];
        else label.textContent = (hzNow > 0 ? "+" : "") + hzText(hzNow);
      }
      const sc = view.root.querySelector(".fs-spectrum");
      if (sc && sc.clientWidth) {
        const { g, w, h } = BleepView.fit(sc);
        g.strokeStyle = line; g.lineWidth = 1; g.globalAlpha = 0.5;
        g.beginPath();
        for (const f of [100, 1000, 10000]) { const x = Math.round(xOf(f, w)) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); }
        g.stroke(); g.globalAlpha = 1;
        const arrays = (st && st.arrays) || {};
        if (arrays.spectrumIn || arrays.spectrumOut) {
          if (arrays.spectrumIn) curve(g, arrays.spectrumIn, w, h, muted, 1);
          if (arrays.spectrumOut) { BleepView.glow(g, accent, 10); curve(g, arrays.spectrumOut, w, h, accent, 2); g.shadowBlur = 0; }
        } else {
          // No live data: the partials of a 110 Hz tone (grey) and where the shift puts them (every
          // line moves by the same number of hertz, so the harmonic ratios break), with the feedback echoes.
          const fb = Math.abs(view.value(st, "feedback") * 2 - 1), mix = view.value(st, "mix");
          const shiftHz = sync > 0 ? 40 * (shift >= 0 ? 1 : -1) : hzNow;
          for (let n = 1; n <= 40; n++) {
            const f0 = 110 * n, amp = 1 / Math.pow(n, 0.8), x0 = xOf(f0, w);
            g.strokeStyle = muted; g.globalAlpha = 0.5 * (1 - 0.5 * mix); g.lineWidth = 1;
            g.beginPath(); g.moveTo(x0, h - 2); g.lineTo(x0, h - 2 - amp * (h - 10)); g.stroke();
            for (let r = 1; r <= 3; r++) {
              const f = f0 + shiftHz * r, a = amp * Math.pow(fb, r - 1) * (r === 1 ? mix : mix * fb);
              if (a < 0.02 || f < 20 || f > 20000) continue;
              const x = xOf(f, w);
              g.globalAlpha = 0.9 / r; g.strokeStyle = accent; g.lineWidth = 2;
              BleepView.glow(g, accent, 8);
              g.beginPath(); g.moveTo(x, h - 2); g.lineTo(x, h - 2 - a * (h - 10)); g.stroke();
              g.shadowBlur = 0;
              if (r === 1) { g.globalAlpha = 0.18; g.lineWidth = 1; g.strokeStyle = text; g.beginPath(); g.moveTo(x0, h - 2 - amp * (h - 10)); g.lineTo(x, h - 2 - a * (h - 10)); g.stroke(); }
            }
          }
          g.globalAlpha = 1; g.lineWidth = 1;
        }
      }
      const dc = view.root.querySelector(".fs-dial");
      if (dc && dc.clientWidth) {
        const { g, w, h } = BleepView.fit(dc);
        const r = Math.min(w, h) / 2 - 6, cx = w / 2, cy = h / 2;
        g.strokeStyle = line; g.lineWidth = 1.5;
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
        const dot = (phase, colour, size) => {
          if (typeof phase !== "number") return;
          const a = phase * Math.PI * 2 - Math.PI / 2;
          g.fillStyle = colour;
          g.beginPath(); g.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), size, 0, Math.PI * 2); g.fill();
        };
        // No live phases: a dot that turns with the shift direction.
        const t = performance.now() / 1000, hasPhase = st && typeof st.phaseL === "number";
        const pl = hasPhase ? st.phaseL : (t * hzNow / Math.max(2, Math.abs(hzNow)) * 0.5) % 1;
        const trail = hasPhase ? 0 : 1;
        if (trail) for (let k = 1; k < 9; k++) { g.globalAlpha = 0.35 - 0.04 * k; dot(pl - Math.sign(hzNow || 1) * k * 0.012, accent, 3.5); }
        g.globalAlpha = 1;
        BleepView.glow(g, accent, 8);
        dot(pl, accent, 4);
        g.shadowBlur = 0;
        dot(st && st.phaseR, text, 3);
      }
    },
  });
})();
