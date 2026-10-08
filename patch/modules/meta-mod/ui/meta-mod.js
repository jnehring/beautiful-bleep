// SPDX-License-Identifier: MIT
// Meta Mod view: the algorithm strip (eight names, a marker on the modulated
// Algorithm value, the two active neighbours lit by their weight; a click
// sets the knob), a triggered scope of carrier, modulator and output, the
// vocoder's 12 band envelopes while the vocoder is heard, and which inputs
// the internal oscillator stands in for.
(function () {
  "use strict";
  const NAMES = ["Xfade", "Fold", "ARing", "DRing", "Bits", "Comp", "Vocod", "Cheby"];

  function canvas(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return [g, w, h];
  }

  BleepViews.register("meta-mod", {
    top: true,
    template: '<div class="bv-panel">' +
      '<div class="mm-strip" style="display:grid;grid-template-columns:repeat(8,1fr);gap:2px;font-size:10px;text-align:center"></div>' +
      '<canvas class="mm-marker" style="width:100%;height:10px"></canvas>' +
      '<canvas class="mm-scope" style="width:100%;height:80px"></canvas>' +
      '<div class="mm-src" style="font-size:10px;opacity:.7;margin-top:2px"></div></div>',
    afterBuild(view, el) {
      const strip = el.querySelector(".mm-strip");
      NAMES.forEach((n, i) => {
        const b = document.createElement("span");
        b.textContent = n;
        b.style.cssText = "cursor:pointer;padding:2px 0;border-radius:3px";
        b.addEventListener("click", () => { view.api.beginGesture(); view.api.setParam("algorithm", i / 7); });
        strip.append(b);
      });
    },
    onState(st, view) {
      if (!st) return;
      const css = getComputedStyle(view.root);
      const accent = css.getPropertyValue("--accent"), line = css.getPropertyValue("--line"), text = css.getPropertyValue("--text");
      const x = 7 * view.value(st, "algorithm");
      const i = Math.min(Math.floor(x), 6), f = x - i;
      view.root.querySelectorAll(".mm-strip span").forEach((b, k) => {
        const w = k === i ? 1 - f : k === i + 1 ? f : 0;
        b.style.background = w > 0 ? accent : "transparent";
        b.style.color = w > 0.5 ? "#000" : text;
        b.style.opacity = String(0.45 + 0.55 * w);
      });
      const m = view.root.querySelector(".mm-marker");
      if (m && m.clientWidth) {
        const [g, w, h] = canvas(m);
        const px = (x + 0.5) / 8 * w;
        g.fillStyle = accent;
        g.beginPath(); g.moveTo(px, 1); g.lineTo(px - 5, h - 1); g.lineTo(px + 5, h - 1); g.fill();
      }

      const a = st.arrays || {};
      const s = view.root.querySelector(".mm-scope");
      if (s && s.clientWidth) {
        const [g, w, h] = canvas(s);
        if (st.vocoder && a.bands) {
          // Vocoder bands: 12 bars, log-scaled.
          const bw = w / a.bands.length;
          g.fillStyle = accent;
          a.bands.forEach((v, k) => {
            const lv = Math.max(0, 1 + Math.log10(Math.max(v, 1e-4)) / 3);  // −60 … 0 dB
            g.fillRect(k * bw + 2, h - lv * h, bw - 4, lv * h);
          });
        } else {
          const draw = (data, colour, alpha, width) => {
            if (!data) return;
            g.strokeStyle = colour;
            g.globalAlpha = alpha;
            g.lineWidth = width;
            g.beginPath();
            data.forEach((v, k) => {
              const px = k / (data.length - 1) * w, py = h / 2 - Math.max(-1.5, Math.min(1.5, v)) * (h / 2 - 2) / 1.5;
              k ? g.lineTo(px, py) : g.moveTo(px, py);
            });
            g.stroke();
          };
          g.strokeStyle = line;
          g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
          draw(a.carrier, text, 0.35, 1);
          draw(a.modulator, text, 0.2, 1);
          draw(a.out, accent, 1, 1.5);
          g.globalAlpha = 1;
          g.lineWidth = 1;
        }
      }
      const src = view.root.querySelector(".mm-src");
      if (src) {
        const c = st.carrierIsOsc ? "Osc" : "input", md = ["input", "Osc", "silent"][st.modulatorSource | 0] || "input";
        src.textContent = "Carrier: " + c + " · Modulator: " + md;
      }
    },
  });
})();
