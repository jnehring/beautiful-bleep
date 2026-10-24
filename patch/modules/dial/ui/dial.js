// SPDX-License-Identifier: GPL-3.0-only
// Dial view (doc/specs/modules/dial.md §5): one big dial for Value, with its
// detents, the modulation ring and the output in the range's units.
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const START = -135, END = 135, C = 60;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const angle = (v) => START + (END - START) * v;
  const polar = (r, deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  };
  function arc(r, from, to) {
    if (to < from) [from, to] = [to, from];
    if (to - from < 0.5) to = from + 0.5;
    const [x1, y1] = polar(r, from), [x2, y2] = polar(r, to);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  }
  const svg = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  function param(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    return { p, v: view.node.params[id] ?? p.default };
  }
  const units = (view, id) => { const { p, v } = param(view, id); return p.min + v * (p.max - p.min); };
  const stepsOf = (view) => Math.round(units(view, "steps"));
  const snap = (v, steps) => (steps >= 2 ? Math.round(v * (steps - 1)) / (steps - 1) : v);

  function draw(view) {
    const d = view.dial;
    if (!d) return;
    const v = param(view, "value").v, steps = stepsOf(view);
    const shown = snap(v, steps);
    d.arc.setAttribute("d", arc(46, START, angle(shown)));
    const [x1, y1] = polar(20, angle(shown)), [x2, y2] = polar(40, angle(shown));
    d.pointer.setAttribute("x1", x1); d.pointer.setAttribute("y1", y1);
    d.pointer.setAttribute("x2", x2); d.pointer.setAttribute("y2", y2);
    const eff = d.eff;
    d.ring.setAttribute("opacity", eff === null ? 0 : 1);
    if (eff !== null) d.ring.setAttribute("d", arc(53, angle(shown), angle(snap(eff, steps))));
    // Detents
    if (d.stepsDrawn !== steps) {
      d.stepsDrawn = steps;
      d.ticks.innerHTML = "";
      for (let i = 0; steps >= 2 && i < steps; i++) {
        const a = angle(i / (steps - 1));
        const [a1, b1] = polar(51, a), [a2, b2] = polar(56, a);
        d.ticks.appendChild(svg("line", { x1: a1, y1: b1, x2: a2, y2: b2, class: "dl-tick" }));
      }
    }
    // Output in the range's units (before smoothing).
    const out = units(view, "min") + (units(view, "max") - units(view, "min")) * snap(eff ?? v, steps);
    const fmt = (x) => (x >= 0 ? "" : "−") + Math.abs(x).toFixed(2);
    d.lo.textContent = fmt(units(view, "min"));
    d.hi.textContent = fmt(units(view, "max"));
    d.out.textContent = (out >= 0 ? "+" : "−") + Math.abs(out).toFixed(2);
  }

  BleepViews.register("dial", {
    width: 450,
    partNames: ["Dial"],
    side: true,
    hideParams: ["value"],
    layout: [
      { title: "Range", params: ["min", "max"] },
      { title: "Feel", params: ["steps", "smooth"] },
    ],
    template:
      "<style>" +
      ".dl{display:flex;flex-direction:column;align-items:center;gap:2px;flex:1 1 100%}" +
      ".dl svg{width:210px;height:210px;filter:drop-shadow(0 0 6px color-mix(in srgb,var(--accent) 60%,transparent));cursor:ns-resize;touch-action:none}" +
      ".dl .dl-track{stroke:var(--line);fill:none;stroke-width:7;stroke-linecap:round}" +
      ".dl .dl-arc{stroke:var(--accent);fill:none;stroke-width:7;stroke-linecap:round}" +
      ".dl .dl-ring{stroke:var(--mod);fill:none;stroke-width:4;stroke-linecap:round}" +
      ".dl .dl-cap{fill:var(--panel-3);stroke:var(--line)}" +
      ".dl .dl-pointer{stroke:var(--text);stroke-width:4;stroke-linecap:round}" +
      ".dl .dl-tick{stroke:var(--muted);stroke-width:1.5}" +
      ".dl-out{font-size:28px;font-variant-numeric:tabular-nums}" +
      ".dl-hint{font-size:10px;color:var(--muted)}" +
      ".dl .dl-end{fill:var(--muted);font-size:8px;text-anchor:middle;font-variant-numeric:tabular-nums}" +
      "</style>" +
      '<div class="dl"><div class="dl-out"></div><div class="dl-hint">drag · wheel · double-click resets</div></div>',
    afterBuild(view, el) {
      const box = el.querySelector(".dl");
      const s = svg("svg", { viewBox: "0 0 120 120" });
      const ticks = svg("g", {});
      const track = svg("path", { class: "dl-track", d: arc(46, START, END) });
      const a = svg("path", { class: "dl-arc" });
      const ring = svg("path", { class: "dl-ring", opacity: 0 });
      const cap = svg("circle", { class: "dl-cap", cx: C, cy: C, r: 38 });
      const pointer = svg("line", { class: "dl-pointer" });
      const lo = svg("text", { class: "dl-end", x: 22, y: 112 }), hi = svg("text", { class: "dl-end", x: 98, y: 112 });
      s.append(ticks, track, a, ring, cap, pointer, lo, hi);
      box.insertBefore(s, box.firstChild);
      view.dial = { lo, hi, arc: a, ring, pointer, ticks, out: box.querySelector(".dl-out"), eff: null, stepsDrawn: -1 };
      // The small Value knob would repeat the dial; cables into Value still show on the board.
      const small = view.knobs.get("value");
      if (small) small.box.style.display = "none";

      const set = (v) => {
        v = clamp01(v);
        view.node.params.value = v;
        view.api.setParam("value", v);
        draw(view);
      };
      let startY = 0, startV = 0, dragging = false;
      s.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        s.setPointerCapture(e.pointerId);
        startY = e.clientY;
        startV = param(view, "value").v;
        dragging = true;
        view.api.beginGesture();
      });
      s.addEventListener("pointermove", (e) => {
        if (dragging) set(startV + (startY - e.clientY) / (e.shiftKey ? 1200 : 240));
      });
      const end = () => (dragging = false);
      s.addEventListener("pointerup", end);
      s.addEventListener("pointercancel", end);
      s.addEventListener("dblclick", () => { view.api.beginGesture(); set(param(view, "value").p.default); });
      s.addEventListener("wheel", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const steps = stepsOf(view), v = param(view, "value").v;
        // With detents, one wheel notch is one step.
        if (steps >= 2) set(snap(v, steps) + Math.sign(-e.deltaY) / (steps - 1));
        else set(v - e.deltaY / (e.shiftKey ? 3000 : 600));
      }, { passive: false });
      view.dial.dragging = () => dragging;
      draw(view);
    },
    onState(st, view) {
      const ps = st && st.params && st.params.value;
      if (ps && view.dial && !view.dial.dragging()) view.node.params.value = ps.v;
      if (view.dial) view.dial.eff = ps && ps.a ? ps.e : null;
      draw(view);
    },
    onRefresh: draw,
  });
})();
