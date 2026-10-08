// SPDX-License-Identifier: MIT
// Shift Register view (specs/modules/shift-register.md §5): the 16 live bits
// (newest left, bits beyond Length dimmed, the feedback tap marked, flipped
// bits flashing), the start pattern below them, Capture / Load, the Combo
// toggles and a history strip of the last 32 Voltage values.
//   Clicking a live bit flips it in the running register (a command, no undo).
//   Clicking a start bit edits the start pattern (node data, one undo step).
//   Capture copies the live register into the start pattern; Load loads the
//   start pattern into the running register now.
(function () {
  "use strict";
  const CELL = 20, ROW = 22;
  const setting = (view, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round(p.min + (view.node.params[id] ?? p.default) * (p.max - p.min));
  };
  function data(view) {
    const d = view.node.data && typeof view.node.data === "object" ? view.node.data : {};
    if (typeof d.start !== "number") d.start = 1;
    if (typeof d.combo !== "number") d.combo = 9;
    view.node.data = d;
    return d;
  }
  function edit(view, fn) {
    view.api.beginGesture();
    const d = data(view);
    fn(d);
    d.start &= 0xffff;
    d.combo &= 0xff;
    view.api.setData({ start: d.start, combo: d.combo });
    draw(view);
  }

  function draw(view) {
    const s = view.sr;
    if (!s || !s.canvas) return;
    const c = s.canvas, st = s.state || {}, d = data(view);
    const dpr = window.devicePixelRatio || 1, w = 16 * CELL + 38, h = 2 * ROW + 70;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; c.style.width = w + "px"; c.style.height = h + "px"; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim(), line = css.getPropertyValue("--line").trim();
    const muted = css.getPropertyValue("--muted").trim(), text = css.getPropertyValue("--text").trim();
    const len = Math.min(16, Math.max(2, setting(view, "length")));
    const bits = st.bits ?? d.start, flips = st.flips ?? 0;
    if (st.k !== s.lastK) { s.lastK = st.k; s.flash = flips & 1 ? 8 : 0; }
    g.font = "9px system-ui, sans-serif";
    for (let row = 0; row < 2; row++) {
      const v = row === 0 ? bits : d.start, y = 4 + row * ROW;
      for (let i = 0; i < 16; i++) {
        const x = 4 + i * CELL + CELL / 2, on = (v >> i) & 1;
        g.globalAlpha = i < len ? 1 : 0.35;
        g.fillStyle = accent; g.strokeStyle = row === 0 ? accent : muted; g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y + 8, row === 0 ? 7 : 5, 0, Math.PI * 2);
        on ? g.fill() : g.stroke();
        if (row === 0 && i === 0 && s.flash > 0) {  // the entering bit was flipped
          g.strokeStyle = text; g.globalAlpha = s.flash / 8;
          g.beginPath(); g.arc(x, y + 8, 9.5, 0, Math.PI * 2); g.stroke();
        }
        g.globalAlpha = 1;
      }
    }
    if (s.flash > 0) s.flash--;
    // feedback tap and labels
    const tx = 4 + (len - 1) * CELL + CELL / 2;
    g.fillStyle = text; g.textAlign = "center";
    g.fillText("▲", tx, 2 * ROW + 12);
    g.fillStyle = muted;
    g.fillText("1", 4 + CELL / 2, 2 * ROW + 12);
    g.fillText("8", 4 + 7 * CELL + CELL / 2, 2 * ROW + 12);
    g.fillText("16", 4 + 15 * CELL + CELL / 2, 2 * ROW + 12);
    g.textAlign = "left";
    g.fillText("live", w - 28, 14);
    g.fillText("start", w - 28, 4 + ROW + 12);
    // history: the last 32 values of Voltage, flipped steps marked
    const hist = (st.arrays && st.arrays.history) || [], fl = (st.arrays && st.arrays.flipped) || [];
    const top = 2 * ROW + 18, bh = h - top - 4, hw = 16 * CELL, bw = hw / 32;
    g.strokeStyle = line; g.strokeRect(3.5, top - 0.5, hw + 1, bh + 1);
    hist.forEach((v, i) => {
      g.fillStyle = accent;
      g.fillRect(4 + i * bw + 1, top + bh - v * bh, bw - 2, Math.max(1, v * bh));
      if (fl[i] > 0.5) { g.fillStyle = text; g.fillText("×", 4 + i * bw + 1, top + 8); }
    });
    // combo toggles
    s.combo.forEach((b, i) => b.classList.toggle("on", ((d.combo >> i) & 1) === 1));
  }

  const STYLE = `
    .sr-panel { flex: 1 1 100%; }
    .sr-tools { display: flex; gap: 4px; align-items: center; margin: 4px 0; flex-wrap: wrap; font-size: 11px; color: var(--muted); }
    .sr-tools button { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 6px;
      padding: 1px 7px; font: inherit; font-size: 11px; cursor: pointer; }
    .sr-tools button.on { border-color: var(--accent); background: var(--accent); color: var(--panel); }
    .sr-panel canvas { display: block; cursor: pointer; touch-action: none; }`;

  BleepViews.register("shift-register", {
    top: true,
    width: 380,
    template: `<div class="bv-panel sr-panel">
      <canvas></canvas>
      <div class="sr-tools">
        <button class="sr-capture" title="Copy the live register into the start pattern">Capture</button>
        <button class="sr-load" title="Load the start pattern into the running register now">Load</button>
        <span style="margin-left:8px">Combo</span><span class="sr-combo"></span>
      </div>
    </div>`,
    afterBuild(view, el) {
      if (!document.getElementById("sr-style")) {
        const s = document.createElement("style");
        s.id = "sr-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      const canvas = el.querySelector("canvas"), comboBox = el.querySelector(".sr-combo");
      const combo = [];
      for (let i = 0; i < 8; i++) {
        const b = document.createElement("button");
        b.textContent = String(i + 1);
        b.title = `Bit ${i + 1} feeds Combo`;
        b.addEventListener("click", () => edit(view, (d) => (d.combo ^= 1 << i)));
        comboBox.appendChild(b);
        combo.push(b);
      }
      view.sr = { canvas, combo, state: null, flash: 0, lastK: undefined };
      canvas.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const r = canvas.getBoundingClientRect(), x = e.clientX - r.left - 4, y = e.clientY - r.top - 4;
        const i = Math.floor(x / CELL), row = Math.floor(y / ROW);
        if (i < 0 || i > 15 || row < 0 || row > 1) return;
        e.stopPropagation();
        if (row === 0) view.api.command("toggle", i);
        else edit(view, (d) => (d.start ^= 1 << i));
      });
      el.querySelector(".sr-capture").addEventListener("click", () => {
        const st = view.sr.state;
        if (st && typeof st.bits === "number") edit(view, (d) => (d.start = st.bits));
      });
      el.querySelector(".sr-load").addEventListener("click", () => view.api.command("load", 1));
      requestAnimationFrame(() => draw(view));
    },
    onState(st, view) {
      if (!view.sr) return;
      view.sr.state = st;
      draw(view);
    },
    onRefresh(view) { draw(view); },
  });
})();
