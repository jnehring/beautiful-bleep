// SPDX-License-Identifier: MIT
// Perc Voice view: a sketch of the hit over time (the amplitude envelope from
// Decay and Click as a glowing filled curve, the pitch sweep dashed above it,
// a dot replaying the hit) and the eight partials of the current (modulated)
// settings (position = ratio on a log axis, height = amplitude, shade =
// decay). The Hit button comes from the module's buttons.
(function () {
  "use strict";

  /// Decay knob (normalised) → seconds: 10 ms … 8 s, skewed so 0.6 s is the centre.
  function decaySeconds(x) {
    const min = 0.01, max = 8, centre = 0.6;
    const skew = Math.log(0.5) / Math.log((centre - min) / (max - min));
    return x <= 0 ? min : min + (max - min) * Math.exp(Math.log(x) / skew);
  }
  const fmt = (s) => (s < 1 ? Math.round(s * 1000) + " ms" : s.toFixed(s < 10 ? 1 : 0) + " s");

  function drawHit(view, st, T) {
    const c = view.root.querySelector(".pv-env");
    if (!c || !c.clientWidth) return;
    const { g, w, h } = BleepView.fit(c), col = BleepView.theme(view.root);
    const decay = decaySeconds(view.value(st, "decay"));
    const click = view.value(st, "click"), sweep = view.value(st, "sweep");
    const span = Math.min(decay * 1.3, 8), base = h - 14, top = 6;
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, 0, w, h);
    // time grid
    g.font = "9px system-ui, sans-serif"; g.fillStyle = col.muted; g.textAlign = "left";
    const step = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2].find((s) => span / s <= 8) || 4;
    for (let t = step; t < span; t += step) {
      const x = (t / span) * w;
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, base); g.stroke();
      g.fillText(fmt(t), x + 2, h - 3);
    }
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(0, base + 0.5); g.lineTo(w, base + 0.5); g.stroke();
    const amp = (t) => { let a = Math.pow(10, (-3 * t) / decay); if (t < 0.004) a = Math.min(1, a + click * (1 - t / 0.004)); return Math.min(a, 1); };
    const yA = (t) => base - amp(t) * (base - top);
    // amplitude: a gradient-filled, glowing curve
    const gr = g.createLinearGradient(0, top, 0, base);
    gr.addColorStop(0, col.accent + "88"); gr.addColorStop(1, col.accent + "08");
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(0, base);
    for (let px = 0; px <= w; px++) g.lineTo(px, yA((px / w) * span));
    g.lineTo(w, base); g.closePath(); g.fill();
    g.strokeStyle = col.accent; g.lineWidth = 2; BleepView.glow(g, col.accent, 10);
    g.beginPath();
    for (let px = 0; px <= w; px++) { const y = yA((px / w) * span); px ? g.lineTo(px, y) : g.moveTo(px, y); }
    g.stroke(); g.shadowBlur = 0;
    // pitch sweep: +3 octaves × Sweep, falling to 5 % in Decay / 8
    const yP = (t) => base - ((3 * sweep * Math.exp((-3 * t) / (decay / 8))) / 3) * (base - top);
    if (sweep > 0) {
      g.strokeStyle = col.text; g.lineWidth = 1.3; g.setLineDash([4, 3]); g.globalAlpha = 0.85;
      g.beginPath();
      for (let px = 0; px <= w; px++) { const y = yP((px / w) * span); px ? g.lineTo(px, y) : g.moveTo(px, y); }
      g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      g.fillStyle = col.text; g.textAlign = "right"; g.fillText("pitch +" + (3 * sweep).toFixed(1) + " oct", w - 4, 22);
    }
    // the replaying hit
    const pos = Math.min(1, (T % 2.4) / 1.6);
    if (T % 2.4 < 1.6 + 0.4) {
      const t = pos * span, x = pos * w;
      BleepView.glow(g, col.accent, 12);
      g.fillStyle = col.text; g.beginPath(); g.arc(x, yA(t), 3.5, 0, 6.3); g.fill();
      if (sweep > 0) { g.beginPath(); g.arc(x, yP(t), 2.5, 0, 6.3); g.fill(); }
      g.shadowBlur = 0;
    }
    g.lineWidth = 1; g.textAlign = "right"; g.fillStyle = col.muted;
    g.fillText("decay " + fmt(decay), w - 4, 11);
  }

  function drawPartials(view, st) {
    const c = view.root.querySelector(".pv-partials");
    if (!c || !c.clientWidth) return;
    const { g, w, h } = BleepView.fit(c), col = BleepView.theme(view.root);
    const arrays = (st && st.arrays) || {};
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, 0, w, h);
    const base = h - 14;
    g.font = "9px system-ui, sans-serif"; g.fillStyle = col.muted; g.textAlign = "left";
    const x = (r) => 6 + (Math.log(r) / Math.log(40)) * (w - 12);  // ratios 1 … 40
    for (const r of [1, 2, 4, 8, 16, 32]) {
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(Math.round(x(r)) + 0.5, 0); g.lineTo(Math.round(x(r)) + 0.5, base); g.stroke();
      g.fillText("×" + r, x(r) + 2, h - 3);
    }
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(0, base + 0.5); g.lineTo(w, base + 0.5); g.stroke();
    if (!arrays.ratios) { g.fillStyle = col.muted; g.textAlign = "center"; g.fillText("partials appear when playing", w / 2, base / 2); return; }
    const maxAmp = Math.max(...arrays.amps, 1e-6);
    BleepView.glow(g, col.accent, 9);
    g.lineWidth = 3;
    for (let k = arrays.ratios.length - 1; k >= 0; k--) {
      const a = arrays.amps[k] / maxAmp;
      if (a < 0.003) continue;
      const xx = x(arrays.ratios[k]);
      g.globalAlpha = 0.25 + 0.75 * Math.min(1, Math.max(0, arrays.decays[k]));
      const gr = g.createLinearGradient(0, base, 0, base - a * (base - 6));
      gr.addColorStop(0, col.accent + "55"); gr.addColorStop(1, col.accent);
      g.strokeStyle = gr;
      g.beginPath(); g.moveTo(xx, base); g.lineTo(xx, base - a * (base - 6)); g.stroke();
    }
    g.globalAlpha = 1; g.shadowBlur = 0; g.lineWidth = 1;
  }

  BleepViews.register("perc-voice", {
    parts: [{ id: "hit", name: "Hit", select: ".bv-panel > div:nth-child(1)" }, { id: "partials", name: "Partials", select: ".bv-panel > div:nth-child(2)" }],
    width: 1000,
    layout: [
      { title: "Engine & level", params: ["engine", "level", "track", "drive", "seed"] },
      { title: "Voice", params: ["pitch", "tone", "morph", "spread"] },
      { title: "Hit", params: ["click", "sweep", "decay", "damp"] },
    ],
    template:
      '<div class="bv-panel" style="display:flex;gap:10px"><div style="flex:1 1 0;min-width:0"><h2>Hit · amplitude and pitch sweep</h2>' +
      '<canvas class="pv-env" style="height:100px"></canvas></div>' +
      '<div style="flex:0 0 280px"><h2>Partials</h2><canvas class="pv-partials" style="height:100px"></canvas></div></div>',
    afterBuild(view) {
      view.pv = { st: null };
      BleepView.loop(view.root, (t) => { drawHit(view, view.pv.st, t); drawPartials(view, view.pv.st); });
    },
    onState(st, view) { if (view.pv) view.pv.st = st; },
  });
})();
