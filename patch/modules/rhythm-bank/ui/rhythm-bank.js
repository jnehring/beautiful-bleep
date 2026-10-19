// SPDX-License-Identifier: GPL-3.0-or-later
// Rhythm Bank view (doc/specs/modules/rhythm-bank.md §5): the playing pattern as
// four rows by Length steps (muted rows dimmed, the playhead, Accent steps
// marked below, Poly Free hits at their exact position), a large pattern
// number with ◀ ▶ (one undo step each) and the family name; a pending
// pattern change shows as "→ 17". Clicking a row's label toggles its mute.
(function () {
  "use strict";
  const FAMILIES = ["Even", "Prime", "Metric", "Poly", "Interlock", "Seeded"];
  const ROW_H = 22, ACC_H = 7, LABEL_W = 44, RING = 204;
  const RADII = [90, 71, 52, 33];

  function setting(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    const v = view.node.params[id] ?? p.default;
    return Math.round(p.min + v * (p.max - p.min));
  }
  function setUnits(view, id, units) {
    const p = view.type.params.find((x) => x.id === id);
    const v = Math.max(0, Math.min(1, (units - p.min) / (p.max - p.min)));
    view.node.params[id] = v;
    view.api.setParam(id, v);
  }
  const pt = (R, a) => [RING / 2 + R * Math.cos(a), RING / 2 + R * Math.sin(a)];

  /// The four outputs as concentric rings: hits are glowing beads joined by the
  /// rhythm's polygon, the playhead sweeps round with a fading wake.
  function drawRings(view, now) {
    const r = view.rb, st = r.state || {}, arr = st.arrays || {};
    const rows = arr.rows || [], accent = arr.accent || [], gates = arr.gates || [];
    const L = accent.length || setting(view, "length") || 16;
    const { g } = BleepView.fit(r.rings);
    const th = BleepView.theme(view.root);
    const step = Math.round(st.step || 0) % L;
    if (step !== r.lastStep) { r.lastStep = step; r.stepAt = now; }
    const since = now - (r.stepAt || 0);
    const cx = RING / 2, cy = RING / 2, ang = (i) => ((i % L) / L) * 2 * Math.PI - Math.PI / 2;
    // the wake: a fading wedge behind the playhead
    const a0 = ang(step) - 0.08;
    for (let k = 0; k < 6; k++) {
      g.globalAlpha = 0.12 * (1 - k / 6);
      g.fillStyle = th.accent;
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, RADII[0] + 8, a0 - (k + 1) * (Math.PI / L), a0 - k * (Math.PI / L)); g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
    for (let j = 0; j < 4; j++) {
      const R = RADII[j], muted = setting(view, "mute" + (j + 1)) === 1;
      const dot = Math.max(1.6, Math.min(5, 0.42 * 2 * Math.PI * R / L));
      g.globalAlpha = muted ? 0.28 : 1;
      g.strokeStyle = th.line; g.lineWidth = 1;
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
      const hits = [];
      for (let i = 0; i < L; i++) {
        const v = rows[j * L + i] || 0;
        if (v > 0) hits.push([i + (v > 1 ? v - 1 : 0), i]);
        else { g.fillStyle = th.line; const [x, y] = pt(R, ang(i)); g.beginPath(); g.arc(x, y, Math.max(1, dot * 0.35), 0, Math.PI * 2); g.fill(); }
      }
      if (hits.length > 1) {  // the rhythm's polygon
        g.beginPath();
        hits.forEach(([pos], k) => { const [x, y] = pt(R, ((pos / L) * 2 * Math.PI) - Math.PI / 2); k ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.closePath();
        g.fillStyle = th.accent; g.globalAlpha = (muted ? 0.28 : 1) * 0.1; g.fill();
        g.globalAlpha = (muted ? 0.28 : 1) * 0.45; g.strokeStyle = th.accent; g.lineWidth = 1; g.stroke();
        g.globalAlpha = muted ? 0.28 : 1;
      }
      for (const [pos, i] of hits) {
        const [x, y] = pt(R, ((pos / L) * 2 * Math.PI) - Math.PI / 2);
        const here = i === step && !muted, pulse = here ? 1 + Math.max(0, 0.35 - since) * 3 : 1;
        g.fillStyle = here ? th.text : th.accent;
        BleepView.glow(g, th.accent, here ? 14 : 5);
        g.beginPath(); g.arc(x, y, dot * pulse, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
      }
      g.globalAlpha = 1;
      g.fillStyle = gates[j] > 0.5 ? th.accent : th.muted;
      g.font = "8px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      const [lx, ly] = pt(R, -Math.PI / 2 - 0.0);
      g.fillStyle = th.panel; g.fillRect(lx - 5, ly - 5, 10, 10);
      g.fillStyle = muted ? th.muted : gates[j] > 0.5 ? th.accent : th.text;
      g.fillText(muted ? "M" : String(j + 1), lx, ly + 0.5);
    }
    // the playhead
    const [px, py] = pt(RADII[0] + 8, ang(step));
    g.strokeStyle = th.text; g.lineWidth = 1.5;
    BleepView.glow(g, th.accent, 10);
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(px, py); g.stroke();
    g.shadowBlur = 0;
  }

  function drawGrid(view) {
    const r = view.rb;
    const st = r.state || {}, arr = st.arrays || {};
    const rows = arr.rows || [], accent = arr.accent || [], gates = arr.gates || [];
    const L = accent.length || 16;
    r.number.textContent = String(st.pattern ?? setting(view, "pattern"));
    r.family.textContent = FAMILIES[st.family ?? setting(view, "family")] || "";
    r.next.textContent = st.pending ? "→ " + Math.round(st.next) : "";
    const { g, w } = BleepView.fit(r.canvas);
    if (!w) return;
    const th = BleepView.theme(view.root);
    const cw = (w - LABEL_W) / L, step = Math.round(st.step || 0) % L;
    g.font = "10px system-ui, sans-serif";
    g.textBaseline = "middle";
    for (let j = 0; j < 4; j++) {
      const muted = setting(view, "mute" + (j + 1)) === 1, y = j * ROW_H;
      g.globalAlpha = muted ? 0.35 : 1;
      g.fillStyle = gates[j] > 0.5 ? th.accent : th.text;
      g.fillText((muted ? "M " : "") + "Out " + (j + 1), 0, y + ROW_H / 2);
      for (let i = 0; i < L; i++) {
        const x = LABEL_W + i * cw, v = rows[j * L + i] || 0;
        g.fillStyle = i % 4 === 0 ? th.line : th.panel2 || th.line;
        g.fillRect(x + 1, y + 2, cw - 2, ROW_H - 4);
        if (v > 0) {
          const f = v - 1;  // Poly Free: offset inside the step
          g.fillStyle = th.accent;
          if (!muted) BleepView.glow(g, th.accent, i === step ? 12 : 4);
          g.fillRect(x + 1 + f * cw, y + 2, Math.max(2, (cw - 2) * (f > 0 ? 0.4 : 1)), ROW_H - 4);
          g.shadowBlur = 0;
        }
      }
    }
    g.globalAlpha = 1;
    for (let i = 0; i < L; i++)
      if (accent[i] > 0) {
        g.fillStyle = th.text;
        g.fillRect(LABEL_W + i * cw + cw / 2 - 2, 4 * ROW_H + 1, 4, ACC_H - 2);
      }
    g.strokeStyle = th.text;
    g.strokeRect(LABEL_W + step * cw + 0.5, 0.5, cw - 1, 4 * ROW_H - 1);
  }

  BleepViews.register("rhythm-bank", {
    partNames: ["Pattern"],
    top: true,
    width: 900,
    layout: [
      { title: "Clock & family", params: ["syncto", "rate", "length", "family", "change"] },
      { title: "Pattern · rotate · width", params: ["pattern", "rotate1", "rotate2", "rotate3", "rotate4", "width"] },
      { title: "Outputs", params: ["output", "grid", "complement", "mute1", "mute2", "mute3", "mute4"] },
    ],
    template: `<div class="bv-panel rb-panel"><div class="rb-wrap">
      <canvas class="rb-rings" title="Click a ring to mute its output"></canvas>
      <div class="rb-right">
        <div class="rb-head"><button class="rb-prev" title="Previous pattern">◀</button><span class="rb-num">0</span>
          <button class="rb-nextb" title="Next pattern">▶</button><span class="rb-fam"></span><span class="rb-pend"></span></div>
        <canvas class="rb-grid" title="Click an output label to mute it"></canvas>
      </div></div></div>`,
    afterBuild(view, el) {
      if (!document.getElementById("rb-style")) {
        const s = document.createElement("style");
        s.id = "rb-style";
        s.textContent = `
          .rb-wrap { display: flex; gap: 16px; align-items: center; }
          .rb-panel canvas.rb-rings { flex: none; width: ${RING}px; height: ${RING}px; cursor: pointer; }
          .rb-right { flex: 1; min-width: 0; }
          .rb-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
          .rb-num { font-size: 28px; font-weight: 600; min-width: 52px; text-align: center; font-variant-numeric: tabular-nums;
                    color: var(--accent); text-shadow: 0 0 12px var(--accent); }
          .rb-fam { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
          .rb-pend { color: var(--muted); font-size: 12px; margin-left: auto; }
          .rb-panel canvas.rb-grid { display: block; cursor: pointer; width: 100%; height: ${4 * ROW_H + ACC_H + 4}px; }
          .rb-head button { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 6px;
                            padding: 4px 12px; cursor: pointer; }`;
        document.head.appendChild(s);
      }
      const step = (d) => {
        view.api.beginGesture();
        setUnits(view, "pattern", Math.max(0, Math.min(127, setting(view, "pattern") + d)));
      };
      el.querySelector(".rb-prev").addEventListener("click", () => step(-1));
      el.querySelector(".rb-nextb").addEventListener("click", () => step(1));
      const toggle = (j) => {
        view.api.beginGesture();
        const id = "mute" + (j + 1);
        setUnits(view, id, setting(view, id) ? 0 : 1);
      };
      const canvas = el.querySelector(".rb-grid"), rings = el.querySelector(".rb-rings");
      canvas.addEventListener("click", (e) => {  // a row label toggles its mute
        const r = canvas.getBoundingClientRect();
        const x = e.clientX - r.left, j = Math.floor((e.clientY - r.top) / ROW_H);
        if (x > LABEL_W || j < 0 || j > 3) return;
        toggle(j);
      });
      rings.addEventListener("click", (e) => {  // a ring toggles its mute
        const r = rings.getBoundingClientRect();
        const d = Math.hypot(e.clientX - r.left - RING / 2, e.clientY - r.top - RING / 2);
        const j = RADII.findIndex((R) => Math.abs(d - R) < 9);
        if (j >= 0) toggle(j);
      });
      view.rb = { number: el.querySelector(".rb-num"), family: el.querySelector(".rb-fam"), next: el.querySelector(".rb-pend"),
        canvas, rings, state: null, lastStep: -1, stepAt: 0 };
      BleepView.loop(view.root, (t) => { drawRings(view, t); drawGrid(view); });
    },
    onState(st, view) { if (view.rb) view.rb.state = st; },
    onRefresh(view) { if (view.rb) { drawRings(view, performance.now() / 1000); drawGrid(view); } },
  });
})();
