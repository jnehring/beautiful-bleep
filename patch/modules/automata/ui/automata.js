// SPDX-License-Identifier: GPL-3.0-or-later
// Automata view (doc/specs/modules/automata.md §5): the system as it evolves.
//   Ring     the cells on a circle (the read head marked) and, beside it, the last
//            generations as rows
//   Grid     the 8×8 cells, the column being read lit
//   Walker   the 8×8 marks and the walker
//   Chain    the 9×9 transition table (rows = from, columns = to; the last row and
//            column are the rest): click a cell to raise its weight, right-click to lower it
//   Rewrite  the string as chips, the symbol being read marked
// A bar underneath shows how alive the system is (the Density output).
(function () {
  "use strict";
  const H = 190;
  const setting = (view, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round(p.min + (view.node.params[id] ?? p.default) * (p.max - p.min));
  };
  const DEFAULT_TABLE = (() => {
    const by = [1, 5, 3, 2, 1, 1, 0, 0], t = [];
    for (let i = 0; i < 9; i++)
      for (let j = 0; j < 9; j++) t.push(i === 8 || j === 8 ? (i === 8 && j === 8 ? 0 : 1) : by[Math.abs(i - j)]);
    return t;
  })();
  function data(view) {
    const d = view.node.data && typeof view.node.data === "object" ? view.node.data : {};
    if (!Array.isArray(d.table) || d.table.length !== 81) d.table = DEFAULT_TABLE.slice();
    view.node.data = d;
    return d;
  }
  function editTable(view, i, delta) {
    view.api.beginGesture();
    const d = data(view);
    d.table[i] = (d.table[i] + delta + 10) % 10;
    view.api.setData({ table: d.table.slice() });
    draw(view, performance.now() / 1000);
  }

  const SYM = ["A", "B", "C", "R", "U", "D"];
  function geom(w, mode) {
    const g = { w };
    if (mode === 2) {
      const cell = Math.min(17, Math.floor((H - 40) / 9));
      g.cell = cell; g.x0 = Math.round((w - cell * 9) / 2); g.y0 = 16;
    } else if (mode === 1 || mode === 3) {
      const cell = Math.min(20, Math.floor((H - 40) / 8));
      g.cell = cell; g.x0 = Math.round((w - cell * 8) / 2); g.y0 = 12;
    }
    return g;
  }

  function draw(view, now) {
    const s = view.am;
    if (!s || !s.canvas) return;
    const { g, w } = BleepView.fit(s.canvas);
    if (!w) return;
    const th = BleepView.theme(view.root), accent = th.accent, muted = th.muted, text = th.text, line = th.line;
    const st = s.state || {}, mode = setting(view, "mode");
    const cells = (st.arrays && st.arrays.cells) || [], len = st.len || 0, at = st.at || 0;
    const geo = (s.geo = geom(w, mode));
    g.font = "9px system-ui, sans-serif"; g.textBaseline = "middle"; g.textAlign = "center";
    if (mode === 0) {  // Ring + history rows
      if (st.gen !== s.lastGen) {
        s.rows.push(cells.slice(0, len).map((v) => (v > 0.5 ? 1 : 0)));
        if (s.rows.length > 28) s.rows.shift();
        s.lastGen = st.gen;
      }
      const cx = 100, cy = 82, R = 66, n = Math.max(len, 1), r = Math.min(9, (Math.PI * R) / n * 0.8);
      for (let i = 0; i < len; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2, x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R, on = cells[i] > 0.5;
        if (on) { BleepView.glow(g, accent, 10); g.fillStyle = accent; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.shadowBlur = 0; }
        else { g.strokeStyle = muted; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); }
        if (i === at) { g.strokeStyle = text; g.lineWidth = 1.6; g.beginPath(); g.arc(x, y, r + 3.5, 0, 7); g.stroke(); }
      }
      const rw = Math.max(4, Math.min(12, Math.floor((w - 230) / Math.max(len, 1))));
      const rh = 5, x0 = 210, y0 = 14;
      g.fillStyle = muted; g.textAlign = "left"; g.fillText("last generations", x0, 6);
      s.rows.forEach((row, ri) => {
        const y = y0 + (s.rows.length - 1 - ri) * (rh + 1);
        g.globalAlpha = 0.35 + 0.65 * (ri / Math.max(1, s.rows.length - 1));
        row.forEach((v, i) => { if (v) { g.fillStyle = accent; g.fillRect(x0 + i * (rw + 1), y, rw, rh); } });
      });
      g.globalAlpha = 1;
    } else if (mode === 1 || mode === 3) {  // Grid / Walker
      const C = geo.cell;
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const v = cells[y * 8 + x] || 0, px = geo.x0 + x * C, py = geo.y0 + y * C;
          const col = mode === 1 && x === at % 8 ? 0.16 : 0;
          g.fillStyle = muted; g.globalAlpha = 0.1 + col; g.fillRect(px + 1, py + 1, C - 2, C - 2);
          if (v > 0.02) {
            g.globalAlpha = 0.3 + 0.7 * v; g.fillStyle = accent;
            if (mode === 1) BleepView.glow(g, accent, 6);
            g.fillRect(px + 2, py + 2, C - 4, C - 4); g.shadowBlur = 0;
          }
          g.globalAlpha = 1;
        }
      if (mode === 3) {
        const ax = (at % 8) * C + geo.x0 + C / 2, ay = Math.floor(at / 8) * C + geo.y0 + C / 2;
        g.fillStyle = text; g.beginPath(); g.arc(ax, ay, C * 0.3, 0, 7); g.fill();
      }
    } else if (mode === 2) {  // Chain table
      const C = geo.cell, d = data(view);
      g.fillStyle = muted;
      for (let i = 0; i < 9; i++) {
        const lab = i === 8 ? "–" : String(i + 1);
        g.fillText(lab, geo.x0 + i * C + C / 2, geo.y0 - 8);
        g.textAlign = "right"; g.fillText(lab, geo.x0 - 5, geo.y0 + i * C + C / 2); g.textAlign = "center";
      }
      for (let i = 0; i < 9; i++)
        for (let j = 0; j < 9; j++) {
          const p = cells[i * 9 + j] || 0, px = geo.x0 + j * C, py = geo.y0 + i * C;
          g.fillStyle = muted; g.globalAlpha = 0.08; g.fillRect(px + 1, py + 1, C - 2, C - 2);
          g.fillStyle = accent; g.globalAlpha = Math.min(1, p * 2.2);
          g.fillRect(px + 1, py + 1, C - 2, C - 2); g.globalAlpha = 1;
          if (d.table[i * 9 + j] > 0 && p < 0.02) { g.strokeStyle = muted; g.strokeRect(px + 2.5, py + 2.5, C - 5, C - 5); }
        }
      g.strokeStyle = text; g.lineWidth = 1.5;
      g.strokeRect(geo.x0 + 0.5, geo.y0 + at * C + 0.5, 9 * C - 1, C - 1);
      g.fillStyle = muted; g.textAlign = "left";
      g.fillText("from ↓  to →  · click ▲  right-click ▼", 8, H - 22);
    } else {  // Rewrite
      const chip = 15, per = Math.max(1, Math.floor((w - 20) / (chip + 2)));
      const col = [accent, accent, accent, muted, th.mod || text, th.mod || text];
      for (let i = 0; i < len; i++) {
        const sym = Math.round((cells[i] * 255 - 10) / 40), x = 10 + (i % per) * (chip + 2), y = 12 + Math.floor(i / per) * (chip + 2);
        g.globalAlpha = i === at ? 1 : 0.65; g.fillStyle = col[sym] || muted; g.fillRect(x, y, chip, chip);
        g.fillStyle = th.panel || "#000"; g.textAlign = "center"; g.fillText(SYM[sym] || "?", x + chip / 2, y + chip / 2 + 0.5);
        if (i === at) { g.strokeStyle = text; g.lineWidth = 1.6; g.strokeRect(x - 1.5, y - 1.5, chip + 3, chip + 3); }
      }
      g.globalAlpha = 1;
    }
    // Density bar and the generation count
    const bw = w - 120, by = H - 12, d = Math.max(0, Math.min(1, st.density || 0));
    g.strokeStyle = line; g.lineWidth = 1; g.strokeRect(60.5, by - 3.5, bw, 7);
    g.fillStyle = accent; g.globalAlpha = 0.85; g.fillRect(61, by - 3, (bw - 1) * d, 6); g.globalAlpha = 1;
    g.fillStyle = muted; g.textAlign = "right"; g.fillText("alive", 54, by);
    g.textAlign = "left"; g.fillText("gen " + (st.gen || 0), 66 + bw, by);
  }

  const STYLE = `.am-panel { flex: 1 1 100%; } .am-panel canvas { display: block; width: 100%; height: ${H}px; touch-action: none; }`;

  BleepViews.register("automata", {
    partNames: ["System"],
    top: true,
    width: 760,
    layout: [
      { title: "System", params: ["mode", "seed", "rule", "cells", "gridrule", "turns", "rules", "density"] },
      { title: "Evolution", params: ["interference", "rewindby", "learn"] },
      { title: "Clock", params: ["syncto", "sync", "rate", "gatelength"] },
      { title: "Pitch", params: ["octaves", "root", "scale", "harmony"] },
    ],
    template: `<div class="bv-panel am-panel"><canvas></canvas></div>`,
    afterBuild(view, el) {
      if (!document.getElementById("am-style")) {
        const s = document.createElement("style");
        s.id = "am-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      const canvas = el.querySelector("canvas");
      view.am = { canvas, state: null, rows: [], lastGen: undefined };
      const hit = (e) => {
        if (setting(view, "mode") !== 2 || !view.am.geo) return -1;
        const geo = view.am.geo, r = canvas.getBoundingClientRect();
        const j = Math.floor((e.clientX - r.left - geo.x0) / geo.cell), i = Math.floor((e.clientY - r.top - geo.y0) / geo.cell);
        return i >= 0 && i < 9 && j >= 0 && j < 9 ? i * 9 + j : -1;
      };
      canvas.addEventListener("pointerdown", (e) => {
        const k = hit(e);
        if (k < 0) return;
        e.stopPropagation(); e.preventDefault();
        editTable(view, k, e.button === 2 || e.shiftKey ? -1 : 1);
      });
      canvas.addEventListener("contextmenu", (e) => { if (hit(e) >= 0) e.preventDefault(); });
      BleepView.loop(view.root, (t) => draw(view, t));
    },
    onState(st, view) {
      if (view.am) view.am.state = st;
    },
    onRefresh(view) { if (view.am) { view.am.rows = []; draw(view, performance.now() / 1000); } },
  });
})();
