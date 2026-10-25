// SPDX-License-Identifier: GPL-3.0-only
// Shape Sequencer view (doc/specs/modules/shape-sequencer.md §5): the loop as a row
// of slots. A shape from the palette is painted into slots; the selected slot
// shows handles: a yellow square for each level (start/end; a plateau has one,
// a pulse one per half) and a white dot that bends the curve. The slots live in
// the node data; length, grid, sync and the output stage are the knobs.
(function () {
  "use strict";
  const MAX = 32;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const BARS = [0.25, 0.5, 1, 2, 4, 8], PER_BAR = [1, 2, 4, 8, 16, 32];
  const TOP = 12, BOTTOM = 16;
  const NAMES = { empty: "Empty", ramp: "Ramp", curve: "Curve", tri: "Triangle", plat: "Plateau", pulse: "Pulse" };
  // [palette name, type, start, end, curve]
  const SHAPES = [["Saw up", "ramp", 0, 1, 0], ["Saw down", "ramp", 1, 0, 0], ["Plateau", "plat", 0.6, 0.6, 0],
    ["Curve", "curve", 0, 1, 0.4], ["Triangle", "tri", 0, 1, 0], ["Pulse", "pulse", 1, 0, 0]];
  const hasBend = (s) => s.t === "ramp" || s.t === "curve" || s.t === "tri";

  /// The shape at t (0…1) inside a slot: ShapeSequencerDsp.h shapeValue.
  function shapeValue(s, t) {
    t = clamp(t, 0, 1);
    const p = Math.pow(2, 2 * s.c);
    let x;
    switch (s.t) {
      case "ramp": x = Math.pow(t, p); break;
      case "curve": { const u = Math.pow(t, p), v = Math.pow(1 - t, p); x = u / (u + v); break; }
      case "tri": x = Math.pow(1 - Math.abs(2 * t - 1), p); break;
      case "plat": return s.a;
      case "pulse": return t < 0.5 ? s.a : s.b;
      default: return 0;
    }
    return s.a + (s.b - s.a) * x;
  }
  const baseOf = { ramp: (t) => t, curve: (t) => t, tri: (t) => 1 - Math.abs(2 * t - 1) };

  // ---- model ---------------------------------------------------------------------------------
  function units(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round(p.min + (view.node.params[id] ?? p.default) * (p.max - p.min));
  }
  const slotCount = (view) => clamp(Math.round(BARS[units(view, "length")] * PER_BAR[units(view, "grid")]), 1, MAX);
  function data(view) {
    let d = view.node.data;
    if (!d || !Array.isArray(d.slots)) {
      d = view.node.data = { slots: [] };
      d.slots.push({ t: "ramp", a: 0, b: 1, c: 0 }, { t: "plat", a: 0.6, b: 0.6, c: 0 },
        { t: "ramp", a: 1, b: 0, c: 0.5 }, { t: "curve", a: 0, b: 1, c: 0.4 });
    }
    while (d.slots.length < MAX) d.slots.push({ t: "empty", a: 0, b: 0, c: 0 });
    return d;
  }
  function send(view) { view.api.setData(JSON.parse(JSON.stringify(data(view)))); }
  const fromShape = (sh) => ({ t: sh[1], a: sh[2], b: sh[3], c: sh[4] });

  // ---- drawing -------------------------------------------------------------------------------
  function draw(view) {
    const sq = view.sq, c = sq.canvas;
    if (!c || !c.clientWidth) return;
    const { g, w, h } = BleepView.fit(c);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim() || "#5eead4";
    const line = css.getPropertyValue("--line"), text = css.getPropertyValue("--text"), muted = css.getPropertyValue("--muted");
    const mod = css.getPropertyValue("--mod").trim() || "#f6c35b";
    const n = slotCount(view), sw = w / n, slots = data(view).slots;
    const top = TOP, bottom = h - BOTTOM, Y = (v) => top + (1 - v) * (bottom - top);
    sq.sel = clamp(sq.sel, 0, n - 1);
    sq.geo = { n, sw, w, h, Y, top, bottom };
    // Cells, with the selected one lit.
    for (let i = 0; i < n; i++) {
      g.fillStyle = i === sq.sel ? accent : line;
      g.globalAlpha = i === sq.sel ? 0.14 : i % 2 ? 0.1 : 0.04;
      g.fillRect(i * sw, 0, sw, h);
    }
    g.globalAlpha = 1;
    g.strokeStyle = line;
    g.lineWidth = 1;
    g.beginPath();
    for (let k = 0; k <= 4; k++) { const y = Math.round(Y(k / 4)) + 0.5; g.moveTo(0, y); g.lineTo(w, y); }
    for (let i = 1; i < n; i++) { const x = Math.round(i * sw) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); }
    g.stroke();
    // The shapes.
    const trace = (s, i) => {
      const steps = Math.max(2, Math.round(sw));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, x = i * sw + t * sw, y = Y(shapeValue(s, t));
        if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
    };
    slots.slice(0, n).forEach((s, i) => {
      if (s.t === "empty") {
        if (sw > 44) { g.fillStyle = muted; g.font = "10px system-ui, sans-serif"; g.textAlign = "center"; g.fillText("empty", i * sw + sw / 2, Y(0.5)); }
        return;
      }
      g.beginPath();
      trace(s, i);
      g.lineTo((i + 1) * sw, Y(0)); g.lineTo(i * sw, Y(0)); g.closePath();
      g.fillStyle = accent; g.globalAlpha = i === sq.sel ? 0.28 : 0.14; g.fill(); g.globalAlpha = 1;
      g.beginPath();
      trace(s, i);
      g.strokeStyle = accent; g.lineWidth = i === sq.sel ? 2.6 : 1.8; g.lineJoin = "round"; g.stroke();
    });
    // Slot numbers.
    g.fillStyle = muted; g.font = "9px system-ui, sans-serif"; g.textAlign = "left";
    if (sw > 22) for (let i = 0; i < n; i++) g.fillText(String(i + 1), i * sw + 4, h - 4);
    // The selected slot's handles.
    sq.handles = [];
    const s = slots[sq.sel], x0 = sq.sel * sw, x1 = x0 + sw, ins = Math.min(9, sw / 6);
    if (s && s.t !== "empty") {
      const hs = [];
      if (s.t === "plat") hs.push(["ab", (x0 + x1) / 2, Y(s.a)]);
      else if (s.t === "pulse") hs.push(["a", x0 + sw * 0.25, Y(s.a)], ["b", x0 + sw * 0.75, Y(s.b)]);
      else if (s.t === "tri") hs.push(["a", x0 + ins, Y(s.a)], ["b", (x0 + x1) / 2, Y(s.b)]);
      else hs.push(["a", x0 + ins, Y(s.a)], ["b", x1 - ins, Y(s.b)]);
      for (const [k, x, y] of hs) {
        sq.handles.push({ k, x, y });
        g.fillStyle = css.getPropertyValue("--panel") || "#15171c"; g.strokeStyle = mod; g.lineWidth = 2;
        g.fillRect(x - 5, y - 5, 10, 10); g.strokeRect(x - 5, y - 5, 10, 10);
      }
      if (hasBend(s)) {
        const tm = s.t === "ramp" ? 0.5 : 0.25, x = x0 + tm * sw, y = Y(shapeValue(s, tm));
        sq.handles.push({ k: "c", x, y, tm });
        g.fillStyle = css.getPropertyValue("--panel") || "#15171c"; g.strokeStyle = text; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    }
    // The playhead.
    const st = sq.state;
    if (st && st.active > 0.5) {
      const x = clamp(st.phase, 0, 1) * w;
      g.strokeStyle = text; g.globalAlpha = 0.85; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); g.globalAlpha = 1;
    }
  }

  // ---- editing -------------------------------------------------------------------------------
  function attach(view) {
    const sq = view.sq, c = sq.canvas;
    let drag = null;
    const at = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const slotAt = (x) => clamp(Math.floor(x / sq.geo.sw), 0, sq.geo.n - 1);
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !sq.geo) return;
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      const p = at(e);
      view.api.beginGesture();
      const hit = sq.handles.find((hd) => Math.hypot(p.x - hd.x, p.y - hd.y) < 10);
      if (hit) {
        const s = data(view).slots[sq.sel];
        drag = { k: hit.k, y: p.y, a: s.a, b: s.b, c: s.c, tm: hit.tm, mid: shapeValue(s, hit.tm || 0.5) };
        return;
      }
      const i = slotAt(p.x), d = data(view);
      if (sq.tool === "erase") d.slots[i] = { t: "empty", a: 0, b: 0, c: 0 };
      else if (sq.tool !== "select") d.slots[i] = fromShape(SHAPES.find((s) => s[1] + s[0] === sq.tool) || SHAPES[0]);
      sq.sel = i;
      send(view);
      updateInspector(view);
      draw(view);
    });
    c.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const p = at(e), s = data(view).slots[sq.sel], span = sq.geo.bottom - sq.geo.top;
      const dy = (p.y - drag.y) / span;
      if (drag.k === "ab") s.a = s.b = clamp(drag.a - dy, 0, 1);
      else if (drag.k === "a") s.a = clamp(drag.a - dy, 0, 1);
      else if (drag.k === "b") s.b = clamp(drag.b - dy, 0, 1);
      else if (s.t === "curve") s.c = clamp(drag.c - dy * 2.5, -1, 1);
      else {  // move the dot: solve the exponent that puts the shape through it
        const q = (drag.mid - dy - s.a) / (s.b - s.a || 1e-6);
        if (q > 0.02 && q < 0.98) s.c = clamp(Math.log2(Math.log(q) / Math.log(baseOf[s.t](drag.tm))) / 2, -1, 1);
      }
      send(view);
      updateInspector(view);
      draw(view);
    });
    const end = () => { drag = null; };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  function updateInspector(view) {
    const sq = view.sq, n = slotCount(view), s = data(view).slots[clamp(sq.sel, 0, n - 1)];
    const e = s.t === "empty", pct = (v) => Math.round(v * 100) + "%";
    sq.info.textContent = "Slot " + (sq.sel + 1) + " of " + n + " · " + NAMES[s.t] +
      (e ? "" : " · " + (s.t === "plat" ? pct(s.a) : pct(s.a) + " → " + pct(s.b)) +
        (hasBend(s) || s.t === "curve" ? " · curve " + (s.c >= 0 ? "+" : "") + Math.round(s.c * 100) : ""));
  }

  function shapeIcon(sh) {
    const s = fromShape(sh);
    let d = "";
    for (let i = 0; i <= 24; i++) d += (i ? "L" : "M") + (3 + (i / 24) * 34).toFixed(1) + " " + (19 - shapeValue(s, i / 24) * 16).toFixed(1);
    return '<svg viewBox="0 0 40 22" width="40" height="22"><path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }

  BleepViews.register("shape-sequencer", {
    top: true,
    width: 560,
    layout: [
      { title: "Timing", params: ["length", "grid", "sync", "playback", "rate"] },
      { title: "Output", params: ["polarity", "depth", "offset", "slew"] },
    ],
    template: '<div class="bv-panel">' +
      '<div class="sq-pal" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px"></div>' +
      '<canvas class="sq-canvas" style="height:170px;width:100%;touch-action:none"></canvas>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:6px">' +
      '<div class="sq-info bv-label" style="flex:1 1 auto"></div><div class="sq-btns" style="display:flex;gap:4px"></div></div></div>',
    afterBuild(view, el) {
      const sq = (view.sq = { canvas: el.querySelector(".sq-canvas"), sel: 0, tool: "select", state: null, handles: [] });
      sq.info = el.querySelector(".sq-info");
      const pal = el.querySelector(".sq-pal"), buttons = [];
      const tool = (key, label, icon) => {
        const b = document.createElement("button");
        b.className = "bv-toggle";
        b.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:1px;padding:3px 6px;font-size:10px";
        b.innerHTML = (icon || "") + "<span>" + label + "</span>";
        b.addEventListener("click", () => { sq.tool = key; buttons.forEach(([k, x]) => x.classList.toggle("on", k === key)); });
        buttons.push([key, b]);
        pal.appendChild(b);
        return b;
      };
      tool("select", "Select", '<svg viewBox="0 0 40 22" width="40" height="22"><path d="M15 3 L15 19 L19 15 L22 21 L25 20 L22 14 L28 14Z" fill="currentColor"/></svg>').classList.add("on");
      for (const sh of SHAPES) tool(sh[1] + sh[0], sh[0], shapeIcon(sh));
      tool("erase", "Erase", '<svg viewBox="0 0 40 22" width="40" height="22"><path d="M13 4 L27 18 M27 4 L13 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>');
      // Flip swaps start and end; Reset shape clears the curve.
      const btns = el.querySelector(".sq-btns");
      const act = (label, title, fn) => {
        const b = document.createElement("button");
        b.className = "bv-toggle";
        b.textContent = label;
        b.title = title;
        b.addEventListener("click", () => {
          const s = data(view).slots[sq.sel];
          if (s.t === "empty") return;
          view.api.beginGesture();
          fn(s);
          send(view);
          updateInspector(view);
          draw(view);
        });
        btns.appendChild(b);
      };
      act("Flip", "Swap start and end", (s) => { [s.a, s.b] = [s.b, s.a]; });
      act("Reset shape", "Straight curve", (s) => { s.c = 0; if (s.t === "plat") s.a = s.b = 0.6; });
      attach(view);
      updateInspector(view);
    },
    onState(st, view) {
      if (!view.sq) return;
      view.sq.state = st;
      updateInspector(view);
      draw(view);
    },
    onRefresh(view) {
      if (!view.sq) return;
      updateInspector(view);
      draw(view);
    },
  });
})();
