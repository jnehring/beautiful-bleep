// SPDX-License-Identifier: GPL-3.0-only
// Roll view (doc/specs/modules/roll.md): the note editor. Notes are drawn on a
// pitch grid (click and drag to draw, drag to move, drag the right edge to
// resize, right-click or Delete to remove; the Select tool drags a rectangle), a ruler sets the loop region and
// a lane below sets velocity, chance and ratchet. The previous slot shows as a
// ghost and the Morph target as dashed outlines. Notes live in the node's data
// as [start, length, pitch, velocity, chance, ratchet]; edits go to the engine
// with api.setData.
(function () {
  "use strict";
  const TPB = 96, TPBAR = 384, SLOTS = 8, MAXBARS = 8, MAXN = 256, MINROWS = 12, MAXROWS = 60;
  const KEYS = 40, RULER = 20, AREA = 396, LANE = 66, LANE_TOP = RULER + AREA + 8, H = LANE_TOP + LANE + 4;
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const BLACK = [1, 3, 6, 8, 10];
  // Same order and notes as patch/common/dsp/Scales.h.
  const SCALES = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7, 8, 11],
    [0, 2, 3, 5, 7, 9, 11], [0, 2, 3, 5, 7, 9, 10], [0, 1, 3, 5, 7, 8, 10], [0, 2, 4, 6, 7, 9, 11],
    [0, 2, 4, 5, 7, 9, 10], [0, 1, 3, 5, 6, 8, 10], [0, 1, 4, 5, 7, 8, 10], [0, 2, 4, 7, 9], [0, 3, 5, 7, 10],
    [0, 3, 5, 6, 7, 10], [0, 2, 4, 6, 8, 10], [0, 2, 3, 5, 6, 8, 9, 11], [0, 2, 3, 7, 8],
  ];
  const GRIDS = [["Off", 1], ["1/4", 96], ["1/8", 48], ["1/8T", 32], ["1/16", 24], ["1/16T", 16], ["1/32", 12], ["1/32T", 8]];
  const LANES = [["vel", "Velocity", 3, 1, 127], ["prob", "Chance", 4, 0, 100], ["rat", "Ratchet", 5, 1, 8]];
  const mod = (a, m) => ((a % m) + m) % m;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const T = 0, L = 1, P = 2, V = 3, PR = 4, R = 5;

  function setting(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    const v = view.node.params[id] ?? p.default;
    return Math.round(p.min + v * (p.max - p.min));
  }
  const freshSlot = () => ({ bars: 2, loop: [0, 2 * TPBAR], notes: [] });
  function data(view) {
    let d = view.node.data;
    if (!d || !Array.isArray(d.slots)) {
      d = view.node.data = { slot: 0, grid: 24, ghost: true, slots: Array.from({ length: SLOTS }, freshSlot) };
      d.slots[0] = { bars: 1, loop: [0, TPBAR], notes: [[0, 36, 60, 100, 100, 1], [48, 36, 63, 100, 100, 1], [96, 36, 67, 100, 100, 1], [144, 36, 70, 100, 100, 1]] };
    }
    while (d.slots.length < SLOTS) d.slots.push(freshSlot());
    for (const s of d.slots) {
      if (!Array.isArray(s.notes)) s.notes = [];
      s.bars = clamp(s.bars | 0 || 2, 1, MAXBARS);
      if (!Array.isArray(s.loop) || s.loop.length !== 2) s.loop = [0, s.bars * TPBAR];
    }
    if (d.slot == null) d.slot = 0;
    if (d.grid == null) d.grid = 24;
    if (d.ghost == null) d.ghost = true;
    return d;
  }
  const cur = (view) => data(view).slots[clamp(data(view).slot, 0, SLOTS - 1)];
  const noteName = (n) => NAMES[mod(n, 12)] + (Math.floor(n / 12) - 1);
  function send(view) { view.api.setData(JSON.parse(JSON.stringify(data(view)))); }
  function edit(view, fn) {
    view.api.beginGesture();
    fn(data(view), cur(view));
    send(view);
    draw(view);
  }
  function fixLoop(s) {
    const len = s.bars * TPBAR;
    s.loop[0] = clamp(s.loop[0], 0, len - 1);
    s.loop[1] = clamp(s.loop[1], s.loop[0] + 1, len);
  }
  /// Scale for the highlight: the live one (follows a harmony bus), else the settings.
  function scaleOf(view) {
    const st = view.roll.state || {};
    if (st.mask != null && st.root != null) return { root: st.root, mask: st.mask };
    const notes = SCALES[clamp(setting(view, "scale"), 0, SCALES.length - 1)];
    let mask = 0;
    for (const n of notes) mask |= 1 << n;
    return { root: setting(view, "root"), mask };
  }

  // ---- geometry ----------------------------------------------------------
  const R_ = (view) => view.roll;
  const xOf = (r, t) => KEYS + (t - r.x0) * r.pxT;
  const tickOf = (r, x) => r.x0 + (x - KEYS) / r.pxT;
  const yOf = (r, p) => RULER + (r.lo + r.rows - 1 - p) * r.row;
  const pitchOf = (r, y) => r.lo + r.rows - 1 - Math.floor((y - RULER) / r.row);
  function snapTick(view, t, free) {
    const g = free ? 1 : data(view).grid;
    return Math.round(t / g) * g;
  }
  function fitZoom(view) {
    const r = R_(view), s = cur(view);
    r.pxT = (r.w - KEYS - 8) / (s.bars * TPBAR);
    r.x0 = 0;
  }
  /// Resets the pitch zoom and scrolls so the notes of the slot sit in the middle.
  function fitPitch(view) {
    const r = R_(view), ps = cur(view).notes.map((n) => n[P]);
    r.rows = 36;
    r.lo = ps.length ? Math.round((Math.min(...ps) + Math.max(...ps)) / 2 - r.rows / 2) : 48;
  }
  function clampView(view) {
    const r = R_(view), s = cur(view), len = s.bars * TPBAR, span = (r.w - KEYS) / r.pxT;
    r.pxT = clamp(r.pxT, (r.w - KEYS - 8) / (MAXBARS * TPBAR), 2.5);
    r.x0 = clamp(r.x0, 0, Math.max(0, len - span + 12));
    r.rows = clamp(Math.round(r.rows), MINROWS, MAXROWS);
    r.row = AREA / r.rows;
    r.lo = clamp(r.lo, 0, 127 - r.rows + 1);
  }
  /// Zoom in time by `f` (> 1 zooms in), keeping the tick under `x` in place.
  function zoomH(view, f, x) {
    const r = R_(view), ax = x == null ? (r.w + KEYS) / 2 : x, t = tickOf(r, ax);
    r.pxT *= f;
    clampView(view);
    r.x0 += t - tickOf(r, ax);
  }
  /// Zoom the pitch axis by `f` (> 1 zooms in), keeping the pitch under `y` in place.
  function zoomV(view, f, y) {
    const r = R_(view), ay = y == null ? RULER + AREA / 2 : y, frac = (ay - RULER) / AREA;
    const p = r.lo + r.rows * (1 - frac);
    r.rows /= f;
    clampView(view);
    r.lo = clamp(Math.round(p - r.rows * (1 - frac)), 0, 127 - r.rows + 1);
  }

  // ---- drawing -------------------------------------------------------------
  function drawNotes(g, r, notes, mode, col, alpha) {
    g.save();
    g.beginPath();
    g.rect(KEYS, RULER, r.w - KEYS, AREA);
    g.clip();
    g.globalAlpha = alpha;
    for (const n of notes) {
      if (n[P] < r.lo || n[P] >= r.lo + r.rows) continue;
      const x = xOf(r, n[T]), w = Math.max(3, n[L] * r.pxT - 1), y = yOf(r, n[P]);
      if (mode === "fill") {
        g.fillStyle = col;
        g.fillRect(x, y + 1, w, r.row - 2);
      } else {
        if (mode === "dash") g.setLineDash([3, 3]);
        g.strokeStyle = col;
        g.strokeRect(x + 0.5, y + 1.5, w - 1, r.row - 3);
        g.setLineDash([]);
      }
    }
    g.restore();
  }
  function draw(view) {
    const r = view.roll && view.roll.canvas && view.roll;
    if (!r) return;
    const d = data(view), s = cur(view), st = r.state || {};
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(320, Math.floor(r.box.clientWidth) || r.w);
    if (w !== r.w || r.canvas.width !== Math.round(w * dpr)) {
      const first = !r.w;
      r.w = w;
      r.canvas.width = Math.round(w * dpr);
      r.canvas.height = H * dpr;
      r.canvas.style.width = w + "px";
      r.canvas.style.height = H + "px";
      if (first) fitZoom(view);
    }
    clampView(view);
    const g = r.canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.w, H);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim() || "#7cc4a4";
    const line = css.getPropertyValue("--line").trim() || "#333";
    const muted = css.getPropertyValue("--muted").trim() || "#888";
    const text = css.getPropertyValue("--text").trim() || "#ddd";
    const modc = css.getPropertyValue("--mod").trim() || "#c78cf0";
    const panel2 = css.getPropertyValue("--panel-2").trim() || "#222";
    const len = s.bars * TPBAR, sc = scaleOf(view);
    g.font = "9px system-ui, sans-serif";

    // rows: black keys darker, scale rows lighter, tonic tinted
    for (let p = r.lo; p < r.lo + r.rows; p++) {
      const y = yOf(r, p), pc = mod(p, 12), inS = (sc.mask >> mod(p - sc.root, 12)) & 1;
      g.fillStyle = panel2;
      g.globalAlpha = BLACK.includes(pc) ? 1 : 0.55;
      g.fillRect(KEYS, y, r.w - KEYS, r.row);
      g.globalAlpha = 1;
      if (inS) {
        g.fillStyle = accent;
        g.globalAlpha = mod(p - sc.root, 12) === 0 ? 0.2 : 0.07;
        g.fillRect(KEYS, y, r.w - KEYS, r.row);
        g.globalAlpha = 1;
      }
      // key column
      g.fillStyle = BLACK.includes(pc) ? "#111" : "#d8d8d0";
      g.fillRect(0, y, KEYS - 2, r.row - 1);
      if (pc === 0) {
        g.fillStyle = "#222";
        g.textAlign = "right";
        g.fillText(noteName(p), KEYS - 5, y + r.row - 3);
      }
      if (inS) { g.fillStyle = accent; g.fillRect(KEYS - 3, y + 1, 2, r.row - 3); }
    }
    // beat and bar lines
    g.lineWidth = 1;
    const g0 = d.grid;
    for (let t = 0; t <= len; t += g0 > 1 && g0 * r.pxT >= 5 ? g0 : TPB / 4) {
      const x = Math.round(xOf(r, t)) + 0.5;
      if (x < KEYS || x > r.w) continue;
      g.strokeStyle = t % TPBAR === 0 ? muted : line;
      g.globalAlpha = t % TPBAR === 0 ? 0.9 : t % TPB === 0 ? 0.6 : 0.2;
      g.beginPath(); g.moveTo(x, RULER); g.lineTo(x, RULER + AREA); g.stroke();
    }
    g.globalAlpha = 1;
    // outside the pattern / loop
    g.fillStyle = "#000";
    g.globalAlpha = 0.35;
    const xa = xOf(r, s.loop[0]), xb = xOf(r, s.loop[1]);
    g.fillRect(KEYS, RULER, Math.max(0, xa - KEYS), AREA);
    g.fillRect(Math.max(KEYS, xb), RULER, Math.max(0, r.w - xb), AREA);
    g.globalAlpha = 1;

    // ghost: the slot that played before (or the one playing, while another is edited); Morph target dashed
    const playing = st.slot ?? 0, prev = st.prev ?? 0;
    if (d.ghost) {
      const gs = d.slot === playing ? prev : playing;
      if (gs !== d.slot) drawNotes(g, r, d.slots[gs].notes, "fill", text, 0.16);
    }
    const morph = view.node.params.morph || 0, to = setting(view, "morphto") - 1;
    if (morph > 0.001 && to !== d.slot) drawNotes(g, r, d.slots[to].notes, "dash", modc, 0.35 + 0.65 * morph);

    // notes
    drawNotes(g, r, s.notes, "fill", accent, 1);
    g.save();
    g.beginPath(); g.rect(KEYS, RULER, r.w - KEYS, AREA); g.clip();
    for (const n of s.notes) {
      if (n[P] < r.lo || n[P] >= r.lo + r.rows) continue;
      const x = xOf(r, n[T]), wd = Math.max(3, n[L] * r.pxT - 1), y = yOf(r, n[P]);
      g.globalAlpha = 0.35 + 0.65 * (n[V] / 127);
      g.fillStyle = "#000";
      g.globalAlpha = 0.45 * (1 - n[V] / 127);
      g.fillRect(x, y + 1, wd, r.row - 2);
      g.globalAlpha = 1;
      if (r.sel.has(n)) { g.strokeStyle = text; g.lineWidth = 1.5; g.strokeRect(x + 0.5, y + 1.5, wd - 1, r.row - 3); g.lineWidth = 1; }
      g.fillStyle = "#101010";
      g.textAlign = "left";
      const tag = (n[R] > 1 ? "×" + n[R] + " " : "") + (n[PR] < 100 ? n[PR] + "%" : "");
      if (tag && wd > 22) g.fillText(tag, x + 3, y + r.row - 3);
      if (n[R] > 1) {  // ratchet ticks
        g.fillStyle = "#101010";
        for (let k = 1; k < n[R]; k++) g.fillRect(x + (wd * k) / n[R], y + 1, 1, r.row - 2);
      }
    }
    g.restore();

    // loop region and ruler
    g.fillStyle = panel2;
    g.fillRect(KEYS, 0, r.w - KEYS, RULER);
    g.fillStyle = accent;
    g.globalAlpha = 0.35;
    g.fillRect(Math.max(KEYS, xa), 0, Math.max(0, Math.min(r.w, xb) - Math.max(KEYS, xa)), RULER);
    g.globalAlpha = 1;
    g.fillStyle = muted;
    g.textAlign = "left";
    for (let b = 0; b < s.bars; b++) {
      const x = xOf(r, b * TPBAR);
      if (x >= KEYS && x < r.w) g.fillText(String(b + 1), x + 3, 13);
      for (let q = 1; q < 4; q++) {
        const xx = Math.round(xOf(r, b * TPBAR + q * TPB)) + 0.5;
        if (xx >= KEYS && xx < r.w) { g.fillRect(xx, 14, 1, 5); }
      }
    }
    g.fillStyle = accent;
    g.fillRect(xa - 1, 0, 2, RULER);
    g.fillRect(xb - 1, 0, 2, RULER);

    if (r.marquee) {
      const m = r.marquee, x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
      g.fillStyle = accent;
      g.globalAlpha = 0.15;
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.globalAlpha = 1;
      g.strokeStyle = accent;
      g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
    }

    // playhead (only while the playing slot is the edited one)
    if (st.pos != null && playing === d.slot) {
      const x = xOf(r, st.pos);
      if (x >= KEYS && x <= r.w) {
        g.strokeStyle = text;
        g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, LANE_TOP + LANE); g.stroke();
      }
    }

    // lane
    const lane = LANES.find((l) => l[0] === r.lane);
    g.fillStyle = panel2;
    g.fillRect(KEYS, LANE_TOP, r.w - KEYS, LANE);
    g.save();
    g.beginPath(); g.rect(KEYS, LANE_TOP, r.w - KEYS, LANE); g.clip();
    g.fillStyle = accent;
    for (const n of s.notes) {
      const v = n[lane[2]], f = (v - lane[3]) / (lane[4] - lane[3]);
      const x = xOf(r, n[T]), wd = Math.max(3, Math.min(n[L] * r.pxT - 1, 18)), hh = Math.max(2, f * (LANE - 4));
      g.globalAlpha = r.sel.has(n) ? 1 : 0.7;
      g.fillRect(x, LANE_TOP + LANE - 2 - hh, wd, hh);
    }
    g.restore();
    g.globalAlpha = 1;
    g.fillStyle = muted;
    g.textAlign = "left";
    g.fillText(lane[1], 4, LANE_TOP + 12);
    r.drawBtn.classList.toggle("on", r.tool === "draw");
    r.selectBtn.classList.toggle("on", r.tool === "select");
    r.delBtn.disabled = r.sel.size === 0;
    r.recBtn.classList.toggle("on", setting(view, "record") === 1);
    r.canvas.style.cursor = r.tool === "select" ? "default" : "crosshair";
    r.info.textContent = s.notes.length + " notes · " + s.bars + (s.bars === 1 ? " bar" : " bars");
    r.slotBtns.forEach((b, i) => {
      b.classList.toggle("on", i === d.slot);
      b.classList.toggle("play", i === playing);
      b.classList.toggle("prev", i === prev && prev !== playing);
      b.classList.toggle("filled", d.slots[i].notes.length > 0);
    });
  }

  // ---- editing -------------------------------------------------------------
  function hit(view, x, y) {
    const r = R_(view), s = cur(view);
    if (x < KEYS || y < RULER || y >= RULER + AREA) return null;
    const t = tickOf(r, x), p = pitchOf(r, y);
    for (let i = s.notes.length - 1; i >= 0; i--) {
      const n = s.notes[i];
      if (n[P] === p && t >= n[T] - 0.5 / r.pxT && t < n[T] + Math.max(n[L], 3 / r.pxT)) return n;
    }
    return null;
  }
  function attach(view, c) {
    const r = R_(view);
    const at = (e) => { const b = c.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    let drag = null;
    c.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const { x, y } = at(e), n = hit(view, x, y);
      if (n) edit(view, (d, s) => { s.notes.splice(s.notes.indexOf(n), 1); r.sel.delete(n); });
    });
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      c.focus();
      const { x, y } = at(e), s = cur(view);
      c.setPointerCapture(e.pointerId);
      view.api.beginGesture();
      if (y < RULER && x >= KEYS) {  // the loop region
        const t = clamp(snapTick(view, tickOf(r, x), e.altKey), 0, s.bars * TPBAR);
        drag = { kind: "loop", t0: t };
        return;
      }
      if (y >= LANE_TOP && x >= KEYS) {
        drag = { kind: "lane" };
        laneSet(view, x, y, e);
        return;
      }
      const n = hit(view, x, y);
      if (n) {
        if (e.shiftKey) { if (r.sel.has(n)) r.sel.delete(n); else r.sel.add(n); }
        else if (!r.sel.has(n)) { r.sel.clear(); r.sel.add(n); }
        const edge = x >= xOf(r, n[T] + n[L]) - 6 && n[L] * r.pxT > 10;
        drag = { kind: edge ? "resize" : "move", t0: tickOf(r, x), p0: pitchOf(r, y), orig: [...r.sel].map((m) => [m, m[T], m[L], m[P]]), moved: false,
          // draw mode: a click without a drag removes the note
          erase: r.tool === "draw" && !e.shiftKey ? n : null };
        r.lastVel = n[V];
        draw(view);
        return;
      }
      if (r.tool === "select") {
        if (x < KEYS || y >= RULER + AREA) return;
        drag = { kind: "marquee", base: e.shiftKey ? new Set(r.sel) : new Set() };
        r.sel = new Set(drag.base);
        r.marquee = { x0: x, y0: y, x1: x, y1: y };
        draw(view);
        return;
      }
      if (!e.shiftKey) r.sel.clear();
      if (x < KEYS || y >= RULER + AREA || y < RULER || s.notes.length >= MAXN) { draw(view); return; }
      const gq = e.altKey ? 1 : data(view).grid;
      const t0 = clamp(Math.floor(tickOf(r, x) / gq) * gq, 0, s.bars * TPBAR - 1);
      const p = clamp(pitchOf(r, y), 0, 127);
      const len = Math.min(e.altKey ? 12 : data(view).grid, s.bars * TPBAR - t0);
      const note = [t0, len, p, r.lastVel || 100, 100, 1];
      s.notes.push(note);
      r.sel.clear();
      r.sel.add(note);
      drag = { kind: "create", note, t0 };
      send(view);
      draw(view);
    });
    c.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const { x, y } = at(e), s = cur(view), len = s.bars * TPBAR, free = e.altKey, g = free ? 1 : data(view).grid;
      if (drag.kind === "loop") {
        const t = clamp(snapTick(view, tickOf(r, x), free), 0, len);
        s.loop = [Math.min(drag.t0, t), Math.max(drag.t0, t)];
        if (s.loop[1] - s.loop[0] < g) s.loop[1] = s.loop[0] + g;
        fixLoop(s);
      } else if (drag.kind === "lane") {
        laneSet(view, x, y, e);
        return;
      } else if (drag.kind === "marquee") {
        const m = r.marquee;
        m.x1 = clamp(x, KEYS, r.w);
        m.y1 = clamp(y, RULER, RULER + AREA);
        const ta = tickOf(r, Math.min(m.x0, m.x1)), tb = tickOf(r, Math.max(m.x0, m.x1));
        const pa = pitchOf(r, Math.max(m.y0, m.y1)), pb = pitchOf(r, Math.min(m.y0, m.y1));
        r.sel = new Set(drag.base);
        for (const n of s.notes) if (n[T] < tb && n[T] + n[L] > ta && n[P] >= pa && n[P] <= pb) r.sel.add(n);
        draw(view);
        return;
      } else if (drag.kind === "create") {
        const n = drag.note, end = clamp(Math.round(tickOf(r, x) / g) * g, n[T] + 1, len);
        n[L] = Math.max(free ? 1 : g, end - n[T]);
      } else if (drag.kind === "move") {
        const dt = Math.round((tickOf(r, x) - drag.t0) / g) * g, dp = pitchOf(r, y) - drag.p0;
        if (dt || dp) drag.moved = true, drag.erase = null;
        for (const [n, t, l, p] of drag.orig) {
          n[T] = clamp(t + dt, 0, len - n[L]);
          n[P] = clamp(p + dp, 0, 127);
        }
      } else if (drag.kind === "resize") {
        for (const [n] of drag.orig) {
          const end = Math.round(tickOf(r, x) / g) * g;
          n[L] = clamp(Math.max(g, end - n[T]), 1, len - n[T]);
        }
        drag.erase = null;
      }
      send(view);
      draw(view);
    });
    const end = () => {
      const d = drag;
      drag = null;
      if (d && d.kind === "marquee") { r.marquee = null; draw(view); }
      else if (d && d.erase) edit(view, (data_, s) => { s.notes.splice(s.notes.indexOf(d.erase), 1); r.sel.delete(d.erase); });
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("dblclick", (e) => {
      const { x, y } = at(e);
      if (y < RULER && x >= KEYS) { edit(view, (d, s) => (s.loop = [0, s.bars * TPBAR])); return; }
      const n = r.tool === "select" ? hit(view, x, y) : null;  // draw mode removes on a single click
      if (n) edit(view, (d, s) => { s.notes.splice(s.notes.indexOf(n), 1); r.sel.delete(n); });
    });
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // up / down zooms in time, left / right zooms the pitch rows
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) zoomV(view, Math.exp(-e.deltaX / 300), e.offsetY);
        else zoomH(view, Math.exp(-e.deltaY / 300), e.offsetX);
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) r.x0 += (e.deltaX || e.deltaY) / r.pxT;
      else r.lo += Math.round(e.deltaY / 30) || Math.sign(e.deltaY);
      draw(view);
    }, { passive: false });
    c.addEventListener("keydown", (e) => {
      e.stopPropagation();
      const s = cur(view), sel = [...r.sel];
      if ((e.key === "Delete" || e.key === "Backspace") && sel.length) {
        e.preventDefault();
        deleteSelected(view);
      } else if ((e.key === "a" || e.key === "A") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        s.notes.forEach((n) => r.sel.add(n));
        draw(view);
      } else if (e.key.startsWith("Arrow") && sel.length) {
        e.preventDefault();
        const g = e.altKey ? 1 : data(view).grid;
        edit(view, () => {
          for (const n of sel) {
            if (e.key === "ArrowLeft") n[T] = clamp(n[T] - g, 0, s.bars * TPBAR - n[L]);
            if (e.key === "ArrowRight") n[T] = clamp(n[T] + g, 0, s.bars * TPBAR - n[L]);
            if (e.key === "ArrowUp") n[P] = clamp(n[P] + (e.shiftKey ? 12 : 1), 0, 127);
            if (e.key === "ArrowDown") n[P] = clamp(n[P] - (e.shiftKey ? 12 : 1), 0, 127);
          }
        });
      } else if (e.key === "Escape") { r.sel.clear(); draw(view); }
    });
  }
  function deleteSelected(view) {
    const r = R_(view), s = cur(view), sel = [...r.sel];
    if (!sel.length) return;
    edit(view, () => { for (const n of sel) s.notes.splice(s.notes.indexOf(n), 1); r.sel.clear(); });
  }
  function laneSet(view, x, y, e) {
    const r = R_(view), s = cur(view), lane = LANES.find((l) => l[0] === r.lane);
    const t = tickOf(r, x);
    // the note under the pointer: the latest-starting one that covers it, else the nearest start
    let best = null, bd = 1e9;
    for (const n of s.notes) {
      const inside = t >= n[T] && t < n[T] + Math.max(n[L], 10 / r.pxT);
      const dist = inside ? Math.abs(t - n[T]) : 1e8 + Math.abs(t - n[T]);
      if (dist < bd) { bd = dist; best = n; }
    }
    if (!best || bd >= 1e8) return;
    const f = clamp(1 - (y - LANE_TOP - 2) / (LANE - 4), 0, 1);
    const v = Math.round(lane[3] + f * (lane[4] - lane[3]));
    const targets = r.sel.has(best) ? [...r.sel] : [best];
    for (const n of targets) n[lane[2]] = v;
    if (lane[0] === "vel") r.lastVel = v;
    send(view);
    draw(view);
  }

  // ---- tools ---------------------------------------------------------------
  function randomNotes(view) {
    const sc = scaleOf(view);
    edit(view, (d, s) => {
      s.notes = [];
      const grid = Math.max(12, d.grid), cells = Math.floor((s.loop[1] - s.loop[0]) / grid);
      const base = 48 + sc.root;
      let p = base + 12;
      for (let i = 0; i < cells; i++) {
        if (Math.random() < 0.4) continue;
        for (let k = 0; k < 6; k++) {  // a step of at most a fifth, inside the scale
          const q = clamp(p + Math.round((Math.random() * 2 - 1) * 7), base, base + 28);
          if ((sc.mask >> mod(q - sc.root, 12)) & 1) { p = q; break; }
        }
        const len = grid * (Math.random() < 0.3 ? 2 : 1);
        s.notes.push([s.loop[0] + i * grid, Math.min(len, s.bars * TPBAR - (s.loop[0] + i * grid)), p, 70 + Math.floor(Math.random() * 50), 100, 1]);
      }
      view.roll.sel.clear();
    });
  }
  function setPlaying(view, i) {
    if (view.api.isPatched("pattern")) return;
    const v = i / (SLOTS - 1);
    view.node.params.slot = v;
    view.api.setParam("slot", v);
  }

  const STYLE = `
    .rl-panel { flex: 1 1 100%; min-width: 0; }
    .rl-tools { display: flex; gap: 4px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
    .rl-tools button, .rl-tools select { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 6px;
      padding: 2px 7px; font: inherit; font-size: 11px; cursor: pointer; }
    .rl-tools button.on { border-color: var(--accent); background: var(--panel-3, var(--panel)); }
    .rl-tools button.filled { color: var(--text); }
    .rl-tools button:not(.filled) { color: var(--muted); }
    .rl-tools button.play { box-shadow: inset 0 -3px 0 var(--accent); }
    .rl-tools button.prev { box-shadow: inset 0 -3px 0 var(--muted); }
    .rl-tools .rl-group { display: flex; gap: 2px; margin-right: 6px; }
    .rl-tools button:disabled { opacity: 0.4; cursor: default; }
    .rl-tools button.rl-rec.on { border-color: #e5484d; color: #e5484d; }
    .rl-tools .rl-slots { display: flex; gap: 2px; margin-right: 8px; }
    .rl-tools .rl-info { margin-left: auto; color: var(--muted); font-size: 11px; }
    .rl-tools label { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 4px; }
    .rl-box { width: 100%; min-width: 0; }
    .rl-box canvas { display: block; touch-action: none; cursor: crosshair; outline: none; }`;

  BleepViews.register("roll", {
    partNames: ["Piano roll"],
    top: true,
    width: 1180,
    layout: [
      { title: "Slots", params: ["slot", "morph", "morphto", "change"] },
      { title: "Feel", params: ["humanise", "length", "swing"] },
      { title: "Time", params: ["syncto", "speed", "clockstep"] },
      { title: "Pitch", params: ["root", "scale", "octave", "quantize", "harmony", "seed"] },
    ],
    template: `<div class="bv-panel rl-panel">
      <div class="rl-tools">
        <span class="rl-slots"></span>
        <span class="rl-group">
          <button class="rl-draw" title="Draw: click empty grid to add a note, click a note to remove it, drag to move or resize">Draw</button>
          <button class="rl-select" title="Select: drag a rectangle to select notes (Shift adds to the selection)">Select</button>
          <button class="rl-del" title="Delete the selected notes (Delete)">Delete</button>
        </span>
        <button class="rl-rec" title="Record the notes, pitch and CV on the record inputs into the playing slot at the playhead">● Rec</button>
        <label>Bars <select class="rl-bars">${[1, 2, 3, 4, 5, 6, 7, 8].map((b) => `<option>${b}</option>`).join("")}</select></label>
        <label>Snap <select class="rl-grid">${GRIDS.map((g) => `<option value="${g[1]}">${g[0]}</option>`).join("")}</select></label>
        <label>Lane <select class="rl-lane">${LANES.map((l) => `<option value="${l[0]}">${l[1]}</option>`).join("")}</select></label>
        <button class="rl-ghost" title="Show the slot that played before as a ghost behind the notes">Ghost</button>
        <button class="rl-double" title="Repeat the pattern into a pattern twice as long (up to 8 bars)">Double</button>
        <button class="rl-copy" title="Copy this slot to the next one">Copy →</button>
        <button class="rl-rand" title="Replace this slot with a random line in the scale">Dice</button>
        <button class="rl-clear" title="Remove every note of this slot">Clear</button>
        <span class="rl-group">
          <button class="rl-hout" title="Zoom out in time (⌘ + wheel up / down)">↔−</button>
          <button class="rl-hin" title="Zoom in in time (⌘ + wheel up / down)">↔+</button>
          <button class="rl-vout" title="Zoom out in pitch (⌘ + wheel left / right)">↕−</button>
          <button class="rl-vin" title="Zoom in in pitch (⌘ + wheel left / right)">↕+</button>
          <button class="rl-fit" title="Fit all bars in the window">Fit</button>
        </span>
        <span class="rl-info"></span>
      </div>
      <div class="rl-box"><canvas tabindex="0"></canvas></div>
    </div>`,
    afterBuild(view, el) {
      if (!document.getElementById("rl-style")) {
        const s = document.createElement("style");
        s.id = "rl-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      const canvas = el.querySelector("canvas");
      const r = (view.roll = { canvas, box: el.querySelector(".rl-box"), info: el.querySelector(".rl-info"), state: null,
        x0: 0, pxT: 0.5, lo: 48, rows: 36, row: 11, tool: "draw", marquee: null, w: 0, sel: new Set(), lane: "vel", lastVel: 100, slotBtns: [] });
      const slots = el.querySelector(".rl-slots");
      for (let i = 0; i < SLOTS; i++) {
        const b = document.createElement("button");
        b.textContent = String(i + 1);
        b.title = "Edit and play slot " + (i + 1) + " (Shift: edit only)";
        b.addEventListener("click", (e) => {
          data(view).slot = i;
          if (!e.shiftKey) setPlaying(view, i);
          r.sel.clear();
          fitZoom(view);
          send(view);
          draw(view);
        });
        slots.appendChild(b);
        r.slotBtns.push(b);
      }
      attach(view, canvas);
      const bars = el.querySelector(".rl-bars"), grid = el.querySelector(".rl-grid"), lane = el.querySelector(".rl-lane");
      bars.addEventListener("change", () => edit(view, (d, s) => {
        const was = s.loop[1] >= s.bars * TPBAR;
        s.bars = +bars.value;
        const len = s.bars * TPBAR;
        s.notes = s.notes.filter((n) => n[T] < len);
        for (const n of s.notes) n[L] = Math.min(n[L], len - n[T]);
        if (was) s.loop[1] = len;
        fixLoop(s);
        fitZoom(view);
      }));
      grid.addEventListener("change", () => { view.api.beginGesture(); data(view).grid = +grid.value; send(view); draw(view); });
      lane.addEventListener("change", () => { r.lane = lane.value; draw(view); });
      el.querySelector(".rl-ghost").addEventListener("click", () => edit(view, (d) => (d.ghost = !d.ghost)));
      el.querySelector(".rl-fit").addEventListener("click", () => { fitZoom(view); fitPitch(view); draw(view); });
      const zoom = (sel, fn) => el.querySelector(sel).addEventListener("click", () => { fn(); draw(view); });
      zoom(".rl-hin", () => zoomH(view, 1.5));
      zoom(".rl-hout", () => zoomH(view, 1 / 1.5));
      zoom(".rl-vin", () => zoomV(view, 1.4));
      zoom(".rl-vout", () => zoomV(view, 1 / 1.4));
      r.drawBtn = el.querySelector(".rl-draw");
      r.selectBtn = el.querySelector(".rl-select");
      r.delBtn = el.querySelector(".rl-del");
      r.recBtn = el.querySelector(".rl-rec");
      r.drawBtn.addEventListener("click", () => { r.tool = "draw"; draw(view); });
      r.selectBtn.addEventListener("click", () => { r.tool = "select"; draw(view); });
      r.delBtn.addEventListener("click", () => deleteSelected(view));
      r.recBtn.addEventListener("click", () => {
        const v = setting(view, "record") === 1 ? 0 : 1;
        view.node.params.record = v;
        view.api.setParam("record", v);
        draw(view);
      });
      el.querySelector(".rl-clear").addEventListener("click", () => edit(view, (d, s) => { s.notes = []; r.sel.clear(); }));
      el.querySelector(".rl-rand").addEventListener("click", () => randomNotes(view));
      el.querySelector(".rl-double").addEventListener("click", () => edit(view, (d, s) => {
        if (s.bars * 2 > MAXBARS) return;
        const len = s.bars * TPBAR, copy = s.notes.map((n) => [n[T] + len, ...n.slice(1)]);
        s.notes = s.notes.concat(copy).slice(0, MAXN);
        s.bars *= 2;
        s.loop = [0, s.bars * TPBAR];
        fitZoom(view);
      }));
      el.querySelector(".rl-copy").addEventListener("click", () => edit(view, (d, s) => {
        d.slots[(d.slot + 1) % SLOTS] = JSON.parse(JSON.stringify(s));
      }));
      new ResizeObserver(() => draw(view)).observe(r.box);
      r.syncControls = () => {
        const d = data(view), s = cur(view);
        bars.value = String(s.bars);
        grid.value = String(GRIDS.some((g) => g[1] === d.grid) ? d.grid : 24);
        lane.value = r.lane;
        el.querySelector(".rl-ghost").classList.toggle("on", !!d.ghost);
      };
      r.syncControls();
      requestAnimationFrame(() => draw(view));
    },
    onState(st, view) {
      if (!view.roll) return;
      view.roll.state = st;
      view.roll.syncControls();
      draw(view);
    },
    onRefresh(view) {
      if (!view.roll) return;
      view.roll.sel.clear();
      view.roll.syncControls();
      draw(view);
    },
  });
})();
