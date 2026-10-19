// SPDX-License-Identifier: GPL-3.0-or-later
// Tidal view (doc/specs/modules/tidal.md §5): a scope of all four outputs over two
// cycles of A (one envelope in AD/AR), computed from the knobs like TidalDsp,
// with a dot at A's live phase. Relabels Frequency for the Range, Sync and
// Clock, and Spread with the ratio set in the Ratio relation.
(function () {
  "use strict";
  const C4 = 261.6255653005986;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

  // ---- the DSP, as in dsp/Slope.h and TidalDsp.h -------------------------------------
  function rangeHz(range, n) {
    n = clamp(n, 0, 1);
    if (range === 0) return 0.001 * Math.pow(1000, n);
    if (range === 2) return n < 0.5 ? 8 * Math.pow(C4 / 8, 2 * n) : C4 * Math.pow(8000 / C4, 2 * n - 1);
    return 0.02 * Math.pow(2500, n);
  }
  function curveMorph(u, c) {
    u = clamp(u, 0, 1);
    if (c <= 0) { const lg = 1 - Math.pow(1 - u, 4); return lg + (c + 1) * (u - lg); }
    const cs = 0.5 - 0.5 * Math.cos(Math.PI * u);
    if (c <= 0.5) return u + 2 * c * (cs - u);
    return cs + (2 * c - 1) * (Math.pow(u, 4) - cs);
  }
  function slope(p, r) {
    if (p < r) return p / r;
    return r >= 1 ? 0 : clamp((1 - p) / (1 - r), 0, 1);
  }
  function fold(v, amount) {
    const x = (2 * v - 1) * (1 + 5 * amount);
    let t = (x + 1) % 4;
    if (t < 0) t += 4;
    return 0.5 + 0.5 * (t < 2 ? t - 1 : 3 - t);
  }
  const ZONES = [[[1, 1], [1, 1], [1, 1]], [[2, 1], [3, 1], [4, 1]], [[3, 2], [2, 1], [3, 1]],
    [[4, 3], [3, 2], [2, 1]], [[5, 4], [3, 2], [7, 4]], [[5, 3], [7, 4], [9, 4]]];
  function ratioSet(s) {
    const z = clamp(Math.round(Math.abs(s) * 5), 0, 5);
    return ZONES[z].map(([n, d]) => (s < 0 ? [d, n] : [n, d]));
  }
  function ratios(rel, s) {
    if (rel === 0) return [1, ...ratioSet(s).map(([n, d]) => n / d)];
    if (rel === 3) return [0, 1, 2, 3].map((k) => (s >= 0 ? 1 + k * s : 1 / (1 + k * -s)));
    return [1, 1, 1, 1];
  }
  const frac = (x) => x - Math.floor(x);

  /// Four traces, n points each, over `span` cycles of A (Loop) or the envelope.
  function render(q, n) {
    const r = q.skew, loop = q.mode === 1, rel = q.relation, s = q.spread;
    const rat = ratios(rel, s);
    const out = [[], [], [], []];
    let span = 2;
    if (!loop) {
      span = 1;
      if (rel === 0 || rel === 3) for (const x of rat) span = Math.max(span, 1 / x);
      if (rel === 1) span = 1 + 0.75 * Math.abs(s);
    }
    // Smooth < 0: a 2-pole low-pass (as dsp::SvfLow) at the cycle rate × 2^(7(1+s)),
    // with three cycles of pre-roll, then the level compensation of TidalDsp.
    const per = 256, pre = loop && q.smooth < 0 ? 3 * per : 0, total = Math.round(span * per) + pre;
    for (let k = 0; k < 4; k++) {
      if (rel === 2 && k > 0) continue;
      const raw = new Float32Array(total), y = new Float32Array(total);
      for (let i = 0; i < total; i++) {
        const x = (i - pre) / per;  // cycles of A
        let ph, v;
        if (loop) {
          ph = rel === 1 ? frac(x + (k * s) / 4) : frac(x * rat[k]);
          v = curveMorph(slope(ph, r), q.curve);
        } else {
          const t = rel === 1 ? x - (k * Math.abs(s)) / 4 : x * rat[k];
          v = t < 0 || t >= 1 ? 0 : curveMorph(slope(t, r), q.curve);
        }
        raw[i] = v;
      }
      if (q.smooth < 0) {
        const fc = Math.min(rat[k] * Math.pow(2, 7 * (1 + q.smooth)), 0.49 * per);
        const g = Math.tan((Math.PI * fc) / per), kk = 1 / 0.7071;
        const a1 = 1 / (1 + g * (g + kk)), a2 = g * a1, a3 = g * a2;
        let ic1 = 0, ic2 = raw[0];
        const mix = Math.min(1, -q.smooth / 0.1);
        for (let i = 0; i < total; i++) {
          const v3 = raw[i] - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
          ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
          y[i] = raw[i] + mix * (v2 - raw[i]);
        }
        if (loop) {
          let il = 1e9, ih = -1e9, ol = 1e9, oh = -1e9;
          for (let i = pre; i < total; i++) {
            il = Math.min(il, raw[i]); ih = Math.max(ih, raw[i]); ol = Math.min(ol, y[i]); oh = Math.max(oh, y[i]);
          }
          const gain = oh - ol > 1e-4 ? clamp((ih - il) / (oh - ol), 1, 8) : 1;
          for (let i = 0; i < total; i++) y[i] = (ih + il) / 2 + (y[i] - (oh + ol) / 2) * gain;
        }
      } else for (let i = 0; i < total; i++) y[i] = q.smooth > 0 ? fold(raw[i], q.smooth) : raw[i];
      for (let i = pre; i < total; i++) out[k].push(clamp(y[i], 0, 1));
    }
    const bipolar = loop && !q.unipolar;
    const map = (u) => (bipolar ? 2 * u - 1 : u);
    if (rel === 2) {
      const a = out[0];
      for (let k = 0; k < 4; k++) {
        const g = 1 - (k * Math.abs(s)) / 3, inv = s < 0 && k % 2 === 1;
        out[k] = a.map((u) => (bipolar ? g * (inv ? -1 : 1) * map(u) : g * (inv ? 1 - u : u)));
      }
    } else for (let k = 0; k < 4; k++) out[k] = out[k].map(map);
    return { out, span, bipolar };
  }

  // ---- labels ----------------------------------------------------------------------------
  function hzText(hz) {
    if (hz >= 1000) return (hz / 1000).toFixed(2) + " kHz";
    if (hz >= 10) return hz.toFixed(1) + " Hz";
    if (hz >= 0.1) return hz.toFixed(2) + " Hz";
    const s = 1 / hz;
    return s >= 60 ? (s / 60).toFixed(1) + " min" : s.toFixed(1) + " s";
  }
  function noteText(hz) {
    const m = 69 + 12 * Math.log2(hz / 440), n = Math.round(m), cents = Math.round((m - n) * 100);
    return NOTES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1) + (cents ? (cents > 0 ? " +" : " ") + cents + "¢" : "");
  }
  function units(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round(p.min + (view.node.params[id] ?? p.default) * (p.max - p.min));
  }
  const choiceText = (view, id) => view.type.params.find((x) => x.id === id).choices[units(view, id)];

  BleepViews.register("tidal", {
    top: true,
    width: 900,
    layout: [
      { title: "Mode", params: ["mode", "range", "polarity"] },
      { title: "Rate", params: ["freq", "sync", "syncto"] },
      { title: "Slope", params: ["skew", "curve", "smooth"] },
      { title: "Relation", params: ["relation", "ratio", "spread"] },
    ],
    template: '<div class="bv-panel"><h2>Outputs</h2><canvas class="tidal-scope" style="height:100px;width:100%"></canvas>' +
      '<div class="tidal-legend" style="display:flex;gap:10px;font-size:11px;opacity:.8"></div></div>',
    afterBuild(view, el) {
      const legend = el.querySelector(".tidal-legend");
      ["A", "B", "C", "D"].forEach((n, k) => {
        const s = document.createElement("span");
        s.textContent = "● " + n;
        s.style.color = "var(--accent)";
        s.style.opacity = String(1 - k * 0.22);
        legend.appendChild(s);
      });
    },
    onState(st, view) {
      const q = {
        mode: units(view, "mode"), range: units(view, "range"), relation: units(view, "relation"),
        sync: units(view, "sync"), unipolar: units(view, "polarity") === 1,
        skew: view.value(st, "skew"), curve: view.value(st, "curve") * 2 - 1,
        smooth: view.value(st, "smooth") * 2 - 1, spread: view.value(st, "spread") * 2 - 1,
      };
      if (q.range === 2) q.skew = clamp(q.skew, 0.005, 0.995);
      // Knob labels.
      const freq = view.knobs.get("freq"), spread = view.knobs.get("spread");
      if (freq) {
        let text;
        if (st && st.clocked) text = choiceText(view, "ratio") + " · " + Math.round(st.bpm) + " BPM";
        else if (q.sync > 0) text = choiceText(view, "sync");
        else {
          const hz = rangeHz(q.range, view.value(st, "freq"));
          text = q.range === 2 ? noteText(hz) : hzText(hz);
        }
        freq.value.textContent = text;
      }
      if (spread && q.relation === 0) {
        const set = ratioSet(q.spread).map(([n, d]) => (d === 1 ? String(n) : n + "/" + d));
        spread.value.textContent = set.join(" · ");
      }

      const c = view.root.querySelector(".tidal-scope");
      if (!c || !c.clientWidth) return;
      const { g, w, h } = BleepView.fit(c);
      const css = getComputedStyle(view.root);
      const accent = css.getPropertyValue("--accent").trim() || "#60a5fa";
      const { out, span, bipolar } = render(q, w);
      const y = (v) => (bipolar ? h / 2 - v * (h / 2 - 4) : h - 4 - v * (h - 8));
      g.strokeStyle = css.getPropertyValue("--line");
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, y(0)); g.lineTo(w, y(0));
      if (q.mode === 1) { g.moveTo(w / 2, 0); g.lineTo(w / 2, h); }
      g.stroke();
      g.strokeStyle = accent;
      for (let k = 3; k >= 0; k--) {
        const tr = out[k];
        g.globalAlpha = 1 - k * 0.22;
        g.lineWidth = k === 0 ? 2.2 : 1.3;
        BleepView.glow(g, accent, k === 0 ? 10 : 5);
        g.beginPath();
        for (let i = 0; i < tr.length; i++) {
          const px = (i / (tr.length - 1)) * w;
          i ? g.lineTo(px, y(tr[i])) : g.moveTo(px, y(tr[i]));
        }
        g.stroke();
      }
      g.globalAlpha = 1; g.shadowBlur = 0;
      if (q.mode === 1 || !(st && typeof st.phase === "number")) {
        const a = out[0], live = st && typeof st.phase === "number" ? st.phase / span : (performance.now() / 4000) % 1;
        const i = Math.min(a.length - 1, Math.round(live * (a.length - 1)));
        g.fillStyle = css.getPropertyValue("--text");
        BleepView.glow(g, accent, 14);
        g.beginPath();
        g.arc((i / (a.length - 1)) * w, y(a[i]), 4, 0, Math.PI * 2);
        g.fill(); g.shadowBlur = 0;
      }
    },
  });
})();
