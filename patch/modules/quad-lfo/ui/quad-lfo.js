// SPDX-License-Identifier: GPL-3.0-only
// Quad LFO view (doc/specs/modules/quad-lfo.md §5): a four-trace scope of one
// cycle of channel 1 (two in Divide) with a dot at each live phase, computed
// from the knobs like QuadLfoDsp, and an XY view (Out 1 against Out 2). In
// Sync the Rate knobs show note values; with a clock, Rate 1 shows the
// pulses per cycle and the measured tempo.
(function () {
  "use strict";
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const frac = (x) => x - Math.floor(x);
  const rnd = (k, s) => { const x = Math.sin(k * 12.9898 + s * 78.233 + 4.1) * 43758.5453; return 2 * frac(x) - 1; };  // preview only
  const DIV = [4, 3, 2, 1, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 6, 1 / 7, 1 / 8, 1 / 12, 1 / 16];
  // dsp::noteValues() from 16 bars to 1/32T, in quarter notes (QuadLfoDsp::syncBeats).
  const BEATS = [64, 32, 16, 8, 6, 4, 8 / 3, 3, 2, 4 / 3, 1.5, 1, 2 / 3, 0.75, 0.5, 1 / 3, 0.375, 0.25, 1 / 6, 0.1875, 0.125, 1 / 12];
  const NAMES = ["16 bars", "8 bars", "4 bars", "2 bars", "1/1.", "1/1", "1/1T", "1/2.", "1/2", "1/2T", "1/4.", "1/4", "1/4T",
    "1/8.", "1/8", "1/8T", "1/16.", "1/16", "1/16T", "1/32.", "1/32", "1/32T"];
  const PULSES = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];

  function wave(w, p, pw, cycle, stream) {
    switch (w) {
      case 1: return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
      case 2: return 2 * p - 1;
      case 3: return 1 - 2 * p;
      case 4: return p < pw ? 1 : -1;
      case 5: return rnd(cycle, stream);
      case 6: { const k = 0.5 - 0.5 * Math.cos(p * Math.PI); return (1 - k) * rnd(cycle, stream) + k * rnd(cycle + 1, stream); }
      default: return Math.sin(p * 2 * Math.PI);
    }
  }
  function shape(v, level, unipolar) {
    if (!unipolar) return v * level;
    const u = 0.5 + 0.5 * v;
    return clamp(level >= 0 ? level * u : -level * (1 - u), 0, 1);
  }
  function units(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round(p.min + (view.node.params[id] ?? p.default) * (p.max - p.min));
  }
  const syncIndex = (n) => clamp(Math.round(n * 21), 0, 21);
  const rateHz = (n) => 0.01 * Math.pow(5000, clamp(n, 0, 1));

  /// Channel setup: per channel the cycles it runs per cycle of channel 1, and its offset.
  function channels(view, st) {
    const mode = units(view, "mode"), sync = units(view, "sync") === 1;
    const spread = view.value(st, "spread");  // 0…360° is 0…1 of a cycle
    const rate = [1, 2, 3, 4].map((k) => view.value(st, "rate" + k));
    const hz = rate.map((n) => (sync ? 1 / BEATS[syncIndex(n)] : rateHz(n)));
    const ch = [];
    for (let k = 0; k < 4; k++) {
      let ratio = 1, offset = 0;
      if (mode === 0) ratio = hz[k] / hz[0];
      else if (mode === 1) offset = k * 0.25;
      else if (mode === 2) offset = k * spread;
      else ratio = DIV[units(view, "divide" + (k + 1))];
      ch.push({
        ratio, offset,
        wave: units(view, "wave" + (k + 1)),
        level: view.value(st, "level" + (k + 1)) * 2 - 1,
      });
    }
    return { mode, ch, unipolar: units(view, "polarity") === 1, pw: 0.05 + 0.9 * view.value(st, "pw"), seed: units(view, "seed") };
  }
  function valueAt(q, k, x) {
    const c = q.ch[k], pos = x * c.ratio + c.offset, cyc = Math.floor(pos);
    return shape(wave(c.wave, pos - cyc, q.pw, cyc + q.seed * 1000, k + 1), c.level, q.unipolar);
  }

  BleepViews.register("quad-lfo", {
    top: true,
    width: 810,
    layout: [
      { title: "Mode", params: ["mode", "sync", "clockratio", "spread"] },
      { title: "Waves", params: ["wave1", "wave2", "wave3", "wave4"] },
      { title: "Rates", params: ["rate1", "rate2", "rate3", "rate4", "divide1", "divide2", "divide3", "divide4"] },
      { title: "Shape", params: ["pw", "polarity"] },
      { title: "Levels", params: ["level1", "level2", "level3", "level4"] },
      { title: "Random", params: ["seed"] },
    ],
    template: '<div class="bv-panel"><h2 style="display:flex;justify-content:space-between;align-items:center">LFOs' +
      '<button class="bv-toggle quad-xy" title="Out 1 against Out 2">XY</button></h2>' +
      '<canvas class="quad-scope" style="height:104px;width:100%"></canvas></div>',
    afterBuild(view, el) {
      view.quad = { xy: false };
      try { view.quad.xy = localStorage.getItem("bleep.quad-lfo.xy") === "1"; } catch (e) { /* no storage */ }
      const b = el.querySelector(".quad-xy");
      b.classList.toggle("on", view.quad.xy);
      b.addEventListener("click", () => {
        view.quad.xy = !view.quad.xy;
        b.classList.toggle("on", view.quad.xy);
        try { localStorage.setItem("bleep.quad-lfo.xy", view.quad.xy ? "1" : "0"); } catch (e) { /* no storage */ }
      });
    },
    onState(st, view) {
      if (!view.quad) return;
      const q = channels(view, st);
      // Knob labels: note values with Sync, the clock's ratio and tempo on Rate 1.
      const sync = units(view, "sync") === 1;
      for (let k = 1; k <= 4; k++) {
        const knob = view.knobs.get("rate" + k);
        if (!knob) continue;
        if (k === 1 && st && st.clocked) knob.value.textContent = PULSES[units(view, "clockratio")] + " pulses · " + Math.round(st.bpm) + " BPM";
        else if (sync) knob.value.textContent = NAMES[syncIndex(view.value(st, "rate" + k))];
      }

      const c = view.root.querySelector(".quad-scope");
      if (!c || !c.clientWidth) return;
      const { g, w, h } = BleepView.fit(c);
      const css = getComputedStyle(view.root);
      const accent = css.getPropertyValue("--accent").trim() || "#ea580c";
      const text = css.getPropertyValue("--text");
      g.strokeStyle = css.getPropertyValue("--line");
      g.lineWidth = 1;
      const live = [1, 2, 3, 4].map((k) => (st && typeof st["phase" + k] === "number" ? st["phase" + k] : null));

      if (view.quad.xy) {
        // Out 1 (x) against Out 2 (y) over enough cycles to close the figure.
        const s = Math.min(w, h) - 8, ox = (w - s) / 2, oy = (h - s) / 2;
        const px = (v) => ox + (q.unipolar ? v : 0.5 + 0.5 * v) * s, py = (v) => oy + s - (q.unipolar ? v : 0.5 + 0.5 * v) * s;
        g.strokeRect(ox + 0.5, oy + 0.5, s, s);
        g.beginPath(); g.moveTo(px(q.unipolar ? 0.5 : 0), oy); g.lineTo(px(q.unipolar ? 0.5 : 0), oy + s);
        g.moveTo(ox, py(q.unipolar ? 0.5 : 0)); g.lineTo(ox + s, py(q.unipolar ? 0.5 : 0)); g.stroke();
        const span = q.mode === 0 || q.mode === 3 ? 8 : 1, n = 600;
        g.strokeStyle = accent;
        g.lineWidth = 1.6;
        BleepView.glow(g, accent, 8);
        g.beginPath();
        for (let i = 0; i <= n; i++) {
          const x = (i / n) * span, a = valueAt(q, 0, x), b = valueAt(q, 1, x);
          i ? g.lineTo(px(a), py(b)) : g.moveTo(px(a), py(b));
        }
        g.stroke(); g.shadowBlur = 0;
        const o = st && st.outputs;
        if (o && typeof o.out1 === "number") {
          g.fillStyle = text;
          g.beginPath(); g.arc(px(o.out1), py(o.out2), 3.5, 0, Math.PI * 2); g.fill();
        }
        return;
      }

      const span = q.mode === 3 ? 2 : 1;
      const y = (v) => (q.unipolar ? h - 4 - v * (h - 8) : h / 2 - v * (h / 2 - 4));
      g.beginPath(); g.moveTo(0, y(0)); g.lineTo(w, y(0)); g.stroke();
      g.strokeStyle = accent;
      for (let k = 3; k >= 0; k--) {
        g.globalAlpha = 1 - k * 0.2;
        g.lineWidth = k === 0 ? 2.2 : 1.4;
        BleepView.glow(g, accent, k === 0 ? 10 : 5);
        g.beginPath();
        for (let px = 0; px <= w; px++) {
          const v = valueAt(q, k, (px / w) * span);
          px ? g.lineTo(px, y(v)) : g.moveTo(px, y(v));
        }
        g.stroke();
      }
      g.globalAlpha = 1; g.shadowBlur = 0;
      // Dots: where each channel's live phase falls in the window.
      g.fillStyle = text;
      for (let k = 0; k < 4; k++) {
        if (live[k] === null) continue;
        const c2 = q.ch[k];
        let x = (frac(live[k] - c2.offset) / Math.max(c2.ratio, 1e-6));
        if (q.mode === 1 || q.mode === 2) x = live[0];
        if (x > span) continue;
        g.globalAlpha = 1 - k * 0.2;
        BleepView.glow(g, accent, 12);
        g.beginPath(); g.arc((x / span) * w, y(valueAt(q, k, x)), 3.5, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1; g.shadowBlur = 0;
    },
  });
})();
