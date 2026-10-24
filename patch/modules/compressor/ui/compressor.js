// SPDX-License-Identifier: GPL-3.0-only
// Compressor view (doc/compressor.md): the volume envelopes of the last two seconds, input and output as two
// lines over each other on a dB scale, the gain reduction in dB below them, and the input and output meters
// next to each other. Live values from CompressorModule::liveValues (inPeakL/R, inRmsL/R, outPeakL/R, outRmsL/R,
// reductionDb, stereo) and live arrays from liveArrays (historyIn, historyOut: linear peaks; historyGr: dB).
(function () {
  "use strict";
  const FLOOR = -60;                 // dB range shown by the meters and the envelope graph
  const GR_RANGE = 24;               // gain reduction graph: 0 … −24 dB (the Reduction output's full scale)
  const FALL = 24;                   // dB per second, the meter bar's fall
  const READOUT = 0.25;              // seconds between changes of the gain reduction number
  const HOLD = 1.5;                  // seconds the peak line stays
  const TICKS = [0, -12, -24, -36, -48, -60];
  const toDb = (x) => (x > 1e-6 ? 20 * Math.log10(x) : -200);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmtDb = (db) => (db <= FLOOR ? "−∞" : (db > 0 ? "+" : db < 0 ? "−" : "") + Math.abs(db).toFixed(1));

  const channel = () => ({ bar: -200, rms: -200, hold: -200, holdAt: 0, clip: false });
  const thresholdDb = (view) => {
    const p = view.type.params.find((x) => x.id === "threshold");
    return p ? p.min + (view.node.params.threshold ?? p.default) * (p.max - p.min) : null;
  };
  const outColour = (root, th) => getComputedStyle(root).getPropertyValue("--sig-gate").trim() || th.accent;  // the module's own accent is grey

  // ---- meters ---------------------------------------------------------------------------------
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

  // Both meters in one canvas, next to each other: a shared dB scale, then IN, then OUT.
  function drawMeters(canvas, m, th) {
    const { g, w, h } = BleepView.fit(canvas);
    if (!w || !h) return;
    const top = 18, bot = h - 20, scaleW = 22, bars = m.stereo ? 2 : 1, gap = 3;
    const bw = clamp((w - scaleW - 12) / (2 * bars) - gap, 6, 14);
    const groupW = bars * bw + (bars - 1) * gap, space = (w - scaleW - 2 * groupW) / 3;
    const y = (db) => bot - (bot - top) * clamp(1 - db / FLOOR, 0, 1);
    g.font = "9px system-ui, sans-serif"; g.textAlign = "right"; g.textBaseline = "middle";
    for (const t of TICKS) {
      g.fillStyle = th.muted; g.fillText(t === 0 ? "0" : "−" + -t, scaleW - 3, y(t));
      g.fillStyle = th.line; g.globalAlpha = 0.5; g.fillRect(scaleW, Math.round(y(t)), w - scaleW, 1); g.globalAlpha = 1;
    }
    const grad = g.createLinearGradient(0, bot, 0, top);
    const z6 = clamp(1 - -6 / FLOOR, 0, 1);
    grad.addColorStop(0, th.accent); grad.addColorStop(Math.max(0.01, z6 - 0.02), th.accent);
    grad.addColorStop(Math.min(0.99, z6 + 0.02), th.mod); grad.addColorStop(1, "#ef4444");
    [["IN", m.in], ["OUT", m.out]].forEach(([name, chans], gi) => {
      const gx = scaleW + space + gi * (groupW + space);
      g.fillStyle = th.muted; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(name, gx + groupW / 2, 8);
      for (let k = 0; k < bars; k++) {
        const ch = chans[k], x = gx + k * (bw + gap);
        g.fillStyle = th.panel2; g.fillRect(x, top, bw, bot - top);
        g.fillStyle = grad;
        if (ch.bar > FLOOR) { g.globalAlpha = 0.4; g.fillRect(x, y(Math.min(6, ch.bar)), bw, bot - y(Math.min(6, ch.bar))); }
        if (ch.rms > FLOOR) { g.globalAlpha = 1; g.fillRect(x + 2, y(Math.min(6, ch.rms)), bw - 4, bot - y(Math.min(6, ch.rms))); }
        g.globalAlpha = 1;
        if (ch.hold > FLOOR) { g.fillStyle = ch.hold > 0 ? "#ef4444" : th.text; g.fillRect(x - 1, Math.round(y(Math.min(0, ch.hold))) - 1, bw + 2, 2); }
        if (ch.clip) { g.fillStyle = "#ef4444"; g.fillRect(x, top - 5, bw, 3); }
      }
      const hold = Math.max(chans[0].hold, m.stereo ? chans[1].hold : -200);
      g.fillStyle = th.text; g.font = "bold 10px system-ui, sans-serif"; g.textAlign = "center";
      g.fillText(fmtDb(hold), gx + groupW / 2, h - 8);
      g.font = "9px system-ui, sans-serif";
    });
  }

  // ---- graphs ---------------------------------------------------------------------------------
  function label(g, x, y, title, th) {
    g.font = "9px system-ui, sans-serif"; g.textAlign = "left"; g.textBaseline = "top";
    g.fillStyle = th.text; g.globalAlpha = 0.8; g.fillText(title, x + 4, y + 3); g.globalAlpha = 1;
  }

  // One envelope as a line (and a faint fill under it) on a dB scale inside the box (y0, h).
  function line(g, pts, w, y0, h, colour, fill, glow) {
    const n = pts.length, px = (i) => w * i / (n - 1);
    const py = (v) => y0 + 2 + (h - 4) * clamp(toDb(v) / FLOOR, 0, 1);
    g.beginPath();
    for (let i = 0; i < n; i++) (i ? g.lineTo(px(i), py(pts[i])) : g.moveTo(px(i), py(pts[i])));
    if (fill) {
      g.save();
      g.lineTo(w, y0 + h); g.lineTo(0, y0 + h); g.closePath();
      g.globalAlpha = fill; g.fillStyle = colour; g.fill();
      g.restore();
      g.beginPath();
      for (let i = 0; i < n; i++) (i ? g.lineTo(px(i), py(pts[i])) : g.moveTo(px(i), py(pts[i])));
    }
    g.strokeStyle = colour; g.lineWidth = 1.5; g.lineJoin = "round";
    if (glow) BleepView.glow(g, colour, 8);
    g.stroke(); g.shadowBlur = 0;
  }

  function drawGraphs(view, canvas, arrays, th, gr) {
    const { g, w, h } = BleepView.fit(canvas);
    if (!w || !h) return;
    const gap = 6, eh = Math.round((h - gap) * 0.7), gh = h - gap - eh, yGr = eh + gap;
    const hin = arrays.historyIn, hout = arrays.historyOut, hgr = arrays.historyGr;
    g.fillStyle = th.panel2; g.fillRect(0, 0, w, eh); g.fillRect(0, yGr, w, gh);

    // envelope graph: dB grid, threshold, then both lines over each other
    const ey = (db) => 2 + (eh - 4) * clamp(-db / -FLOOR, 0, 1);
    g.font = "9px system-ui, sans-serif"; g.textAlign = "right"; g.textBaseline = "middle";
    for (const db of TICKS.slice(1, -1)) {
      g.fillStyle = th.line; g.globalAlpha = 0.6; g.fillRect(0, Math.round(ey(db)), w, 1); g.globalAlpha = 1;
      g.fillStyle = th.muted; g.fillText("−" + -db, w - 3, ey(db) - 6);
    }
    const th0 = thresholdDb(view);
    if (th0 !== null) {
      g.strokeStyle = th.mod; g.lineWidth = 1; g.setLineDash([4, 3]); g.globalAlpha = 0.8;
      g.beginPath(); g.moveTo(0, Math.round(ey(th0)) + 0.5); g.lineTo(w, Math.round(ey(th0)) + 0.5); g.stroke();
      g.setLineDash([]); g.globalAlpha = 1;
      g.fillStyle = th.mod; g.textAlign = "left"; g.textBaseline = "bottom";
      g.fillText("threshold", 4, ey(th0) - 2);
    }
    const gy = (db) => yGr + 2 + (gh - 4) * clamp(-db / GR_RANGE, 0, 1);
    g.textAlign = "right"; g.textBaseline = "middle";
    for (const db of [-6, -12, -18]) {
      g.fillStyle = th.line; g.globalAlpha = 0.6; g.fillRect(0, Math.round(gy(db)), w, 1); g.globalAlpha = 1;
      g.fillStyle = th.muted; g.fillText("−" + -db, w - 3, gy(db) - 6);
    }

    const labels = () => {
      label(g, 0, 0, "VOLUME ENVELOPE", th);
      label(g, 0, yGr, "GAIN REDUCTION", th);
      // the amount, right under the label
      g.font = "bold 13px system-ui, sans-serif"; g.textAlign = "left"; g.textBaseline = "top";
      g.fillStyle = th.text;
      g.fillText((gr > -0.05 ? "0.0" : "−" + (-gr).toFixed(1)) + " dB", 4, yGr + 16);
    };
    if (!hin) {
      labels();
      g.fillStyle = th.muted; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("Patch audio in to see the signal", w / 2, eh / 2);
      return;
    }
    line(g, hin, w, 0, eh, th.muted, 0.15, false);
    line(g, hout, w, 0, eh, th.out, 0.07, true);

    const n = hgr.length, px = (i) => w * i / (n - 1);
    g.beginPath();
    g.moveTo(0, gy(0));
    for (let i = 0; i < n; i++) g.lineTo(px(i), gy(hgr[i]));
    g.lineTo(w, gy(0));
    g.closePath();
    g.globalAlpha = 0.35; g.fillStyle = th.mod; g.fill(); g.globalAlpha = 1;
    g.beginPath();
    for (let i = 0; i < n; i++) (i ? g.lineTo(px(i), gy(hgr[i])) : g.moveTo(px(i), gy(hgr[i])));
    g.strokeStyle = th.mod; g.lineWidth = 1.5; g.lineJoin = "round";
    BleepView.glow(g, th.mod, 6); g.stroke(); g.shadowBlur = 0;
    labels();
  }

  function draw(view) {
    const m = view.comp;
    if (!m) return;
    const th = BleepView.theme(view.root);
    th.out = outColour(view.root, th);
    const root = view.root;
    for (const [cls, colour] of [["in", th.muted], ["out", th.out], ["gr", th.mod]]) {   // the legend in the graphs' colours
      const e = root.querySelector(".cp-leg-" + cls);
      if (e) e.style.color = colour;
    }
    drawMeters(root.querySelector(".cp-meters"), m, th);
    drawGraphs(view, root.querySelector(".cp-graphs"), m.arrays, th, m.gr);
  }

  function reset(view) {
    const m = view.comp;
    for (const side of [m.in, m.out]) for (const ch of side) { ch.hold = -200; ch.clip = false; }
    draw(view);
  }

  BleepViews.register("compressor", {
    width: 800,
    top: true,
    partNames: ["Envelopes and meters"],
    layout: [
      { title: "Detection", params: ["threshold", "ratio", "knee", "detector"] },
      { title: "Timing", params: ["attack", "release"] },
      { title: "Output", params: ["makeup", "mix", "link"] },
    ],
    template:
      "<style>" +
      ".cp{display:grid;grid-template-columns:1fr 130px;gap:8px;align-items:stretch}" +
      ".cp canvas{display:block;width:100%;height:230px}" +
      ".cp-meters{cursor:pointer}" +
      ".cp-foot{grid-column:1;display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}" +
      ".cp-foot b{color:var(--text);font-weight:600;font-variant-numeric:tabular-nums}" +
      "</style>" +
      '<div class="bv-panel"><h2>Signal <span class="cp-legend" style="float:right;font-weight:normal;font-size:11px">' +
      '<span class="cp-leg-in">▬ in</span> <span class="cp-leg-out">▬ out</span> <span class="cp-leg-gr">▬ gain reduction</span></span></h2>' +
      '<div class="cp">' +
      '<canvas class="cp-graphs"></canvas>' +
      '<canvas class="cp-meters" title="Input and output level. Click to reset the peak holds and clip lights."></canvas>' +
      '<div class="cp-foot"><span>2 s</span><span>now</span></div>' +
      "</div></div>",
    afterBuild(view, el) {
      view.comp = { in: [channel(), channel()], out: [channel(), channel()], arrays: {}, gr: 0, grMin: 0, grAt: 0, stereo: false, last: 0 };
      el.querySelector(".cp-meters").addEventListener("click", () => reset(view));
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
      m.arrays = st.arrays || {};
      draw(view);
    },
    onRefresh: draw,
  });
})();
