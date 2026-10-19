// SPDX-License-Identifier: GPL-3.0-or-later
// Beat Oscillator view (doc/specs/modules/beat-oscillator.md §5): the two
// carriers A and B drawn as a glowing waveform pair with their sum and its
// beat envelope (the envelope's period is 1 / |B − A|, scaled to the window:
// at most 6 beats are shown, a lock freezes it), the actual frequencies of A
// and B after drift, warm-up and pulling, the signed beat B − A with the lock
// lamp (flashes once per slip), and the phase-difference circle: a dot at ψ
// with a fading tail, still when locked, creeping near the edge, a blur when
// it spins faster than 20 Hz. The Cold button comes from the module's buttons.
(function () {
  "use strict";
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

  function trace(g, w, y0, amp, fn, colour, width, blur) {
    g.strokeStyle = colour; g.lineWidth = width;
    BleepView.glow(g, colour, blur);
    g.beginPath();
    for (let x = 0; x <= w; x += 2) { const y = y0 - fn(x / w) * amp; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    g.shadowBlur = 0;
  }

  function draw(view, t) {
    const b = view.bo;
    if (!b || !b.canvas.clientWidth) return;
    const st = b.st || {}, { g, w, h } = BleepView.fit(b.canvas), c = BleepView.theme(view.root);
    const live = typeof st.df === "number";
    // Without live values: a slow beat from the Beat knob alone.
    const df = live ? st.df : (2 * view.value(null, "beat") - 1) * 8;
    const locked = st.lock > 0.5;
    const pw = Math.min(150, w * 0.26), ww = w - pw - 10;          // the wave area, the phase area

    // ---- the waves
    g.save();
    g.beginPath(); g.rect(0, 0, ww, h); g.clip();
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, 0, ww, h);
    const rows = [h * 0.17, h * 0.4, h * 0.72], amp = [h * 0.11, h * 0.11, h * 0.2];
    g.strokeStyle = c.line; g.globalAlpha = 0.5;
    for (const y of rows) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(ww, y + 0.5); g.stroke(); }
    g.globalAlpha = 1;
    // beats in the window: |df| scaled so the envelope is readable (a lock = none)
    const beats = locked ? 0 : Math.min(6, Math.max(0.35, Math.abs(df) * 0.5)) * Math.sign(df || 1);
    const carrier = 26, scroll = t * 0.6;
    const A = (u) => Math.sin(TWO_PI * (carrier * u - scroll * carrier * 0.25));
    const B = (u) => Math.sin(TWO_PI * ((carrier + beats) * u - scroll * (carrier + beats) * 0.25));
    const sum = (u) => (A(u) + B(u)) / 2;
    const env = (u) => Math.abs(Math.cos(Math.PI * beats * (u - scroll * 0.25)));
    g.save(); g.beginPath(); g.rect(0, 0, ww, h); g.clip(); g.translate(0, 0);
    trace(g, ww, rows[0], amp[0], A, c.accent, 1.5, 8);
    trace(g, ww, rows[1], amp[1], B, c.text, 1.5, 6);
    // envelope fill
    g.globalAlpha = 0.22; g.fillStyle = c.accent;
    g.beginPath(); g.moveTo(0, rows[2]);
    for (let x = 0; x <= ww; x += 3) g.lineTo(x, rows[2] - env(x / ww) * amp[2]);
    for (let x = ww; x >= 0; x -= 3) g.lineTo(x, rows[2] + env(x / ww) * amp[2]);
    g.fill(); g.globalAlpha = 1;
    trace(g, ww, rows[2], amp[2], sum, c.text, 1.2, 10);
    g.setLineDash([3, 3]);
    trace(g, ww, rows[2], amp[2], env, c.accent, 1, 0);
    trace(g, ww, rows[2], amp[2], (u) => -env(u), c.accent, 1, 0);
    g.setLineDash([]);
    g.restore();
    g.fillStyle = c.muted; g.font = "10px system-ui, sans-serif"; g.textBaseline = "top"; g.textAlign = "left";
    g.fillText("A", 6, 4); g.fillText("B", 6, rows[0] + amp[0] + 2); g.fillText("A + B", 6, rows[1] + amp[1] + 2);
    g.fillStyle = c.accent; g.textAlign = "right";
    g.fillText(live ? "A  " + freqText(st.fA || 0) : "", ww - 6, 4);
    g.fillStyle = c.text;
    g.fillText(live ? "B  " + freqText(st.fB || 0) : "", ww - 6, rows[0] + amp[0] + 2);
    g.restore();

    // ---- B − A, the lock lamp and the phase circle
    const cx = ww + 10 + pw / 2;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = c.muted; g.font = "10px system-ui, sans-serif";
    g.fillText("B − A", cx - 22, 12);
    g.fillStyle = c.text; g.font = "600 14px system-ui, sans-serif";
    g.fillText(live ? beatText(st.df) : "–", cx - 10, 30);
    const lit = locked || performance.now() / 1000 < b.flashUntil;
    g.fillStyle = lit ? c.accent : c.panel; g.strokeStyle = lit ? c.accent : c.line;
    if (lit) BleepView.glow(g, c.accent, 12);
    g.beginPath(); g.arc(cx + pw / 2 - 12, 12, 5, 0, TWO_PI); g.fill(); g.stroke(); g.shadowBlur = 0;
    g.fillStyle = c.muted; g.font = "9px system-ui, sans-serif"; g.fillText("LOCK", cx + pw / 2 - 12, 26);

    const pr = Math.min(pw / 2 - 8, (h - 70) / 2), py = 46 + pr + 4;
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
    g.fillText("ψ", cx + pr + 6, py - pr + 2);
    if (Math.abs(st.df || 0) > 20) {
      g.strokeStyle = c.accent; g.globalAlpha = 0.45; g.lineWidth = 6;
      g.beginPath(); g.arc(cx, py, pr, 0, TWO_PI); g.stroke();
      g.globalAlpha = 1;
    } else {
      // Without a live ψ the dot circles at the beat rate (illustration only).
      const tail = b.tail.length ? b.tail : null;
      const pts = tail || Array.from({ length: TAIL }, (_, i) => wrap(-(TWO_PI * df * (t - (TAIL - i) * 0.033)) * 0.3));
      BleepView.glow(g, c.accent, 8);
      pts.forEach((psi, i) => {
        const [x, y] = at(psi, pr);
        g.globalAlpha = ((i + 1) / pts.length) * 0.5;
        g.fillStyle = c.accent;
        g.beginPath(); g.arc(x, y, 2.5, 0, TWO_PI); g.fill();
      });
      g.globalAlpha = 1;
      const [x, y] = at(pts[pts.length - 1], pr);
      g.fillStyle = c.text; g.beginPath(); g.arc(x, y, 4.5, 0, TWO_PI); g.fill();
      g.shadowBlur = 0;
    }
  }

  BleepViews.register("beat-oscillator", {
    partNames: ["Beat display"],
    width: 760,
    layout: [
      { title: "Carrier", params: ["carrier", "beat", "fine"] },
      { title: "Detune input", params: ["range", "detuneRange"] },
      { title: "Locking", params: ["pull", "detector", "mixer", "coupling"] },
      { title: "Analog", params: ["drift", "warmup", "seed"] },
    ],
    template: '<div class="bv-panel"><canvas class="bo-canvas" style="width:100%;height:150px"></canvas></div>',
    afterBuild(view, el) {
      view.bo = { canvas: el.querySelector("canvas"), tail: [], slips: null, flashUntil: 0, st: null };
      BleepView.loop(view.root, (t) => draw(view, t));
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
    },
  });
})();
