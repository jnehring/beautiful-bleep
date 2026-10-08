// SPDX-License-Identifier: MIT
// Folder view: the transfer curve of the stages up to Tap (computed by the
// module with dsp::Folder::transfer, x from −2 to +2 after Level) with the
// live input range shaded, a row of six dots for the Tap position, and a
// scope of the output over the dry signal (about 20 ms, triggered).
(function () {
  "use strict";

  function canvas(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return [g, w, h];
  }
  function trace(g, data, w, h, scale) {
    g.beginPath();
    data.forEach((v, i) => {
      const x = i / (data.length - 1) * w, y = h / 2 - Math.max(-1.2, Math.min(1.2, v)) * scale;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
  }

  BleepViews.register("wavefolder", {
    template: '<div class="bv-panel" style="display:flex;gap:8px">' +
      '<div style="flex:1"><h2>Transfer</h2><canvas class="wf-curve" style="width:100%;height:96px"></canvas>' +
      '<div class="wf-taps" style="display:flex;justify-content:space-between;padding:4px 6px 0"></div></div>' +
      '<div style="flex:1"><h2>Scope</h2><canvas class="wf-scope" style="width:100%;height:96px"></canvas></div></div>',
    afterBuild(view, el) {
      const taps = el.querySelector(".wf-taps");
      for (let i = 0; i < 6; i++) {
        const d = document.createElement("span");
        d.style.cssText = "width:8px;height:8px;border-radius:50%;background:var(--line)";
        taps.append(d);
      }
    },
    onState(st, view) {
      const a = st && st.arrays;
      if (!a || !a.transfer) return;
      const css = getComputedStyle(view.root);
      const accent = css.getPropertyValue("--accent"), line = css.getPropertyValue("--line"), text = css.getPropertyValue("--text");

      // Transfer curve, x −2 … +2, y −1 … +1, with the input range shaded.
      const c = view.root.querySelector(".wf-curve");
      if (c && c.clientWidth) {
        const [g, w, h] = canvas(c);
        const X = (x) => (x + 2) / 4 * w, Y = (y) => h / 2 - y * (h / 2 - 3);
        const [lo, hi] = a.range || [0, 0];
        g.fillStyle = accent;
        g.globalAlpha = 0.15;
        g.fillRect(X(Math.max(-2, lo)), 0, Math.max(1, X(Math.min(2, hi)) - X(Math.max(-2, lo))), h);
        g.globalAlpha = 1;
        g.strokeStyle = line;
        g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
        g.strokeStyle = accent;
        g.lineWidth = 2;
        g.beginPath();
        a.transfer.forEach((v, i) => {
          const x = -2 + 4 * i / (a.transfer.length - 1);
          i ? g.lineTo(X(x), Y(v)) : g.moveTo(X(x), Y(v));
        });
        g.stroke();
        g.lineWidth = 1;
      }

      // Tap dots: brightness by weight of the two stages heard.
      const tap = 1 + 5 * view.value(st, "tap");
      view.root.querySelectorAll(".wf-taps span").forEach((d, i) => {
        const weight = Math.max(0, 1 - Math.abs(tap - (i + 1)));
        d.style.background = weight > 0 ? accent : line;
        d.style.opacity = weight > 0 ? String(0.35 + 0.65 * weight) : "1";
      });

      // Scope: dry dim, output bright.
      const s = view.root.querySelector(".wf-scope");
      if (s && s.clientWidth && a.wet) {
        const [g, w, h] = canvas(s);
        const scale = h / 2 - 3;
        g.strokeStyle = text;
        g.globalAlpha = 0.3;
        trace(g, a.dry || [], w, h, scale);
        g.globalAlpha = 1;
        g.strokeStyle = accent;
        g.lineWidth = 1.5;
        trace(g, a.wet, w, h, scale);
        g.lineWidth = 1;
      }
    },
  });
})();
