// SPDX-License-Identifier: GPL-3.0-only
// Coin Toss view (doc/specs/modules/coin-toss.md §5): per channel the last 32
// tosses (filled = B, empty = A, newest right) and a coin that flips on each
// toss; with Loop on, the loop's tosses and the current one are marked.
(function () {
  "use strict";
  const LOOPS = [0, 2, 3, 4, 6, 8, 12, 16, 32];
  const setting = (view, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round(p.min + (view.node.params[id] ?? p.default) * (p.max - p.min));
  };

  function draw(view, st) {
    const c = view.coin && view.coin.canvas;
    if (!c || !c.clientWidth) return;
    const { g, w, h } = BleepView.fit(c);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim(), muted = css.getPropertyValue("--muted").trim();
    const text = css.getPropertyValue("--text").trim();
    const loop = LOOPS[Math.min(LOOPS.length - 1, Math.max(0, setting(view, "loop")))];
    const link = setting(view, "link");
    g.font = "10px system-ui, sans-serif";
    const RH = 42;
    for (let ch = 0; ch < 2; ch++) {
      const y = 6 + ch * RH, hist = (st && st["history" + (ch + 1)]) || 0, count = (st && st["count" + (ch + 1)]) || 0;
      const coinA = st ? st["coin" + (ch + 1)] > 0.5 : true;
      // coin: A (outline) or B (filled); flips (squashes) when the count changes
      const flip = view.coin.count[ch] !== count;
      view.coin.count[ch] = count;
      if (flip) view.coin.flash[ch] = 10;
      const f = view.coin.flash[ch];
      const r = Math.max(1.5, 14 * Math.abs(Math.cos((f / 10) * Math.PI)));
      if (f > 0) view.coin.flash[ch]--;
      g.fillStyle = accent; g.strokeStyle = accent; g.lineWidth = 2;
      BleepView.glow(g, accent, 10);
      g.beginPath(); g.ellipse(24, y + 18, r, 14, 0, 0, Math.PI * 2);
      coinA ? g.stroke() : g.fill();
      g.shadowBlur = 0;
      g.fillStyle = muted; g.font = "10px system-ui, sans-serif";
      g.fillText(coinA ? "A" : "B", 21, y + 36 + 0);
      // the last 32 tosses, newest right
      const shown = Math.min(32, count), x0 = 52, cell = (w - x0 - 40) / 32;
      for (let i = 0; i < 32; i++) {
        const age = 31 - i;  // tosses ago
        const x = x0 + i * cell;
        if (age >= shown) {
          g.globalAlpha = 0.25; g.strokeStyle = muted; g.lineWidth = 1;
          g.strokeRect(x + 2.5, y + 8.5, cell - 5, 20);
          g.globalAlpha = 1;
          continue;
        }
        const b = (Math.floor(hist / Math.pow(2, age)) & 1) === 1;
        const inLoop = loop > 0 && age < loop;
        g.globalAlpha = (loop > 0 && !inLoop ? 0.3 : 1) * (0.45 + 0.55 * (i / 31));
        g.fillStyle = accent; g.strokeStyle = accent; g.lineWidth = 1.5;
        if (b) { BleepView.glow(g, accent, age === 0 ? 12 : 4); g.fillRect(x + 2, y + 8, cell - 4, 21); g.shadowBlur = 0; }
        else g.strokeRect(x + 2.5, y + 8.5, cell - 5, 20);
        g.globalAlpha = 1;
      }
      if (loop > 0 && shown > 0) {  // the current loop position
        g.fillStyle = text; g.textAlign = "right";
        g.fillText(`${((count - 1) % loop) + 1}/${loop}`, w - 6, y + 22);
        g.textAlign = "left";
      }
    }
    if (link > 0) {  // chain between the channels
      g.strokeStyle = muted; g.lineWidth = 1;
      g.beginPath(); g.moveTo(24, 42); g.lineTo(24, 54); g.stroke();
      g.fillStyle = muted; g.fillText(link === 1 ? "shared" : "opposed", 30, 52);
    }
  }

  BleepViews.register("coin-toss", {
    width: 700,
    top: true,
    layout: [
      { title: "Coin 1", params: ["prob1", "memory1", "mode1"] },
      { title: "Coin 2", params: ["prob2", "memory2", "mode2"] },
      { title: "Coupling", params: ["link", "loop", "seed"] },
    ],
    template: '<div class="bv-panel"><h2>Tosses</h2><canvas class="coin-hist" style="width:100%;height:98px"></canvas></div>',
    afterBuild(view, el) {
      view.coin = { canvas: el.querySelector("canvas"), count: [0, 0], flash: [0, 0] };
      requestAnimationFrame(() => draw(view, null));
    },
    onState(st, view) { draw(view, st); },
    onRefresh(view) { draw(view, null); },
  });
})();
