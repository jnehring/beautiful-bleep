// SPDX-License-Identifier: MIT
// Beat Oscillator view (doc/specs/modules/beat-oscillator.md §5): two calibrated
// dials with the actual frequencies of A and B (after drift, warm-up and
// pulling), the signed beat B − A between them with a lock lamp that flashes
// once per slip, and the phase-difference circle below: a dot at ψ with a
// fading tail, still when locked, creeping and flicking near the edge, a blur
// when it spins faster than 20 Hz. The Cold button comes from the module's buttons.
(function () {
  "use strict";
  const LO = 500, HI = 18000;                       // the Carrier range: the dials' scale
  const TICKS = [500, 1000, 2000, 5000, 10000, 18000];
  const TAIL = 28;                                  // ψ positions in the tail
  const FLASH = 0.09;                               // seconds a slip lights the lamp
  const TWO_PI = 2 * Math.PI;

  const freqText = (f) => (f >= 1000 ? (f / 1000).toFixed(3) + " kHz" : f.toFixed(1) + " Hz");
  /// Signed, three significant figures; mHz below 1 Hz.
  function beatText(v) {
    if (!isFinite(v) || v === 0) return "0 Hz";
    const s = v > 0 ? "+" : "−", a = Math.abs(v);
    if (a < 1) return s + Number((a * 1000).toPrecision(3)) + " mHz";
    if (a < 1000) return s + Number(a.toPrecision(3)) + " Hz";
    return s + Number((a / 1000).toPrecision(3)) + " kHz";
  }
  const wrap = (x) => ((x % TWO_PI) + TWO_PI) % TWO_PI;

  function dial(g, cx, cy, r, f, label, col, c) {
    const ang = (hz) => (-135 + 270 * Math.log(Math.min(HI, Math.max(LO, hz)) / LO) / Math.log(HI / LO)) * Math.PI / 180;
    g.strokeStyle = c.line; g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2 - 0.75 * Math.PI, -Math.PI / 2 + 0.75 * Math.PI); g.stroke();
    g.font = "9px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    for (const t of TICKS) {
      const a = ang(t), sx = Math.sin(a), sy = -Math.cos(a);
      g.strokeStyle = c.muted; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx + sx * (r - 5), cy + sy * (r - 5)); g.lineTo(cx + sx * r, cy + sy * r); g.stroke();
      g.fillStyle = c.muted;
      g.fillText(t >= 1000 ? t / 1000 + "k" : String(t), cx + sx * (r - 13), cy + sy * (r - 13));
    }
    if (f > 0) {
      const a = ang(f);
      g.strokeStyle = col; g.lineWidth = 2;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(a) * (r - 2), cy - Math.cos(a) * (r - 2)); g.stroke();
    }
    g.fillStyle = col; g.beginPath(); g.arc(cx, cy, 3, 0, TWO_PI); g.fill();
    g.font = "600 11px system-ui, sans-serif"; g.fillText(label, cx, cy - r - 8);
    g.font = "11px system-ui, sans-serif"; g.fillStyle = c.text;
    g.fillText(f > 0 ? freqText(f) : "–", cx, cy + r * 0.62);
  }

  function draw(view) {
    const b = view.bo;
    if (!b || !b.canvas.clientWidth) return;
    const cv = b.canvas, st = b.st || {};
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const c = { accent: css.getPropertyValue("--accent").trim(), line: css.getPropertyValue("--line").trim(),
                muted: css.getPropertyValue("--muted").trim(), text: css.getPropertyValue("--text").trim(),
                panel: css.getPropertyValue("--panel-3").trim() };

    // Dials
    const r = Math.min(46, w * 0.13), dy = r + 22;
    dial(g, r + 12, dy, r, st.fA || 0, "A", c.accent, c);
    dial(g, w - r - 12, dy, r, st.fB || 0, "B", c.text, c);

    // B − A and the lock lamp
    const cx = w / 2;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = c.muted; g.font = "10px system-ui, sans-serif";
    g.fillText("B − A", cx, 14);
    g.fillStyle = c.text; g.font = "600 15px system-ui, sans-serif";
    g.fillText(beatText(st.df || 0), cx, 32);
    const lit = st.lock > 0.5 || performance.now() / 1000 < b.flashUntil;
    const ly = 56;
    g.fillStyle = lit ? c.accent : c.panel;
    g.strokeStyle = lit ? c.accent : c.line;
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx, ly, 5, 0, TWO_PI); g.fill(); g.stroke();
    g.fillStyle = c.muted; g.font = "9px system-ui, sans-serif";
    g.fillText("LOCK", cx, ly + 13);

    // Phase-difference circle
    const pr = Math.min(32, (h - 100) / 2), py = h - pr - 10;
    g.strokeStyle = c.line; g.lineWidth = 1;
    g.beginPath(); g.arc(cx, py, pr, 0, TWO_PI); g.stroke();
    g.beginPath(); g.moveTo(cx - pr - 4, py); g.lineTo(cx + pr + 4, py); g.moveTo(cx, py - pr - 4); g.lineTo(cx, py + pr + 4); g.stroke();
    const at = (psi, rr) => [cx + Math.cos(psi) * rr, py - Math.sin(psi) * rr];
    const lockHz = st.lockHz || 0, detune = st.detune || 0;
    if (lockHz > 0 && Math.abs(detune) <= lockHz) {     // where a locked ψ rests: asin(Δf / L)
      const [x0, y0] = at(Math.asin(detune / lockHz), pr - 6), [x1, y1] = at(Math.asin(detune / lockHz), pr + 6);
      g.strokeStyle = c.muted; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    g.fillStyle = c.muted; g.font = "italic 11px system-ui, sans-serif"; g.textAlign = "left";
    g.fillText("ψ", cx + pr + 8, py - pr + 4);
    if (Math.abs(st.df || 0) > 20) {
      g.strokeStyle = c.accent; g.globalAlpha = 0.45; g.lineWidth = 6;
      g.beginPath(); g.arc(cx, py, pr, 0, TWO_PI); g.stroke();
      g.globalAlpha = 1;
    } else {
      b.tail.forEach((psi, i) => {
        const [x, y] = at(psi, pr);
        g.globalAlpha = ((i + 1) / b.tail.length) * 0.5;
        g.fillStyle = c.accent;
        g.beginPath(); g.arc(x, y, 2.5, 0, TWO_PI); g.fill();
      });
      g.globalAlpha = 1;
      if (b.tail.length) {
        const [x, y] = at(b.tail[b.tail.length - 1], pr);
        g.fillStyle = c.accent;
        g.beginPath(); g.arc(x, y, 4.5, 0, TWO_PI); g.fill();
      }
    }
  }

  BleepViews.register("beat-oscillator", {
    top: true,
    width: 380,
    template: '<div class="bv-panel"><canvas class="bo-canvas" style="width:100%;height:190px"></canvas></div>',
    afterBuild(view, el) {
      view.bo = { canvas: el.querySelector("canvas"), tail: [], slips: null, flashUntil: 0, st: null };
      requestAnimationFrame(() => draw(view));
    },
    onState(st, view) {
      const b = view.bo;
      if (!b || !st) return;
      b.st = st;
      if (typeof st.psi === "number") {
        b.tail.push(wrap(st.psi));
        if (b.tail.length > TAIL) b.tail.shift();
      }
      if (typeof st.slips === "number") {
        if (b.slips !== null && st.slips !== b.slips && !(st.lock > 0.5)) b.flashUntil = performance.now() / 1000 + FLASH;
        b.slips = st.slips;
      }
      draw(view);
    },
    onRefresh(view) { draw(view); },
  });
})();
