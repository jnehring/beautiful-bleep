// SPDX-License-Identifier: GPL-3.0-or-later
// Switch view: the eight slots as glowing columns (height = level, slots beyond
// Length dimmed) with the active step lit, the stepping order and the Select
// offset. The active step comes from the engine (SwitchDsp position).
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".sw-cv{height:150px;cursor:ns-resize;touch-action:none!important}";
  document.head.appendChild(style);
  const real = (view, st, id) => {
    const p = view.type.params.find((q) => q.id === id);
    return p.min + (p.max - p.min) * view.value(st, id);
  };
  const ORDERS = ["forward", "backward", "ping-pong", "random", "random walk"];
  function draw(view, cv, t) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st;
    const len = Math.round(real(view, st, "length")), order = view.units("order");
    const sel = Math.floor(view.value(st, "select") * len);
    const step = st && typeof st.step === "number" ? ((st.step % 8) + 8) % 8 : 0;
    const pad = 8, top = 16, bot = h - 16, mid = (top + bot) / 2, half = (bot - top) / 2, slot = (w - pad * 2) / 8;
    g.strokeStyle = th.line; g.lineWidth = 1; g.beginPath(); g.moveTo(pad, Math.round(mid) + 0.5); g.lineTo(w - pad, Math.round(mid) + 0.5); g.stroke();
    g.font = "9px system-ui, sans-serif"; g.textAlign = "center";
    for (let k = 0; k < 8; k++) {
      const cx = pad + slot * (k + 0.5), bw = Math.min(40, slot * 0.6);
      const on = k < len, active = k === step && on;
      const v = Math.max(-1, Math.min(1, real(view, st, "level" + (k + 1)))), y = mid - v * half;
      g.globalAlpha = on ? 1 : 0.22;
      g.fillStyle = th.line; g.fillRect(cx - bw / 2, top, bw, bot - top); g.globalAlpha = on ? 0.5 : 0.1;
      g.fillStyle = th.panel2; g.fillRect(cx - bw / 2, top, bw, bot - top);
      g.globalAlpha = on ? (active ? 1 : 0.45) : 0.18;
      const gr = g.createLinearGradient(0, mid, 0, y);
      gr.addColorStop(0, "transparent"); gr.addColorStop(1, th.accent);
      g.fillStyle = gr; g.fillRect(cx - bw / 2, Math.min(mid, y), bw, Math.abs(y - mid));
      if (active) BleepView.glow(g, th.accent, 16);
      g.strokeStyle = th.accent; g.lineWidth = active ? 3 : 1.5;
      g.beginPath(); g.moveTo(cx - bw / 2, y); g.lineTo(cx + bw / 2, y); g.stroke();
      g.shadowBlur = 0; g.globalAlpha = 1;
      g.fillStyle = active ? th.text : th.muted; g.fillText(String(k + 1), cx, h - 4);
      if (active) { g.fillStyle = th.accent; g.beginPath(); g.arc(cx, 8, 3.5, 0, 7); g.fill(); }
    }
    g.fillStyle = th.muted; g.textAlign = "right"; g.font = "10px system-ui, sans-serif";
    const rate = view.units("rate");
    g.fillText(`${len} steps · ${ORDERS[order] || ""}${sel ? ` · start +${sel}` : ""}${rate ? "" : " · step by trigger"} · drag a column to set its level`, w - pad, 11);
  }
  BleepViews.register("switch", {
    width: 690,
    template: '<div class="bv-panel"><h2>Slots</h2><canvas class="sw-cv"></canvas></div>',
    layout: [
      { title: "Sequence", params: ["length", "order", "rate", "select"] },
      { title: "Transition", params: ["mode", "fade", "curve", "idle"] },
      { title: "Random", params: ["seed"] },
    ],
    hideParams: ["level1", "level2", "level3", "level4", "level5", "level6", "level7", "level8"],  // the columns set them
    afterBuild(view, custom) {
      const cv = custom.querySelector("canvas");
      // Dragging a column sets that slot's level (the knobs are hidden).
      let slotDrag = -1;
      const geom = () => { const h = cv.clientHeight, top = 16, bot = h - 16; return { top, bot, mid: (top + bot) / 2, half: (bot - top) / 2, pad: 8, slot: (cv.clientWidth - 16) / 8 }; };
      const setFrom = (e) => {
        const r = cv.getBoundingClientRect(), G = geom();
        let v = (G.mid - (e.clientY - r.top)) / G.half;
        v = Math.max(-1, Math.min(1, Math.abs(v) < 0.04 ? 0 : v));
        view.api.setParam("level" + (slotDrag + 1), (v + 1) / 2);
      };
      cv.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const r = cv.getBoundingClientRect(), G = geom();
        slotDrag = Math.max(0, Math.min(7, Math.floor((e.clientX - r.left - G.pad) / G.slot)));
        cv.setPointerCapture(e.pointerId);
        if (view.api.beginGesture) view.api.beginGesture();
        setFrom(e);
      });
      cv.addEventListener("pointermove", (e) => { if (slotDrag >= 0) setFrom(e); });
      const end = () => { slotDrag = -1; };
      cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
      cv.addEventListener("dblclick", (e) => {
        const r = cv.getBoundingClientRect(), G = geom();
        const k = Math.max(0, Math.min(7, Math.floor((e.clientX - r.left - G.pad) / G.slot)));
        view.api.setParam("level" + (k + 1), 1);
      });
      BleepView.loop(view.root, (t) => draw(view, cv, t));
    },
    onState(st, view) { view._st = st; },
  });
})();
