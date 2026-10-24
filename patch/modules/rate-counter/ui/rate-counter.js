// SPDX-License-Identifier: GPL-3.0-only
// Rate Counter view (doc/specs/modules/rate-counter.md §5): the tap-averaged tempo as a big number,
// the latest rate beside it in BPM and Hz, a lamp for Steady, and a bar for each of the last sixteen
// intervals against their average, so an uneven pulse train shows at a glance.
(function () {
  "use strict";
  const hzText = (f) => (f >= 1000 ? (f / 1000).toFixed(3) + " kHz" : f >= 10 ? f.toFixed(2) + " Hz" : f.toFixed(3) + " Hz");

  function draw(view) {
    const rc = view.rate;
    if (!rc || !rc.canvas.clientWidth) return;
    const { g, w, h } = BleepView.fit(rc.canvas);
    const th = BleepView.theme(view.root);
    const iv = rc.intervals.filter((x) => x > 0);
    const n = 16, bw = w / n;
    if (!iv.length) return;
    const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
    g.strokeStyle = th.line;
    g.beginPath(); g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5); g.stroke();
    rc.intervals.forEach((x, i) => {  // newest on the right
      if (x <= 0) return;
      const dev = Math.max(-0.5, Math.min(0.5, (x - mean) / mean)) * 2;  // ±50 % fills the half height
      const bx = w - (i + 1) * bw + 2, bh = Math.max(2, Math.abs(dev) * (h / 2 - 2));
      g.fillStyle = Math.abs(dev) < 0.1 ? th.accent : th.mod || th.text;
      g.globalAlpha = 1 - i * 0.04;
      g.fillRect(bx, dev >= 0 ? h / 2 - bh : h / 2, bw - 4, bh);
    });
    g.globalAlpha = 1;
  }

  BleepViews.register("rate-counter", {
    partNames: ["Counter"],
    top: true,
    width: 640,
    layout: [
      { title: "Input", params: ["mode", "perbeat"] },
      { title: "Counting", params: ["average", "tolerance", "timeout"] },
    ],
    template:
      "<style>" +
      ".rc{display:flex;gap:18px;align-items:center;flex-wrap:wrap}" +
      ".rc-big{font-size:46px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1}" +
      ".rc-unit{font-size:12px;color:var(--muted)}" +
      ".rc-side{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}" +
      ".rc-side b{color:var(--text);font-weight:600}" +
      ".rc canvas{flex:1 1 220px;height:70px;min-width:200px}" +
      ".rc-lamp{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--panel-3);border:1px solid var(--line);vertical-align:middle}" +
      ".rc-lamp.on{background:var(--accent);border-color:var(--accent);box-shadow:0 0 6px var(--accent)}" +
      "</style>" +
      '<div class="rc"><div><div class="rc-big">—</div><div class="rc-unit">average BPM</div></div>' +
      '<div class="rc-side"><span>Latest <b class="rc-bpm">—</b> BPM</span><span>Rate <b class="rc-hz">—</b></span>' +
      '<span>Steady <span class="rc-lamp"></span></span><span>Intervals <b class="rc-n">0</b></span></div><canvas></canvas></div>',
    afterBuild(view, el) {
      const q = (s) => el.querySelector(s);
      view.rate = { canvas: q("canvas"), big: q(".rc-big"), bpm: q(".rc-bpm"), hz: q(".rc-hz"), lamp: q(".rc-lamp"), n: q(".rc-n"), intervals: [], dirty: true };
      BleepView.loop(view.root, () => { if (view.rate.dirty) { draw(view); view.rate.dirty = false; } });
    },
    onState(st, view) {
      const rc = view.rate;
      if (!rc || !st) return;
      const live = st.active > 0.5 && st.count > 0;
      rc.big.textContent = live ? st.avg.toFixed(1) : "—";
      rc.bpm.textContent = live ? st.bpm.toFixed(1) : "—";
      rc.hz.textContent = live ? hzText(st.hz) : "—";
      rc.lamp.classList.toggle("on", !!st.stable);
      rc.n.textContent = String(st.count || 0);
      const a = st.arrays && st.arrays.intervals;
      if (a) { rc.intervals = Array.from(a); }
      rc.dirty = true;
    },
    onRefresh(view) { if (view.rate) view.rate.dirty = true; },
  });
})();
