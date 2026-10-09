// SPDX-License-Identifier: MIT
// Polymeter Seq view (doc/specs/modules/polymeter-sequencer.md §5): six track rows
// (Trigger, Note, Octave, Gate, Probability, Ratchet), each with its length,
// loop window, division, direction, mute and dice; a playhead per track, a
// phase strip, the full-cycle length and the pattern slots. Slots live in the
// node's data; edits go to the engine with api.setData.
(function () {
  "use strict";
  const SLOTS = 8, STEPS = 64, COL = 12, ROW = 32, STRIP = 16;
  const KEYS = ["trig", "note", "oct", "gate", "prob", "ratch"];
  const LABELS = ["TRIG", "NOTE", "OCT", "GATE", "PROB", "RATCH"];
  const NEUTRAL = [1, 0, 0, 50, 100, [1, 0]];
  const RANGE = [[0, 2], [-14, 21], [-3, 3], [5, 100], [0, 100], [1, 8]];
  const DIVS = ["x4", "x3", "x2", "1", "/2", "/3", "/4", "/5", "/6", "/7", "/8", "/16"];
  const DIRS = [["fwd", "→"], ["bwd", "←"], ["pp", "↔"], ["rnd", "?"]];
  const H = KEYS.length * ROW + STRIP + 4;
  // Same order and notes as patch/common/dsp/Scales.h.
  const SCALES = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7, 8, 11],
    [0, 2, 3, 5, 7, 9, 11], [0, 2, 3, 5, 7, 9, 10], [0, 1, 3, 5, 7, 8, 10], [0, 2, 4, 6, 7, 9, 11],
    [0, 2, 4, 5, 7, 9, 10], [0, 1, 3, 5, 6, 8, 10], [0, 1, 4, 5, 7, 8, 10], [0, 2, 4, 7, 9], [0, 3, 5, 7, 10],
    [0, 3, 5, 6, 7, 10], [0, 2, 4, 6, 8, 10], [0, 2, 3, 5, 6, 8, 9, 11], [0, 2, 3, 7, 8],
  ];
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const mod = (a, m) => ((a % m) + m) % m;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const lcm = (a, b) => (a / gcd(a, b)) * b;
  const multOf = (div) => ({ x4: 4, x3: 3, x2: 2 })[div] || 1;
  const divOf = (div) => (div[0] === "/" ? parseInt(div.slice(1), 10) : 1);

  function freshTrack(k) {
    const len = [16, 7, 5, 16, 16, 16][k];
    return { len, lo: 0, hi: len - 1, div: "1", dir: "fwd", mute: false,
             steps: Array.from({ length: STEPS }, () => (k === 5 ? [1, 0] : NEUTRAL[k])) };
  }
  function data(view) {
    let d = view.node.data;
    if (!d || !Array.isArray(d.slots)) d = view.node.data = { slot: 0, slots: [] };
    while (d.slots.length < SLOTS) d.slots.push({ tracks: {} });
    for (const s of d.slots) {
      if (!s.tracks) s.tracks = {};
      KEYS.forEach((key, k) => { if (!s.tracks[key]) s.tracks[key] = freshTrack(k); });
    }
    if (!d.randomize) d.randomize = { density: 0.5, degrees: [0, 7], stepwise: true, ratchet: 0.1 };
    if (typeof d.slot !== "number") d.slot = 0;
    return d;
  }
  const slotOf = (view) => data(view).slots[clamp(data(view).slot, 0, SLOTS - 1)];
  function degreeName(view, deg) {
    const scale = SCALES[clamp(view.units("scale"), 0, SCALES.length - 1)], n = scale.length;
    const oct = Math.floor(deg / n), semis = scale[mod(deg, n)] + 12 * oct;
    const note = 60 + view.units("root") + view.units("octave") * 12 + semis;
    return NAMES[mod(note, 12)] + (Math.floor(note / 12) - 1);
  }
  function period(t) { const L = t.hi - t.lo + 1; return t.dir === "pp" && L > 1 ? 2 * L - 2 : L; }
  function cycleTicks(slot) {
    let c = 1;
    for (const key of KEYS) {
      const t = slot.tracks[key];
      if (t.mute) continue;
      const P = period(t), m = multOf(t.div);
      c = lcm(c, m > 1 ? P / gcd(P, m) : P * divOf(t.div));
      if (c > 2 ** 31) return Infinity;
    }
    return c;
  }
  function send(view) { view.api.setData(JSON.parse(JSON.stringify(data(view)))); }
  function edit(view, fn) {
    view.api.beginGesture();
    fn(data(view));
    send(view);
    redraw(view);
  }

  // ---- drawing --------------------------------------------------------------
  function draw(view) {
    const c = view.pm && view.pm.canvas;
    if (!c) return;
    const slot = slotOf(view), st = view.pm.state || {};
    const w = STEPS * COL + 2, dpr = window.devicePixelRatio || 1;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = H * dpr; c.style.width = w + "px"; c.style.height = H + "px"; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, H);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim() || "#f59e6b";
    const line = css.getPropertyValue("--line").trim() || "#333";
    const muted = css.getPropertyValue("--muted").trim() || "#888";
    const text = css.getPropertyValue("--text").trim() || "#ddd";
    const playing = st.slot === undefined || st.slot === data(view).slot;
    g.font = "8px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    KEYS.forEach((key, k) => {
      const t = slot.tracks[key], y0 = k * ROW, top = y0 + 4, bot = y0 + ROW - 6, h = bot - top;
      const [lo, hi] = RANGE[k], pos = st["pos" + k];
      for (let i = 0; i < t.len; i++) {
        const x = i * COL, inLoop = i >= t.lo && i <= t.hi, v = t.steps[i];
        g.globalAlpha = (inLoop ? 1 : 0.3) * (t.mute ? 0.4 : 1);
        if (playing && i === pos) { g.fillStyle = line; g.fillRect(x, y0, COL, ROW - 2); }
        g.fillStyle = accent;
        g.strokeStyle = muted;
        if (k === 0) {
          if (v === 0) g.strokeRect(x + 2.5, bot - 6.5, COL - 5, 6);
          else g.fillRect(x + 2, v === 2 ? top + 2 : bot - 12, COL - 4, v === 2 ? h - 2 : 12);
        } else if (k === 1 || k === 2) {
          const zero = bot - ((0 - lo) / (hi - lo)) * h, y = bot - ((v - lo) / (hi - lo)) * h;
          g.fillRect(x + 3, Math.min(y, zero), COL - 6, Math.max(1, Math.abs(zero - y)));
          g.fillRect(x + 2, y - 1, COL - 4, 2);
        } else if (k === 3) {
          if (v < 0) { g.fillRect(x + 1, top + 4, COL - 1, 4); g.fillStyle = text; g.fillText("T", x + COL / 2, bot - 4); }
          else { const bh = (v / 100) * h; g.fillRect(x + 2, bot - bh, COL - 4, bh); }
        } else if (k === 4) {
          const bh = Math.max(1, (v / 100) * h);
          g.fillRect(x + 2, bot - bh, COL - 4, bh);
        } else {
          const [n, shape] = v;
          for (let q = 0; q < n; q++) g.fillRect(x + 2, bot - 2 - q * 3, COL - 4, 2);
          if (shape) { g.fillStyle = text; g.fillText(shape === 1 ? "»" : "«", x + COL / 2, top + 3); }
        }
      }
      g.globalAlpha = 1;
      // loop bracket
      g.strokeStyle = accent;
      g.beginPath();
      g.moveTo(t.lo * COL + 0.5, y0 + ROW - 3); g.lineTo(t.lo * COL + 0.5, y0 + ROW - 1); g.lineTo((t.hi + 1) * COL - 0.5, y0 + ROW - 1);
      g.lineTo((t.hi + 1) * COL - 0.5, y0 + ROW - 3);
      g.stroke();
      g.strokeStyle = line;
      g.beginPath(); g.moveTo(0, y0 + ROW + 0.5); g.lineTo(w, y0 + ROW + 0.5); g.stroke();
    });
    // phase strip: where each track is in its loop
    const sy = KEYS.length * ROW + 4;
    KEYS.forEach((key, k) => {
      const t = slot.tracks[key], pos = st["pos" + k], L = t.hi - t.lo + 1;
      const x = 4 + k * 64;
      g.fillStyle = line;
      g.fillRect(x, sy + 4, 56, 4);
      if (typeof pos === "number" && playing) {
        g.fillStyle = t.mute ? muted : accent;
        g.fillRect(x, sy + 4, (56 * clamp(pos - t.lo + 1, 0, L)) / L, 4);
      }
      g.fillStyle = muted;
      g.textAlign = "left";
      g.fillText(LABELS[k][0], x + 58, sy + 6);
      g.textAlign = "center";
    });
    const cyc = cycleTicks(slot);
    view.pm.cycle.textContent = "cycle: " + (cyc === Infinity ? "∞" : cyc + " steps");
  }

  function drawRows(view) {
    const slot = slotOf(view);
    view.pm.rows.forEach((r, k) => {
      const t = slot.tracks[KEYS[k]];
      r.len.value = t.len;
      r.div.value = t.div;
      r.dir.textContent = (DIRS.find((d) => d[0] === t.dir) || DIRS[0])[1];
      r.mute.classList.toggle("on", !!t.mute);
    });
    const d = data(view), used = clamp(view.units("slots"), 1, SLOTS), st = view.pm.state || {};
    view.pm.slots.forEach((b, s) => {
      b.classList.toggle("on", s === d.slot);
      b.classList.toggle("playing", s === st.slot);
      b.style.opacity = s < used ? 1 : 0.45;
    });
  }
  function redraw(view) { draw(view); drawRows(view); }

  // ---- editing --------------------------------------------------------------
  function attach(view, c) {
    let drag = null;
    const at = (e) => {
      const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      return { k: Math.floor(y / ROW), i: clamp(Math.floor(x / COL), 0, STEPS - 1), x, y };
    };
    const valueAt = (k, y) => {
      const [lo, hi] = RANGE[k], top = k * ROW + 4, bot = k * ROW + ROW - 6;
      return clamp(Math.round(lo + ((bot - y) / (bot - top)) * (hi - lo)), lo, hi);
    };
    const apply = (e) => {
      const h = at(e), t = slotOf(view).tracks[KEYS[drag.k]];
      if (drag.kind === "lo" || drag.kind === "hi") {
        const i = clamp(Math.round(h.x / COL) - (drag.kind === "hi" ? 1 : 0), 0, t.len - 1);
        if (drag.kind === "lo") t.lo = Math.min(i, t.hi); else t.hi = Math.max(i, t.lo);
      } else {
        if (h.i >= t.len) return;
        if (drag.kind === "paint") t.steps[h.i] = drag.value;
        else if (drag.k === 5) t.steps[h.i] = [valueAt(5, h.y), t.steps[h.i][1]];
        else t.steps[h.i] = valueAt(drag.k, h.y);
      }
      send(view);
      draw(view);
    };
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const h = at(e);
      if (h.k < 0 || h.k >= KEYS.length) return;
      e.stopPropagation();
      const t = slotOf(view).tracks[KEYS[h.k]];
      const yIn = h.y - h.k * ROW;
      if (yIn > ROW - 7) {  // the loop bracket: drag whichever end is nearer
        drag = { kind: Math.abs(h.x - t.lo * COL) < Math.abs(h.x - (t.hi + 1) * COL) ? "lo" : "hi", k: h.k };
      } else {
        if (h.i >= t.len) return;
        const v = t.steps[h.i];
        if (h.k === 0) drag = { kind: "paint", k: 0, value: (v + 1) % 3 };
        else if (h.k === 3 && e.shiftKey) return edit(view, () => (t.steps[h.i] = v < 0 ? 50 : -1));
        else if (h.k === 5 && e.shiftKey) return edit(view, () => (t.steps[h.i] = [v[0], (v[1] + 1) % 3]));
        else drag = { kind: "value", k: h.k };
      }
      c.setPointerCapture(e.pointerId);
      view.api.beginGesture();
      apply(e);
    });
    c.addEventListener("pointermove", (e) => {
      if (drag) return apply(e);
      const h = at(e);
      if (h.k === 1) {
        const t = slotOf(view).tracks.note;
        c.title = h.i < t.len ? degreeName(view, t.steps[h.i]) : "";
      } else c.title = "";
    });
    const end = () => (drag = null);
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("dblclick", (e) => {
      const h = at(e);
      if (h.k < 1 || h.k >= KEYS.length) return;
      const t = slotOf(view).tracks[KEYS[h.k]];
      if (h.i < t.len) edit(view, () => (t.steps[h.i] = h.k === 5 ? [1, 0] : NEUTRAL[h.k]));
    });
  }

  // ---- Randomize (spec §4.5) -----------------------------------------------------
  function randomizeTrack(view, d, k) {
    const t = d.slots[clamp(d.slot, 0, SLOTS - 1)].tracks[KEYS[k]], o = d.randomize;
    let deg = o.degrees[0];
    for (let i = 0; i < t.len; i++) {
      if (k === 0) t.steps[i] = Math.random() < o.density ? (Math.random() < 0.25 ? 2 : 1) : 0;
      else if (k === 1) {
        if (o.stepwise) deg = clamp(deg + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2)), o.degrees[0], o.degrees[1]);
        else deg = o.degrees[0] + Math.floor(Math.random() * (o.degrees[1] - o.degrees[0] + 1));
        t.steps[i] = deg;
      } else if (k === 2) t.steps[i] = Math.random() < 0.7 ? 0 : Math.random() < 0.5 ? 1 : -1;
      else if (k === 3) t.steps[i] = Math.random() < 0.1 ? -1 : 10 * (2 + Math.floor(Math.random() * 8));
      else if (k === 4) t.steps[i] = Math.random() < 0.6 ? 100 : 40 + 10 * Math.floor(Math.random() * 6);
      else t.steps[i] = Math.random() < o.ratchet ? [2 + Math.floor(Math.random() * 3), Math.floor(Math.random() * 3)] : [1, 0];
    }
  }
  function options(view, box) {
    const o = data(view).randomize;
    box.innerHTML = "";
    const save = () => { view.api.beginGesture(); send(view); };
    const num = (txt, v, min, max, set) => {
      const l = document.createElement("label");
      const n = Object.assign(document.createElement("input"), { type: "number", min, max, value: v, className: "bv-number" });
      n.addEventListener("change", () => { set(clamp(parseFloat(n.value) || 0, min, max)); save(); options(view, box); });
      l.append(txt + " ", n);
      box.appendChild(l);
    };
    num("Density %", Math.round(o.density * 100), 0, 100, (v) => (o.density = v / 100));
    num("Degrees from", o.degrees[0], -14, 21, (v) => (o.degrees = [v, Math.max(v, o.degrees[1])]));
    num("to", o.degrees[1], -14, 21, (v) => (o.degrees = [Math.min(v, o.degrees[0]), v]));
    num("Ratchet %", Math.round(o.ratchet * 100), 0, 100, (v) => (o.ratchet = v / 100));
    const l = document.createElement("label");
    const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: !!o.stepwise });
    cb.addEventListener("change", () => { o.stepwise = cb.checked; save(); });
    l.append(cb, " step-wise");
    box.appendChild(l);
  }

  const STYLE = `
    .pm-panel { flex: 1 1 100%; min-width: 0; }
    .pm-tools { display: flex; gap: 4px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; font-size: 11px; color: var(--muted); }
    .pm-tools button, .pm-row button { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 6px;
      padding: 1px 6px; font: inherit; font-size: 11px; cursor: pointer; }
    .pm-tools button.on, .pm-row button.on { border-color: var(--accent); color: var(--accent); }
    .pm-tools button.playing { box-shadow: inset 0 -2px 0 var(--accent); }
    .pm-tools .pm-cycle { margin-left: auto; }
    .pm-opts { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11px; color: var(--muted); margin-bottom: 6px; }
    .pm-opts .bv-number { width: 44px; }
    .pm-body { display: flex; }
    .pm-labels { width: 188px; flex: none; }
    .pm-row { height: ${ROW}px; display: flex; align-items: center; gap: 3px; font-size: 9px; color: var(--muted); letter-spacing: .04em; }
    .pm-row .pm-name { width: 36px; flex: none; }
    .pm-row input.bv-number { width: 38px; padding: 1px 2px; font-size: 10px; flex: none; }
    .pm-row select { width: 46px; font-size: 10px; flex: none; }
    .pm-row button { flex: none; }
    .pm-scroll { overflow-x: auto; flex: 1; min-width: 0; }
    .pm-scroll canvas { display: block; touch-action: none; cursor: crosshair; }`;

  BleepViews.register("polymeter-sequencer", {
    top: true,
    width: 680,
    template: `<div class="bv-panel pm-panel">
      <div class="pm-tools">
        Slot <span class="pm-slots"></span>
        <button class="pm-copy" title="Copy this slot">Copy</button><button class="pm-paste" title="Paste into this slot">Paste</button>
        <button class="pm-rand" title="Randomize every track (one undo step)">Randomize all</button>
        <button class="pm-more" title="Randomize options">▾</button>
        <span class="pm-cycle"></span>
      </div>
      <div class="pm-opts" hidden></div>
      <div class="pm-body">
        <div class="pm-labels"></div>
        <div class="pm-scroll"><canvas></canvas></div>
      </div>
    </div>`,
    afterBuild(view, el) {
      if (!document.getElementById("pm-style")) {
        const s = document.createElement("style");
        s.id = "pm-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      const canvas = el.querySelector("canvas");
      view.pm = { canvas, state: null, rows: [], slots: [], clip: null, cycle: el.querySelector(".pm-cycle") };
      const slots = el.querySelector(".pm-slots");
      for (let s = 0; s < SLOTS; s++) {
        const b = Object.assign(document.createElement("button"), { textContent: String(s + 1), title: "Edit and play this slot (when Pattern isn't patched)" });
        b.addEventListener("click", () => edit(view, (d) => (d.slot = s)));
        slots.appendChild(b);
        view.pm.slots.push(b);
      }
      el.querySelector(".pm-copy").addEventListener("click", () => (view.pm.clip = JSON.parse(JSON.stringify(slotOf(view)))));
      el.querySelector(".pm-paste").addEventListener("click", () => {
        if (view.pm.clip) edit(view, (d) => (d.slots[d.slot] = JSON.parse(JSON.stringify(view.pm.clip))));
      });
      el.querySelector(".pm-rand").addEventListener("click", () => edit(view, (d) => KEYS.forEach((_, k) => randomizeTrack(view, d, k))));
      const box = el.querySelector(".pm-opts"), more = el.querySelector(".pm-more");
      more.addEventListener("click", () => {
        box.hidden = !box.hidden;
        more.classList.toggle("on", !box.hidden);
        if (!box.hidden) options(view, box);
      });
      const labels = el.querySelector(".pm-labels");
      KEYS.forEach((key, k) => {
        const row = document.createElement("div");
        row.className = "pm-row";
        const name = Object.assign(document.createElement("span"), { className: "pm-name", textContent: LABELS[k] });
        const len = Object.assign(document.createElement("input"), { type: "number", min: 1, max: STEPS, className: "bv-number", title: "Length" });
        len.addEventListener("change", () => edit(view, () => {
          const t = slotOf(view).tracks[key], whole = t.hi === t.len - 1;  // a loop to the end follows the length
          t.len = clamp(parseInt(len.value, 10) || 1, 1, STEPS);
          t.hi = whole ? t.len - 1 : Math.min(t.hi, t.len - 1);
          t.lo = Math.min(t.lo, t.hi);
        }));
        const div = document.createElement("select");
        div.title = "Division of the base tick";
        for (const d of DIVS) div.appendChild(Object.assign(document.createElement("option"), { value: d, textContent: d.replace("x", "×") }));
        div.addEventListener("change", () => edit(view, () => (slotOf(view).tracks[key].div = div.value)));
        const dir = Object.assign(document.createElement("button"), { title: "Direction: forward, backward, ping-pong, random" });
        dir.addEventListener("click", () => edit(view, () => {
          const t = slotOf(view).tracks[key], i = DIRS.findIndex((d) => d[0] === t.dir);
          t.dir = DIRS[(i + 1) % DIRS.length][0];
        }));
        const mute = Object.assign(document.createElement("button"), { textContent: "M", title: "Mute: the track gives its neutral value" });
        mute.addEventListener("click", () => edit(view, () => (slotOf(view).tracks[key].mute = !slotOf(view).tracks[key].mute)));
        const dice = Object.assign(document.createElement("button"), { textContent: "⟳", title: "Randomize this track" });
        dice.addEventListener("click", () => edit(view, (d) => randomizeTrack(view, d, k)));
        row.append(name, len, div, dir, mute, dice);
        labels.appendChild(row);
        view.pm.rows.push({ len, div, dir, mute });
      });
      attach(view, canvas);
      requestAnimationFrame(() => redraw(view));
    },
    onState(st, view) {
      if (!view.pm) return;
      view.pm.state = st;
      draw(view);
      drawRows(view);
    },
    onRefresh(view) {
      if (!view.pm) return;
      const box = view.root.querySelector(".pm-opts");
      if (box && !box.hidden) options(view, box);
      redraw(view);
    },
  });
})();
