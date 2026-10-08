// SPDX-License-Identifier: MIT
// Matrix Mixer view (specs/modules/matrix-mixer.md §5): the crosspoint grid
// (circle size = |gain|, warm positive, cool negative; click toggles +1/0,
// Alt-click −1, drag sets, Shift fine, double-click types), row labels and
// mutes, column labels and meters, snapshots (click recalls, Shift-click
// stores, right-click: rename, clear, A/B) and Randomize. With Morph on, an
// edit goes to the snapshot nearest the morph position. The generic knob
// list only shows the rows and columns in use.
(function () {
  "use strict";
  const N = 8;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function param(view, id) { return view.type.params.find((x) => x.id === id); }
  function setting(view, id) {
    const p = param(view, id);
    const v = view.node.params[id] ?? p.default;
    return Math.round(p.min + v * (p.max - p.min));
  }
  const gid = (i, j) => `g_${i + 1}_${j + 1}`;
  function knobGain(view, i, j) {
    const p = param(view, gid(i, j));
    return 2 * (view.node.params[p.id] ?? p.default) - 1;
  }
  function data(view) {
    let d = view.node.data;
    if (!d || typeof d !== "object") d = view.node.data = {};
    if (!d.labels) d.labels = { in: Array(N).fill(""), out: Array(N).fill("") };
    if (!Array.isArray(d.snapshots)) d.snapshots = Array(N).fill(null);
    if (typeof d.morphA !== "number") d.morphA = 0;
    if (typeof d.morphB !== "number") d.morphB = 1;
    return d;
  }
  function save(view) {
    view.api.beginGesture();
    view.api.setData(JSON.parse(JSON.stringify(data(view))));
  }
  /// The current knobs as a snapshot.
  function capture(view, name) {
    const g = [], level = [], mute = [];
    for (let i = 0; i < N; i++) {
      g.push([...Array(N).keys()].map((j) => Math.round(knobGain(view, i, j) * 1000) / 1000));
      mute.push(setting(view, "mute_" + (i + 1)));
    }
    for (let j = 0; j < N; j++) {
      const p = param(view, "level_" + (j + 1));
      level.push(Math.round(2 * (view.node.params[p.id] ?? p.default) * 1000) / 1000);
    }
    return { name: name || "", g, level, mute };
  }
  function recall(view, s) {
    view.api.beginGesture();
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const v = (clamp(s.g[i][j], -1, 1) + 1) / 2;
        view.node.params[gid(i, j)] = v;
        view.api.setParam(gid(i, j), v);
      }
      view.node.params["mute_" + (i + 1)] = s.mute[i] ? 1 : 0;
      view.api.setParam("mute_" + (i + 1), s.mute[i] ? 1 : 0);
    }
    for (let j = 0; j < N; j++) {
      const v = clamp(s.level[j], 0, 2) / 2;
      view.node.params["level_" + (j + 1)] = v;
      view.api.setParam("level_" + (j + 1), v);
    }
  }
  /// Writes a crosspoint: the knob, or with Morph on the nearest snapshot.
  function setGain(view, i, j, g, gesture) {
    g = clamp(Math.round(g * 1000) / 1000, -1, 1);
    if (setting(view, "morphon") === 1) {
      const d = data(view);
      const m = view.node.params.morph ?? 0;
      const slot = m < 0.5 ? d.morphA : d.morphB;
      if (!d.snapshots[slot]) d.snapshots[slot] = capture(view, "");
      d.snapshots[slot].g[i][j] = g;
      if (gesture) view.api.beginGesture();
      view.api.setData(JSON.parse(JSON.stringify(d)));
    } else {
      if (gesture) view.api.beginGesture();
      view.node.params[gid(i, j)] = (g + 1) / 2;
      view.api.setParam(gid(i, j), (g + 1) / 2);
    }
    draw(view);
  }
  /// The gain shown at a crosspoint: live (morphed, modulated) if known.
  function shownGain(view, i, j) {
    const arr = view.mm.state && view.mm.state.arrays;
    if (arr && arr.gains && !view.mm.dragging) return arr.gains[i * N + j];
    return knobGain(view, i, j);
  }

  // ---- building ------------------------------------------------------------
  function build(view) {
    const m = view.mm, ni = setting(view, "inputs"), no = setting(view, "outputs");
    m.ni = ni;
    m.no = no;
    const t = m.grid;
    t.innerHTML = "";
    t.style.gridTemplateColumns = `64px 22px repeat(${no}, 34px)`;
    t.append(div(""), div(""));
    for (let j = 0; j < no; j++) t.append(labelField(view, "out", j, "Out " + (j + 1)));
    m.cells = [];
    m.mutes = [];
    for (let i = 0; i < ni; i++) {
      t.append(labelField(view, "in", i, "In " + (i + 1)));
      const mb = Object.assign(document.createElement("button"), { textContent: "M", className: "mm-mute", title: "Mute In " + (i + 1) });
      mb.addEventListener("click", () => {
        view.api.beginGesture();
        const id = "mute_" + (i + 1), v = setting(view, id) ? 0 : 1;
        view.node.params[id] = v;
        view.api.setParam(id, v);
        draw(view);
      });
      m.mutes.push(mb);
      t.append(mb);
      const row = [];
      for (let j = 0; j < no; j++) {
        const cell = document.createElement("div");
        cell.className = "mm-cell";
        cell.title = `In ${i + 1} → Out ${j + 1}`;
        const dot = document.createElement("span");
        cell.appendChild(dot);
        attachCell(view, cell, i, j);
        t.append(cell);
        row.push(dot);
      }
      m.cells.push(row);
    }
    t.append(div(""), div(""));
    m.meters = [];
    for (let j = 0; j < no; j++) {
      const meter = document.createElement("div");
      meter.className = "mm-meter";
      const bar = document.createElement("i");
      meter.appendChild(bar);
      t.append(meter);
      m.meters.push(bar);
    }
    buildSnapshots(view);
  }
  function div(text) { return Object.assign(document.createElement("div"), { textContent: text }); }
  function labelField(view, side, k, placeholder) {
    const f = Object.assign(document.createElement("input"), { className: "mm-label", placeholder, maxLength: 24 });
    f.value = data(view).labels[side][k] || "";
    f.addEventListener("change", () => {
      data(view).labels[side][k] = f.value.slice(0, 24);
      save(view);
    });
    return f;
  }
  function attachCell(view, cell, i, j) {
    let start = null;
    cell.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      cell.setPointerCapture(e.pointerId);
      start = { y: e.clientY, g: knobGainOrSnap(view, i, j), moved: false, alt: e.altKey };
    });
    cell.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dy = start.y - e.clientY;
      if (!start.moved && Math.abs(dy) < 3) return;
      if (!start.moved) view.api.beginGesture();
      start.moved = true;
      view.mm.dragging = true;
      setGain(view, i, j, start.g + dy / (e.shiftKey ? 600 : 100), false);
    });
    const up = () => {
      if (!start) return;
      if (!start.moved) setGain(view, i, j, start.alt ? -1 : Math.abs(start.g) > 0.001 ? 0 : 1, true);
      start = null;
      view.mm.dragging = false;
    };
    cell.addEventListener("pointerup", up);
    cell.addEventListener("pointercancel", () => { start = null; view.mm.dragging = false; });
    cell.addEventListener("dblclick", () => {
      const f = Object.assign(document.createElement("input"), { type: "number", min: -1, max: 1, step: 0.01, className: "mm-edit" });
      f.value = knobGainOrSnap(view, i, j).toFixed(2);
      cell.appendChild(f);
      f.focus();
      f.select();
      const done = () => { if (f.isConnected) { setGain(view, i, j, parseFloat(f.value) || 0, true); f.remove(); } };
      f.addEventListener("change", done);
      f.addEventListener("blur", () => f.remove());
      f.addEventListener("keydown", (e) => { if (e.key === "Escape") f.remove(); });
    });
  }
  /// The value an edit starts from: the knob, or the snapshot being edited.
  function knobGainOrSnap(view, i, j) {
    if (setting(view, "morphon") === 1) {
      const d = data(view), m = view.node.params.morph ?? 0;
      const s = d.snapshots[m < 0.5 ? d.morphA : d.morphB];
      if (s) return s.g[i][j];
    }
    return knobGain(view, i, j);
  }

  // ---- snapshots ---------------------------------------------------------------
  function buildSnapshots(view) {
    const m = view.mm, d = data(view);
    m.snaps.innerHTML = "";
    d.snapshots.forEach((s, k) => {
      const b = document.createElement("button");
      b.className = "mm-snap" + (s ? " stored" : "");
      b.textContent = (s && s.name) || String(k + 1);
      b.title = s ? "Click: recall · Shift-click: store · right-click: more" : "Shift-click: store the current matrix";
      if (k === d.morphA) b.dataset.ab = "A";
      if (k === d.morphB) b.dataset.ab = d.morphA === d.morphB ? "AB" : "B";
      b.addEventListener("click", (e) => {
        if (e.shiftKey || !s) {
          d.snapshots[k] = capture(view, s ? s.name : "");
          save(view);
          buildSnapshots(view);
        } else {
          recall(view, s);
          draw(view);
        }
      });
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        menu(view, k);
      });
      m.snaps.appendChild(b);
    });
  }
  function menu(view, k) {
    const m = view.mm, d = data(view);
    m.menu.hidden = false;
    m.menu.innerHTML = `<span>Snapshot ${k + 1}</span>`;
    const name = Object.assign(document.createElement("input"), { className: "mm-label", placeholder: "Name", maxLength: 24 });
    name.value = (d.snapshots[k] && d.snapshots[k].name) || "";
    name.disabled = !d.snapshots[k];
    name.addEventListener("change", () => { d.snapshots[k].name = name.value.slice(0, 24); save(view); buildSnapshots(view); });
    const act = (label, fn) => {
      const b = Object.assign(document.createElement("button"), { textContent: label });
      b.addEventListener("click", () => { fn(); save(view); buildSnapshots(view); m.menu.hidden = true; });
      return b;
    };
    m.menu.append(name, act("Clear", () => (d.snapshots[k] = null)), act("Set A", () => (d.morphA = k)),
      act("Set B", () => (d.morphB = k)), act("×", () => {}));
  }
  function randomize(view, dense) {
    view.api.beginGesture();
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const on = dense || Math.random() < 0.25;
        const g = on ? Math.round((Math.random() * 2 - 1) * 100) / 100 : 0;
        view.node.params[gid(i, j)] = (g + 1) / 2;
        view.api.setParam(gid(i, j), (g + 1) / 2);
      }
    draw(view);
  }

  // ---- drawing -----------------------------------------------------------------
  function draw(view) {
    const m = view.mm;
    if (!m) return;
    if (m.ni !== setting(view, "inputs") || m.no !== setting(view, "outputs")) build(view);
    for (let i = 0; i < m.ni; i++) {
      m.mutes[i].classList.toggle("on", setting(view, "mute_" + (i + 1)) === 1);
      for (let j = 0; j < m.no; j++) {
        const g = shownGain(view, i, j), dot = m.cells[i][j], a = Math.min(1, Math.abs(g));
        const size = a < 0.001 ? 3 : 6 + 18 * a;
        dot.style.width = dot.style.height = size + "px";
        dot.className = a < 0.001 ? "zero" : g > 0 ? "pos" : "neg";
      }
    }
    const meters = (m.state && m.state.arrays && m.state.arrays.meters) || [];
    m.meters.forEach((bar, j) => (bar.style.width = clamp((meters[j] || 0) * 100, 0, 100) + "%"));
    const d = data(view);
    m.ab.textContent = setting(view, "morphon") === 1 ? `A: ${d.morphA + 1} · B: ${d.morphB + 1} · edits go to ` +
      ((view.node.params.morph ?? 0) < 0.5 ? "A" : "B") : "";
    hideUnusedRows(view);
  }
  /// The generic knob list: crosspoint rows beyond Inputs are hidden too.
  function hideUnusedRows(view) {
    const ni = setting(view, "inputs");
    for (const [id, k] of view.knobs) {
      const match = /^g_(\d)_\d$/.exec(id);
      if (match && +match[1] > ni) k.box.hidden = true;
    }
    for (const g of view.root.querySelectorAll(".bv-group"))
      g.hidden = ![...g.querySelectorAll(".bv-knob")].some((b) => !b.hidden);
  }

  const STYLE = `
    .mm-grid { display: grid; gap: 3px; align-items: center; overflow-x: auto; }
    .mm-label { width: 100%; box-sizing: border-box; background: transparent; border: 1px solid transparent; color: var(--text);
      font: inherit; font-size: 10px; padding: 1px 2px; border-radius: 3px; }
    .mm-label:hover, .mm-label:focus { border-color: var(--line); }
    .mm-mute { padding: 0; width: 20px; height: 20px; font-size: 10px; }
    .mm-mute.on { background: #b45309; border-color: #f59e0b; }
    .mm-cell { position: relative; width: 34px; height: 30px; display: flex; align-items: center; justify-content: center;
      background: var(--panel, #1d2027); border-radius: 4px; cursor: ns-resize; touch-action: none; }
    .mm-cell span { border-radius: 50%; display: block; }
    .mm-cell span.zero { background: var(--line); }
    .mm-cell span.pos { background: #f59e0b; }
    .mm-cell span.neg { background: #38bdf8; }
    .mm-edit { position: absolute; inset: 0; width: 100%; font-size: 10px; box-sizing: border-box; }
    .mm-meter { height: 4px; background: var(--panel, #1d2027); border-radius: 2px; overflow: hidden; }
    .mm-meter i { display: block; height: 100%; background: var(--accent); }
    .mm-bar { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; margin-top: 8px; font-size: 11px; }
    .mm-snap { min-width: 24px; padding: 1px 5px; font-size: 10px; position: relative; color: var(--muted); }
    .mm-snap.stored { color: var(--text); border-color: var(--accent); }
    .mm-snap[data-ab]::after { content: attr(data-ab); position: absolute; top: -7px; right: -3px; font-size: 8px; color: var(--accent); }
    .mm-ab { color: var(--muted); font-size: 10px; margin-top: 4px; }
    .mm-menu { display: flex; gap: 4px; align-items: center; margin-top: 4px; font-size: 11px; color: var(--muted); }
    .mm-menu .mm-label { width: 90px; }`;

  BleepViews.register("matrix-mixer", {
    top: true,
    width: 440,
    template: `<div class="bv-panel">
      <div class="mm-grid"></div>
      <div class="mm-bar"><span>Snapshots</span><span class="mm-snaps"></span>
        <button class="mm-rs" title="Random gains on a quarter of the crosspoints (one undo step)">Random sparse</button>
        <button class="mm-rd" title="Random gains everywhere (one undo step)">Random dense</button></div>
      <div class="mm-menu" hidden></div>
      <div class="mm-ab"></div>
    </div>`,
    afterBuild(view, el) {
      if (!document.getElementById("mm-style")) {
        const s = document.createElement("style");
        s.id = "mm-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      view.mm = { grid: el.querySelector(".mm-grid"), snaps: el.querySelector(".mm-snaps"), menu: el.querySelector(".mm-menu"),
        ab: el.querySelector(".mm-ab"), state: null, ni: 0, no: 0, cells: [], mutes: [], meters: [], dragging: false };
      el.querySelector(".mm-rs").addEventListener("click", () => randomize(view, false));
      el.querySelector(".mm-rd").addEventListener("click", () => randomize(view, true));
      build(view);
      draw(view);
    },
    onState(st, view) {
      if (!view.mm) return;
      view.mm.state = st;
      draw(view);
    },
    onRefresh(view) {
      if (!view.mm) return;
      build(view);
      draw(view);
    },
  });
})();
