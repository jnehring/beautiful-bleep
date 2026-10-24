// SPDX-License-Identifier: GPL-3.0-only
// Drum Grid view (doc/specs/modules/drum-grid.md §5): the 8 × 32 grid, the 16
// pattern slots, mute/solo per track, and the pattern library. Patterns live
// in the node's data; edits go to the engine with api.setData.
(function () {
  "use strict";
  const TRACKS = 8, STEPS = 32, SLOTS = 16, MIN_COL = 10, RULER = 14;
  const NAMES = ["Kick", "Snare", "Closed Hat", "Open Hat", "Clap", "Low Tom", "High Tom", "Perc"];
  const PPQN = [0, 2, 4, 24, 48];
  const RATE_BEATS = [1.5, 1, 2 / 3, 0.75, 0.5, 1 / 3, 0.375, 0.25, 1 / 6, 0.1875, 0.125, 1 / 12];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const mod = (a, m) => ((a % m) + m) % m;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const emptyRow = () => ".".repeat(STEPS);
  const row = (s) => (String(s || "") + emptyRow()).slice(0, STEPS).replace(/[^xX]/g, ".");
  const newPattern = () => ({ name: "", length: 16, steps: Array.from({ length: TRACKS }, emptyRow) });

  function setting(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    const v = view.node.params[id] ?? p.default;
    return Math.round(p.min + v * (p.max - p.min));
  }
  /// The node's data, filled in like the engine's sanitise does.
  function data(view) {
    let d = view.node.data;
    if (!d || !Array.isArray(d.patterns)) {
      d = view.node.data = { tracks: [], current: 0, patterns: [] };
      d.patterns[0] = { name: "Four on the Floor", length: 16, steps: ["x...x...x...x...", "", "..x...x...x...x."] };
    }
    if (!Array.isArray(d.tracks)) d.tracks = [];
    for (let k = 0; k < TRACKS; k++) {
      const t = (d.tracks[k] = d.tracks[k] || {});
      if (!t.name) t.name = NAMES[k];
      t.mute = !!t.mute;
      t.solo = !!t.solo;
    }
    for (let s = 0; s < SLOTS; s++) {
      const p = d.patterns[s];
      if (!p) { d.patterns[s] = null; continue; }
      p.length = clamp(Math.round(p.length || 16), 1, STEPS);
      p.steps = Array.from({ length: TRACKS }, (_, k) => row((p.steps || [])[k]));
      if (typeof p.name !== "string") p.name = "";
    }
    d.current = clamp(d.current | 0, 0, SLOTS - 1);
    return d;
  }
  const editSlot = (view) => (view.dg.edit ?? data(view).current);
  function send(view) { view.api.setData(clone(data(view))); }
  async function edit(view, fn) {
    await view.api.beginGesture();
    fn(data(view));
    send(view);
    render(view);
  }
  /// The pattern being edited, created when `create` and the slot is empty.
  function pattern(view, create) {
    const d = data(view), s = editSlot(view);
    if (!d.patterns[s] && create) d.patterns[s] = newPattern();
    return d.patterns[s];
  }
  const cellAt = (p, k, i) => (p ? p.steps[k][i] : ".");
  const setCell = (p, k, i, c) => (p.steps[k] = p.steps[k].slice(0, i) + c + p.steps[k].slice(i + 1));

  // ---- drawing ------------------------------------------------------------
  /// Cell size from the room the grid has: columns fill the width, rows follow.
  function layout(view) {
    const avail = view.dg.scroll.clientWidth || STEPS * MIN_COL;
    const COL = Math.max(MIN_COL, avail / STEPS), ROW = Math.round(clamp(COL * 1.1, 16, 19));
    view.root.style.setProperty("--dg-row", ROW + "px");
    return { COL, ROW, W: COL * STEPS, H: RULER + TRACKS * ROW };
  }

  function draw(view) {
    const c = view.dg && view.dg.canvas;
    if (!c) return;
    const d = data(view), st = view.dg.state || {}, p = pattern(view, false);
    const len = p ? p.length : 16;
    const { COL, ROW, W: w, H } = layout(view);
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(H * dpr);
      c.style.width = w + "px"; c.style.height = H + "px";
    }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, H);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim() || "#fb923c";
    const line = css.getPropertyValue("--line").trim() || "#333";
    const muted = css.getPropertyValue("--muted").trim() || "#888";
    const text = css.getPropertyValue("--text").trim() || "#ddd";
    const group = /T$/.test(view.type.params.find((x) => x.id === "rate").choices[setting(view, "rate")] || "") ? 3 : 4;
    const showHead = st.running && st.playing === editSlot(view);
    const active = d.tracks.some((t) => t.solo) ? d.tracks.map((t) => t.solo) : d.tracks.map((t) => !t.mute);
    g.font = "9px system-ui, sans-serif";
    g.textAlign = "center";
    for (let i = 0; i < STEPS; i++) {
      const x = i * COL;
      g.globalAlpha = i < len ? 1 : 0.3;
      if (Math.floor(i / group) % 2 === 1) {  // beats
        g.fillStyle = line;
        g.globalAlpha *= 0.35;
        g.fillRect(x, RULER, COL, H - RULER);
        g.globalAlpha = i < len ? 1 : 0.3;
      }
      const head = showHead && i === st.step;
      if (head) {
        g.fillStyle = line;
        g.fillRect(x, RULER, COL, H - RULER);
      }
      g.fillStyle = head ? text : muted;
      if (i % group === 0 || i === len - 1) g.fillText(String(i + 1), x + COL / 2, RULER - 4);
      for (let k = 0; k < TRACKS; k++) {
        const y = RULER + k * ROW, v = cellAt(p, k, i);
        const a = (i < len ? 1 : 0.3) * (active[k] ? 1 : 0.4);
        g.globalAlpha = a;
        if (v === ".") {
          g.strokeStyle = muted;
          g.globalAlpha = a * 0.5;
          g.strokeRect(x + 1.5, y + 1.5, COL - 3, ROW - 3);
          continue;
        }
        const hit = head && ((st.hits || 0) >> k) & 1;
        g.fillStyle = hit ? text : accent;
        g.globalAlpha = a * (v === "X" ? 1 : 0.6);
        g.fillRect(x + 1, y + 1, COL - 2, ROW - 2);
        if (v === "X") {  // accent mark
          g.fillStyle = text;
          g.globalAlpha = a;
          g.fillRect(x + 3, y + 3, COL - 6, 2);
        }
      }
    }
    g.globalAlpha = 1;
    // Length marker: drag it on the ruler.
    g.fillStyle = accent;
    g.beginPath();
    g.moveTo(len * COL, RULER - 1);
    g.lineTo(len * COL - 5, 1);
    g.lineTo(len * COL + 5, 1);
    g.closePath();
    g.fill();
    g.fillRect(len * COL - 0.5, RULER, 1, H - RULER);
  }

  function renderSlots(view) {
    const d = data(view), st = view.dg.state || {}, es = editSlot(view);
    view.dg.slots.forEach((b, s) => {
      b.classList.toggle("used", !!d.patterns[s]);
      b.classList.toggle("playing", st.running ? st.playing === s : d.current === s);
      b.classList.toggle("queued", st.queued === s);
      b.classList.toggle("editing", es === s);
      b.title = (d.patterns[s] && d.patterns[s].name ? d.patterns[s].name + " — " : "") +
        "click: play and edit · Alt-click: edit only";
    });
    const playing = st.running ? st.playing : d.current;
    view.dg.status.textContent = es === playing ? "" : `Editing ${es + 1} · Playing ${playing + 1}`;
  }

  function renderTracks(view) {
    const d = data(view);
    view.dg.tracks.forEach((r, k) => {
      const t = d.tracks[k];
      if (document.activeElement !== r.name) r.name.value = t.name;
      r.mute.classList.toggle("on", t.mute);
      r.solo.classList.toggle("on", t.solo);
    });
  }

  function renderInfo(view) {
    const p = pattern(view, false);
    view.dg.length.value = p ? p.length : 16;
    view.dg.length.disabled = !p;
    const ppqn = setting(view, "ppqn"), rate = setting(view, "rate");
    const per = PPQN[ppqn] * RATE_BEATS[rate];
    view.dg.warn.hidden = !(ppqn > 0 && Math.abs(per - Math.round(per)) > 1e-9);
  }

  function render(view) {
    if (!view.dg) return;
    renderSlots(view);
    renderTracks(view);
    renderInfo(view);
    draw(view);
  }

  // ---- grid editing -----------------------------------------------------------
  function attach(view, c) {
    let drag = null;
    const at = (e) => {
      const r = c.getBoundingClientRect(), { COL } = layout(view);
      return { i: clamp(Math.floor((e.clientX - r.left) / COL), 0, STEPS - 1), y: e.clientY - r.top,
               x: e.clientX - r.left };
    };
    const apply = (e) => {
      const { COL, ROW } = layout(view);
      const { i, y, x } = at(e);
      if (drag.ruler) {
        const p = pattern(view, true);
        p.length = clamp(Math.round(x / COL), 1, STEPS);
      } else {  // every cell between the last and this one, so fast drags don't skip
        const k = clamp(Math.floor((y - RULER) / ROW), 0, TRACKS - 1), p = pattern(view, true);
        const last = drag.last || { i, k }, n = Math.max(Math.abs(i - last.i), Math.abs(k - last.k));
        for (let s = 0; s <= n; s++) {
          const f = n ? s / n : 0;
          setCell(p, Math.round(last.k + (k - last.k) * f), Math.round(last.i + (i - last.i) * f), drag.value);
        }
        drag.last = { i, k };
      }
      send(view);
      render(view);
    };
    let token = 0, held = false;
    c.addEventListener("pointerdown", async (e) => {
      if (e.button !== 0) return;
      const { ROW } = layout(view);
      const { i, y } = at(e), mine = ++token;
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      drag = null;
      held = true;
      // The reply to beginGesture refreshes the view from the engine; wait for
      // it, or it would overwrite the edit made below.
      await view.api.beginGesture();
      if (mine !== token) return;
      if (y < RULER) drag = { ruler: true };
      else {
        const k = clamp(Math.floor((y - RULER) / ROW), 0, TRACKS - 1);
        const v = cellAt(pattern(view, false), k, i);
        const value = e.shiftKey ? (v === "X" ? "." : "X") : { ".": "x", x: "X", X: "." }[v];
        drag = { value };
      }
      apply(e);
      if (!held) drag = null;  // released while waiting
    });
    c.addEventListener("pointermove", (e) => { if (drag) apply(e); });
    const end = () => { held = false; drag = null; };
    c.addEventListener("lostpointercapture", end);
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  /// Rotates rows (all, or one track) within the pattern's length.
  function rotate(view, by, track) {
    edit(view, () => {
      const p = pattern(view, false);
      if (!p) return;
      for (let k = 0; k < TRACKS; k++) {
        if (track !== undefined && k !== track) continue;
        const part = p.steps[k].slice(0, p.length);
        let out = "";
        for (let i = 0; i < p.length; i++) out += part[mod(i + by, p.length)];
        p.steps[k] = out + p.steps[k].slice(p.length);
      }
    });
  }

  // ---- presets (spec §4.6) ---------------------------------------------------
  let clipboard = null;  // shared by all Drum Grid views

  async function loadPreset(view, preset) {
    const src = preset && preset.pattern;
    if (!src) return;
    edit(view, (d) => {
      d.patterns[editSlot(view)] = {
        name: src.name || "", length: clamp(src.length | 0 || 16, 1, STEPS),
        steps: Array.from({ length: TRACKS }, (_, k) => row((src.steps || [])[k])),
      };
      // Track names only replace the defaults, never names the user chose.
      if (Array.isArray(src.trackNames) && d.tracks.every((t, k) => t.name === NAMES[k]))
        src.trackNames.forEach((n, k) => { if (k < TRACKS && n) d.tracks[k].name = String(n).slice(0, 24); });
    });
  }

  function menu(view) {
    const box = view.dg.menu;
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = "";
    const item = (label, run, cls) => {
      const b = Object.assign(document.createElement("button"), { textContent: label, className: cls || "" });
      b.addEventListener("click", (e) => { e.stopPropagation(); run(); });
      box.appendChild(b);
      return b;
    };
    const heading = (t) => box.appendChild(Object.assign(document.createElement("div"), { className: "dg-h", textContent: t }));
    const byCategory = (list) => {
      const m = new Map();
      for (const p of list) {
        const c = (p.preset && p.preset.category) || "My Patterns";
        if (!m.has(c)) m.set(c, []);
        m.get(c).push(p);
      }
      return m;
    };
    item("Save Pattern…", () => saveForm(view), "dg-save").disabled = !pattern(view, false);
    for (const [cat, list] of byCategory(window.BleepDrumPatterns || [])) {
      heading(cat);
      for (const p of list) item(p.name, () => { box.hidden = true; loadPreset(view, p.preset); });
    }
    view.api.presets("drums").then((user) => {
      if (box.hidden || !user.length) return;
      for (const [cat, list] of byCategory(user)) {
        heading(cat + " (yours)");
        for (const p of list) {
          const b = item(p.name, () => { box.hidden = true; loadPreset(view, p.preset); });
          const x = Object.assign(document.createElement("span"), { className: "dg-del", textContent: "×", title: "Delete" });
          x.addEventListener("click", async (e) => {
            e.stopPropagation();
            await view.api.deletePreset("drums", p.name);
            box.hidden = true;
            menu(view);
          });
          b.appendChild(x);
        }
      }
    });
  }

  function saveForm(view) {
    const box = view.dg.menu, p = pattern(view, false), d = data(view);
    box.innerHTML = "";
    const input = (label, value) => {
      const l = Object.assign(document.createElement("label"), { className: "dg-field" });
      const i = Object.assign(document.createElement("input"), { value, className: "bv-number" });
      i.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") save();
        if (e.key === "Escape") box.hidden = true;
      });
      l.append(Object.assign(document.createElement("span"), { textContent: label }), i);
      box.appendChild(l);
      return i;
    };
    const name = input("Name", p.name || `Pattern ${editSlot(view) + 1}`);
    const cat = input("Category", "My Patterns");
    const ok = Object.assign(document.createElement("button"), { textContent: "Save", className: "dg-save" });
    box.appendChild(ok);
    async function save() {
      const n = name.value.trim();
      if (!n) return;
      edit(view, () => (p.name = n));
      await view.api.savePreset("drums", n, {
        category: cat.value.trim() || "My Patterns", version: 1,
        pattern: { name: n, length: p.length, steps: p.steps.slice(), trackNames: d.tracks.map((t) => t.name) },
      });
      box.hidden = true;
    }
    ok.addEventListener("click", save);
    name.focus();
    name.select();
  }

  const STYLE = `
    .dg-panel { flex: 1 1 100%; min-width: 0; position: relative; }
    .dg-tools { display: flex; gap: 4px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; font-size: 11px; color: var(--muted); }
    .dg-tools button, .dg-menu button { background: var(--panel); color: var(--text); border: 1px solid var(--line);
      border-radius: 6px; padding: 2px 8px; font: inherit; font-size: 11px; cursor: pointer; }
    .dg-tools button:disabled { opacity: .4; cursor: default; }
    .dg-slots { display: flex; gap: 2px; margin-bottom: 6px; align-items: center; }
    .dg-slots button { width: 22px; height: 20px; padding: 0; border-radius: 4px; font-size: 10px; background: transparent;
      color: var(--muted); border: 1px dashed var(--line); cursor: pointer; }
    .dg-slots button.used { border-style: solid; color: var(--text); background: var(--panel); }
    .dg-slots button.editing { border-color: var(--accent); }
    .dg-slots button.playing { background: var(--accent); color: var(--bg, #111); }
    .dg-slots button.queued { animation: dg-blink .5s steps(2) infinite; }
    @keyframes dg-blink { 50% { background: var(--accent); color: var(--bg, #111); } }
    .dg-status { margin-left: 6px; font-size: 10px; color: var(--muted); }
    .dg-len { width: 44px; }
    .dg-warn { color: var(--accent); }
    .dg-body { display: flex; }
    .dg-tracks { flex: none; width: 128px; padding-top: ${RULER}px; }
    .dg-track { height: var(--dg-row, 20px); display: flex; align-items: center; gap: 2px; }
    .dg-track input { width: 74px; background: transparent; border: 1px solid transparent; border-radius: 4px; color: var(--text);
      font: inherit; font-size: 11px; padding: 0 3px; }
    .dg-track input:focus { border-color: var(--line); outline: none; }
    .dg-track button { width: 16px; height: 16px; padding: 0; font-size: 9px; line-height: 14px; border-radius: 4px; cursor: pointer;
      background: var(--panel); color: var(--muted); border: 1px solid var(--line); }
    .dg-track button.on { background: var(--accent); color: var(--bg, #111); border-color: var(--accent); }
    .dg-track .dg-rot { visibility: hidden; border: none; background: transparent; }
    .dg-track:hover .dg-rot { visibility: visible; }
    .dg-scroll { overflow-x: auto; flex: 1; min-width: 0; }
    .dg-scroll canvas { display: block; touch-action: none; cursor: pointer; }
    .dg-menu { position: absolute; z-index: 5; top: 52px; left: 0; max-height: 280px; overflow-y: auto; min-width: 180px;
      background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 4px; display: flex; flex-direction: column; gap: 1px;
      box-shadow: 0 6px 20px rgba(0,0,0,.35); }
    .dg-menu[hidden] { display: none; }
    .dg-menu button { text-align: left; border: none; display: flex; justify-content: space-between; }
    .dg-menu button:hover { background: var(--line); }
    .dg-menu .dg-h { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 6px 8px 2px; }
    .dg-menu .dg-del { color: var(--muted); padding-left: 10px; }
    .dg-menu .dg-del:hover { color: var(--text); }
    .dg-field { display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 2px 4px; font-size: 11px; color: var(--muted); }
    .dg-field input { width: 120px; }`;

  BleepViews.register("drum-grid", {
    partNames: ["Drum grid"],
    top: true,
    width: 900,
    layout: [
      { title: "Clock", params: ["syncto", "source", "rate", "ppqn", "switch"] },
      { title: "Level", params: ["tempo", "gatelength", "swing", "velocity"] },
    ],
    resizable: true,
    template: `<div class="bv-panel dg-panel">
      <div class="dg-slots"></div>
      <div class="dg-tools">
        <button class="dg-presets" title="Factory and saved patterns">Presets ▾</button>
        <button class="dg-copy" title="Copy this pattern">Copy</button>
        <button class="dg-paste" title="Paste into this slot" disabled>Paste</button>
        <button class="dg-clear" title="Empty this slot">Clear</button>
        <button class="dg-left" title="Rotate all rows left">◀</button>
        <button class="dg-right" title="Rotate all rows right">▶</button>
        <span>Length</span><input class="bv-number dg-len" type="number" min="1" max="32">
        <span class="dg-warn" hidden title="Clock PPQN doesn't divide this Rate evenly; steps are rounded to whole pulses">⚠ PPQN</span>
      </div>
      <div class="dg-menu" hidden></div>
      <div class="dg-body">
        <div class="dg-tracks"></div>
        <div class="dg-scroll"><canvas></canvas></div>
      </div>
    </div>`,
    afterBuild(view, el) {
      if (!document.getElementById("dg-style")) {
        const s = document.createElement("style");
        s.id = "dg-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      const canvas = el.querySelector("canvas");
      view.dg = {
        canvas, state: null, edit: null, slots: [], tracks: [],
        menu: el.querySelector(".dg-menu"), length: el.querySelector(".dg-len"), warn: el.querySelector(".dg-warn"),
      };
      // Slots: click plays (queued) and edits; Alt-click only edits.
      const slots = el.querySelector(".dg-slots");
      for (let s = 0; s < SLOTS; s++) {
        const b = Object.assign(document.createElement("button"), { textContent: String(s + 1) });
        b.addEventListener("click", (e) => {
          if (e.altKey) {
            view.dg.edit = s;
            render(view);
          } else {
            view.dg.edit = null;  // edit what plays
            edit(view, (d) => (d.current = s));
          }
        });
        slots.appendChild(b);
        view.dg.slots.push(b);
      }
      view.dg.status = slots.appendChild(Object.assign(document.createElement("span"), { className: "dg-status" }));
      // Tracks: name, mute, solo, rotate this row.
      const tracks = el.querySelector(".dg-tracks");
      for (let k = 0; k < TRACKS; k++) {
        const r = Object.assign(document.createElement("div"), { className: "dg-track" });
        const name = Object.assign(document.createElement("input"), { title: "Track name" });
        name.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") name.blur(); });
        name.addEventListener("change", () => edit(view, (d) => (d.tracks[k].name = name.value.trim().slice(0, 24) || NAMES[k])));
        const button = (t, title, cls, run) => {
          const b = Object.assign(document.createElement("button"), { textContent: t, title, className: cls || "" });
          b.addEventListener("click", run);
          return b;
        };
        const mute = button("M", "Mute", "", () => edit(view, (d) => (d.tracks[k].mute = !d.tracks[k].mute)));
        const solo = button("S", "Solo", "", () => edit(view, (d) => (d.tracks[k].solo = !d.tracks[k].solo)));
        r.append(name, mute, solo,
          button("‹", "Rotate this row left", "dg-rot", () => rotate(view, 1, k)),
          button("›", "Rotate this row right", "dg-rot", () => rotate(view, -1, k)));
        tracks.appendChild(r);
        view.dg.tracks.push({ name, mute, solo });
      }
      view.dg.scroll = el.querySelector(".dg-scroll");
      new ResizeObserver(() => { if (view.root.isConnected) draw(view); }).observe(view.dg.scroll);
      attach(view, canvas);
      const paste = el.querySelector(".dg-paste");
      el.querySelector(".dg-presets").addEventListener("click", () => menu(view));
      const outside = (e) => {  // a click elsewhere closes the menu
        if (!view.root.isConnected) return document.removeEventListener("pointerdown", outside, true);
        if (!view.dg.menu.hidden && !view.dg.menu.contains(e.target) && !e.target.closest(".dg-presets")) view.dg.menu.hidden = true;
      };
      document.addEventListener("pointerdown", outside, true);
      el.querySelector(".dg-copy").addEventListener("click", () => {
        const p = pattern(view, false);
        clipboard = p ? clone(p) : null;
        paste.disabled = !clipboard;
      });
      paste.disabled = !clipboard;
      paste.addEventListener("click", () => { if (clipboard) edit(view, (d) => (d.patterns[editSlot(view)] = clone(clipboard))); });
      el.querySelector(".dg-clear").addEventListener("click", () => edit(view, (d) => (d.patterns[editSlot(view)] = null)));
      el.querySelector(".dg-left").addEventListener("click", () => rotate(view, 1));
      el.querySelector(".dg-right").addEventListener("click", () => rotate(view, -1));
      view.dg.length.addEventListener("keydown", (e) => e.stopPropagation());
      view.dg.length.addEventListener("change", () => {
        const n = clamp(parseInt(view.dg.length.value, 10) || 16, 1, STEPS);
        edit(view, () => (pattern(view, true).length = n));
      });
      requestAnimationFrame(() => render(view));
    },
    onState(st, view) {
      if (!view.dg) return;
      view.dg.state = st;
      renderSlots(view);
      draw(view);
    },
    onRefresh(view) { render(view); },
  });
})();
