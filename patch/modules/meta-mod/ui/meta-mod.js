// SPDX-License-Identifier: MIT
// Meta Mod view: the algorithm strip (eight names, a marker on the modulated
// Algorithm value, the two active neighbours lit by their weight; a click
// sets the knob), a triggered scope of carrier, modulator and output, the
// vocoder's 12 band envelopes while the vocoder is heard, and which inputs
// the internal oscillator stands in for.
(function () {
  "use strict";
  const NAMES = ["Xfade", "Fold", "ARing", "DRing", "Bits", "Comp", "Vocod", "Cheby"];

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const hardF = (x) => 1 - Math.abs(((x + 1) - 4 * Math.floor((x + 1) / 4)) - 2);
  // MetaModDsp::algorithm for a pure-JS preview (analog ring and bitwise are close, not exact; no vocoder).
  function alg(k, a, b, t, op) {
    switch (k) {
      case 0: return a * Math.cos(1.5707963 * t) + b * Math.sin(1.5707963 * t);
      case 1: return Math.sin(Math.PI / 2 * (1 + 7 * t) * (a + b));
      case 2: return Math.tanh(3 * a * b * (1 + 0.6 * t)) * 0.9 + 0.15 * t * a;
      case 3: return a * (b + t) / (1 + t);
      case 4: {
        const bits = clamp(Math.round(16 * Math.pow(0.125, t)), 2, 16), n = Math.pow(2, bits - 1);
        const x = Math.round(clamp(a, -1, 1) * (n - 1)), y = Math.round(clamp(b, -1, 1) * (n - 1));
        const r = op === 0 ? x ^ y : op === 1 ? x & y : op === 2 ? x | y : ((x + y + n) & (2 * n - 1)) - n;
        return r / (n - 1);
      }
      case 5:
        if (t < 0.5) return Math.tanh(1000 * Math.pow(0.004, 2 * t) * (a - b));
        { const u = 2 * (t - 0.5); return (1 - u) * Math.tanh(4 * (a - b)) + u * Math.max(a, b); }
      case 7: {
        const c = clamp(a, -1, 1), n = 1 + 15 * clamp(t + 0.5 * b, 0, 1), lo = Math.min(Math.floor(n), 15), fr = n - lo;
        let t0 = 1, t1 = c;
        for (let i = 1; i < lo; i++) { const t2 = 2 * c * t1 - t0; t0 = t1; t1 = t2; }
        return t1 + fr * ((2 * c * t1 - t0) - t1);
      }
      default: return a * Math.cos(1.5707963 * t) + b * Math.sin(1.5707963 * t);  // vocoder: shown as a plain mix
    }
  }

  BleepViews.register("meta-mod", {
    partNames: ["Algorithm and scope"],
    width: 860,
    layout: [
      { title: "Algorithm", params: ["algorithm", "timbre", "bitwiseOp"] },
      { title: "Inputs", params: ["carrierLevel", "modLevel"] },
      { title: "Internal oscillator", params: ["oscOctave", "oscTune", "oscShape"] },
      { title: "Output", params: ["mix", "quality"] },
    ],
    top: true,
    template: '<div class="bv-panel">' +
      '<div class="mm-strip" style="display:grid;grid-template-columns:repeat(8,1fr);gap:2px;font-size:10px;text-align:center"></div>' +
      '<canvas class="mm-marker" style="width:100%;height:10px"></canvas>' +
      '<canvas class="mm-scope" style="width:100%;height:120px"></canvas>' +
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
        const { g, w, h } = BleepView.fit(m);
        const px = (x + 0.5) / 8 * w;
        g.fillStyle = accent;
        g.beginPath(); g.moveTo(px, 1); g.lineTo(px - 5, h - 1); g.lineTo(px + 5, h - 1); g.fill();
      }

      const a = st.arrays || {};
      const s = view.root.querySelector(".mm-scope");
      if (s && s.clientWidth) {
        const { g, w, h } = BleepView.fit(s);
        if (st.vocoder && a.bands) {
          // Vocoder bands: 12 bars, log-scaled.
          const bw = w / a.bands.length;
          g.fillStyle = accent;
          a.bands.forEach((v, k) => {
            const lv = Math.max(0, 1 + Math.log10(Math.max(v, 1e-4)) / 3);  // −60 … 0 dB
            g.fillRect(k * bw + 2, h - lv * h, bw - 4, lv * h);
          });
        } else {
          const draw = (data, colour, alpha, width, glow) => {
            if (!data) return;
            g.strokeStyle = colour;
            g.globalAlpha = alpha;
            g.lineWidth = width;
            if (glow) BleepView.glow(g, colour, 10);
            g.beginPath();
            data.forEach((v, k) => {
              const px = k / (data.length - 1) * w, py = h / 2 - Math.max(-1.5, Math.min(1.5, v)) * (h / 2 - 2) / 1.5;
              k ? g.lineTo(px, py) : g.moveTo(px, py);
            });
            g.stroke();
            g.shadowBlur = 0;
          };
          g.strokeStyle = line; g.globalAlpha = 0.6;
          g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
          let car = a.carrier, mod = a.modulator, out = a.out;
          if (!out) {
            // No live data: a 4:1 pair of sines through the blended algorithm (a "what does this do" picture).
            const n = Math.max(64, Math.floor(w / 2)), ph = (performance.now() / 6000) % 1;
            const cl = view.value(st, "carrierLevel") * 2, ml = view.value(st, "modLevel") * 2;
            const t = view.value(st, "timbre"), op = view.units("bitwiseOp");
            const i = Math.min(Math.floor(x), 6), f = x - i;
            car = []; mod = []; out = [];
            for (let k = 0; k < n; k++) {
              const u = k / (n - 1) + ph;
              const A = cl * Math.sin(2 * Math.PI * 4 * u), B = ml * Math.sin(2 * Math.PI * u);
              car.push(A); mod.push(B);
              out.push((1 - f) * alg(i, A, B, t, op) + f * alg(i + 1, A, B, t, op));
            }
          }
          draw(car, text, 0.35, 1);
          draw(mod, text, 0.2, 1);
          draw(out, accent, 1, 2, true);
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
