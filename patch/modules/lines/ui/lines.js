// SPDX-License-Identifier: GPL-3.0-only
// Lines view (doc/specs/modules/lines.md): the tracker. Four tracks of rows,
// each cell with a note, a velocity, a gate length and an effect; type notes
// on the keyboard, move with the arrows, Delete clears. A drift panel shows
// where each track is in its own cycle and when all four line up again, and an
// order list chains the patterns. Cells live in the node's data as sparse
// lists [row, note, velocity, gate, effect, parameter]; edits go to the engine
// with api.setData.
(function () {
  "use strict";
  const TRACKS = 4, MAXROWS = 64, MINROWS = 16, PATTERNS = 16, MAXORDER = 32, OFF = 128;
  const NAMES = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];
  const FX = ["-", "R", "S", "P", "T", "J", "K"];
  const FX_HELP = ["", "Retrigger: repeats in the row (02-10 hex)", "Slide: tie into the note, glide time 00-FF", "Probability: chance 00-FF",
    "Transpose: semitones, 80-FF counts down", "Jump: the track's next row is row xx", "Skip: leave out the next xx rows"];
  const SPEEDS = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1, 1.5, 2, 3, 4];
  const SPEED_NAMES = ["x1/4", "x1/3", "x1/2", "x2/3", "x3/4", "x1", "x3/2", "x2", "x3", "x4"];
  const SPEED_FRAC = [[1, 4], [1, 3], [1, 2], [2, 3], [3, 4], [1, 1], [3, 2], [2, 1], [3, 1], [4, 1]];
  // Piano keys: lower row from the cursor octave, upper row one higher.
  const KEYMAP = { z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, ",": 12, l: 13, ".": 14,
    q: 12, 2: 13, w: 14, 3: 15, e: 16, r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23, i: 24, 9: 25, o: 26, 0: 27, p: 28 };
  // Cursor fields in a track and their widths in characters.
  const FIELDS = ["note", "vel", "gate", "fx", "p1", "p2"];
  const CH = [3, 2, 1, 1, 1, 1];  // note, vel (two digits), gate, fx, param digits
  const ROWH = 16, HEAD = 40, VIS = 26;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const mod = (a, m) => ((a % m) + m) % m;
  const hex = (v, n) => v.toString(16).toUpperCase().padStart(n, "0");
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);

  function setting(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    const v = view.node.params[id] ?? p.default;
    return Math.round(p.min + v * (p.max - p.min));
  }
  const freshPattern = () => ({ rows: 16, tracks: [[], [], [], []] });
  function data(view) {
    let d = view.node.data;
    if (!d || !Array.isArray(d.patterns)) {
      d = view.node.data = { pattern: 0, octave: 4, edit: 1, order: [0], patterns: Array.from({ length: PATTERNS }, freshPattern) };
      d.patterns[0].tracks[0] = [[0, 36, 112, 6, 0, 0], [4, 36, 0, 6, 0, 0], [8, 43, 0, 6, 0, 0], [12, 39, 0, 6, 0, 0]];
      d.patterns[0].tracks[1] = [[0, 72, 0, 0, 0, 0], [2, 75, 0, 0, 0, 0], [4, 79, 0, 0, 0, 0]];
    }
    while (d.patterns.length < PATTERNS) d.patterns.push(freshPattern());
    for (const p of d.patterns) {
      p.rows = clamp(p.rows | 0 || 16, MINROWS, MAXROWS);
      if (!Array.isArray(p.tracks)) p.tracks = [];
      while (p.tracks.length < TRACKS) p.tracks.push([]);
    }
    if (!Array.isArray(d.order) || !d.order.length) d.order = [0];
    if (d.pattern == null) d.pattern = 0;
    if (d.octave == null) d.octave = 4;
    if (d.edit == null) d.edit = 1;
    return d;
  }
  const pat = (view) => data(view).patterns[clamp(data(view).pattern, 0, PATTERNS - 1)];
  function send(view) { view.api.setData(JSON.parse(JSON.stringify(data(view)))); }
  function edit(view, fn) {
    view.api.beginGesture();
    fn(data(view), pat(view));
    send(view);
    draw(view);
  }
  function find(p, track, row) { return p.tracks[track].find((c) => c[0] === row); }
  function cellAt(p, track, row) {
    const c = find(p, track, row);
    return c ? c : [row, 0, 0, 0, 0, 0];
  }
  /// Writes a cell, dropping it when it became empty.
  function putCell(p, track, row, c) {
    const list = p.tracks[track], i = list.findIndex((x) => x[0] === row);
    const empty = c[1] === 0 && c[4] === 0;
    if (i >= 0) { if (empty) list.splice(i, 1); else list[i] = c; }
    else if (!empty) list.push(c);
  }
  const noteText = (n) => (n === 0 ? "···" : n === OFF ? "===" : NAMES[n % 12] + (Math.floor(n / 12) - 1));

  /// Master rows after which all four tracks are back at their first row together (null: more than 4096).
  function realign(view) {
    const fr = [];
    for (let k = 0; k < TRACKS; k++) {
      const [a, b] = SPEED_FRAC[clamp(setting(view, "speed" + (k + 1)), 0, 9)];
      const len = Math.min(setting(view, "length" + (k + 1)), pat(view).rows);
      let n = len * b, m = a, g = gcd(n, m);  // the track's period in master rows: len / speed
      fr.push([n / g, m / g]);
    }
    // lcm of fractions n/m = lcm(n) / gcd(m)
    let ln = 1, gm = 0;
    for (const [n, m] of fr) { ln = (ln * n) / gcd(ln, n); gm = gcd(gm, m); if (ln > 1e6) return null; }
    const v = ln / gm;
    return v > 4096 ? null : v;
  }

  // ---- drawing -------------------------------------------------------------
  function colX(t, f, cw) {  // x of a field in a track
    let x = 34 + t * (cw * 15 + 14);
    for (let i = 0; i < f; i++) x += (CH[i] + 1) * cw;
    return x;
  }
  function draw(view) {
    const r = view.lines;
    if (!r) return;
    const c = r.canvas, d = data(view), p = pat(view), st = r.state || {};
    const dpr = window.devicePixelRatio || 1;
    g_font(r);
    const cw = r.cw, W = 34 + TRACKS * (cw * 15 + 14), Hh = HEAD + VIS * ROWH + 6;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(Hh * dpr)) {
      c.width = Math.round(W * dpr); c.height = Math.round(Hh * dpr);
      c.style.width = W + "px"; c.style.height = Hh + "px";
    }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, Hh);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim() || "#e0856a";
    const line = css.getPropertyValue("--line").trim() || "#333";
    const muted = css.getPropertyValue("--muted").trim() || "#888";
    const text = css.getPropertyValue("--text").trim() || "#ddd";
    const panel2 = css.getPropertyValue("--panel-2").trim() || "#222";
    g.font = r.font;
    g.textBaseline = "middle";
    const playing = (st.pattern ?? 0) === d.pattern;
    // keep the cursor row in view
    r.top = clamp(r.top, 0, Math.max(0, p.rows - VIS));
    if (r.cur.row < r.top) r.top = r.cur.row;
    if (r.cur.row >= r.top + VIS) r.top = r.cur.row - VIS + 1;

    // track headers
    for (let t = 0; t < TRACKS; t++) {
      const x0 = colX(t, 0, cw), n = t + 1;
      const sp = SPEED_NAMES[clamp(setting(view, "speed" + n), 0, 9)], len = setting(view, "length" + n);
      const muted_ = setting(view, "mute" + n) >= 0.5;
      g.fillStyle = muted_ ? line : accent;
      g.globalAlpha = muted_ ? 0.6 : 0.9;
      g.fillRect(x0 - 3, 2, cw * 15 + 8, 17);
      g.globalAlpha = 1;
      g.fillStyle = "#101010";
      g.textAlign = "left";
      g.fillText((muted_ ? "× " : "") + "Track " + n, x0, 11);
      g.fillStyle = muted;
      g.fillText(sp + "  len " + Math.min(len, p.rows) + (r.cur.track === t ? "" : ""), x0, 30);
    }
    g.fillStyle = muted;
    g.textAlign = "right";
    // rows
    for (let i = 0; i < VIS; i++) {
      const row = r.top + i;
      if (row >= p.rows) break;
      const y = HEAD + i * ROWH;
      if (row % 16 === 0) { g.fillStyle = line; g.globalAlpha = 0.9; g.fillRect(0, y, W, ROWH); }
      else if (row % 4 === 0) { g.fillStyle = line; g.globalAlpha = 0.45; g.fillRect(0, y, W, ROWH); }
      g.globalAlpha = 1;
      const masterNow = playing && st.row === row;
      g.fillStyle = masterNow ? accent : muted;
      g.textAlign = "right";
      g.fillText(String(row).padStart(2, "0"), 26, y + ROWH / 2);
      for (let t = 0; t < TRACKS; t++) {
        const len = Math.min(setting(view, "length" + (t + 1)), p.rows);
        const x0 = colX(t, 0, cw), here = playing && st["row" + t] === row;
        const outside = row >= len;
        if (here) { g.fillStyle = accent; g.globalAlpha = 0.28; g.fillRect(x0 - 3, y, cw * 15 + 8, ROWH); g.globalAlpha = 1; }
        const c = cellAt(p, t, row);
        const vals = [noteText(c[1]), c[2] ? hex(c[2], 2) : "··", c[3] ? hex(c[3], 1) : "·", FX[c[4]] === "-" ? "·" : FX[c[4]],
          c[4] ? hex(c[5] >> 4, 1) : "·", c[4] ? hex(c[5] & 15, 1) : "·"];
        g.textAlign = "left";
        for (let f = 0; f < 6; f++) {
          const on = r.cur.row === row && r.cur.track === t && r.cur.field === f;
          const x = colX(t, f, cw), fw = f === 1 ? 2 : f === 0 ? 3 : 1;
          if (on) { g.fillStyle = text; g.fillRect(x - 1, y + 1, fw * cw + 2, ROWH - 2); }
          g.globalAlpha = outside && !on ? 0.35 : 1;
          g.fillStyle = on ? "#101010" : (f === 0 && c[1] ? text : f === 3 && c[4] ? accent : muted);
          g.fillText(vals[f], x, y + ROWH / 2);
          g.globalAlpha = 1;
        }
        if (row === len && len < p.rows) {  // the track wraps here
          g.fillStyle = accent; g.globalAlpha = 0.5; g.fillRect(x0 - 3, y, cw * 15 + 8, 1); g.globalAlpha = 1;
        }
      }
    }
    // column separators
    g.strokeStyle = line;
    for (let t = 1; t <= TRACKS; t++) {
      const x = colX(t, 0, cw) - 8.5;
      g.beginPath(); g.moveTo(x, HEAD - 4); g.lineTo(x, Hh); g.stroke();
    }
    r.help.textContent = helpFor(view);
    r.drawDrift(view);
  }
  function g_font(r) {
    if (r.cw) return;
    r.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    const t = document.createElement("canvas").getContext("2d");
    t.font = r.font;
    r.cw = Math.ceil(t.measureText("M").width);
  }
  function helpFor(view) {
    const r = view.lines, c = cellAt(pat(view), r.cur.track, r.cur.row), f = FIELDS[r.cur.field];
    if (f === "note") return "Notes: Z-M and Q-U play like piano keys, 1 = note off, [ ] octave, +/- transpose, Delete clears.";
    if (f === "vel") return "Velocity 00-7F (hex); 00 uses the Velocity setting.";
    if (f === "gate") return "Gate length 1-F in eighths of a row (8 = a full row); 0 uses the Gate setting.";
    if (f === "fx") return "Effect: R retrigger, S slide, P probability, T transpose, J jump, K skip; . removes.";
    return FX_HELP[c[4]] || "Type an effect letter first.";
  }

  // ---- the drift panel -----------------------------------------------------
  function drawDrift(view) {
    const r = view.lines, c = r.drift, st = r.state || {}, p = pat(view);
    const dpr = window.devicePixelRatio || 1, W = 300, Hh = 190;
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(Hh * dpr); c.style.width = W + "px"; c.style.height = Hh + "px"; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, Hh);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim() || "#e0856a";
    const line = css.getPropertyValue("--line").trim() || "#333";
    const muted = css.getPropertyValue("--muted").trim() || "#888";
    const text = css.getPropertyValue("--text").trim() || "#ddd";
    g.font = "10px system-ui, sans-serif";
    g.textBaseline = "middle";
    for (let t = 0; t < TRACKS; t++) {
      const cx = 70, cy = 0, rad = 14 + 0 * t;
      const y = 22 + t * 42, len = Math.min(setting(view, "length" + (t + 1)), p.rows);
      const sp = SPEEDS[clamp(setting(view, "speed" + (t + 1)), 0, 9)];
      // a ring of `len` ticks, the playhead as a dot
      g.strokeStyle = line; g.lineWidth = 1;
      g.beginPath(); g.arc(cx, y, 15, 0, Math.PI * 2); g.stroke();
      for (let i = 0; i < len; i++) {
        const a = (i / len) * Math.PI * 2 - Math.PI / 2, filled = cellAt(p, t, i)[1] > 0;
        g.fillStyle = filled ? text : muted;
        g.globalAlpha = filled ? 1 : 0.5;
        g.fillRect(cx + Math.cos(a) * 15 - 1, y + Math.sin(a) * 15 - 1, 2, 2);
      }
      g.globalAlpha = 1;
      const rowNow = st["row" + t] ?? 0, a = (rowNow / len) * Math.PI * 2 - Math.PI / 2;
      g.fillStyle = accent;
      g.beginPath(); g.arc(cx + Math.cos(a) * 15, y + Math.sin(a) * 15, 3.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = muted;
      g.textAlign = "left";
      g.fillText("Track " + (t + 1), 100, y - 8);
      g.fillStyle = text;
      g.fillText(SPEED_NAMES[clamp(setting(view, "speed" + (t + 1)), 0, 9)] + " · " + len + " rows · cycle " + (len / sp).toFixed(len / sp % 1 ? 1 : 0), 100, y + 8);
      g.fillStyle = muted;
      g.textAlign = "right";
      g.fillText(String(rowNow).padStart(2, "0"), 38, y);
    }
    const n = realign(view);
    g.fillStyle = muted;
    g.textAlign = "left";
    g.fillText(n ? "All four line up every " + n + " rows" + (n >= 16 ? " (" + (n / 16).toFixed(n % 16 ? 1 : 0) + (n === 16 ? " bar" : " bars") + " at 1/16)" : "") : "The tracks do not line up within 4096 rows", 6, Hh - 10);
  }

  // ---- editing -------------------------------------------------------------
  function moveCursor(view, dRow, dTrack, dField) {
    const r = view.lines, p = pat(view);
    r.typed = 0;
    if (dField) {
      let f = r.cur.field + dField, t = r.cur.track;
      if (f < 0) { t = mod(t - 1, TRACKS); f = FIELDS.length - 1; }
      else if (f >= FIELDS.length) { t = (t + 1) % TRACKS; f = 0; }
      r.cur.field = f; r.cur.track = t;
    }
    if (dTrack) { r.cur.track = mod(r.cur.track + dTrack, TRACKS); }
    if (dRow) r.cur.row = clamp(r.cur.row + dRow, 0, p.rows - 1);
    draw(view);
  }
  function advance(view) { moveCursor(view, data(view).edit, 0, 0); }
  function setField(view, fn) {
    const r = view.lines;
    edit(view, (d, p) => {
      const c = cellAt(p, r.cur.track, r.cur.row).slice();
      fn(c);
      putCell(p, r.cur.track, r.cur.row, c);
    });
  }
  function onKey(view, e) {
    const r = view.lines, d = data(view), p = pat(view), f = FIELDS[r.cur.field];
    e.stopPropagation();
    const k = e.key, lower = k.length === 1 ? k.toLowerCase() : k;
    if (e.metaKey || e.ctrlKey) return;
    const moves = { ArrowUp: [-1, 0, 0], ArrowDown: [1, 0, 0], ArrowLeft: [0, 0, -1], ArrowRight: [0, 0, 1], PageUp: [-16, 0, 0], PageDown: [16, 0, 0] };
    if (moves[k]) { e.preventDefault(); moveCursor(view, ...moves[k]); return; }
    if (k === "Tab") { e.preventDefault(); r.cur.field = 0; moveCursor(view, 0, e.shiftKey ? -1 : 1, 0); return; }
    if (k === "Home") { e.preventDefault(); r.cur.row = 0; moveCursor(view, 0, 0, 0); return; }
    if (k === "End") { e.preventDefault(); r.cur.row = p.rows - 1; moveCursor(view, 0, 0, 0); return; }
    if (k === "Enter") {  // insert an empty row in this track (Shift: remove the row)
      e.preventDefault();
      edit(view, (dd, pp) => {
        const list = pp.tracks[r.cur.track], row = r.cur.row;
        if (e.shiftKey) {
          pp.tracks[r.cur.track] = list.filter((c) => c[0] !== row).map((c) => (c[0] > row ? [c[0] - 1, ...c.slice(1)] : c));
        } else {
          pp.tracks[r.cur.track] = list.map((c) => (c[0] >= row ? [c[0] + 1, ...c.slice(1)] : c)).filter((c) => c[0] < pp.rows);
        }
      });
      return;
    }
    if (k === "Delete" || k === "Backspace") {
      e.preventDefault();
      if (e.shiftKey) setField(view, (c) => { c[1] = c[2] = c[3] = c[4] = c[5] = 0; });
      else setField(view, (c) => {
        if (f === "note") c[1] = 0;
        else if (f === "vel") c[2] = 0;
        else if (f === "gate") c[3] = 0;
        else c[4] = c[5] = 0;
      });
      advance(view);
      return;
    }
    if (k === "[" || k === "]") { e.preventDefault(); d.octave = clamp(d.octave + (k === "]" ? 1 : -1), 0, 8); send(view); r.syncControls(); return; }
    if (f === "note") {
      if (k === "1") { e.preventDefault(); setField(view, (c) => (c[1] = OFF)); advance(view); return; }
      if ((k === "+" || k === "=" || k === "-") && !e.altKey) {
        e.preventDefault();
        const step = (k === "-" ? -1 : 1) * (e.shiftKey ? 12 : 1);
        setField(view, (c) => { if (c[1] > 0 && c[1] < OFF) c[1] = clamp(c[1] + step, 1, 127); });
        return;
      }
      if (lower in KEYMAP && !e.altKey) {
        e.preventDefault();
        const note = clamp(KEYMAP[lower] + (d.octave + 1) * 12, 1, 127);
        setField(view, (c) => (c[1] = note));
        advance(view);
        return;
      }
    } else if (f === "fx") {
      const i = FX.findIndex((s) => s.toLowerCase() === lower && s !== "-");
      if (i > 0) { e.preventDefault(); setField(view, (c) => { c[4] = i; if (!c[5]) c[5] = i === 1 ? 4 : i === 3 ? 128 : 0; }); return; }
      if (k === ".") { e.preventDefault(); setField(view, (c) => (c[4] = c[5] = 0)); return; }
    } else if (/^[0-9a-f]$/i.test(k)) {
      e.preventDefault();
      const dv = parseInt(k, 16);
      if (f === "vel") {
        setField(view, (c) => (c[2] = clamp(r.typed === 1 ? ((c[2] & 15) << 4) | dv : dv, 0, 127)));
        r.typed = (r.typed + 1) % 2;
        if (r.typed === 0) advance(view);
      } else if (f === "gate") {
        setField(view, (c) => (c[3] = dv));
        advance(view);
      } else if (f === "p1" || f === "p2") {
        setField(view, (c) => {
          if (!c[4]) return;
          c[5] = f === "p1" ? (dv << 4) | (c[5] & 15) : (c[5] & 240) | dv;
        });
        if (f === "p1") moveCursor(view, 0, 0, 1); else { r.cur.field = 4; advance(view); }
      }
    }
  }
  function attach(view, c) {
    const r = view.lines;
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      c.focus();
      const b = c.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, cw = r.cw;
      if (y < HEAD) {
        for (let t = 0; t < TRACKS; t++) {
          const x0 = colX(t, 0, cw);
          if (x >= x0 - 3 && x < x0 + cw * 15 + 5 && y < 20) {
            const n = t + 1, v = setting(view, "mute" + n) >= 0.5 ? 0 : 1;
            view.api.beginGesture();
            view.node.params["mute" + n] = v;
            view.api.setParam("mute" + n, v);
            draw(view);
            return;
          }
        }
        return;
      }
      const row = r.top + Math.floor((y - HEAD) / ROWH);
      if (row < 0 || row >= pat(view).rows) return;
      for (let t = TRACKS - 1; t >= 0; t--) {
        if (x < colX(t, 0, cw) - 4) continue;
        let fld = 0;
        for (let f = 0; f < 6; f++) if (x >= colX(t, f, cw) - 2) fld = f;
        r.cur = { row, track: t, field: fld };
        r.typed = 0;
        break;
      }
      draw(view);
    });
    c.addEventListener("keydown", (e) => onKey(view, e));
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      r.top = clamp(r.top + Math.sign(e.deltaY) * 2, 0, Math.max(0, pat(view).rows - VIS));
      draw(view);
    }, { passive: false });
  }

  // ---- toolbar and order list ------------------------------------------------
  function buildOrder(view) {
    const r = view.lines, d = data(view), box = r.orderBox, st = r.state || {};
    box.innerHTML = "";
    d.order.forEach((pi, i) => {
      const b = document.createElement("button");
      b.textContent = String(pi + 1).padStart(2, "0");
      b.className = "ln-chip" + (i === r.selOrd ? " sel" : "") + (st.order === i ? " play" : "");
      b.title = "Pattern " + (pi + 1) + " (click: select; right-click: remove)";
      b.addEventListener("click", () => { r.selOrd = i; d.pattern = pi; send(view); r.syncControls(); draw(view); });
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (d.order.length > 1) edit(view, (dd) => { dd.order.splice(i, 1); r.selOrd = Math.min(r.selOrd, dd.order.length - 1); });
        buildOrder(view);
      });
      box.appendChild(b);
    });
  }
  const STYLE = `
    .ln-panel { flex: 1 1 100%; min-width: 0; }
    .ln-tools { display: flex; gap: 4px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
    .ln-tools button, .ln-tools select, .ln-tools input { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 6px;
      padding: 2px 7px; font: inherit; font-size: 11px; cursor: pointer; }
    .ln-tools label { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 4px; }
    .ln-tools input[type=number] { width: 50px; cursor: text; }
    .ln-order { display: flex; gap: 2px; flex-wrap: wrap; margin: 0 0 6px; align-items: center; font-size: 11px; color: var(--muted); }
    .ln-chip { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 5px; padding: 1px 5px; font: 11px ui-monospace, Menlo, monospace; cursor: pointer; }
    .ln-chip.sel { border-color: var(--accent); }
    .ln-chip.play { box-shadow: inset 0 -3px 0 var(--accent); }
    .ln-body { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
    .ln-body canvas { display: block; outline: none; touch-action: none; }
    .ln-body canvas.ln-main { cursor: cell; border-radius: 6px; }
    .ln-side { display: flex; flex-direction: column; gap: 6px; }
    .ln-help { font-size: 11px; color: var(--muted); max-width: 520px; min-height: 28px; margin-top: 4px; }`;

  BleepViews.register("lines", {
    partNames: ["Tracker"],
    top: true,
    width: 1000,
    layout: [
      { title: "Time", params: ["syncto", "rate", "drift", "gate", "velocity"] },
      { title: "Track 1", params: ["speed1", "length1", "octave1", "mute1"] },
      { title: "Track 2", params: ["speed2", "length2", "octave2", "mute2"] },
      { title: "Track 3", params: ["speed3", "length3", "octave3", "mute3"] },
      { title: "Track 4", params: ["speed4", "length4", "octave4", "mute4"] },
      { title: "Pitch", params: ["root", "scale", "quantize", "harmony", "seed"] },
    ],
    template: `<div class="bv-panel ln-panel">
      <div class="ln-tools">
        <label>Pattern <select class="ln-pat">${Array.from({ length: PATTERNS }, (_, i) => `<option value="${i}">${String(i + 1).padStart(2, "0")}</option>`).join("")}</select></label>
        <label>Rows <input type="number" class="ln-rows" min="${MINROWS}" max="${MAXROWS}"></label>
        <label>Octave <select class="ln-oct">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((o) => `<option>${o}</option>`).join("")}</select></label>
        <label>Step <select class="ln-step">${[0, 1, 2, 3, 4, 8].map((o) => `<option>${o}</option>`).join("")}</select></label>
        <button class="ln-copy" title="Copy this pattern into the next free one and select it">Duplicate</button>
        <button class="ln-clear" title="Empty this pattern">Clear</button>
      </div>
      <div class="ln-order"><span>Order</span><span class="ln-chips"></span>
        <button class="ln-chip ln-add" title="Add the shown pattern after the selected entry">+</button>
        <button class="ln-chip ln-rm" title="Remove the selected entry">−</button></div>
      <div class="ln-body">
        <div><canvas class="ln-main" tabindex="0"></canvas><div class="ln-help"></div></div>
        <div class="ln-side"><canvas class="ln-drift"></canvas></div>
      </div>
    </div>`,
    afterBuild(view, el) {
      if (!document.getElementById("ln-style")) {
        const s = document.createElement("style");
        s.id = "ln-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      const canvas = el.querySelector(".ln-main");
      const r = (view.lines = { canvas, drift: el.querySelector(".ln-drift"), help: el.querySelector(".ln-help"), orderBox: el.querySelector(".ln-chips"),
        state: null, cur: { row: 0, track: 0, field: 0 }, top: 0, typed: 0, selOrd: 0, drawDrift: (v) => drawDrift(v) });
      attach(view, canvas);
      const sel = el.querySelector(".ln-pat"), rows = el.querySelector(".ln-rows"), oct = el.querySelector(".ln-oct"), step = el.querySelector(".ln-step");
      r.syncControls = () => {
        const d = data(view), p = pat(view);
        sel.value = String(d.pattern);
        rows.value = String(p.rows);
        oct.value = String(d.octave);
        step.value = String(d.edit);
        buildOrder(view);
      };
      sel.addEventListener("change", () => { view.api.beginGesture(); data(view).pattern = +sel.value; r.cur.row = 0; send(view); r.syncControls(); draw(view); });
      rows.addEventListener("keydown", (e) => e.stopPropagation());
      rows.addEventListener("change", () => edit(view, (d, p) => {
        p.rows = clamp(parseInt(rows.value, 10) || 16, MINROWS, MAXROWS);
        rows.value = String(p.rows);
        for (const list of p.tracks) for (let i = list.length - 1; i >= 0; i--) if (list[i][0] >= p.rows) list.splice(i, 1);
        r.cur.row = Math.min(r.cur.row, p.rows - 1);
      }));
      oct.addEventListener("change", () => { view.api.beginGesture(); data(view).octave = +oct.value; send(view); });
      step.addEventListener("change", () => { view.api.beginGesture(); data(view).edit = +step.value; send(view); });
      el.querySelector(".ln-clear").addEventListener("click", () => edit(view, (d, p) => (p.tracks = [[], [], [], []])));
      el.querySelector(".ln-copy").addEventListener("click", () => edit(view, (d, p) => {
        let to = -1;
        for (let i = 1; i <= PATTERNS; i++) {
          const j = (d.pattern + i) % PATTERNS;
          if (d.patterns[j].tracks.every((l) => !l.length)) { to = j; break; }
        }
        if (to < 0) return;
        d.patterns[to] = JSON.parse(JSON.stringify(p));
        d.pattern = to;
        r.syncControls();
      }));
      el.querySelector(".ln-add").addEventListener("click", () => {
        edit(view, (d) => { if (d.order.length < MAXORDER) d.order.splice(r.selOrd + 1, 0, d.pattern); r.selOrd = Math.min(r.selOrd + 1, d.order.length - 1); });
        buildOrder(view);
      });
      el.querySelector(".ln-rm").addEventListener("click", () => {
        edit(view, (d) => { if (d.order.length > 1) d.order.splice(r.selOrd, 1); r.selOrd = Math.min(r.selOrd, d.order.length - 1); });
        buildOrder(view);
      });
      r.syncControls();
      requestAnimationFrame(() => draw(view));
    },
    onState(st, view) {
      if (!view.lines) return;
      const was = view.lines.state && view.lines.state.order;
      view.lines.state = st;
      if (was !== st.order) buildOrder(view);
      draw(view);
    },
    onRefresh(view) {
      if (!view.lines) return;
      view.lines.syncControls();
      draw(view);
    },
  });
})();
