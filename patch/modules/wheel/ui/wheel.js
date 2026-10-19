// SPDX-License-Identifier: GPL-3.0-or-later
// Wheel view (doc/specs/modules/wheel.md §5): a vertical wheel for Value. Drag
// it up and down; with Spring on it returns to the middle when let go.
(function () {
  "use strict";
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  function param(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    return { p, v: view.node.params[id] ?? p.default };
  }
  const units = (view, id) => { const { p, v } = param(view, id); return p.min + v * (p.max - p.min); };
  const spring = (view) => param(view, "spring").v >= 0.5;

  function draw(view) {
    const w = view.wheel;
    if (!w) return;
    const v = param(view, "value").v;
    w.cap.style.bottom = `calc(8px + (100% - 16px - 28px) * ${v})`;
    w.fill.style.height = `${v * 100}%`;
    const eff = w.eff === null ? v : w.eff;
    const out = units(view, "min") + (units(view, "max") - units(view, "min")) * eff;
    w.out.textContent = (out >= 0 ? "+" : "−") + Math.abs(out).toFixed(2);
    w.ring.style.display = w.eff === null ? "none" : "block";
    w.ring.style.bottom = `calc(8px + (100% - 16px - 28px) * ${eff} + 12px)`;
  }

  BleepViews.register("wheel", {
    partNames: ["Wheel"],
    side: true,
    hideParams: ["value"],
    layout: [
      { title: "Range", params: ["min", "max"] },
      { title: "Feel", params: ["smooth", "spring"] },
    ],
    template:
      "<style>" +
      ".wh{display:flex;flex-direction:column;align-items:center;gap:6px;flex:1 1 100%}" +
      ".wh-out{font-size:28px;font-variant-numeric:tabular-nums}" +
      ".wh-hint{font-size:10px;color:var(--muted)}" +
      ".wh-track{position:relative;width:76px;height:210px;border-radius:12px;border:2px solid var(--line);background:var(--panel-2);cursor:ns-resize;touch-action:none;overflow:hidden}" +
      ".wh-fill{position:absolute;left:0;right:0;bottom:0;background:color-mix(in srgb,var(--accent) 35%,transparent)}" +
      ".wh-mid{position:absolute;left:0;right:0;top:50%;height:1px;background:var(--muted);opacity:.5}" +
      ".wh-cap{position:absolute;left:4px;right:4px;height:28px;border-radius:8px;background:repeating-linear-gradient(var(--panel-3) 0 3px,var(--line) 3px 4px);border:1px solid var(--muted)}" +
      ".wh-ring{position:absolute;left:0;right:0;height:3px;background:var(--mod);display:none}" +
      "</style>" +
      '<div class="wh"><div class="wh-out"></div><div class="wh-track"><div class="wh-fill"></div><div class="wh-mid"></div><div class="wh-ring"></div><div class="wh-cap"></div></div><div class="wh-hint">drag · double-click resets</div></div>',
    afterBuild(view, el) {
      const track = el.querySelector(".wh-track");
      view.wheel = { cap: el.querySelector(".wh-cap"), fill: el.querySelector(".wh-fill"), ring: el.querySelector(".wh-ring"),
                     out: el.querySelector(".wh-out"), eff: null, dragging: false };
      const small = view.knobs.get("value");
      if (small) small.box.style.display = "none";
      const set = (v) => {
        v = clamp01(v);
        view.node.params.value = v;
        view.api.setParam("value", v);
        draw(view);
      };
      const at = (e) => {
        const r = track.getBoundingClientRect();
        set(1 - (e.clientY - r.top - 14) / Math.max(1, r.height - 28));
      };
      track.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        track.setPointerCapture(e.pointerId);
        view.wheel.dragging = true;
        view.api.beginGesture();
        at(e);
      });
      track.addEventListener("pointermove", (e) => { if (view.wheel.dragging) at(e); });
      const end = () => {
        if (!view.wheel.dragging) return;
        view.wheel.dragging = false;
        if (spring(view)) set(param(view, "value").p.default);
      };
      track.addEventListener("pointerup", end);
      track.addEventListener("pointercancel", end);
      track.addEventListener("dblclick", () => { view.api.beginGesture(); set(param(view, "value").p.default); });
      draw(view);
    },
    onState(st, view) {
      const ps = st && st.params && st.params.value;
      if (ps && view.wheel && !view.wheel.dragging) view.node.params.value = ps.v;
      if (view.wheel) view.wheel.eff = ps && ps.a ? ps.e : null;
      draw(view);
    },
    onRefresh: draw,
  });
})();
