// SPDX-License-Identifier: MIT
// Coin Toss view (specs/modules/coin-toss.md §5): per channel the last 32
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
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim(), muted = css.getPropertyValue("--muted").trim();
    const text = css.getPropertyValue("--text").trim();
    const loop = LOOPS[Math.min(LOOPS.length - 1, Math.max(0, setting(view, "loop")))];
    const link = setting(view, "link");
    g.font = "10px system-ui, sans-serif";
    for (let ch = 0; ch < 2; ch++) {
      const y = 8 + ch * 30, hist = (st && st["history" + (ch + 1)]) || 0, count = (st && st["count" + (ch + 1)]) || 0;
      const coinA = st ? st["coin" + (ch + 1)] > 0.5 : true;
      // coin: A (outline) or B (filled); flips when the count changes
      const flip = view.coin.count[ch] !== count;
      view.coin.count[ch] = count;
      if (flip) view.coin.flash[ch] = 6;
      const r = 8 - Math.min(6, view.coin.flash[ch]);
      if (view.coin.flash[ch] > 0) view.coin.flash[ch]--;
      g.fillStyle = accent; g.strokeStyle = accent; g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(14, y + 9, Math.max(1, r), 8, 0, 0, Math.PI * 2);
      coinA ? g.stroke() : g.fill();
      g.fillStyle = muted; g.fillText(String(ch + 1), 28, y + 13);
      // the last 32 tosses, newest right
      const shown = Math.min(32, count), x0 = 40, cell = (w - x0 - 4) / 32;
      for (let i = 0; i < 32; i++) {
        const age = 31 - i;  // tosses ago
        if (age >= shown) continue;
        const b = (Math.floor(hist / Math.pow(2, age)) & 1) === 1;
        const x = x0 + i * cell;
        const inLoop = loop > 0 && age < loop;
        g.globalAlpha = loop > 0 && !inLoop ? 0.35 : 1;
        g.fillStyle = accent; g.strokeStyle = accent;
        if (b) g.fillRect(x + 1, y + 2, cell - 2, 14);
        else g.strokeRect(x + 1.5, y + 2.5, cell - 3, 13);
        g.globalAlpha = 1;
      }
      if (loop > 0 && shown > 0) {  // the current loop position
        g.fillStyle = text;
        g.fillText(`${((count - 1) % loop) + 1}/${loop}`, w - 34, y + 30);
      }
    }
    if (link > 0) {  // chain between the channels
      g.strokeStyle = muted; g.lineWidth = 1;
      g.beginPath(); g.moveTo(14, 26); g.lineTo(14, 39); g.stroke();
      g.fillStyle = muted; g.fillText(link === 1 ? "shared" : "opposed", 2, 70);
    }
  }

  BleepViews.register("coin-toss", {
    top: true,
    template: '<div class="bv-panel"><h2>Tosses</h2><canvas class="coin-hist" style="width:100%;height:74px"></canvas></div>',
    afterBuild(view, el) {
      view.coin = { canvas: el.querySelector("canvas"), count: [0, 0], flash: [0, 0] };
      requestAnimationFrame(() => draw(view, null));
    },
    onState(st, view) { draw(view, st); },
    onRefresh(view) { draw(view, null); },
  });
})();
