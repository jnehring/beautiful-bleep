// SPDX-License-Identifier: GPL-3.0-only
// Melody Mirror view (doc/melody-mirror.md): two strips. The upper one is the
// phrase it remembers (the last Length notes), the lower one what it plays
// back with the current Mode; while it plays, a head runs along the lower one.
(function () {
  "use strict";
  const F = 4;  // onset, length (both 0…1 of the phrase), note, velocity

  function roll(g, th, x, y, w, h, arr, lo, hi, alpha) {
    const rows = hi - lo + 1, rh = h / rows;
    g.fillStyle = th.line; g.globalAlpha = 0.15; g.fillRect(x, y, w, h);
    for (let n = lo; n <= hi; n++) if ([1, 3, 6, 8, 10].includes(n % 12)) g.fillRect(x, y + (hi - n) * rh, w, rh);
    g.globalAlpha = 1;
    g.fillStyle = th.accent;
    for (let i = 0; i + F <= arr.length; i += F) {
      g.globalAlpha = alpha * (0.4 + 0.6 * arr[i + 3]);
      g.fillRect(x + arr[i] * w, y + (hi - arr[i + 2]) * rh + 0.5, Math.max(3, arr[i + 1] * w - 1), Math.max(2, rh - 1));
    }
    g.globalAlpha = 1;
  }

  function draw(view, cv) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st || {}, a = st.arrays || {}, src = a.src || [], out = a.out || [];
    let lo = 127, hi = 0;
    for (const arr of [src, out]) for (let i = 2; i < arr.length; i += F) { lo = Math.min(lo, arr[i]); hi = Math.max(hi, arr[i]); }
    if (lo > hi) { lo = 55; hi = 72; }
    lo = Math.max(0, lo - 1); hi = Math.min(127, Math.max(hi + 1, lo + 9));
    const pad = 4, label = 52, x = label, pw = w - x - pad, gap = 8, ph = (h - 2 * pad - gap) / 2;
    g.font = "10px system-ui, sans-serif"; g.textAlign = "left"; g.fillStyle = th.muted;
    g.fillText("heard", pad, pad + 12);
    g.fillText("plays", pad, pad + ph + gap + 12);
    roll(g, th, x, pad, pw, ph, src, lo, hi, 0.55);
    roll(g, th, x, pad + ph + gap, pw, ph, out, lo, hi, 1);
    if (st.playing && typeof st.pos === "number" && st.pos >= 0) {
      const px = x + st.pos * pw;
      BleepView.glow(g, th.accent, 8);
      g.strokeStyle = th.text; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(px, pad + ph + gap); g.lineTo(px, pad + 2 * ph + gap); g.stroke();
      g.shadowBlur = 0; g.lineWidth = 1;
    }
    g.textAlign = "right"; g.fillStyle = th.muted;
    const state = st.playing ? "answering" : st.fresh > 0 ? "listening · " + st.fresh + " new" : "listening";
    g.fillText(state, w - pad - 4, pad + 12);
    if (!src.length) { g.textAlign = "center"; g.fillText("Play some notes", x + pw / 2, pad + ph / 2 + 4); }
  }

  BleepViews.register("melody-mirror", {
    top: true,
    template: '<div class="bv-panel"><h2>Phrase</h2><canvas class="mm-roll" style="height:150px"></canvas></div>',
    partNames: ["Phrase"],
    afterBuild(view, custom) {
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, () => draw(view, cv));
    },
    onState(st, view) { view._st = st; },
  });
})();
