// SPDX-License-Identifier: MIT
// Rhythm Bank view (doc/specs/modules/rhythm-bank.md §5): the playing pattern as
// four rows by Length steps (muted rows dimmed, the playhead, Accent steps
// marked below, Poly Free hits at their exact position), a large pattern
// number with ◀ ▶ (one undo step each) and the family name; a pending
// pattern change shows as "→ 17". Clicking a row's label toggles its mute.
(function () {
  "use strict";
  const FAMILIES = ["Even", "Prime", "Metric", "Poly", "Interlock", "Seeded"];
  const ROW_H = 16, ACC_H = 6, LABEL_W = 34;

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

  function draw(view) {
    const r = view.rb;
    if (!r) return;
    const st = r.state || {}, arr = st.arrays || {};
    const rows = arr.rows || [], accent = arr.accent || [], gates = arr.gates || [];
    const L = accent.length || 16;
    r.number.textContent = String(st.pattern ?? setting(view, "pattern"));
    r.family.textContent = FAMILIES[st.family ?? setting(view, "family")] || "";
    r.next.textContent = st.pending ? "→ " + Math.round(st.next) : "";
    const c = r.canvas;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth || 300, h = 4 * ROW_H + ACC_H + 4;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const accentC = css.getPropertyValue("--accent"), line = css.getPropertyValue("--line"), text = css.getPropertyValue("--text");
    const cw = (w - LABEL_W) / L, step = Math.round(st.step || 0) % L;
    g.font = "10px system-ui, sans-serif";
    g.textBaseline = "middle";
    for (let j = 0; j < 4; j++) {
      const muted = setting(view, "mute" + (j + 1)) === 1, y = j * ROW_H;
      g.globalAlpha = muted ? 0.35 : 1;
      g.fillStyle = gates[j] > 0.5 ? accentC : text;
      g.fillText((muted ? "M " : "") + "Out " + (j + 1), 0, y + ROW_H / 2);
      for (let i = 0; i < L; i++) {
        const x = LABEL_W + i * cw, v = rows[j * L + i] || 0;
        g.fillStyle = line;
        g.fillRect(x + 1, y + 2, cw - 2, ROW_H - 4);
        if (v > 0) {
          g.fillStyle = accentC;
          const f = v - 1;  // Poly Free: offset inside the step
          g.fillRect(x + 1 + f * cw, y + 2, Math.max(2, (cw - 2) * (f > 0 ? 0.4 : 1)), ROW_H - 4);
        }
      }
    }
    g.globalAlpha = 1;
    for (let i = 0; i < L; i++)
      if (accent[i] > 0) {
        g.fillStyle = text;
        g.fillRect(LABEL_W + i * cw + cw / 2 - 2, 4 * ROW_H + 1, 4, ACC_H - 2);
      }
    g.strokeStyle = text;
    g.strokeRect(LABEL_W + step * cw + 0.5, 0.5, cw - 1, 4 * ROW_H - 1);
  }

  BleepViews.register("rhythm-bank", {
    top: true,
    width: 420,
    template: `<div class="bv-panel rb-panel">
      <div class="rb-head"><button class="rb-prev" title="Previous pattern">◀</button><span class="rb-num">0</span>
        <button class="rb-nextb" title="Next pattern">▶</button><span class="rb-fam"></span><span class="rb-pend"></span></div>
      <canvas class="rb-grid" style="width:100%;height:74px"></canvas></div>`,
    afterBuild(view, el) {
      if (!document.getElementById("rb-style")) {
        const s = document.createElement("style");
        s.id = "rb-style";
        s.textContent = `
          .rb-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
          .rb-num { font-size: 24px; font-weight: 600; min-width: 44px; text-align: center; font-variant-numeric: tabular-nums; }
          .rb-fam { color: var(--muted); font-size: 12px; }
          .rb-pend { color: var(--muted); font-size: 12px; margin-left: auto; }
          .rb-grid { display: block; cursor: pointer; }`;
        document.head.appendChild(s);
      }
      const step = (d) => {
        view.api.beginGesture();
        setUnits(view, "pattern", Math.max(0, Math.min(127, setting(view, "pattern") + d)));
        draw(view);
      };
      el.querySelector(".rb-prev").addEventListener("click", () => step(-1));
      el.querySelector(".rb-nextb").addEventListener("click", () => step(1));
      const canvas = el.querySelector(".rb-grid");
      canvas.addEventListener("click", (e) => {  // a row label toggles its mute
        const r = canvas.getBoundingClientRect();
        const x = e.clientX - r.left, j = Math.floor((e.clientY - r.top) / ROW_H);
        if (x > LABEL_W || j < 0 || j > 3) return;
        view.api.beginGesture();
        const id = "mute" + (j + 1);
        setUnits(view, id, setting(view, id) ? 0 : 1);
        draw(view);
      });
      view.rb = { number: el.querySelector(".rb-num"), family: el.querySelector(".rb-fam"), next: el.querySelector(".rb-pend"),
        canvas, state: null };
      requestAnimationFrame(() => draw(view));
    },
    onState(st, view) {
      if (!view.rb) return;
      view.rb.state = st;
      draw(view);
    },
    onRefresh(view) { draw(view); },
  });
})();
