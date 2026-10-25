// SPDX-License-Identifier: GPL-3.0-only
// Shape Sequencer view (doc/specs/modules/shape-sequencer.md §5): the loop as a row
// of steps. A shape from the palette is painted onto steps (it cuts what was there);
// the selected shape shows handles: a yellow square for each level (start/end; a
// plateau has one, a pulse one per half) and a white dot that bends the curve. The
// shapes (position, length) live in the node data and keep their place when the
// step count changes; length, steps, sync and the output stage are the knobs.
(function () {
  "use strict";
  const MAX = 64;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const EPS = 1e-4;
  const TOP = 12, BOTTOM = 16;
  const NAMES = { ramp: "Ramp", curve: "Curve", tri: "Triangle", plat: "Plateau", pulse: "Pulse" };
  // [palette name, type, start, end, curve]
  const SHAPES = [["Saw up", "ramp", 0, 1, 0], ["Saw down", "ramp", 1, 0, 0], ["Plateau", "plat", 0.6, 0.6, 0],
    ["Curve", "curve", 0, 1, 0.4], ["Triangle", "tri", 0, 1, 0], ["Pulse", "pulse", 1, 0, 0]];
  const hasBend = (s) => s.t === "ramp" || s.t === "curve" || s.t === "tri";

  /// The shape at t (0…1) inside its span: ShapeSequencerDsp.h shapeValue.
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
  const lengthBeats = (view) => clamp(units(view, "length"), 1, 64);
  const stepCount = (view) => clamp(units(view, "steps"), 1, 32);
  /// One step of the editing grid, in quarter notes.
  const cell = (view) => lengthBeats(view) / stepCount(view);
  /// The shapes: sorted by start, without overlaps (the engine sanitises the same way).
  function data(view) {
    let d = view.node.data;
    if (!d || !Array.isArray(d.shapes)) {
      d = view.node.data = { shapes: [
        { t: "ramp", s: 0, n: 1, a: 0, b: 1, c: 0 }, { t: "plat", s: 1, n: 1, a: 0.6, b: 0.6, c: 0 },
        { t: "ramp", s: 2, n: 1, a: 1, b: 0, c: 0.5 }, { t: "curve", s: 3, n: 1, a: 0, b: 1, c: 0.4 }] };
    }
    return d;
  }
  function send(view) { view.api.setData(JSON.parse(JSON.stringify(data(view)))); }
  const fromShape = (sh, start, len) => ({ t: sh[1], s: start, n: len, a: sh[2], b: sh[3], c: sh[4] });
  const round = (v) => Math.round(v * 1e6) / 1e6;

  /// Puts `shape` (or nothing: erase) over [from, to): shapes inside go, shapes that stick out are cut to what is left.
  function place(view, from, to, shape) {
    const d = data(view), out = [];
    for (const s of d.shapes) {
      const a = s.s, b = s.s + s.n;
      if (b <= from + EPS || a >= to - EPS) { out.push(s); continue; }
      if (a < from - EPS) out.push({ ...s, n: round(from - a) });
      if (b > to + EPS) out.push({ ...s, s: round(to), n: round(b - to) });
    }
    if (shape) out.push({ ...shape, s: round(from), n: round(to - from) });
    out.sort((x, y) => x.s - y.s);
    d.shapes = out.slice(0, MAX);
    return shape ? d.shapes.find((x) => x.s === round(from)) : null;
  }
  const shapeAt = (view, beat) => data(view).shapes.find((s) => beat >= s.s - EPS && beat < s.s + s.n - EPS) || null;

  // ---- the playhead --------------------------------------------------------------------------
  // The engine reports the position about 30 times a second (and the board less often when it is busy). The playhead runs on
  // its own between reports at the speed seen in the last two, and every report puts it back on the true position.
  const MAX_AHEAD = 0.25;  // seconds: never run on further than this without a report
  function noteState(sq, st) {
    const now = performance.now() / 1000, prev = sq.live;
    if (!st || !(st.active > 0.5)) { sq.live = null; return; }
    let rate = prev ? prev.rate : 0;
    if (prev && now > prev.t + 1e-3) {
      let dp = st.phase - prev.phase;
      if (dp < -0.5) dp += 1;  // the loop wrapped between the reports
      // A jump back (a restart) keeps the old speed, and so does a report that did not move: inside a Voice Cell the engine
      // skips a voice that is not sounding, so its last position is repeated until it wakes up.
      if (dp > 1e-6 && dp < 0.5) rate = dp / (now - prev.t);
    }
    sq.live = { phase: st.phase, t: now, rate };
  }
  function playPhase(sq) {
    const l = sq.live;
    if (!l) return sq.state ? sq.state.phase : 0;
    if (l.phase >= 0.9999) return 1;  // a one-shot pass that has ended
    const p = l.phase + l.rate * Math.min(MAX_AHEAD, performance.now() / 1000 - l.t);
    return p >= 1 ? p - Math.floor(p) : p;
  }

  // ---- drawing -------------------------------------------------------------------------------
  function draw(view) {
    const sq = view.sq, c = sq.canvas;
    if (!c || !c.clientWidth) return;
    const { g, w, h } = BleepView.fit(c);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim() || "#5eead4";
    const line = css.getPropertyValue("--line"), text = css.getPropertyValue("--text"), muted = css.getPropertyValue("--muted");
    const mod = css.getPropertyValue("--mod").trim() || "#f6c35b", panel = css.getPropertyValue("--panel") || "#15171c";
    const L = lengthBeats(view), n = stepCount(view), cw = cell(view), shapes = data(view).shapes;
    const X = (beat) => (beat / L) * w;
    const top = TOP, bottom = h - BOTTOM, Y = (v) => top + (1 - v) * (bottom - top);
    sq.geo = { L, n, cw, w, h, X, Y, top, bottom };
    if (sq.sel && !shapes.includes(sq.sel)) sq.sel = null;
    // Step cells, alternating, with the selected shape's span lit.
    for (let i = 0; i < n; i++) {
      g.fillStyle = line; g.globalAlpha = i % 2 ? 0.1 : 0.04;
      g.fillRect(X(i * cw), 0, X((i + 1) * cw) - X(i * cw), h);
    }
    if (sq.sel) { g.fillStyle = accent; g.globalAlpha = 0.14; g.fillRect(X(sq.sel.s), 0, X(sq.sel.s + sq.sel.n) - X(sq.sel.s), h); }
    g.globalAlpha = 1;
    g.strokeStyle = line;
    g.lineWidth = 1;
    g.beginPath();
    for (let k = 0; k <= 4; k++) { const y = Math.round(Y(k / 4)) + 0.5; g.moveTo(0, y); g.lineTo(w, y); }
    for (let i = 1; i < n; i++) { const x = Math.round(X(i * cw)) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); }
    g.stroke();
    // Beat marks: where the song's beats fall on the loop.
    g.fillStyle = muted;
    for (let b = 0; b < L; b++) g.fillRect(Math.round(X(b)), h - 5, 1, 5);
    // The shapes.
    const trace = (s) => {
      const steps = Math.max(2, Math.round(X(s.n)));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, x = X(s.s + t * s.n), y = Y(shapeValue(s, t));
        if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
    };
    for (const s of shapes) {
      if (s.s >= L - EPS) continue;
      const on = s === sq.sel;
      g.beginPath();
      trace(s);
      g.lineTo(X(s.s + s.n), Y(0)); g.lineTo(X(s.s), Y(0)); g.closePath();
      g.fillStyle = accent; g.globalAlpha = on ? 0.28 : 0.14; g.fill(); g.globalAlpha = 1;
      g.beginPath();
      trace(s);
      g.strokeStyle = accent; g.lineWidth = on ? 2.6 : 1.8; g.lineJoin = "round"; g.stroke();
    }
    // Step numbers.
    g.fillStyle = muted; g.font = "9px system-ui, sans-serif"; g.textAlign = "left";
    if (X(cw) > 22) for (let i = 0; i < n; i++) g.fillText(String(i + 1), X(i * cw) + 4, h - 7);
    // The selected shape's handles.
    sq.handles = [];
    const s = sq.sel;
    if (s) {
      const x0 = X(s.s), x1 = X(s.s + s.n), ins = Math.min(9, (x1 - x0) / 6), hs = [];
      if (s.t === "plat") hs.push(["ab", (x0 + x1) / 2, Y(s.a)]);
      else if (s.t === "pulse") hs.push(["a", x0 + (x1 - x0) * 0.25, Y(s.a)], ["b", x0 + (x1 - x0) * 0.75, Y(s.b)]);
      else if (s.t === "tri") hs.push(["a", x0 + ins, Y(s.a)], ["b", (x0 + x1) / 2, Y(s.b)]);
      else hs.push(["a", x0 + ins, Y(s.a)], ["b", x1 - ins, Y(s.b)]);
      for (const [k, x, y] of hs) {
        sq.handles.push({ k, x, y });
        g.fillStyle = panel; g.strokeStyle = mod; g.lineWidth = 2;
        g.fillRect(x - 5, y - 5, 10, 10); g.strokeRect(x - 5, y - 5, 10, 10);
      }
      if (hasBend(s)) {
        const tm = s.t === "ramp" ? 0.5 : 0.25, x = x0 + tm * (x1 - x0), y = Y(shapeValue(s, tm));
        sq.handles.push({ k: "c", x, y, tm });
        g.fillStyle = panel; g.strokeStyle = text; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    }
    // The playhead.
    const st = sq.state;
    if (st && st.active > 0.5) {
      const x = clamp(playPhase(sq), 0, 1) * w;
      g.strokeStyle = text; g.globalAlpha = 0.85; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); g.globalAlpha = 1;
    }
  }

  // ---- editing -------------------------------------------------------------------------------
  function attach(view) {
    const sq = view.sq, c = sq.canvas;
    let drag = null, painting = false, lastCell = -1;
    const at = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const cellAt = (x) => clamp(Math.floor((x / sq.geo.w) * sq.geo.n), 0, sq.geo.n - 1);
    /// A click or a drag over a step: paint or erase it with the tool, or select the shape there.
    const touch = (i) => {
      const { cw, L } = sq.geo, from = i * cw, to = Math.min(L, (i + 1) * cw);
      if (sq.tool === "erase") { place(view, from, to, null); sq.sel = null; }
      else if (sq.tool !== "select") sq.sel = place(view, from, to, fromShape(SHAPES.find((x) => x[1] + x[0] === sq.tool) || SHAPES[0], from, to - from));
      else sq.sel = shapeAt(view, from + (to - from) / 2);
      send(view);
      updateInspector(view);
      draw(view);
    };
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !sq.geo) return;
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      const p = at(e);
      view.api.beginGesture();
      const hit = sq.handles.find((hd) => Math.hypot(p.x - hd.x, p.y - hd.y) < 10);
      if (hit && sq.sel) {
        const s = sq.sel;
        drag = { k: hit.k, y: p.y, a: s.a, b: s.b, c: s.c, tm: hit.tm, mid: shapeValue(s, hit.tm || 0.5) };
        return;
      }
      painting = sq.tool !== "select";
      lastCell = cellAt(p.x);
      touch(lastCell);
    });
    c.addEventListener("pointermove", (e) => {
      const p = at(e);
      if (!drag) {
        if (painting && cellAt(p.x) !== lastCell) { lastCell = cellAt(p.x); touch(lastCell); }
        return;
      }
      const s = sq.sel, span = sq.geo.bottom - sq.geo.top;
      if (!s) return;
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
    const end = () => { drag = null; painting = false; };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  const fmtBeats = (v) => (Math.round(v * 100) / 100) + (v === 1 ? " beat" : " beats");
  function updateInspector(view) {
    const sq = view.sq, s = sq.sel, pct = (v) => Math.round(v * 100) + "%";
    const steps = stepCount(view), L = lengthBeats(view);
    const head = fmtBeats(L) + " in " + steps + (steps === 1 ? " step" : " steps");
    if (!s) { sq.info.textContent = head + " · no shape selected"; return; }
    const first = Math.floor(s.s / cell(view) + 1e-6) + 1, covers = Math.max(1, Math.round(s.n / cell(view) * 100) / 100);
    sq.info.textContent = head + " · " + NAMES[s.t] + " at step " + first + " (" + covers + (covers === 1 ? " step" : " steps") + ")" +
      " · " + (s.t === "plat" ? pct(s.a) : pct(s.a) + " → " + pct(s.b)) +
      (hasBend(s) ? " · curve " + (s.c >= 0 ? "+" : "") + Math.round(s.c * 100) : "");
  }

  function shapeIcon(sh) {
    const s = fromShape(sh, 0, 1);
    let d = "";
    for (let i = 0; i <= 24; i++) d += (i ? "L" : "M") + (3 + (i / 24) * 34).toFixed(1) + " " + (19 - shapeValue(s, i / 24) * 16).toFixed(1);
    return '<svg viewBox="0 0 40 22" width="40" height="22"><path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }

  BleepViews.register("shape-sequencer", {
    top: true,
    width: 560,
    layout: [
      { title: "Timing", params: ["length", "steps", "sync", "playback", "rate"] },
      { title: "Output", params: ["polarity", "depth", "offset", "slew"] },
    ],
    template: '<div class="bv-panel">' +
      '<div class="sq-pal" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px"></div>' +
      '<canvas class="sq-canvas" style="height:170px;width:100%;touch-action:none"></canvas>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:6px">' +
      '<div class="sq-info bv-label" style="flex:1 1 auto"></div><div class="sq-btns" style="display:flex;gap:4px"></div></div></div>',
    afterBuild(view, el) {
      // The view and the module come as a pair. A module built before the free step count has a Grid and no Steps: say so.
      if (!view.type.params.some((p) => p.id === "steps") || !view.type.params.some((p) => p.id === "length" && p.max > 8)) {
        el.querySelector(".bv-panel").innerHTML = '<div class="bv-label" style="padding:12px;line-height:1.5">This Shape Sequencer is an older version than its view. ' +
          'Update the module (Bleep Library, or rebuild the web modules) and add it again.</div>';
        return;
      }
      const sq = (view.sq = { canvas: el.querySelector(".sq-canvas"), sel: null, tool: "select", state: null, handles: [] });
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
          if (!sq.sel) return;
          view.api.beginGesture();
          fn(sq.sel);
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
      BleepView.loop(el, () => { if (sq.live) draw(view); });  // the playhead moves every frame, not only with a report
    },
    onState(st, view) {
      if (!view.sq) return;
      view.sq.state = st;
      noteState(view.sq, st);
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
