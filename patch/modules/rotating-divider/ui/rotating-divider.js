// SPDX-License-Identifier: MIT
// Rotating Div view (doc/specs/modules/rotating-divider.md §5): the division
// ring (eight spokes with their division and a gate lamp; a pending rotation
// shows as a ghost label), dragged round to rotate (one undo step); with Set
// = Custom, clicking a label edits that division. Below, the next 32 base
// steps of all eight outputs.
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const R = 62, C = 80, STEPS = 32;
  const SETS = {
    0: (n) => n + 1,
    1: (n) => 2 * n + 1,
    2: (n) => 2 * n + 2,
    3: (n) => [1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83][Math.min(n, 23)],
    4: (n) => Math.min(4096, 2 ** n),
    5: (n) => { let a = 1, b = 2; for (let i = 0; i < n && a < 4096; i++) [a, b] = [b, a + b]; return Math.min(a, 4096); },
  };
  const svg = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  function setting(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    const v = view.node.params[id] ?? p.default;
    return Math.round(p.min + v * (p.max - p.min));
  }
  function custom(view) {
    const d = view.node.data;
    const c = d && Array.isArray(d.custom) ? d.custom.slice(0, 8) : [];
    while (c.length < 8) c.push(c.length + 1);
    return c;
  }
  /// The divisions the settings ask for (as RotatingDividerDsp::rdDivisions).
  function divisions(view, rotate) {
    const set = setting(view, "set"), extend = setting(view, "rotatemode") === 1, r = Math.max(0, Math.min(16, rotate));
    const cu = custom(view);
    return [...Array(8).keys()].map((k) => {
      if (set === 6) return cu[(k + r) % 8];
      return SETS[set](extend ? k + r : (k + r) % 8);
    });
  }

  function draw(view) {
    const v = view.rd;
    if (!v) return;
    const st = v.state || {}, arr = st.arrays || {};
    const rot = setting(view, "rotate");
    const div = arr.div ? arr.div.map(Math.round) : divisions(view, rot);
    const next = arr.next ? arr.next.map(Math.round) : div;
    const gates = arr.gates || [];
    for (let k = 0; k < 8; k++) {
      v.labels[k].textContent = "/" + div[k];
      v.ghosts[k].textContent = next[k] !== div[k] ? "→/" + next[k] : "";
      v.lamps[k].setAttribute("class", "rd-lamp" + (gates[k] > 0.5 ? " on" : ""));
    }
    v.info.textContent = `Rotate ${rot}` + (st.pending ? " · pending" : "");
    v.custom.hidden = setting(view, "set") !== 6;
    if (!v.custom.hidden) custom(view).forEach((x, i) => { if (document.activeElement !== v.fields[i]) v.fields[i].value = x; });
    // Strip: the next 32 base steps.
    const c = v.strip;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth || 300, h = 8 * 8 + 2;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const step = Math.max(0, Math.round(st.step || 0)), cw = w / STEPS;
    for (let k = 0; k < 8; k++)
      for (let s = 0; s < STEPS; s++) {
        const n = step + s, d = s === 0 ? div[k] : next[k];
        g.fillStyle = n % d === 0 ? css.getPropertyValue("--accent") : css.getPropertyValue("--line");
        g.fillRect(s * cw + 1, k * 8 + 1, Math.max(1, cw - 2), 6);
      }
  }

  BleepViews.register("rotating-divider", {
    top: true,
    width: 360,
    template: `<div class="bv-panel rd-panel"><svg class="rd-ring" viewBox="0 0 160 160"></svg>
      <div class="rd-info"></div><div class="rd-custom" hidden></div><canvas class="rd-strip" style="width:100%;height:66px"></canvas></div>`,
    afterBuild(view, el) {
      if (!document.getElementById("rd-style")) {
        const s = document.createElement("style");
        s.id = "rd-style";
        s.textContent = `
          .rd-ring { width: 160px; height: 160px; display: block; margin: 0 auto; cursor: grab; touch-action: none; }
          .rd-ring text { fill: var(--text); font-size: 11px; text-anchor: middle; dominant-baseline: middle; user-select: none; }
          .rd-ring text.ghost { fill: var(--muted); font-size: 8px; }
          .rd-ring line { stroke: var(--line); stroke-width: 1.5; }
          .rd-lamp { fill: var(--panel-3, #2d323d); stroke: var(--line); }
          .rd-lamp.on { fill: var(--accent); }
          .rd-info { text-align: center; color: var(--muted); font-size: 11px; margin: 2px 0 6px; }
          .rd-custom { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; margin-bottom: 6px; }
          .rd-custom input { width: 100%; box-sizing: border-box; }`;
        document.head.appendChild(s);
      }
      const ring = el.querySelector(".rd-ring");
      ring.appendChild(svg("circle", { cx: C, cy: C, r: 10, class: "rd-lamp" }));
      const labels = [], ghosts = [], lamps = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * 2 * Math.PI - Math.PI / 2, cos = Math.cos(a), sin = Math.sin(a);
        ring.appendChild(svg("line", { x1: C + 14 * cos, y1: C + 14 * sin, x2: C + (R - 22) * cos, y2: C + (R - 22) * sin }));
        const lamp = svg("circle", { cx: C + (R - 16) * cos, cy: C + (R - 16) * sin, r: 4, class: "rd-lamp" });
        const label = svg("text", { x: C + R * cos, y: C + R * sin });
        const ghost = svg("text", { x: C + R * cos, y: C + R * sin + 11, class: "ghost" });
        label.addEventListener("click", (e) => {  // Custom: edit the value at this spoke
          if (setting(view, "set") !== 6 || view.rd.dragged) return;
          e.stopPropagation();
          const field = view.rd.fields[(k + setting(view, "rotate")) % 8];
          field.focus();
          field.select();
        });
        ring.append(lamp, label, ghost);
        labels.push(label);
        ghosts.push(ghost);
        lamps.push(lamp);
      }
      // Drag round the ring: one step per 45°.
      let drag = null;
      const angle = (e) => {
        const r = ring.getBoundingClientRect();
        return Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2);
      };
      ring.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        ring.setPointerCapture(e.pointerId);
        drag = { a0: angle(e), r0: setting(view, "rotate"), began: false };
        view.rd.dragged = false;
      });
      ring.addEventListener("pointermove", (e) => {
        if (!drag) return;
        let d = angle(e) - drag.a0;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const r = Math.max(0, Math.min(16, drag.r0 - Math.round(d / (Math.PI / 4))));
        if (r !== setting(view, "rotate")) {
          if (!drag.began) { view.api.beginGesture(); drag.began = true; }
          view.rd.dragged = true;
          view.node.params.rotate = r / 16;
          view.api.setParam("rotate", r / 16);
          draw(view);
        }
      });
      const end = () => { drag = null; setTimeout(() => view.rd && (view.rd.dragged = false), 0); };
      ring.addEventListener("pointerup", end);
      ring.addEventListener("pointercancel", end);
      // Custom set: eight number fields (series order, before rotation).
      const box = el.querySelector(".rd-custom");
      const fields = [...Array(8).keys()].map((i) => {
        const f = Object.assign(document.createElement("input"), { type: "number", min: 1, max: 64, className: "bv-number" });
        f.addEventListener("change", () => {
          const c = custom(view);
          c[i] = Math.max(1, Math.min(64, Math.round(parseFloat(f.value) || 1)));
          view.api.beginGesture();
          view.node.data = { ...(view.node.data || {}), custom: c };
          view.api.setData({ custom: c });
          draw(view);
        });
        box.appendChild(f);
        return f;
      });
      view.rd = { labels, ghosts, lamps, fields, custom: box, info: el.querySelector(".rd-info"), strip: el.querySelector(".rd-strip"), state: null };
      requestAnimationFrame(() => draw(view));
    },
    onState(st, view) {
      if (!view.rd) return;
      view.rd.state = st;
      draw(view);
    },
    onRefresh(view) { draw(view); },
  });
})();
