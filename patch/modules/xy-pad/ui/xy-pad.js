// SPDX-License-Identifier: GPL-3.0-only
// XY Pad view (doc/specs/modules/xy-pad.md §5): a square pad with a point; drag
// to move X and Y together.
(function () {
  "use strict";
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  function param(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    return { p, v: view.node.params[id] ?? p.default };
  }
  const units = (view, id) => { const { p, v } = param(view, id); return p.min + v * (p.max - p.min); };
  const fmt = (x) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(2);

  function draw(view) {
    const d = view.xy;
    if (!d) return;
    const x = param(view, "x").v, y = param(view, "y").v;
    d.dot.style.left = x * 100 + "%";
    d.dot.style.bottom = y * 100 + "%";
    const lo = units(view, "min"), hi = units(view, "max");
    d.out.textContent = `X ${fmt(lo + (hi - lo) * (d.eff.x ?? x))}   Y ${fmt(lo + (hi - lo) * (d.eff.y ?? y))}`;
  }

  BleepViews.register("xy-pad", {
    width: 420,
    partNames: ["Pad"],
    side: true,
    hideParams: ["x", "y"],
    layout: [
      { title: "Range", params: ["min", "max"] },
      { title: "Feel", params: ["smooth"] },
    ],
    template:
      "<style>" +
      ".xp{display:flex;flex-direction:column;align-items:center;gap:6px;flex:1 1 100%}" +
      ".xp-out{font-size:18px;font-variant-numeric:tabular-nums;white-space:pre}" +
      ".xp-hint{font-size:10px;color:var(--muted)}" +
      ".xp-pad{position:relative;width:210px;height:210px;border-radius:12px;border:2px solid var(--line);background:" +
      "linear-gradient(var(--line),var(--line)) 50% 0/1px 100% no-repeat,linear-gradient(var(--line),var(--line)) 0 50%/100% 1px no-repeat,var(--panel-2);cursor:crosshair;touch-action:none}" +
      ".xp-dot{position:absolute;width:20px;height:20px;margin:0 0 -10px -10px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent);pointer-events:none}" +
      "</style>" +
      '<div class="xp"><div class="xp-out"></div><div class="xp-pad"><div class="xp-dot"></div></div><div class="xp-hint">drag · double-click centres</div></div>',
    afterBuild(view, el) {
      const pad = el.querySelector(".xp-pad");
      view.xy = { dot: el.querySelector(".xp-dot"), out: el.querySelector(".xp-out"), eff: {}, dragging: false };
      for (const id of ["x", "y"]) { const small = view.knobs.get(id); if (small) small.box.style.display = "none"; }
      const set = (x, y) => {
        x = clamp01(x); y = clamp01(y);
        view.node.params.x = x; view.node.params.y = y;
        view.api.setParam("x", x);
        view.api.setParam("y", y);
        draw(view);
      };
      const at = (e) => {
        const r = pad.getBoundingClientRect();
        set((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height);
      };
      pad.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        pad.setPointerCapture(e.pointerId);
        view.xy.dragging = true;
        view.api.beginGesture();
        at(e);
      });
      pad.addEventListener("pointermove", (e) => { if (view.xy.dragging) at(e); });
      const end = () => { view.xy.dragging = false; };
      pad.addEventListener("pointerup", end);
      pad.addEventListener("pointercancel", end);
      pad.addEventListener("dblclick", () => { view.api.beginGesture(); set(param(view, "x").p.default, param(view, "y").p.default); });
      draw(view);
    },
    onState(st, view) {
      const d = view.xy;
      if (!d) return;
      for (const id of ["x", "y"]) {
        const ps = st && st.params && st.params[id];
        if (ps && !d.dragging) view.node.params[id] = ps.v;
        d.eff[id] = ps && ps.a ? ps.e : null;
      }
      draw(view);
    },
    onRefresh: draw,
  });
})();
