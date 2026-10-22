// SPDX-License-Identifier: GPL-3.0-or-later
// Shift Register view (doc/specs/modules/shift-register.md §5): the 16 live bits
// (newest left, bits beyond Length dimmed, the feedback tap marked, flipped
// bits flashing), the start pattern below them, Capture / Load, the Combo
// toggles and a history strip of the last 32 Voltage values.
//   Clicking a live bit flips it in the running register (a command, no undo).
//   Clicking a start bit edits the start pattern (node data, one undo step).
//   Capture copies the live register into the start pattern; Load loads the
//   start pattern into the running register now.
(function () {
  "use strict";
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
    draw(view, performance.now() / 1000);
  }

  const H = 128, RH = 40;
  /// Layout of the canvas: bit cells on the left, the history strip right of them.
  function geom(w) {
    const cell = Math.max(14, Math.min(32, Math.floor((w - 70) * 0.58 / 16)));
    return { cell, x0: 34, hx: 34 + 16 * cell + 56, rowY: [26, 26 + RH] };
  }

  function draw(view, now) {
    const s = view.sr;
    if (!s || !s.canvas) return;
    const { g, w } = BleepView.fit(s.canvas);
    if (!w) return;
    const th = BleepView.theme(view.root), accent = th.accent, line = th.line, muted = th.muted, text = th.text;
    const st = s.state || {}, d = data(view);
    const geo = geom(w), C = geo.cell;
    s.geo = geo;
    const len = Math.min(16, Math.max(2, setting(view, "length")));
    const bits = st.bits ?? d.start, flips = st.flips ?? 0;
    if (st.k !== s.lastK) {  // the register shifted: slide the cells one place right
      if (s.lastK !== undefined) { s.shiftAt = now; s.flash = flips & 1 ? now : 0; }
      s.lastK = st.k;
    }
    const slide = s.shiftAt ? Math.min(1, (now - s.shiftAt) / 0.12) : 1;
    const ease = 1 - (1 - slide) * (1 - slide);
    g.font = "9px system-ui, sans-serif";
    g.textBaseline = "middle";
    // The feedback path: from the tap (bit Length) round under the cells to the input.
    const tx = geo.x0 + (len - 1) * C + C / 2, ix = geo.x0 + C / 2, fy = 9;
    g.strokeStyle = th.mod || muted; g.globalAlpha = 0.55; g.lineWidth = 1.2; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(tx, geo.rowY[0] - 1); g.lineTo(tx, fy); g.lineTo(ix, fy); g.lineTo(ix, geo.rowY[0] - 1); g.stroke();
    g.setLineDash([]); g.globalAlpha = 1;
    g.fillStyle = muted; g.textAlign = "center";
    g.fillText("feedback  ◂  lock", (tx + ix) / 2, fy + 8);
    for (let row = 0; row < 2; row++) {
      const v = row === 0 ? bits : d.start, y = geo.rowY[row] + (row === 0 ? 8 : 12);
      const rad = row === 0 ? Math.min(11, C * 0.36) : Math.min(7, C * 0.24);
      for (let i = 0; i < 16; i++) {
        const on = (v >> i) & 1;
        const dx = row === 0 ? (ease - 1) * C : 0;  // live cells glide in from the left
        const x = geo.x0 + i * C + C / 2 + dx;
        const inLen = i < len;
        g.globalAlpha = (inLen ? 1 : 0.3) * (row === 0 && i === 0 ? ease : 1);
        if (on) {
          const gr = g.createRadialGradient(x, y, 0, x, y, rad);
          gr.addColorStop(0, text); gr.addColorStop(0.35, accent); gr.addColorStop(1, accent);
          g.fillStyle = gr;
          if (row === 0 && inLen) BleepView.glow(g, accent, 12);
          g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
          g.shadowBlur = 0;
        } else {
          g.strokeStyle = row === 0 ? accent : muted; g.lineWidth = 1.3;
          g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.stroke();
        }
        if (row === 0 && i === 0 && s.flash && now - s.flash < 0.35) {  // the entering bit was flipped
          g.strokeStyle = text; g.globalAlpha = 1 - (now - s.flash) / 0.35; g.lineWidth = 1.5;
          g.beginPath(); g.arc(x, y, rad + 3 + (now - s.flash) * 14, 0, Math.PI * 2); g.stroke();
        }
        g.globalAlpha = 1;
      }
    }
    g.fillStyle = muted; g.textAlign = "right";
    g.fillText("LIVE", geo.x0 - 8, geo.rowY[0] + 8);
    g.fillText("START", geo.x0 - 8, geo.rowY[1] + 12);
    g.textAlign = "center";
    for (const n of [1, 8, 16]) g.fillText(String(n), geo.x0 + (n - 1) * C + C / 2, H - 6);
    g.fillStyle = text;
    g.fillText("▲", tx, H - 6);
    // History: the last 32 values of Voltage (flipped steps marked), as glowing bars.
    const hist = (st.arrays && st.arrays.history) || [], fl = (st.arrays && st.arrays.flipped) || [];
    const top = 12, bh = H - top - 18, hw = w - geo.hx - 6, bw = hw / 32;
    g.textAlign = "left"; g.fillStyle = muted;
    g.fillText("VOLTAGE · last 32 steps", geo.hx, 4);
    g.strokeStyle = line; g.lineWidth = 1;
    g.strokeRect(geo.hx + 0.5, top + 0.5, hw, bh);
    const bg = g.createLinearGradient(0, top, 0, top + bh);
    bg.addColorStop(0, accent); bg.addColorStop(1, accent + "30");
    g.fillStyle = bg;
    BleepView.glow(g, accent, 6);
    hist.forEach((v, i) => {
      const x = geo.hx + i * bw, hgt = Math.max(1, v * (bh - 2));
      g.fillRect(x + 1, top + bh - 1 - hgt, Math.max(1, bw - 2), hgt);
    });
    g.shadowBlur = 0;
    g.fillStyle = text; g.textAlign = "center";
    hist.forEach((v, i) => { if (fl[i] > 0.5) g.fillText("×", geo.hx + i * bw + bw / 2, top + 8); });
    if (!hist.length) { g.fillStyle = muted; g.fillText("no signal yet", geo.hx + hw / 2, top + bh / 2); }
    s.combo.forEach((b, i) => b.classList.toggle("on", ((d.combo >> i) & 1) === 1));
  }

  const STYLE = `
    .sr-panel { flex: 1 1 100%; }
    .sr-tools { display: flex; gap: 4px; align-items: center; margin: 4px 0; flex-wrap: wrap; font-size: 11px; color: var(--muted); }
    .sr-tools button { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 6px;
      padding: 1px 7px; font: inherit; font-size: 11px; cursor: pointer; }
    .sr-tools button.on { border-color: var(--accent); background: var(--accent); color: var(--panel); }
    .sr-panel canvas { display: block; cursor: pointer; touch-action: none; width: 100%; height: ${H}px; }`;

  BleepViews.register("shift-register", {
    partNames: ["Register"],
    top: true,
    width: 830,
    layout: [
      { title: "Clock & source", params: ["syncto", "sync", "rate", "source", "combine", "seed"] },
      { title: "Register", params: ["length", "lock"] },
      { title: "Output", params: ["level", "gatelength"] },
      { title: "Mixer", params: ["w1", "w2", "w3", "w4", "w5", "w6"] },
      { title: "Pitch", params: ["octaves", "root", "scale"] },
    ],
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
        if (e.button !== 0 || !view.sr.geo) return;
        const geo = view.sr.geo, r = canvas.getBoundingClientRect();
        const x = e.clientX - r.left - geo.x0, y = e.clientY - r.top;
        const i = Math.floor(x / geo.cell);
        const row = y >= geo.rowY[0] - 4 && y < geo.rowY[0] + RH - 6 ? 0 : y >= geo.rowY[1] - 6 && y < geo.rowY[1] + 26 ? 1 : -1;
        if (i < 0 || i > 15 || row < 0) return;
        e.stopPropagation();
        if (row === 0) view.api.command("toggle", i);
        else edit(view, (d) => (d.start ^= 1 << i));
      });
      el.querySelector(".sr-capture").addEventListener("click", () => {
        const st = view.sr.state;
        if (st && typeof st.bits === "number") edit(view, (d) => (d.start = st.bits));
      });
      el.querySelector(".sr-load").addEventListener("click", () => view.api.command("load", 1));
      BleepView.loop(view.root, (t) => draw(view, t));
    },
    onState(st, view) {
      if (view.sr) view.sr.state = st;
    },
    onRefresh(view) { if (view.sr) draw(view, performance.now() / 1000); },
  });
})();
