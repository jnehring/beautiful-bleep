// SPDX-License-Identifier: MIT
// EQ view (doc/eq.md): the signal going in (grey) and coming out (accent) as
// live spectra on a log axis (20 Hz … 20 kHz), with the equaliser's response
// curve and its four band handles on top. Live arrays from EqModule::liveArrays:
// spectrumIn, spectrumOut (dB), curve (dB, same bins), bands (hz, dB, Q ×4, level).
(function () {
  "use strict";
  const TOP = 0, BOTTOM = -90;       // spectrum range in dB
  const RANGE = 18;                  // response curve: ±18 dB (knobs ±15 plus level)
  const FREQS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const xOf = (f, w) => Math.log(Math.max(f, 20) / 20) / Math.log(1000) * w;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmtHz = (f) => (f >= 1000 ? f / 1000 + "k" : f + "");

  // Peaks rise at once and fall slowly, so the spectra read as a calm picture.
  function smooth(keep, name, bins) {
    const prev = keep[name];
    if (!prev || prev.length !== bins.length) return (keep[name] = Float32Array.from(bins));
    for (let i = 0; i < bins.length; i++) prev[i] = bins[i] > prev[i] ? bins[i] : prev[i] + (bins[i] - prev[i]) * 0.25;
    return prev;
  }

  function area(g, bins, w, h, colour, fillAlpha, lineWidth) {
    const y = (db) => (TOP - clamp(db, BOTTOM, TOP)) / (TOP - BOTTOM) * h;
    const pts = [];
    for (let i = 0; i < bins.length; i++) pts.push([(i + 0.5) / bins.length * w, y(bins[i])]);
    g.beginPath();
    pts.forEach(([x, yy], i) => (i ? g.lineTo(x, yy) : g.moveTo(x, yy)));
    if (fillAlpha) {
      g.save();
      g.lineTo(pts[pts.length - 1][0], h); g.lineTo(pts[0][0], h); g.closePath();
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, colour); gr.addColorStop(1, "transparent");
      g.globalAlpha = fillAlpha; g.fillStyle = gr; g.fill();
      g.restore();
      g.beginPath();
      pts.forEach(([x, yy], i) => (i ? g.lineTo(x, yy) : g.moveTo(x, yy)));
    }
    g.strokeStyle = colour; g.lineWidth = lineWidth; g.stroke();
  }

  function draw(view, st) {
    const cv = view.root.querySelector(".eq-display");
    if (!cv || !cv.clientWidth) return;
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root);
    const accent = th.accent, line = th.line, muted = th.muted || th.line, text = th.text;
    const arrays = (st && st.arrays) || {};
    const yc = (db) => h / 2 - clamp(db, -RANGE, RANGE) / RANGE * (h / 2 - 4);

    // grid: frequency decades and the curve's dB lines
    g.lineWidth = 1; g.strokeStyle = line; g.globalAlpha = 0.4;
    g.beginPath();
    for (const f of FREQS) { const x = Math.round(xOf(f, w)) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); }
    for (const db of [-12, -6, 6, 12]) { const yy = Math.round(yc(db)) + 0.5; g.moveTo(0, yy); g.lineTo(w, yy); }
    g.stroke();
    g.globalAlpha = 1;
    g.strokeStyle = muted; g.beginPath(); g.moveTo(0, yc(0) + 0.5); g.lineTo(w, yc(0) + 0.5); g.stroke();
    g.font = "9px system-ui, sans-serif"; g.fillStyle = muted;
    g.textAlign = "left";
    for (const f of FREQS) g.fillText(fmtHz(f), xOf(f, w) + 3, h - 3);
    g.textAlign = "right";
    for (const db of [-12, 12]) g.fillText((db > 0 ? "+" : "") + db, w - 3, yc(db) - 3);

    const keep = view.eq || (view.eq = {});
    if (arrays.spectrumIn) area(g, smooth(keep, "in", arrays.spectrumIn), w, h, muted, 0.25, 1);
    if (arrays.spectrumOut) {
      BleepView.glow(g, accent, 10);
      area(g, smooth(keep, "out", arrays.spectrumOut), w, h, accent, 0.35, 1.5);
      g.shadowBlur = 0;
    }

    // The response curve, computed by the engine from the bands it is really using.
    const curve = arrays.curve;
    if (curve) {
      g.beginPath();
      curve.forEach((db, i) => { const x = (i + 0.5) / curve.length * w; i ? g.lineTo(x, yc(db)) : g.moveTo(x, yc(db)); });
      g.strokeStyle = text; g.lineWidth = 2;
      BleepView.glow(g, text, 6);
      g.stroke();
      g.shadowBlur = 0;
    }

    // Band handles: each band at its frequency and gain.
    const bands = arrays.bands;
    if (bands) {
      const names = ["L", "1", "2", "H"];
      g.font = "bold 9px system-ui, sans-serif"; g.textAlign = "center";
      for (let k = 0; k < 4; k++) {
        const hz = bands[3 * k], gain = bands[3 * k + 1];
        if (!(hz > 0)) continue;
        const x = xOf(hz, w), yy = yc(gain);
        g.globalAlpha = gain === 0 ? 0.45 : 1;
        g.strokeStyle = accent; g.lineWidth = 1; g.setLineDash([2, 3]);
        g.beginPath(); g.moveTo(x + 0.5, yc(0)); g.lineTo(x + 0.5, yy); g.stroke();
        g.setLineDash([]);
        g.fillStyle = accent;
        g.beginPath(); g.arc(x, yy, 7, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#000";
        g.fillText(names[k], x, yy + 3);
      }
      g.globalAlpha = 1;
    }

    if (!arrays.spectrumIn && !arrays.curve) {
      g.fillStyle = muted; g.textAlign = "center"; g.font = "11px system-ui, sans-serif";
      g.fillText("Patch audio in to see the spectrum", w / 2, h / 2 - 10);
    }
    const label = view.root.querySelector(".eq-legend");
    if (label) label.innerHTML =
      '<span style="color:' + muted + '">▬ in</span> <span style="color:' + accent + '">▬ out</span> ' +
      '<span style="color:' + text + '">▬ EQ curve</span>';
  }

  BleepViews.register("eq", {
    width: 800,
    layout: [
      { title: "Low shelf", params: ["lowHz", "lowGain"] },
      { title: "Mid 1", params: ["m1Hz", "m1Gain", "m1Q"] },
      { title: "Mid 2", params: ["m2Hz", "m2Gain", "m2Q"] },
      { title: "High shelf", params: ["highHz", "highGain"] },
      { title: "Output", params: ["level"] },
    ],
    top: true,
    template:
      '<div class="bv-panel"><h2>Spectrum <span class="eq-legend" style="float:right;font-weight:normal;font-size:11px"></span></h2>' +
      '<canvas class="eq-display" style="width:100%;height:180px;display:block"></canvas></div>',
    onState(st, view) { view.eq = view.eq || {}; view.eq.st = st; draw(view, st); },
    onRefresh(view) { draw(view, view.eq && view.eq.st); },
  });
})();
