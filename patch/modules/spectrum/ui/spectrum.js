// SPDX-License-Identifier: GPL-3.0-only
// Spectrum view (doc/specs/modules/spectrum.md §5): the averaged spectrum as a filled curve on a
// logarithmic frequency axis, the peak line over it, a dB grid down to the Floor, marks for the
// strongest partial and the centroid, and a readout line. The live arrays "spec" and "peak" hold
// 256 columns of dB from 20 Hz up to the top of the axis (live value "top").
(function () {
  "use strict";
  const LOW = 20, MIDDLE_C = 261.6255653;
  const FREQS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const param = (view, id) => view.type.params.find((x) => x.id === id);
  const linear = (view, id) => {
    const p = param(view, id);
    return p.min + (view.node.params[id] ?? p.default) * (p.max - p.min);
  };
  const hzOf = (pitch) => MIDDLE_C * Math.pow(2, pitch);
  const fmtHz = (f) => (f >= 1000 ? (f / 1000).toFixed(2) + " kHz" : f.toFixed(f < 100 ? 1 : 0) + " Hz");
  const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const noteName = (f) => {
    const m = Math.round(69 + 12 * Math.log2(f / 440));
    return NOTES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  };

  function draw(view) {
    const sc = view.spec;
    if (!sc || !sc.canvas.clientWidth) return;
    const { g, w, h } = BleepView.fit(sc.canvas);
    const th = BleepView.theme(view.root);
    const left = 34, right = 8, top = 8, bottom = 18, pw = w - left - right, ph = h - top - bottom;
    const floor = linear(view, "floor"), n = sc.spec ? sc.spec.length : 0;
    const topHz = sc.top || 20000, span = Math.log(topHz / LOW);
    const X = (hz) => left + (Math.log(hz / LOW) / span) * pw;
    const Y = (db) => top + ph * clamp((0 - db) / (0 - floor), 0, 1);
    g.fillStyle = "#050807";
    g.fillRect(0, 0, w, h);
    g.font = "10px system-ui, sans-serif";
    g.lineWidth = 1;
    g.textBaseline = "middle";
    g.textAlign = "right";
    const step = floor < -80 ? 20 : 10;
    for (let db = 0; db >= floor; db -= step) {
      const y = Math.round(Y(db)) + 0.5;
      g.strokeStyle = "rgba(160,200,190,0.16)";
      g.beginPath(); g.moveTo(left, y); g.lineTo(w - right, y); g.stroke();
      g.fillStyle = th.muted;
      g.fillText(String(db), left - 4, y);
    }
    g.textAlign = "center";
    for (const f of FREQS) {
      if (f > topHz) continue;
      const x = Math.round(X(f)) + 0.5;
      g.strokeStyle = "rgba(160,200,190,0.16)";
      g.beginPath(); g.moveTo(x, top); g.lineTo(x, top + ph); g.stroke();
      g.fillStyle = th.muted;
      g.fillText(f >= 1000 ? f / 1000 + "k" : String(f), x, h - 8);
    }
    if (n) {
      const xs = (b) => left + ((b + 0.5) / n) * pw;
      const curve = (arr) => { g.beginPath(); for (let b = 0; b < n; b++) g.lineTo(xs(b), Y(arr[b])); };
      const grad = g.createLinearGradient(0, top, 0, top + ph);
      grad.addColorStop(0, th.accent);
      grad.addColorStop(1, "transparent");
      curve(sc.spec);
      g.lineTo(xs(n - 1), top + ph); g.lineTo(xs(0), top + ph); g.closePath();
      g.globalAlpha = 0.45; g.fillStyle = grad; g.fill(); g.globalAlpha = 1;
      g.strokeStyle = th.accent; g.lineWidth = 1.5; g.lineJoin = "round";
      BleepView.glow(g, th.accent, 6);
      curve(sc.spec); g.stroke(); g.shadowBlur = 0;
      if (sc.peak && Math.round(linear(view, "peak")) > 0) {
        g.strokeStyle = th.text; g.globalAlpha = 0.55; g.lineWidth = 1;
        curve(sc.peak); g.stroke(); g.globalAlpha = 1;
      }
    }
    const st = sc.st || {};
    if (st.valid) {  // marks at the top: strongest partial (line), centroid (triangle)
      const dom = hzOf(st.dominant), cen = hzOf(st.centroid);
      if (dom >= LOW && dom <= topHz) {
        g.strokeStyle = th.text; g.setLineDash([3, 3]); g.globalAlpha = 0.7;
        g.beginPath(); g.moveTo(X(dom), top); g.lineTo(X(dom), top + ph); g.stroke();
        g.setLineDash([]); g.globalAlpha = 1;
      }
      if (cen >= LOW && cen <= topHz) {
        g.fillStyle = th.mod || th.accent;
        const x = X(cen);
        g.beginPath(); g.moveTo(x - 5, top); g.lineTo(x + 5, top); g.lineTo(x, top + 8); g.fill();
      }
    }
    const r = sc.read;
    r.dom.textContent = st.valid ? fmtHz(hzOf(st.dominant)) + " · " + noteName(hzOf(st.dominant)) : "—";
    r.cen.textContent = st.valid ? fmtHz(hzOf(st.centroid)) : "—";
    sc.dirty = false;
  }

  BleepViews.register("spectrum", {
    partNames: ["Analyser"],
    top: true,
    width: 540,
    layout: [
      { title: "Analysis", params: ["size", "average", "floor"] },
      { title: "Display", params: ["tilt", "peak"] },
      { title: "Flux", params: ["sensitivity"] },
    ],
    template:
      "<style>" +
      ".sp{display:flex;flex-direction:column;gap:6px}" +
      ".sp canvas{display:block;width:100%;height:280px;border-radius:10px;background:#050807}" +
      ".sp-read{display:flex;gap:16px;justify-content:center;flex-wrap:wrap;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}" +
      ".sp-read b{color:var(--text);font-weight:600}" +
      "</style>" +
      '<div class="sp"><canvas></canvas><div class="sp-read"><span>Strongest <b class="sp-dom">—</b></span>' +
      '<span>Centroid <b class="sp-cen">—</b></span></div></div>',
    afterBuild(view, el) {
      view.spec = { canvas: el.querySelector("canvas"), spec: null, peak: null, st: null, top: 20000, dirty: true,
                    read: { dom: el.querySelector(".sp-dom"), cen: el.querySelector(".sp-cen") } };
      BleepView.loop(view.root, () => { if (view.spec.dirty) draw(view); });
    },
    onState(st, view) {
      const sc = view.spec;
      if (!sc || !st) return;
      sc.st = st;
      sc.top = st.top || sc.top;
      const a = st.arrays || {};
      if (a.spec && a.spec.length) { sc.spec = a.spec; sc.peak = a.peak; }
      sc.dirty = true;
    },
    onRefresh(view) { if (view.spec) view.spec.dirty = true; },
  });
})();
