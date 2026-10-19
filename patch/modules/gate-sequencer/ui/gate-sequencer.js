// SPDX-License-Identifier: GPL-3.0-or-later
// Gate Sequencer view (doc/specs/modules/gate-sequencer.md §5): four track rows
// with their length and rate, edit modes (On, Prob, Len, Ratch, Nudge, Cond,
// Vel), per-track playheads, steps that won't play this pass drawn hollow,
// mute, a selection inspector, and per-track tools (Randomize, Euclid,
// rotate, copy/paste). Steps live in the node's data; edits go to the engine
// with api.setData.
(function () {
  "use strict";
  const TRACKS = 4, STEPS = 32, COL = 16, ROW = 34, H = TRACKS * ROW + 14;
  const MODES = [["on", "On"], ["p", "Prob"], ["l", "Len"], ["r", "Ratch"], ["n", "Nudge"], ["c", "Cond"], ["v", "Vel"]];
  const CONDS = ["Always", "A:B", "First", "Not First", "Fill", "Not Fill", "Prev", "Not Prev"];
  const COND_BADGE = ["", "", "1", "¬1", "F", "¬F", "P", "¬P"];
  const SHAPES = ["Even", "Faster", "Slower"];
  const mod = (a, m) => ((a % m) + m) % m;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fresh = () => ({ on: 0, p: 100, l: 50, t: 0, r: 1, rs: 0, n: 0, c: [0, 0], v: 100 });

  function data(view) {
    let d = view.node.data;
    if (!d || !Array.isArray(d.tracks)) d = view.node.data = { tracks: [] };
    while (d.tracks.length < TRACKS) d.tracks.push({ mute: false, steps: [] });
    for (const t of d.tracks) {
      if (!Array.isArray(t.steps)) t.steps = [];
      while (t.steps.length < STEPS) t.steps.push(fresh());
    }
    return d;
  }
  const param = (view, id) => view.type.params.find((p) => p.id === id);
  const length = (view, t) => clamp(view.units("length" + (t + 1)), 1, STEPS);
  function setParamUnits(view, id, v) {
    const p = param(view, id);
    const n = clamp((v - p.min) / (p.max - p.min), 0, 1);
    view.api.beginGesture();
    view.node.params[id] = n;
    view.api.setParam(id, n);
  }
  function send(view) { view.api.setData(JSON.parse(JSON.stringify(data(view)))); }
  function edit(view, fn) {
    view.api.beginGesture();
    fn(data(view));
    send(view);
    redraw(view);
  }
  const selected = (view) => [...view.gs.sel].map((k) => k.split(":").map(Number));

  // ---- drawing --------------------------------------------------------------
  function draw(view) {
    const c = view.gs && view.gs.canvas;
    if (!c) return;
    const d = data(view), st = view.gs.state || {}, mode = view.gs.mode;
    const w = STEPS * COL + 2, dpr = window.devicePixelRatio || 1;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = H * dpr; c.style.width = w + "px"; c.style.height = H + "px"; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, H);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim() || "#d4e157";
    const line = css.getPropertyValue("--line").trim() || "#333";
    const muted = css.getPropertyValue("--muted").trim() || "#888";
    const text = css.getPropertyValue("--text").trim() || "#ddd";
    g.font = "8px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let t = 0; t < TRACKS; t++) {
      const L = length(view, t), y0 = t * ROW, tr = d.tracks[t];
      const up = st["upcoming" + (t + 1)], pos = st["pos" + (t + 1)];
      const rowMuted = tr.mute;
      for (let i = 0; i < STEPS; i++) {
        const s = tr.steps[i], x = i * COL;
        g.globalAlpha = i < L ? (rowMuted ? 0.45 : 1) : 0.18;
        if (i === pos && i < L) { g.fillStyle = line; g.fillRect(x, y0, COL, ROW - 4); }
        if (view.gs.sel.has(t + ":" + i)) { g.strokeStyle = text; g.strokeRect(x + 0.5, y0 + 0.5, COL - 1, ROW - 5); }
        const top = y0 + 6, bot = y0 + ROW - 8, h = bot - top;
        g.strokeStyle = muted;
        if (!s.on) {
          g.strokeRect(x + 3.5, bot - 4.5, COL - 7, 4);
          continue;
        }
        const will = typeof up !== "number" || i >= L || ((up >>> i) & 1) === 1;
        let frac = s.p / 100, label = "";
        if (mode === "l") frac = s.t ? 1 : s.l / 100, label = s.t ? "T" : "";
        else if (mode === "v") frac = s.v / 127;
        else if (mode === "r") frac = s.r / 8, label = String(s.r);
        else if (mode === "c") label = s.c[0] === 1 ? Math.floor(s.c[1] / 10) + ":" + (s.c[1] % 10) : COND_BADGE[s.c[0]];
        const shift = mode === "n" ? (s.n / 100) * COL : 0;
        const bh = Math.max(3, frac * h);
        g.fillStyle = accent;
        if (will) g.fillRect(x + 3 + shift, bot - bh, COL - 6, bh);
        else { g.strokeStyle = accent; g.strokeRect(x + 3.5 + shift, bot - bh + 0.5, COL - 7, bh - 1); }
        if (s.t && i + 1 < STEPS) g.fillRect(x + COL - 3, bot - 3, 6, 3);  // tie into the next step
        // ratchet ticks and condition badge (in every mode)
        g.fillStyle = text;
        for (let k = 1; k < s.r && mode !== "r"; k++) g.fillRect(x + 2 + ((COL - 4) * k) / s.r, top - 4, 1, 3);
        if (label) g.fillText(label, x + COL / 2, top + 4);
        else if (mode !== "c" && s.c[0] !== 0) g.fillText(s.c[0] === 1 ? "÷" : COND_BADGE[s.c[0]], x + COL / 2, top + 4);
      }
      g.globalAlpha = 1;
      // length marker
      g.fillStyle = accent;
      g.fillRect(L * COL - 1, y0 + 2, 2, ROW - 8);
    }
    g.fillStyle = muted;
    for (let i = 0; i < STEPS; i += 4) g.fillText(String(i + 1), i * COL + COL / 2, H - 6);
    g.strokeStyle = line;
    g.beginPath();
    for (let i = 4; i < STEPS; i += 4) { g.moveTo(i * COL + 0.5, 0); g.lineTo(i * COL + 0.5, H - 12); }
    g.stroke();
  }

  function drawLabels(view) {
    const d = data(view);
    view.gs.rows.forEach((r, t) => {
      r.len.value = length(view, t);
      r.rate.value = String(view.units("rate" + (t + 1)));
      r.mute.classList.toggle("on", !!d.tracks[t].mute);
      r.name.classList.toggle("cur", t === view.gs.track);
    });
  }

  function inspector(view) {
    const box = view.gs.inspector, sel = selected(view);
    box.innerHTML = "";
    if (!sel.length) { box.textContent = "Click a step to select it (Shift: several)."; return; }
    const [t0, i0] = sel[0], s = data(view).tracks[t0].steps[i0];
    const apply = (fn) => edit(view, (d) => { for (const [t, i] of sel) fn(d.tracks[t].steps[i]); });
    const label = (txt) => box.appendChild(Object.assign(document.createElement("span"), { textContent: txt }));
    label(sel.length === 1 ? `Step ${t0 + 1}·${i0 + 1}` : `${sel.length} steps`);
    const check = (txt, on, set) => {
      const l = document.createElement("label");
      const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: !!on });
      cb.addEventListener("change", () => apply((st) => set(st, cb.checked ? 1 : 0)));
      l.append(cb, txt);
      box.appendChild(l);
    };
    const num = (txt, v, min, max, set) => {
      const l = document.createElement("label");
      const n = Object.assign(document.createElement("input"), { type: "number", min, max, value: v, className: "bv-number" });
      n.addEventListener("change", () => apply((st) => set(st, clamp(Math.round(parseFloat(n.value) || 0), min, max))));
      l.append(txt + " ", n);
      box.appendChild(l);
    };
    const pick = (txt, v, list, set) => {
      const l = document.createElement("label");
      const sel2 = document.createElement("select");
      list.forEach((o, k) => sel2.appendChild(Object.assign(document.createElement("option"), { value: k, textContent: o })));
      sel2.value = String(v);
      sel2.addEventListener("change", () => apply((st) => set(st, parseInt(sel2.value, 10))));
      l.append(txt + " ", sel2);
      box.appendChild(l);
    };
    check("On", s.on, (st, v) => (st.on = v));
    num("Prob %", s.p, 0, 100, (st, v) => (st.p = v));
    num("Len %", s.l, 1, 100, (st, v) => (st.l = v));
    check("Tie", s.t, (st, v) => (st.t = v));
    num("Ratch", s.r, 1, 8, (st, v) => (st.r = v));
    pick("", s.rs, SHAPES, (st, v) => (st.rs = v));
    num("Nudge %", s.n, -50, 50, (st, v) => (st.n = v));
    pick("Cond", s.c[0], CONDS, (st, v) => (st.c = [v, v === 1 ? (st.c[0] === 1 ? st.c[1] : 12) : 0]));
    if (s.c[0] === 1) {
      const A = Math.floor(s.c[1] / 10), B = s.c[1] % 10;
      num("A", A, 1, 8, (st, v) => { const b = st.c[0] === 1 ? st.c[1] % 10 : 2; st.c = [1, Math.min(v, b) * 10 + b]; });
      num("B", B, 2, 8, (st, v) => { const a = st.c[0] === 1 ? Math.floor(st.c[1] / 10) : 1; st.c = [1, Math.min(a, v) * 10 + v]; });
    }
    num("Vel", s.v, 1, 127, (st, v) => (st.v = v));
  }
  function redraw(view) { draw(view); drawLabels(view); inspector(view); }

  // ---- editing --------------------------------------------------------------
  function attach(view, c) {
    let drag = null;
    const at = (e) => {
      const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      return { t: clamp(Math.floor(y / ROW), 0, TRACKS - 1), i: clamp(Math.floor(x / COL), 0, STEPS - 1), x, y };
    };
    const apply = (e) => {
      const h = at(e), d = data(view);
      if (drag.kind === "length") {
        const n = clamp(Math.round(h.x / COL), 1, STEPS);
        if (n !== length(view, drag.t)) { setParamUnits(view, "length" + (drag.t + 1), n); draw(view); drawLabels(view); }
        return;
      }
      const t = drag.t, s = d.tracks[t].steps[h.i];
      if (drag.kind === "paint") {
        if (s.on === drag.value) return;
        s.on = drag.value;
      } else {
        const y0 = t * ROW + 6, y1 = t * ROW + ROW - 8, f = clamp((y1 - h.y) / (y1 - y0), 0, 1);
        if (!s.on) return;
        if (drag.kind === "p") s.p = Math.round(f * 100);
        else if (drag.kind === "l") { s.l = clamp(Math.round(f * 100), 1, 100); s.t = 0; }
        else if (drag.kind === "v") s.v = clamp(Math.round(f * 127), 1, 127);
        else if (drag.kind === "r") s.r = clamp(1 + Math.round(f * 7), 1, 8);
        else if (drag.kind === "n") s.n = clamp(Math.round(drag.n0 + (h.x - drag.x0) * 2), -50, 50);
        else return;
      }
      send(view);
      draw(view);
    };
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const h = at(e), d = data(view), L = length(view, h.t);
      e.stopPropagation();
      view.gs.track = h.t;
      if (Math.abs(h.x - L * COL) < 4) {  // the length marker
        c.setPointerCapture(e.pointerId);
        drag = { kind: "length", t: h.t };
        return;
      }
      const key = h.t + ":" + h.i, s = d.tracks[h.t].steps[h.i];
      if (e.shiftKey) view.gs.sel.has(key) ? view.gs.sel.delete(key) : view.gs.sel.add(key);
      else { view.gs.sel.clear(); view.gs.sel.add(key); }
      const mode = view.gs.mode;
      if (mode === "c") {  // click cycles the condition kind
        edit(view, (dd) => { const st = dd.tracks[h.t].steps[h.i]; const k = (st.c[0] + 1) % CONDS.length; st.c = [k, k === 1 ? 12 : 0]; });
        return;
      }
      c.setPointerCapture(e.pointerId);
      view.api.beginGesture();
      if (mode === "on") drag = { kind: "paint", t: h.t, value: s.on ? 0 : 1 };
      else drag = { kind: mode, t: h.t, x0: h.x, n0: s.n };
      apply(e);
      drawLabels(view);
      inspector(view);
    });
    c.addEventListener("pointermove", (e) => { if (drag) apply(e); });
    const end = () => { if (drag) { drag = null; inspector(view); } };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  // ---- per-track tools ------------------------------------------------------
  function randomize(view, t) {
    edit(view, (d) => {
      const o = view.gs.rand, L = length(view, t);
      for (let i = 0; i < L; i++) {
        const s = d.tracks[t].steps[i];
        s.on = Math.random() < o.density ? 1 : 0;
        s.p = Math.round(o.pLo + Math.random() * (o.pHi - o.pLo));
        s.r = Math.random() < o.ratchet ? 2 + Math.floor(Math.random() * 3) : 1;
        s.rs = s.r > 1 ? Math.floor(Math.random() * 3) : 0;
        s.n = Math.round((Math.random() * 2 - 1) * o.nudge);
      }
    });
  }
  function euclid(view, t, k, rot) {
    edit(view, (d) => {
      const L = length(view, t);
      for (let i = 0; i < L; i++) {
        const j = mod(i - rot, L);
        d.tracks[t].steps[i].on = Math.floor(((j + 1) * k) / L) - Math.floor((j * k) / L) > 0 ? 1 : 0;
      }
    });
  }

  const STYLE = `
    .gs-panel { flex: 1 1 100%; min-width: 0; }
    .gs-tools { display: flex; gap: 4px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; font-size: 11px; color: var(--muted); }
    .gs-tools button, .gs-labels button { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 6px;
      padding: 2px 7px; font: inherit; font-size: 11px; cursor: pointer; }
    .gs-tools button.on, .gs-labels button.on { border-color: var(--accent); color: var(--accent); }
    .gs-tools .bv-number { width: 40px; }
    .gs-body { display: flex; }
    .gs-labels { width: 124px; flex: none; }
    .gs-row { height: ${ROW}px; display: flex; align-items: center; gap: 3px; font-size: 10px; color: var(--muted); }
    .gs-row .gs-name { width: 10px; flex: none; }
    .gs-row .gs-name.cur { color: var(--accent); }
    .gs-row input.bv-number { width: 38px; padding: 1px 2px; font-size: 10px; flex: none; }
    .gs-row select { width: 52px; font-size: 10px; flex: none; }
    .gs-row button { padding: 1px 5px; flex: none; }
    .gs-scroll { overflow-x: auto; flex: 1; min-width: 0; }
    .gs-scroll canvas { display: block; touch-action: none; cursor: crosshair; }
    .gs-inspector { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; margin-top: 6px; font-size: 11px;
      color: var(--muted); min-height: 22px; }
    .gs-inspector .bv-number { width: 44px; }
    .gs-rand { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11px; color: var(--muted); margin-bottom: 6px; }
    .gs-rand .bv-number { width: 44px; }`;

  BleepViews.register("gate-sequencer", {
    partNames: ["Tracks"],
    top: true,
    width: 900,
    hideParams: ["rate1", "rate2", "rate3", "rate4", "length1", "length2", "length3", "length4"],
    layout: [
      { title: "Chance", params: ["chance1", "chance2", "chance3", "chance4"] },
      { title: "Feel", params: ["swing", "nudgedepth", "ratchetdecay"] },
      { title: "Notes", params: ["note1", "note2", "note3", "note4"] },
      { title: "Random", params: ["dice", "seed"] },
      { title: "Clock", params: ["syncto"] },
    ],
    template: `<div class="bv-panel gs-panel">
      <div class="gs-tools">
        <span class="gs-modes"></span>
        <span style="width:6px"></span>
        Track: <button class="gs-random" title="Randomize the current track (one undo step)">Randomize</button>
        <button class="gs-more" title="Randomize options">▾</button>
        <button class="gs-euclid" title="Fill the current track with k hits spread evenly">Euclid</button>
        <input class="bv-number gs-k" type="number" min="0" max="32" value="5" title="hits">
        <input class="bv-number gs-rot" type="number" min="0" max="31" value="0" title="rotation">
        <button class="gs-left" title="Rotate left">◀</button><button class="gs-right" title="Rotate right">▶</button>
        <button class="gs-copy">Copy</button><button class="gs-paste">Paste</button>
      </div>
      <div class="gs-rand" hidden></div>
      <div class="gs-body">
        <div class="gs-labels"></div>
        <div class="gs-scroll"><canvas></canvas></div>
      </div>
      <div class="gs-inspector"></div>
    </div>`,
    afterBuild(view, el) {
      if (!document.getElementById("gs-style")) {
        const s = document.createElement("style");
        s.id = "gs-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      const canvas = el.querySelector("canvas");
      view.gs = { canvas, state: null, mode: "on", sel: new Set(), track: 0, rows: [], clip: null,
                  inspector: el.querySelector(".gs-inspector"),
                  rand: { density: 0.5, pLo: 60, pHi: 100, ratchet: 0.1, nudge: 0 } };
      const modes = el.querySelector(".gs-modes");
      for (const [id, label] of MODES) {
        const b = Object.assign(document.createElement("button"), { textContent: label });
        if (id === "on") b.classList.add("on");
        b.addEventListener("click", () => {
          view.gs.mode = id;
          for (const o of modes.children) o.classList.toggle("on", o === b);
          draw(view);
        });
        modes.appendChild(b);
      }
      // Track labels: number, length, rate, mute.
      const labels = el.querySelector(".gs-labels");
      const rateParam = param(view, "rate1");
      for (let t = 0; t < TRACKS; t++) {
        const row = document.createElement("div");
        row.className = "gs-row";
        const name = Object.assign(document.createElement("span"), { className: "gs-name", textContent: String(t + 1) });
        const len = Object.assign(document.createElement("input"), { type: "number", min: 1, max: STEPS, className: "bv-number", title: "Length" });
        len.addEventListener("change", () => { setParamUnits(view, "length" + (t + 1), clamp(parseInt(len.value, 10) || 1, 1, STEPS)); draw(view); });
        const rate = document.createElement("select");
        rate.title = "Rate";
        (rateParam ? rateParam.choices : []).forEach((ch, k) => rate.appendChild(Object.assign(document.createElement("option"), { value: k, textContent: ch })));
        rate.addEventListener("change", () => setParamUnits(view, "rate" + (t + 1), parseInt(rate.value, 10)));
        const mute = Object.assign(document.createElement("button"), { textContent: "M", title: "Mute (with the Mute input)" });
        mute.addEventListener("click", () => edit(view, (d) => (d.tracks[t].mute = !d.tracks[t].mute)));
        row.append(name, len, rate, mute);
        labels.appendChild(row);
        view.gs.rows.push({ name, len, rate, mute });
      }
      attach(view, canvas);
      const cur = () => view.gs.track;
      el.querySelector(".gs-random").addEventListener("click", () => randomize(view, cur()));
      const box = el.querySelector(".gs-rand"), more = el.querySelector(".gs-more");
      more.addEventListener("click", () => {
        box.hidden = !box.hidden;
        more.classList.toggle("on", !box.hidden);
        box.innerHTML = "";
        const o = view.gs.rand;
        const num = (txt, v, min, max, set) => {
          const l = document.createElement("label");
          const n = Object.assign(document.createElement("input"), { type: "number", min, max, value: v, className: "bv-number" });
          n.addEventListener("change", () => set(clamp(parseFloat(n.value) || 0, min, max)));
          l.append(txt + " ", n);
          box.appendChild(l);
        };
        num("Density %", Math.round(o.density * 100), 0, 100, (v) => (o.density = v / 100));
        num("Prob from", o.pLo, 0, 100, (v) => (o.pLo = Math.min(v, o.pHi)));
        num("to", o.pHi, 0, 100, (v) => (o.pHi = Math.max(v, o.pLo)));
        num("Ratchet %", Math.round(o.ratchet * 100), 0, 100, (v) => (o.ratchet = v / 100));
        num("Nudge ±%", o.nudge, 0, 50, (v) => (o.nudge = v));
      });
      el.querySelector(".gs-euclid").addEventListener("click", () =>
        euclid(view, cur(), clamp(parseInt(el.querySelector(".gs-k").value, 10) || 0, 0, STEPS),
               parseInt(el.querySelector(".gs-rot").value, 10) || 0));
      const rotate = (by) => edit(view, (d) => {
        const L = length(view, cur()), part = d.tracks[cur()].steps.slice(0, L);
        for (let i = 0; i < L; i++) d.tracks[cur()].steps[i] = part[mod(i + by, L)];
      });
      el.querySelector(".gs-left").addEventListener("click", () => rotate(1));
      el.querySelector(".gs-right").addEventListener("click", () => rotate(-1));
      el.querySelector(".gs-copy").addEventListener("click", () => (view.gs.clip = JSON.parse(JSON.stringify(data(view).tracks[cur()].steps))));
      el.querySelector(".gs-paste").addEventListener("click", () => {
        if (view.gs.clip) edit(view, (d) => (d.tracks[cur()].steps = JSON.parse(JSON.stringify(view.gs.clip))));
      });
      requestAnimationFrame(() => redraw(view));
    },
    onState(st, view) {
      if (!view.gs) return;
      view.gs.state = st;
      draw(view);
    },
    onRefresh(view) { if (view.gs) redraw(view); },
  });
})();
