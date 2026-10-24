// SPDX-License-Identifier: GPL-3.0-only
// Limiter view (doc/limiter.md): an input meter and an output meter next to each other. The input meter marks
// the limit: the level the input has to reach before the limiter turns it down (Ceiling minus Input gain).
// Live values from LimiterModule::liveValues (inPeakL/R, inRmsL/R, outPeakL/R, outRmsL/R, reductionDb, stereo).
(function () {
  "use strict";
  const FLOOR = -36;                 // dB range shown
  const FALL = 24;                   // dB per second, the meter bar's fall
  const READOUT = 0.25;              // seconds between changes of the gain reduction number
  const HOLD = 1.5;                  // seconds the peak line stays
  const TICKS = [0, -3, -6, -12, -18, -24, -30, -36];
  const LIMIT = "#f59e0b";           // the limit marker
  const toDb = (x) => (x > 1e-6 ? 20 * Math.log10(x) : -200);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmtDb = (db) => (db <= FLOOR ? "−∞" : (db > 0 ? "+" : db < 0 ? "−" : "") + Math.abs(db).toFixed(1));

  const channel = () => ({ bar: -200, rms: -200, hold: -200, holdAt: 0, clip: false });
  const paramValue = (view, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return p ? p.min + (view.node.params[id] ?? p.default) * (p.max - p.min) : 0;
  };
  // Where the input meter shows the limit: the ceiling, seen from before the Input gain.
  const limitDb = (view) => paramValue(view, "ceiling") - paramValue(view, "input");

  function feed(m, st, now, dt, prefix) {
    const side = m[prefix];
    ["L", "R"].forEach((s, k) => {
      const ch = side[k], peak = toDb(st[prefix + "Peak" + s] || 0);
      ch.bar = Math.max(peak, ch.bar - FALL * dt);
      ch.rms = toDb(st[prefix + "Rms" + s] || 0);
      if (peak >= ch.hold) { ch.hold = peak; ch.holdAt = now; }
      else if (now - ch.holdAt > HOLD) ch.hold = Math.max(ch.bar, FLOOR - 1);
      if (peak > 0) ch.clip = true;
    });
  }

  function drawMeters(view, canvas, m, th) {
    const { g, w, h } = BleepView.fit(canvas);
    if (!w || !h) return;
    const top = 28, bot = h - 20, scaleW = 26, bars = m.stereo ? 2 : 1, gap = 4;
    const bw = clamp((w - scaleW - 24) / (2 * bars) - gap, 8, 30);
    const groupW = bars * bw + (bars - 1) * gap, space = (w - scaleW - 2 * groupW) / 3;
    const y = (db) => bot - (bot - top) * clamp(1 - db / FLOOR, 0, 1);
    const lim = limitDb(view);
    g.font = "9px system-ui, sans-serif"; g.textAlign = "right"; g.textBaseline = "middle";
    let lastY = -Infinity;   // scale labels only where they fit
    for (const t of TICKS) {
      g.fillStyle = th.line; g.globalAlpha = 0.5; g.fillRect(scaleW, Math.round(y(t)), w - scaleW, 1); g.globalAlpha = 1;
      if (Math.abs(y(t) - lastY) < 13) continue;
      lastY = y(t);
      g.fillStyle = th.muted; g.fillText(t === 0 ? "0" : "−" + -t, scaleW - 4, y(t));
    }
    const grad = g.createLinearGradient(0, bot, 0, top);
    const z6 = clamp(1 - -6 / FLOOR, 0, 1);
    grad.addColorStop(0, th.accent); grad.addColorStop(Math.max(0.01, z6 - 0.02), th.accent);
    grad.addColorStop(Math.min(0.99, z6 + 0.02), th.mod); grad.addColorStop(1, "#ef4444");
    [["IN", m.in, true], ["OUT", m.out, false]].forEach(([name, chans, isIn], gi) => {
      const gx = scaleW + space + gi * (groupW + space);
      g.fillStyle = th.muted; g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "10px system-ui, sans-serif";
      g.fillText(name, gx + groupW / 2, 9);
      for (let k = 0; k < bars; k++) {
        const ch = chans[k], x = gx + k * (bw + gap);
        g.fillStyle = th.panel2; g.fillRect(x, top, bw, bot - top);
        g.fillStyle = grad;
        if (ch.bar > FLOOR) { g.globalAlpha = 0.4; g.fillRect(x, y(Math.min(6, ch.bar)), bw, bot - y(Math.min(6, ch.bar))); }
        if (ch.rms > FLOOR) { g.globalAlpha = 1; g.fillRect(x + 3, y(Math.min(6, ch.rms)), bw - 6, bot - y(Math.min(6, ch.rms))); }
        g.globalAlpha = 1;
        if (isIn && ch.bar > lim) {   // what the limiter has to take off
          g.fillStyle = LIMIT; g.globalAlpha = 0.55;
          g.fillRect(x, y(Math.min(6, ch.bar)), bw, y(lim) - y(Math.min(6, ch.bar)));
          g.globalAlpha = 1;
        }
        if (ch.hold > FLOOR) { g.fillStyle = ch.hold > 0 ? "#ef4444" : th.text; g.fillRect(x - 1, Math.round(y(Math.min(0, ch.hold))) - 1, bw + 2, 2); }
        if (ch.clip) { g.fillStyle = "#ef4444"; g.fillRect(x, top - 6, bw, 3); }
      }
      const hold = Math.max(chans[0].hold, m.stereo ? chans[1].hold : -200);
      g.fillStyle = th.text; g.font = "bold 11px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(fmtDb(hold), gx + groupW / 2, h - 9);
      if (isIn) {   // the limit across the input meter
        const ly = Math.round(y(lim)) + 0.5;
        g.strokeStyle = LIMIT; g.lineWidth = 2;
        g.beginPath(); g.moveTo(gx - 6, ly); g.lineTo(gx + groupW + 6, ly); g.stroke();
        g.fillStyle = LIMIT; g.font = "bold 9px system-ui, sans-serif"; g.textAlign = "right"; g.textBaseline = "bottom";
        g.fillText("LIMIT " + fmtDb(lim), gx + groupW + 6, ly - 3);
      }
    });
  }

  function draw(view) {
    const m = view.comp;
    if (!m) return;
    const th = BleepView.theme(view.root);
    drawMeters(view, view.root.querySelector(".lm-meters"), m, th);
    const num = view.root.querySelector(".lm-gr-num");
    if (num) num.textContent = m.gr > -0.05 ? "0.0" : "−" + (-m.gr).toFixed(1);
  }

  function reset(view) {
    const m = view.comp;
    for (const side of [m.in, m.out]) for (const ch of side) { ch.hold = -200; ch.clip = false; }
    draw(view);
  }

  BleepViews.register("limiter", {
    width: 496,
    side: true,       // the meters sit right of the controls, as tall as they are
    top: false,
    partNames: ["Meters"],
    layout: [
      { title: "Level", params: ["input", "ceiling"] },
      { title: "Timing", params: ["release", "lookahead"] },
    ],
    template:
      "<style>" +
      ".lm-view.bv-side .bv-stage{grid-template-columns:auto 170px;justify-content:start;align-items:stretch}" +
      ".lm-view .bv-custom .bv-panel{display:flex;flex-direction:column}" +
      ".lm{flex:1;display:flex;flex-direction:column;gap:4px;min-height:0}" +
      ".lm-box{position:relative;flex:1;min-height:120px}" +   // the canvas does not size its box: the controls do
      ".lm-box canvas{position:absolute;inset:0;width:100%;height:100%;cursor:pointer}" +
      ".lm-foot{font-size:11px;color:var(--muted);text-align:center}" +
      ".lm-foot b{color:var(--text);font-weight:600;font-variant-numeric:tabular-nums}" +
      "</style>" +
      '<div class="bv-panel"><h2>Level</h2>' +
      '<div class="lm"><div class="lm-box">' +
      '<canvas class="lm-meters" title="Input and output level; the orange line is the limit. Click to reset the peak holds and clip lights."></canvas>' +
      '</div><div class="lm-foot">Gain reduction <b class="lm-gr-num">0.0</b> dB</div>' +
      "</div></div>",
    afterBuild(view, el) {
      view.root.classList.add("lm-view");
      view.comp = { in: [channel(), channel()], out: [channel(), channel()], gr: 0, grMin: 0, grAt: 0, stereo: false, last: 0 };
      el.querySelector(".lm-meters").addEventListener("click", () => reset(view));
      draw(view);
    },
    onState(st, view) {
      const m = view.comp;
      if (!m || !st) return;
      const now = performance.now() / 1000, dt = m.last ? Math.min(0.5, now - m.last) : 0;
      m.last = now;
      m.stereo = !!st.stereo;
      feed(m, st, now, dt, "in");
      feed(m, st, now, dt, "out");
      // The number changes four times a second, showing the deepest reduction since the last change, so it can be read.
      const gr = st.reductionDb || 0;
      m.grMin = Math.min(m.grMin, gr);
      if (now - m.grAt >= READOUT) { m.gr = m.grMin; m.grMin = gr; m.grAt = now; }
      draw(view);
    },
    onRefresh: draw,
  });
})();
