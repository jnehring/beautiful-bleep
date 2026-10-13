// SPDX-License-Identifier: MIT
// board.js — the board (spec §9): canvas, Add menu, patching, cells,
// floating module views, undo and keyboard shortcuts.
//
// The engine owns the board document; this page edits a copy and commits it
// (native "commit"), and the engine answers with the sanitised result. Knob
// and amount changes go through setParam/setAmount, preceded by beginGesture
// so they get one undo step per drag.
(function () {
  "use strict";

  // ------------------------------------------------------------------ state
  let board = null;            // the board document, or null (no Bleep Board)
  let hasStore = false;        // the app has a module store (the native side's init says so); without one, nothing is checked against it
  let types = {};              // type → description
  let typeList = [];
  let ports = {};              // port id → {kind, track, live, main}
  let canUndo = false, canRedo = false;
  let presets = [];            // [{key, name, category, factory, preset}], factory first
  let presetOrder = [];        // factory preset categories, in menu order
  let path = [];               // ids of the cells we're inside
  const cams = new Map();      // level → {x, y, z}
  const sel = new Set();       // selected node ids
  let selCable = null;         // the cable the popover is for; with selMore, the selected cables (shift-click adds)
  const selMore = new Set();
  const clearCableSel = () => { selCable = null; selMore.clear(); };
  const isCableSel = (id) => id === selCable || selMore.has(id);
  const selectedCableIds = () => (selCable ? [selCable, ...selMore] : []);
  let hoverCable = null;   // id of the cable under the pointer; drawn on top in the highlight colour
  let trace = null;            // Set of node ids, or null
  let live = null;             // latest "state" event
  const scopes = new Map();    // "node|jack" → {canvas, hist, head, bipolar}
  const views = new Map();     // node id → floating view
  const expanded = new Set();  // nodes showing all their outputs
  const kShownOutputs = 4;
  const NODE_W = 184;         // matches --node-w in board.css
  let pointer = { x: 0, y: 0 };// last pointer position in canvas coordinates
  let pointerInside = false;   // the pointer is over the canvas (paste lands there)
  let dev = false;
  let standalone = false;      // the standalone app: MIDI Device is offered
  let shownFor = null;         // the board whose start panel has been opened

  const $ = (id) => document.getElementById(id);
  const canvas = $("canvas"), world = $("world"), nodesEl = $("nodes"), cablesEl = $("cables");
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const SVGNS = "http://www.w3.org/2000/svg";
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const uid = (p) => p + Math.random().toString(36).slice(2, 10);
  const editing = () => {
    const a = document.activeElement;
    return a && (a.tagName === "INPUT" || a.tagName === "SELECT" || a.tagName === "TEXTAREA");
  };

  // --------------------------------------------------------------- the model
  const level = () => (path.length ? path[path.length - 1] : "");
  const nodeById = (id, b = board) => (b ? b.nodes.find((n) => n.id === id) : null);
  const nodesAt = (lvl, b = board) => (b ? b.nodes.filter((n) => (n.parent || "") === lvl) : []);
  const typeOf = (n) => types[n.type] || { type: n.type, name: n.type, params: [], inputs: [], outputs: [] };
  const isPort = (n) => !!typeOf(n).port;
  const isCellLike = (n) => n.type === "cell" || n.type === "voice-cell";
  const isBoundary = (n) => n.type === "cell-in" || n.type === "cell-out" || n.type === "voice-in" || n.type === "voice-out";
  /// A cell may have several Cell Ins and Cell Outs (to lay cables out as you like), but keeps at least one of each.
  const isFixedBoundary = (n) => isBoundary(n) &&
    !((n.type === "cell-in" || n.type === "cell-out") && board.nodes.some((m) => m.id !== n.id && m.parent === n.parent && m.type === n.type));
  const isBay = (n) => n.type === "patchbay-in" || n.type === "patchbay-out";
  const isStructural = (n) => n.type === "cell" || isBoundary(n) || isBay(n);  // a Voice Cell has a view: its settings
  /// Ports the user adds and deletes (MIDI Device); the others come from Live (spec §6).
  /// In the standalone app the app's own ports (audio, MIDI, Link) may be deleted and added again from the Add menu.
  const isFixedPort = (n) => isPort(n) && !typeOf(n).creatable && !(standalone && APP_PORTS.has(typeOf(n).port));
  const APP_PORTS = new Set(["audio-in", "audio-out", "midi-in", "midi-out", "link"]);
  const VOICE_IN = [{ id: "notes", name: "Notes", type: "notes" }];
  const VOICE_OUT = [{ id: "l", name: "Out L", type: "audio" }, { id: "r", name: "Out R", type: "audio" }];
  const compatible = (a, b) => (a === "notes") === (b === "notes") && (a === "patchbay") === (b === "patchbay");

  // ---- patch bays (doc/specs/modules/patchbay.md) ------------------------------------------------------------
  // A Patch Bay In has a channel (c1, c2 …) for every input that has a cable, and one free one: patching it adds the
  // next. A Patch Bay Out has the channels of the Patch Bay In its bundle comes from, with the same names.
  const isChannel = (jack) => /^c\d+$/.test(jack);
  /// The Patch Bay In that feeds the bundle arriving at (node, jack), over cell outputs and inputs.
  function bundleSource(node, jack, b = board, depth = 0) {
    if (depth > 64) return null;
    for (const c of b.cables.filter((k) => k.to.node === node && k.to.jack === jack)) {
      const from = nodeById(c.from.node, b);
      if (!from) continue;
      if (from.type === "patchbay-in") return from;
      if (from.type === "cell") {
        for (const o of b.nodes.filter((m) => m.type === "cell-out" && m.parent === from.id)) {
          const r = bundleSource(o.id, c.from.jack, b, depth + 1);
          if (r) return r;
        }
      } else if (from.type === "cell-in") {
        const r = bundleSource(from.parent, c.from.jack, b, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }
  /// The channels of a Patch Bay In that are patched: [{id, name, type}] by number, named after what is patched in.
  function bayChannels(n, b = board) {
    const ids = [...new Set(b.cables.filter((c) => c.to.node === n.id && isChannel(c.to.jack)).map((c) => c.to.jack))]
      .sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
    return ids.map((id) => {
      const c = b.cables.find((k) => k.to.node === n.id && k.to.jack === id);
      const src = nodeById(c.from.node, b);
      if (!src) return { id, name: id, type: "control" };
      const out = outputsOf(src, b).find((o) => o.id === c.from.jack);
      return { id, name: `${src.name} - ${out ? out.name : c.from.jack}`, type: (out && out.type) || "control" };
    });
  }
  function bayInputs(n, b) {   // the channels and the free one
    const chans = bayChannels(n, b);
    const next = chans.length ? Number(chans[chans.length - 1].id.slice(1)) + 1 : 1;
    return chans.concat([{ id: "c" + next, name: "free", type: "control" }]).map((c) => ({ ...c, type: "any" }));
  }
  function bayOutputs(n, b) {
    const src = bundleSource(n.id, "bundle", b);
    return src ? bayChannels(src, b) : [];
  }

  function outputsOf(n, b = board) {
    if (n.type === "patchbay-out") return bayOutputs(n, b);
    if (n.type === "cell") return n.outputs || [];
    if (n.type === "voice-cell") return VOICE_OUT.concat(n.outputs || []);  // spec §8.3.1
    if (n.type === "cell-in") { const c = nodeById(n.parent, b); return c ? c.inputs || [] : []; }
    return typeOf(n).outputs;
  }
  function inputsOf(n, b = board) {
    if (n.type === "patchbay-in") return bayInputs(n, b);
    if (n.type === "cell") return n.inputs || [];
    if (n.type === "voice-cell") return VOICE_IN.concat(n.inputs || []);
    if (n.type === "cell-out") { const c = nodeById(n.parent, b); return c ? c.outputs || [] : []; }
    return typeOf(n).inputs;
  }
  const modParams = (n) => typeOf(n).params.filter((p) => p.modulatable);  // knobs, incl. stepped ones
  function outType(n, jack) { const j = outputsOf(n).find((o) => o.id === jack); return j ? j.type : null; }
  function inType(n, jack) {
    const j = inputsOf(n).find((o) => o.id === jack);
    if (j) return j.type;
    return modParams(n).some((p) => p.id === jack) ? "control" : null;
  }
  function jackName(n, jack, out) {
    const list = out ? outputsOf(n) : inputsOf(n);
    const j = list.find((o) => o.id === jack);
    if (j) return shownName(n, j);
    const p = typeOf(n).params.find((q) => q.id === jack);
    return p ? p.name : jack;
  }
  const cablesInto = (node, jack, b = board) => b.cables.filter((c) => c.to.node === node && c.to.jack === jack);
  function portInfo(n) { return n.port ? ports[n.port] : null; }
  /// A param's value in its own units (for integer settings like Voices).
  function paramValue(n, id) {
    const p = typeOf(n).params.find((q) => q.id === id);
    if (!p) return 0;
    const v = n.params && id in n.params ? n.params[id] : p.default;
    return Math.round(p.min + v * (p.max - p.min));
  }
  /// Optional type metadata: a jack or param shown only while a setting is in
  /// range ("show"), and names that follow a setting ("names").
  function isShown(n, item) {
    if (!item.show) return true;
    const v = paramValue(n, item.show.param);
    return v >= item.show.min && v <= item.show.max;
  }
  function shownName(n, item) {
    return (item.names && item.names.list[paramValue(n, item.names.by)]) || item.name;
  }
  /// Does changing this param change how the node's jacks look?
  function drivesJacks(n, pid) {
    const t = typeOf(n);
    return [...(t.inputs || []), ...(t.outputs || [])].some((j) =>
      (j.show && j.show.param === pid) || (j.names && j.names.by === pid));
  }
  /// A short notice at the bottom of the canvas.
  function notice(text) {
    let box = document.querySelector(".board-notice");
    if (!box) {
      box = el("div", "board-notice");
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(notice.timer);
    notice.timer = setTimeout(() => box.classList.remove("show"), 5000);
  }
  function insideVoiceCell(id, b = board) {
    for (let n = nodeById(id, b); n; n = nodeById(n.parent, b)) if (n.type === "voice-cell") return true;
    return false;
  }
  function isGhost(n) {
    if (!isPort(n)) return false;
    const p = portInfo(n);
    return !p || !p.live;
  }
  function descendants(cellId, b = board) {
    const out = [];
    const walk = (id) => {
      for (const n of b.nodes)
        if ((n.parent || "") === id) { out.push(n); if (isCellLike(n)) walk(n.id); }
    };
    walk(cellId);
    return out;
  }

  // ---------------------------------------------------------------- backend
  function applyMessage(m) {
    if (!m) return;
    if ("board" in m) {
      board = m.board && m.board.nodes ? m.board : null;
      // A different board was loaded: its start panel opens (panels "show on load").
      const id = board ? String(board.id) : null;
      if (id !== shownFor) {
        shownFor = id;
        for (const k of [...views.keys()]) if (k.startsWith("panel:")) closeView(k);
        if (board) setTimeout(openStartPanel, 0);
      }
    }
    if (m.ports) ports = m.ports;
    if ("canUndo" in m) { canUndo = m.canUndo; canRedo = m.canRedo; }
    if (m.status) $("status").textContent = m.status;
    // Leave cells that no longer exist.
    while (path.length && !nodeById(path[path.length - 1])) path.pop();
    if (pluginMode) syncPluginPanel();
    for (const id of [...sel]) if (!nodeById(id)) sel.delete(id);
    if (selCable && !(board && board.cables.some((c) => c.id === selCable))) selCable = null;
    for (const id of [...selMore]) if (!(board && board.cables.some((c) => c.id === id))) selMore.delete(id);
    if (!selCable && selMore.size) { selCable = [...selMore][0]; selMore.delete(selCable); }
    for (const [id, v] of views) {
      if (v.panelId) {
        const d = panelById(v.panelId);
        if (!d) closeView(id);
        else v.bv.refresh(d);
        continue;
      }
      const n = nodeById(id);
      if (!n) closeView(id);
      else v.bv.refresh(n);
    }
    render();
  }

  // ------------------------------------------------------ in a plugin window
  // Bleep Instrument and Bleep FX show only the panel of the cell they hold (doc/specs/cell-plugins.md §11):
  // the panel fills the window, and follows the cell when another preset replaces it. `?panelOf=<cell name>`
  // does the same in a plain browser, for developing panels.
  let pluginMode = false, pluginPanel = "", pluginSync = 0;
  const pluginBuilt = new Set();
  const panelOf = new URLSearchParams(location.search).get("panelOf");
  async function syncPluginPanel() {
    const tick = ++pluginSync;
    const cell = panelOf ? ((board && board.nodes.find((n) => n.name === panelOf && !n.parent)) || {}).id : ((await native("pluginCell")) || {}).cell;
    if (tick !== pluginSync || !board) return;
    const q = (board.panels || []).find((p) => cell && p.cell === cell);
    const id = q ? q.id : "";
    if (id && id === pluginPanel && views.has("panel:" + id)) return;
    pluginPanel = id;
    for (const k of [...views.keys()]) if (k.startsWith("panel:")) closeView(k);
    document.body.classList.toggle("no-panel", !q);
    if (!q) {  // the panel was deleted: make one from the cell, once
      if (cell && !pluginBuilt.has(cell)) { pluginBuilt.add(cell); buildPanel(cell); }
      return;
    }
    openPanel(q.id, { full: true });
    native("panelSize", (q.cols || 24) * BleepPanels.U, (q.rows || 16) * BleepPanels.U);
  }

  async function commit(next, label) {
    prunePanels(next);
    board = next;
    render();
    applyMessage(await native("commit", next, label));
  }

  /// Edits a copy of the board and commits it.
  function edit(label, fn) {
    if (!board) return;
    const next = clone(board);
    if (fn(next) === false) return;
    return commit(next, label);
  }

  async function gesture() { applyMessage(await native("beginGesture")); }

  // ------------------------------------------------------------- the camera
  function cam() {
    const l = level();
    if (!cams.has(l)) cams.set(l, { x: 260, y: 60, z: 1 });
    return cams.get(l);
  }
  function applyCam() {
    const c = cam();
    world.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.z})`;
    canvas.style.backgroundPosition = `${c.x}px ${c.y}px`;
    canvas.style.backgroundSize = `${24 * c.z}px ${24 * c.z}px`;
    world.classList.toggle("zoomed-out", c.z < 0.6);
    positionCablePop();
  }
  function toWorld(cx, cy) {
    const r = canvas.getBoundingClientRect(), c = cam();
    return { x: (cx - r.left - c.x) / c.z, y: (cy - r.top - c.y) / c.z };
  }
  function toCanvas(wx, wy) { const c = cam(); return { x: wx * c.z + c.x, y: wy * c.z + c.y }; }
  function centreOn(n) {
    const r = canvas.getBoundingClientRect(), c = cam();
    c.x = r.width / 2 - (n.x + NODE_W / 2) * c.z;
    c.y = r.height / 2 - (n.y + 40) * c.z;
    applyCam();
  }
  function fit() {
    const ns = nodesAt(level());
    if (!ns.length) return;
    const r = canvas.getBoundingClientRect();
    if (r.width < 200 || r.height < 150) return false;  // not laid out yet
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ns) {
      const e = nodesEl.querySelector(`[data-id="${n.id}"]`);
      const h = e ? e.offsetHeight : 80;
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + NODE_W); y1 = Math.max(y1, n.y + h);
    }
    const c = cam();
    c.z = Math.min(1.5, Math.max(0.25, Math.min((r.width - 80) / (x1 - x0), (r.height - 80) / (y1 - y0))));
    c.x = (r.width - (x1 - x0) * c.z) / 2 - x0 * c.z;
    c.y = (r.height - (y1 - y0) * c.z) / 2 - y0 * c.z;
    applyCam();
    return true;
  }

  // ---------------------------------------------------------------- render
  function render() {
    renderCrumbs();
    $("cell-close").hidden = path.length === 0;
    renderNodes();
    for (const [id, v] of views) {  // a rename changes the titles of open views
      const n = nodeById(id), t = v.win.querySelector(".v-title");
      if (n && t && n.name !== t.textContent) t.textContent = n.name;
      if (n && v.power) setPowerButton(v.power, n);
    }
    applyCam();  // before the cables: their positions are measured on screen
    renderCables();
    $("undo").disabled = !canUndo;
    $("redo").disabled = !canRedo;
    const empty = $("empty");
    if (!board) {
      empty.hidden = false;
      empty.textContent = "No board in this set. Add Bleep Board to any track in Live.";
    } else if (!nodesAt(level()).length) {
      empty.hidden = false;
      empty.textContent = "Double-click or press Tab to add a module.";
    } else {
      empty.hidden = true;
    }
  }

  function renderCrumbs() {
    const c = $("crumbs");
    c.innerHTML = "";
    const crumb = (label, depth) => {
      const here = depth === path.length;
      const a = el(here ? "span" : "a", here ? "here" : "", label);
      if (!here) a.addEventListener("click", () => leaveTo(depth));
      c.appendChild(a);
    };
    if (!path.length) return;  // at the top level the Board tab already says where we are
    crumb("Board", 0);
    path.forEach((id, i) => {
      c.appendChild(el("span", "sep", "›"));
      const n = nodeById(id);
      crumb(n ? n.name : "?", i + 1);
    });
  }

  function signalColour(t) { return `var(--sig-${t || "control"})`; }

  function renderNodes() {
    nodesEl.innerHTML = "";
    scopes.clear();
    if (!board) return;
    const groups = new Map();
    for (const n of nodesAt(level())) {
      const q = ownerOf(n.id);
      if (!q) { nodesEl.appendChild(nodeElement(n)); continue; }
      const k = groupKey(q, level());
      if (!groups.has(k)) groups.set(k, { q, nodes: [] });
      groups.get(k).nodes.push(n);
    }
    for (const [k, g] of groups) renderGroup(k, g);
  }

  // The modules a panel's controls were made with (panel.modules) sit in one stack per panel and level, folded to
  // its header until opened; panel.groups[level] says where the stack is. Their own x and y are not used.
  const groupOpen = new Set();   // "panelId|level" of the stacks that are open
  const kGroupHead = 30, kGroupGap = 8;
  const ownerOf = (nodeId) => panelList().find((q) => (q.modules || []).includes(nodeId)) || null;
  const groupKey = (q, lvl) => q.id + "|" + lvl;
  // panel.groups is keyed by level: a cell's id, or "@board" for the top level (a JSON key can't be empty).
  const levelKey = (lvl) => lvl || "@board";
  const groupAt = (q, lvl) => (q.groups && q.groups[levelKey(lvl)]) || { x: 40, y: 40 };

  function renderGroup(key, g) {
    const open = groupOpen.has(key), at = groupAt(g.q, level());
    const h = el("div", "pgroup" + (open ? " open" : ""));
    h.dataset.key = key;
    h.dataset.members = " " + g.nodes.map((n) => n.id).join(" ") + " ";
    h.style.left = at.x + "px";
    h.style.top = at.y + "px";
    h.append(el("span", "pg-arrow", open ? "▾" : "▸"), el("span", "pg-title", "▦ " + g.q.name),
             el("small", "", `${g.nodes.length} module${g.nodes.length === 1 ? "" : "s"}`));
    h.title = `Modules made for the controls of the panel “${g.q.name}”. Click to ${open ? "fold" : "open"}, drag to move.`;
    nodesEl.appendChild(h);
    if (open) {
      let y = at.y + kGroupHead + kGroupGap;
      for (const n of g.nodes) {
        const e = nodeElement(n);
        e.classList.add("grouped");
        e.style.left = at.x + "px";
        e.style.top = y + "px";
        nodesEl.appendChild(e);
        y += e.offsetHeight + kGroupGap;
      }
    }
    h.addEventListener("pointerdown", (ev) => onGroupPointerDown(ev, h, key, g));
  }

  function onGroupPointerDown(ev, h, key, g) {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    canvas.focus();
    hidePopovers();
    const start = { x: ev.clientX, y: ev.clientY }, c = cam(), lvl = level(), at0 = groupAt(g.q, lvl);
    const ids = new Set(g.nodes.map((n) => n.id));
    const members = [...nodesEl.querySelectorAll(".node.grouped")].filter((e) => ids.has(e.dataset.id))
      .map((e) => ({ e, x: parseFloat(e.style.left), y: parseFloat(e.style.top) }));
    let moved = false, dx = 0, dy = 0;
    const move = (m) => {
      dx = Math.round((m.clientX - start.x) / c.z);
      dy = Math.round((m.clientY - start.y) / c.z);
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      h.style.left = at0.x + dx + "px";
      h.style.top = at0.y + dy + "px";
      for (const o of members) { o.e.style.left = o.x + dx + "px"; o.e.style.top = o.y + dy + "px"; }
      renderCables();
      positionCablePop();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) {
        edit("move panel modules", (b) => {
          const q = panelById(g.q.id, b);
          if (!q) return false;
          (q.groups || (q.groups = {}))[levelKey(lvl)] = { x: at0.x + dx, y: at0.y + dy };
        });
      } else {
        groupOpen.has(key) ? groupOpen.delete(key) : groupOpen.add(key);
        renderNodes();
        renderCables();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /// Opens the stack a module is in and selects it (from the panel editor).
  function revealPanelModule(id) {
    const q = ownerOf(id), n = nodeById(id);
    if (!n) return;
    if (!q) return goToNode(id);   // a control made with panel-wiring: its module is in the Panel cell
    
    const lvl = n.parent || "";
    if (level() !== lvl && lvl && !path.length) enterCell(lvl);
    if (level() !== lvl) return;
    groupOpen.add(groupKey(q, lvl));
    renderNodes();
    sel.clear();
    sel.add(id);
    renderSelection();
    renderCables();
    centreOn(groupAt(q, lvl));
  }

  function jackRow(n, jack, name, type, dir, extraClass) {
    const row = el("div", `jack ${dir}${extraClass ? " " + extraClass : ""}`);
    row.dataset.node = n.id;
    row.dataset.jack = jack;
    row.dataset.type = type;
    row.style.setProperty("--c", signalColour(type));
    const dot = el("span", "dot");
    if (dir === "in") row.append(dot, el("span", "jl", name));
    else {
      const sc = el("canvas", "scope");
      row.append(el("span", "jl", name), sc, dot);
      if (type !== "notes" && type !== "patchbay") scopes.set(n.id + "|" + jack, { canvas: sc, hist: new Float32Array(40), head: 0 });
    }
    return row;
  }

  function nodeElement(n) {
    const t = typeOf(n);
    const e = el("div", "node");
    e.dataset.id = n.id;
    if (isPort(n)) e.classList.add("port");
    if (isCellLike(n)) e.classList.add("cell");
    if (n.type === "voice-cell") e.classList.add("voice");
    if (isBoundary(n)) e.classList.add("boundary");
    if (isGhost(n)) e.classList.add("ghost");
    if (n.muted) e.classList.add("muted");
    if (n.bypassed) e.classList.add("bypassed");
    if (sel.has(n.id)) e.classList.add("selected");
    if (trace && !trace.has(n.id)) e.classList.add("dim");
    e.style.left = n.x + "px";
    e.style.top = n.y + "px";
    e.style.setProperty("--accent", n.colour || t.colour || "#4fd1c5");

    const head = el("div", "n-head");
    head.appendChild(el("span", "n-title", n.name));
    let sub = t.name;
    if (isPort(n)) sub = isGhost(n) ? (portInfo(n) ? "inactive" : "not in set") : n.track || t.name;
    if (n.type === "cell") sub = "Cell";
    if (n.type === "voice-cell") sub = "×" + paramValue(n, "voices");
    if (isBoundary(n)) sub = "";
    const missingModule = !types[n.type] && !isCellLike(n) && !isBoundary(n) && !isPort(n);
    if (missingModule) { e.classList.add("missing"); sub = "not installed"; }
    if (n.name === sub) sub = t.name;
    if (sub) head.appendChild(el("span", "n-sub", sub));
    if (hasPanel(n)) {
      const pb = el("button", "n-panel", "▦");
      pb.title = "Open the front panel";
      pb.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      pb.addEventListener("dblclick", (ev) => ev.stopPropagation());
      pb.addEventListener("click", (ev) => { ev.stopPropagation(); cellPanels(ev, n); });
      head.appendChild(pb);
    }
    if (isCellLike(n) && n.help && n.help.text) {
      const hb = el("button", "n-help" + (hasPanel(n) ? "" : " first"), "?");
      hb.title = "Help for this cell";
      hb.setAttribute("aria-label", "Help for " + n.name);
      hb.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      hb.addEventListener("dblclick", (ev) => ev.stopPropagation());
      hb.addEventListener("click", (ev) => { ev.stopPropagation(); showCellHelp(n, hb); });
      head.appendChild(hb);
    }
    e.appendChild(head);
    if (missingModule) {  // the module of this node is not on this machine: the node waits, with its settings, and its cables are kept
      const note = el("div", "n-missing", n.type);
      e.appendChild(note);
      if (window.BleepStoreView) {
        const b = el("button", "n-install", "Install");
        b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        b.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          b.disabled = true;
          b.textContent = "Installing…";
          const ok = await window.BleepStoreView.installType(n.type);
          if (!ok) { b.disabled = false; b.textContent = "Install"; note.textContent = n.type + ": " + (window.BleepStoreView.lastMessage() || "not found in the store"); }
        });
        e.appendChild(b);
      }
    }
    if (n.type === "voice-cell") {
      // One dot per voice, lit while it plays (spec §9.3); a warning if the voice makes no sound.
      const dots = el("div", "n-voices");
      const count = paramValue(n, "voices");
      for (let k = 0; k < count; k++) dots.appendChild(el("span", "vdot"));
      const vout = board.nodes.find((m) => m.parent === n.id && m.type === "voice-out");
      if (!vout || !board.cables.some((c) => c.to.node === vout.id && c.to.jack === "l"))
        dots.appendChild(el("span", "n-warn", "no sound"));
      e.appendChild(dots);
    }

    const body = el("div", "n-body");
    const ins = el("div", "n-ins"), outs = el("div", "n-outs");
    for (const j of inputsOf(n)) {
      const connected = board.cables.some((c) => c.to.node === n.id && c.to.jack === j.id);
      const shown = isShown(n, j);
      if (!shown && !connected) continue;  // hidden in this mode; its cables are kept (dimmed)
      const row = jackRow(n, j.id, shownName(n, j), j.type, "in",
        (connected ? "connected" : "") + (shown ? "" : " unused"));
      if (j.normal && !connected) {
        const src = inputsOf(n).find((k) => k.id === j.normal);
        row.title = `Unpatched: follows ${src ? shownName(n, src) : j.normal}`;
      }
      ins.appendChild(row);
    }
    for (const p of modParams(n))
      if (board.cables.some((c) => c.to.node === n.id && c.to.jack === p.id))
        ins.appendChild(jackRow(n, p.id, p.name, "control", "in", "param connected"));
    if (n.type === "cell-out") {
      const add = jackRow(n, "+", "new output", "control", "in", "add");
      ins.appendChild(add);
    }
    // Long output lists (MIDI In, Macros) show the first few and the patched ones.
    const all = outputsOf(n).filter((j) => isShown(n, j) || board.cables.some((c) => c.from.node === n.id && c.from.jack === j.id));
    const shown = all.length <= kShownOutputs + 1 || expanded.has(n.id) ? all
      : all.filter((j, i) => i < kShownOutputs || board.cables.some((c) => c.from.node === n.id && c.from.jack === j.id));
    for (const j of shown) outs.appendChild(jackRow(n, j.id, shownName(n, j), j.type, "out", isShown(n, j) ? "" : "unused"));
    if (all.length > kShownOutputs + 1) {
      const more = el("div", "jack out more", expanded.has(n.id) ? "show less" : `+ ${all.length - shown.length} more`);
      more.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        expanded.has(n.id) ? expanded.delete(n.id) : expanded.add(n.id);
        renderNodes();
        renderCables();
      });
      outs.appendChild(more);
    }
    if (n.type === "cell-in") outs.appendChild(jackRow(n, "+", "new input", "control", "out", "add"));
    body.append(ins, outs);
    e.appendChild(body);

    e.addEventListener("pointerdown", (ev) => onNodePointerDown(ev, n));
    e.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      if (ev.target.closest(".n-title")) return startRename(n, e);
      if (isCellLike(n)) enterCell(n.id);
    });
    e.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // On a jack (or a patched knob): make a panel control for it.
      const row = ev.target.closest(".jack");
      if (row && row.dataset.jack !== "+") {
        const target = row.classList.contains("param") ? { param: row.dataset.jack } : { jack: row.dataset.jack, dir: row.classList.contains("in") ? "in" : "out" };
        const items = controlMenuItems(n.id, target);
        if (items.length) return showMenu(ev, items);
      }
      if (!sel.has(n.id)) { sel.clear(); sel.add(n.id); renderSelection(); }
      showNodeMenu(n, ev);
    });
    return e;
  }

  function renderSelection() {
    for (const e of nodesEl.children) e.classList.toggle("selected", sel.has(e.dataset.id));
  }

  /// Centre of a jack's dot, in world coordinates.
  function jackPos(nodeId, jack, dir) {
    const row = nodesEl.querySelector(`.jack.${dir}[data-node="${nodeId}"][data-jack="${CSS.escape(jack)}"]`);
    if (!row) {   // in a folded stack: the cable ends at its header
      const h = nodesEl.querySelector(`.pgroup[data-members*=" ${nodeId} "]`);
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return toWorld(dir === "out" ? r.right : r.left, r.top + r.height / 2);
    }
    const d = row.querySelector(".dot").getBoundingClientRect();
    return toWorld(d.left + d.width / 2, d.top + d.height / 2);
  }

  function cablePath(a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }

  // Signal pulse: a faint light travelling along each cable whose source
  // output moves, brighter the more it moves (state.activity).
  const pulses = new Map();   // cable id → {path, node, jack}
  const pulseLevel = new Map();  // "node|jack" → smoothed 0..1

  const cableHighlight = "#ffffff";   // hovered and selected cables

  // Draws a highlighted copy of the cable at the end of the SVG: on top of all other cables, and it
  // never moves the element under the pointer (which would end the hover).
  function setHoverCable(id, path) {
    hoverCable = id;
    cablesEl.querySelectorAll(".cable.hover").forEach((e) => e.remove());
    if (!id || !path) return hideMeter();
    const cable = board && board.cables.find((k) => k.id === id);
    if (cable) showMeter(cable); else hideMeter();
    const o = path.cloneNode(false);
    o.classList.remove("ghost", "dim", "selected");
    o.classList.add("hover");
    o.style.setProperty("--c", cableHighlight);
    cablesEl.append(o);
  }

  function renderCables() {
    cablesEl.innerHTML = "";
    pulses.clear();
    if (!board) return;
    const here = new Set(nodesAt(level()).map((n) => n.id));
    // The selected cable is drawn last, so it lies on top of the others.
    const ordered = [...board.cables.filter((c) => !isCableSel(c.id)), ...board.cables.filter((c) => isCableSel(c.id))];
    if (hoverCable && !board.cables.some((c) => c.id === hoverCable)) hoverCable = null;
    let hoverPath = null;
    for (const c of ordered) {
      if (!here.has(c.from.node) || !here.has(c.to.node)) continue;
      const a = jackPos(c.from.node, c.from.jack, "out"), b = jackPos(c.to.node, c.to.jack, "in");
      if (!a || !b) continue;
      const src = nodeById(c.from.node), dst = nodeById(c.to.node);
      const type = outType(src, c.from.jack) || "control";
      const d = cablePath(a, b);
      const p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", d);
      p.setAttribute("class", `cable ${type}`);
      p.style.setProperty("--c", signalColour(type));
      if (isGhost(src) || isGhost(dst)) p.classList.add("ghost");
      if (trace && !(trace.has(src.id) && trace.has(dst.id))) p.classList.add("dim");
      if (isCableSel(c.id)) { p.classList.add("selected"); p.style.setProperty("--c", cableHighlight); }
      const hit = document.createElementNS(SVGNS, "path");
      hit.setAttribute("d", d);
      hit.setAttribute("class", "cable-hit");
      hit.dataset.id = c.id;
      const title = document.createElementNS(SVGNS, "title");
      title.textContent = `${src.name} › ${jackName(src, c.from.jack, true)}  →  ${dst.name} › ${jackName(dst, c.to.jack, false)}  (${Math.round(c.amount * 100)}%)`;
      hit.appendChild(title);
      hit.addEventListener("pointerenter", () => { if (!drag) setHoverCable(c.id, p); });
      hit.addEventListener("pointerleave", () => setHoverCable(null));
      hit.addEventListener("pointermove", (ev) => { hit.style.cursor = cableEndAt(ev, a, b) ? "grab" : ""; });
      const selectCable = (ev) => {
        sel.clear();
        if ((ev.shiftKey || ev.ctrlKey || ev.metaKey) && selCable) {   // shift-, ctrl- or ⌘-click adds the cable to the selection, or takes it out
          if (c.id === selCable) { selCable = selMore.size ? [...selMore][0] : null; selMore.delete(selCable); }
          else selMore.has(c.id) ? selMore.delete(c.id) : selMore.add(c.id);
        } else {
          clearCableSel();
          selCable = c.id;
        }
        renderSelection();
        renderCables();
        if (selCable && !selMore.size) showCablePop(board.cables.find((k) => k.id === selCable));
        else $("cable-pop").hidden = true;
      };
      hit.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        if (ev.button !== 0) return;   // the right button is the cable menu
        const end = ev.shiftKey || ev.ctrlKey || ev.metaKey ? null : cableEndAt(ev, a, b);
        if (!end) return selectCable(ev);
        // Near one end of the cable: dragging picks that end up (the input end onto another output, the output end onto
        // another input); a click without moving selects the cable as usual.
        const x0 = ev.clientX, y0 = ev.clientY;
        const stop = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
        const mv = (e) => {
          if (Math.hypot(e.clientX - x0, e.clientY - y0) < 4) return;
          stop();
          if (end === "from") startSourceDrag(e, c);
          else startCableDrag(e, c.from.node, c.from.jack, c);
        };
        const up = () => { stop(); selectCable(ev); };
        window.addEventListener("pointermove", mv);
        window.addEventListener("pointerup", up);
      });
      hit.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.ctrlKey && ev.button === 0) return;   // ctrl-click on a Mac: a selection click, not the menu
        if (!isCableSel(c.id)) { sel.clear(); clearCableSel(); selCable = c.id; renderSelection(); renderCables(); }
        showCableMenu(ev);
      });
      cablesEl.append(p);
      if (!p.classList.contains("ghost") && !p.classList.contains("dim")) {
        const glow = document.createElementNS(SVGNS, "path");
        glow.setAttribute("d", d);
        glow.setAttribute("class", "cable-pulse");
        glow.style.setProperty("--c", signalColour(type));
        glow.style.setProperty("--act", pulseLevel.get(c.from.node + "|" + c.from.jack) || 0);
        cablesEl.append(glow);
        pulses.set(c.id, { path: glow, key: c.from.node + "|" + c.from.jack });
      }
      cablesEl.append(hit);
      if (c.id === hoverCable) hoverPath = p;
    }
    if (hoverPath) setHoverCable(hoverCable, hoverPath);
    else if (!drag) hideMeter();
    if (!selCable) $("cable-pop").hidden = true;
  }

  const kGrabRadius = 16;   // px: how close to a cable's end a drag picks that end up
  /// Which end of the cable (from → "from", to → "to") the pointer is near, if any.
  function cableEndAt(ev, a, b) {
    const w = toWorld(ev.clientX, ev.clientY), z = cam().z;
    if (Math.hypot(w.x - a.x, w.y - a.y) * z <= kGrabRadius) return "from";
    if (Math.hypot(w.x - b.x, w.y - b.y) * z <= kGrabRadius) return "to";
    return null;
  }

  // ------------------------------------------------------------ cable popover
  function showCablePop(c) {
    const pop = $("cable-pop");
    pop.innerHTML = "";
    const src = nodeById(c.from.node), dst = nodeById(c.to.node);
    pop.appendChild(el("span", "", `${jackName(src, c.from.jack, true)} → ${jackName(dst, c.to.jack, false)}`));
    const r = el("input");
    r.type = "range"; r.min = -1; r.max = 1; r.step = 0.01; r.value = c.amount;
    const v = el("span", "v", Math.round(c.amount * 100) + "%");
    r.addEventListener("pointerdown", () => gesture());
    r.addEventListener("input", () => {
      const a = parseFloat(r.value);
      v.textContent = Math.round(a * 100) + "%";
      const cc = board.cables.find((x) => x.id === c.id);
      if (cc) cc.amount = a;
      native("setAmount", c.id, a);
    });
    const del = el("button", "", "Delete");
    del.addEventListener("click", () => removeCable(c.id));
    pop.append(r, v, del);
    pop.hidden = false;
    pop.dataset.cable = c.id;
    positionCablePop();
  }
  function positionCablePop() {
    const pop = $("cable-pop");
    if (pop.hidden || !board) return;
    const c = board.cables.find((x) => x.id === pop.dataset.cable);
    if (!c) { pop.hidden = true; return; }
    const a = jackPos(c.from.node, c.from.jack, "out"), b = jackPos(c.to.node, c.to.jack, "in");
    if (!a || !b) { pop.hidden = true; return; }
    const m = toCanvas((a.x + b.x) / 2, (a.y + b.y) / 2);
    pop.style.left = m.x - pop.offsetWidth / 2 + "px";
    pop.style.top = m.y + 14 + "px";
  }
  // ------------------------------------------------------- cable activity meter
  // While the pointer rests on a cable, a small meter at its input end shows what travels through it: a level meter
  // for audio, a graph for control and pitch, a step trace for gates, ticks for triggers and notes.
  const kMeterW = 120, kMeterN = 60;   // px wide; samples kept (60 at 30 Hz: two seconds)
  const meterKind = (t) => t === "audio" ? "audio" : t === "control" || t === "pitch" ? "graph" : t === "gate" ? "gate"
                         : t === "trigger" || t === "notes" ? "event" : "bar";
  let meter = null;   // {id, node, jack, kind, el, cv, label, colour, hist, head, level, peak, hold, v}

  function showMeter(c) {
    if (meter && meter.id === c.id) return positionMeter();
    hideMeter();
    const src = nodeById(c.from.node);
    if (!src) return;
    const type = outType(src, c.from.jack) || "control", kind = meterKind(type);
    const e = el("div", "cable-meter");
    e.style.setProperty("--c", signalColour(type));
    const cv = el("canvas");
    const h = kind === "graph" ? 40 : kind === "audio" || kind === "bar" ? 10 : 22;
    cv.style.width = kMeterW + "px";
    cv.style.height = h + "px";
    const label = el("span", "cm-val");
    e.append(cv, label);
    canvas.append(e);
    const ns = live && live.nodes && live.nodes[c.from.node];
    const v0 = (ns && ns.outputs && ns.outputs[c.from.jack]) || 0;
    meter = { id: c.id, node: c.from.node, jack: c.from.jack, kind, el: e, cv, label, colour: getComputedStyle(e).getPropertyValue("--c") || "#888",
              hist: new Float32Array(kMeterN).fill(kind === "graph" || kind === "gate" ? v0 : 0), head: 0, level: 0, peak: 0, hold: 0, v: v0 };
    positionMeter();
    drawMeter();
  }
  function hideMeter() {
    if (!meter) return;
    meter.el.remove();
    meter = null;
  }
  /// Sits above-left of the cable's input end: the cable arrives horizontally from the left, so that corner is free.
  function positionMeter() {
    if (!meter) return;
    const c = board && board.cables.find((x) => x.id === meter.id);
    const b = c && jackPos(c.to.node, c.to.jack, "in");
    if (!b) return hideMeter();
    const p = toCanvas(b.x, b.y), e = meter.el;
    const top = p.y - e.offsetHeight - 10;
    e.style.left = Math.max(4, p.x - e.offsetWidth - 10) + "px";
    e.style.top = (top < 4 ? p.y + 12 : top) + "px";
  }

  /// One state tick (30 Hz) for the hovered cable's source output.
  function feedMeter(ns) {
    const m = meter;
    if (!m || !ns) return;
    const v = ns.outputs && m.jack in ns.outputs ? ns.outputs[m.jack] : 0;
    const act = (ns.activity && ns.activity[m.jack]) || 0;   // how far the signal swung since the last tick
    m.v = v;
    if (m.kind === "audio") {
      const amp = act / 2;   // peak amplitude of a signal swinging around zero
      const f = amp > 1e-5 ? Math.min(1, Math.max(0, (20 * Math.log10(amp) + 60) / 60)) : 0;   // −60 … 0 dB
      m.level = f > m.level ? f : m.level * 0.88;
      if (m.level >= m.peak) { m.peak = m.level; m.hold = 20; } else if (m.hold-- <= 0) m.peak = Math.max(m.level, m.peak - 0.02);
      m.amp = amp;
    } else if (m.kind === "bar") {
      const f = Math.min(1, Math.sqrt(act / 0.5));
      m.level = f > m.level ? f : m.level * 0.9;
    } else {
      m.hist[m.head] = m.kind === "graph" ? v : m.kind === "gate" ? (v > 0.5 ? 1 : 0) : act > 1e-4 ? 1 : 0;
      m.head = (m.head + 1) % kMeterN;
    }
    drawMeter();
  }

  function drawMeter() {
    const m = meter;
    if (!m) return;
    const c = m.cv, w = kMeterW, h = parseFloat(c.style.height);
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,.08)";
    const col = m.colour.trim();
    let text = "";
    if (m.kind === "audio" || m.kind === "bar") {
      g.fillRect(0, 0, w, h);
      const x = m.level * w;
      if (m.kind === "audio") {   // quiet in the signal colour, hot above −12 dB amber, above −3 dB red
        const amber = 48 / 60 * w, red = 57 / 60 * w;
        g.fillStyle = col; g.fillRect(0, 0, Math.min(x, amber), h);
        if (x > amber) { g.fillStyle = "#f6c35b"; g.fillRect(amber, 0, Math.min(x, red) - amber, h); }
        if (x > red) { g.fillStyle = "#ff4d4d"; g.fillRect(red, 0, x - red, h); }
        g.fillStyle = "#fff"; g.fillRect(Math.min(w - 2, m.peak * w), 0, 2, h);
        const db = m.amp > 1e-5 ? 20 * Math.log10(m.amp) : -Infinity;
        text = db === -Infinity || db < -59 ? "−∞ dB" : (db > 0 ? "+" : "") + db.toFixed(0).replace("-", "−") + " dB";
      } else {
        g.fillStyle = col; g.fillRect(0, 0, x, h);
        text = m.level > 0.02 ? "active" : "idle";
      }
    } else if (m.kind === "graph") {
      let lo = Infinity, hi = -Infinity;
      for (const x of m.hist) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
      if (hi - lo < 1e-3) { lo -= 0.5; hi += 0.5; }
      const y = (x) => h - 2 - (x - lo) / (hi - lo) * (h - 4);
      if (lo < 0 && hi > 0) {   // the zero line
        g.fillRect(0, y(0), w, 1);
      }
      g.strokeStyle = col; g.lineWidth = 1.5; g.lineJoin = "round";
      g.beginPath();
      for (let i = 0; i < kMeterN; i++) {
        const px = i / (kMeterN - 1) * w, py = y(m.hist[(m.head + i) % kMeterN]);
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.stroke();
      text = m.v.toFixed(2);
    } else if (m.kind === "gate") {   // high stretches as blocks
      g.fillRect(0, h - 1, w, 1);
      g.fillStyle = col;
      const step = w / kMeterN;
      for (let i = 0; i < kMeterN; i++) if (m.hist[(m.head + i) % kMeterN]) g.fillRect(i * step, 3, Math.ceil(step), h - 6);
      text = m.v > 0.5 ? "high" : "low";
    } else {   // trigger and notes: a tick for every tick of the clock that carried an event
      g.fillRect(0, h - 1, w, 1);
      g.fillStyle = col;
      const step = w / kMeterN;
      let n = 0;
      for (let i = 0; i < kMeterN; i++) if (m.hist[(m.head + i) % kMeterN]) { n++; g.fillRect(i * step, 2, Math.max(2, step - 1), h - 4); }
      text = n ? n + "×" : "idle";
    }
    m.label.textContent = text;
  }

  function removeCable(id) { removeCables([id]); }
  function removeCables(ids) {
    clearCableSel();
    $("cable-pop").hidden = true;
    edit(ids.length > 1 ? "delete cables" : "delete cable", (b) => { b.cables = b.cables.filter((c) => !ids.includes(c.id)); });
  }

  // ---- create patch bay: the selected cables become the channels of one bundle (doc/specs/modules/patchbay.md) -------
  /// The selected cables a bay can carry: any signal but notes, and not a bundle already.
  function bayableCables() {
    const ids = selectedCableIds();
    return board.cables.filter((c) => {
      if (!ids.includes(c.id)) return false;
      const src = nodeById(c.from.node);
      const t = src && outType(src, c.from.jack);
      return t && t !== "notes" && t !== "patchbay";
    });
  }
  function showCableMenu(ev) {
    const n = selectedCableIds().length, ok = bayableCables().length;
    showMenu(ev, [
      { label: "Create patch bay", run: createPatchBay, disabled: !ok },
      "-",
      { label: n > 1 ? "Delete " + n + " cables" : "Delete cable", key: "⌫", run: () => removeCables(selectedCableIds()) },
    ]);
  }
  /// Every distinct source output becomes a channel of a new Patch Bay In (left of the destinations), the bundle goes
  /// to a new Patch Bay Out, and each destination is wired from that channel with its old amount.
  function createPatchBay() {
    const picked = bayableCables().map((c) => c.id);
    if (!picked.length) return;
    clearCableSel();
    $("cable-pop").hidden = true;
    edit("create patch bay", (b) => {
      const cables = b.cables.filter((c) => picked.includes(c.id));
      const mean = (ids, k) => ids.reduce((a, id) => a + nodeById(id, b)[k], 0) / ids.length;
      const srcIds = [...new Set(cables.map((c) => c.from.node))], dstIds = [...new Set(cables.map((c) => c.to.node))];
      const lvl = level();
      // In just right of the sources, Out just left of the destinations, never on top of each other.
      const inX = Math.round(Math.max(...srcIds.map((id) => nodeById(id, b).x)) + 200);
      const outX = Math.round(Math.max(inX + 200, Math.min(...dstIds.map((id) => nodeById(id, b).x)) - 200));
      const bin = { id: uid("n"), type: "patchbay-in", name: types["patchbay-in"].name, x: inX, y: Math.round(mean(srcIds, "y")), parent: lvl, params: {} };
      const bout = { id: uid("n"), type: "patchbay-out", name: types["patchbay-out"].name, x: outX, y: Math.round(mean(dstIds, "y")), parent: lvl, params: {} };
      b.nodes.push(bin, bout);
      const chan = new Map();
      b.cables = b.cables.filter((c) => !picked.includes(c.id));
      for (const c of cables) {
        const key = c.from.node + "|" + c.from.jack;
        if (!chan.has(key)) {
          chan.set(key, "c" + (chan.size + 1));
          b.cables.push({ id: uid("k"), from: clone(c.from), to: { node: bin.id, jack: chan.get(key) }, amount: 1 });
        }
        b.cables.push({ id: uid("k"), from: { node: bout.id, jack: chan.get(key) }, to: clone(c.to), amount: c.amount });
      }
      b.cables.push({ id: uid("k"), from: { node: bin.id, jack: "bundle" }, to: { node: bout.id, jack: "bundle" }, amount: 1 });
      sel.clear();
      sel.add(bin.id);
      sel.add(bout.id);
    });
  }

  // ----------------------------------------------------------- node dragging
  function onNodePointerDown(ev, n) {
    if (ev.button !== 0) return;
    const dot = ev.target.closest(".dot");
    if (dot) {
      ev.stopPropagation();
      const row = dot.closest(".jack");
      if (row.classList.contains("out") && (row.dataset.jack !== "+" || n.type === "cell-in")) return startCableDrag(ev, n.id, row.dataset.jack);
      if (row.classList.contains("in")) {
        // Pick up the last cable into this jack and move its end (spec §9.5).
        const into = cablesInto(n.id, row.dataset.jack);
        if (into.length) {
          const c = into[into.length - 1];
          return startCableDrag(ev, c.from.node, c.from.jack, c);
        }
      }
      return;
    }
    if (ev.target.closest("input")) return;
    ev.stopPropagation();
    canvas.focus();
    hidePopovers();
    clearCableSel();
    if (ev.shiftKey) {
      sel.has(n.id) ? sel.delete(n.id) : sel.add(n.id);
    } else if (!sel.has(n.id)) {
      sel.clear();
      sel.add(n.id);
    }
    renderSelection();
    renderCables();

    const start = { x: ev.clientX, y: ev.clientY };
    const c = cam();
    const moving = [...sel].map((id) => nodeById(id)).filter((m) => m && !ownerOf(m.id));   // a panel's modules sit in their stack
    const origin = moving.map((m) => ({ id: m.id, x: m.x, y: m.y }));
    let moved = false;
    // Dropping on a cell moves what is dragged into it (the cell under the pointer, if it may take them).
    const movers = moving.filter((m) => !isPort(m) && !isBoundary(m));
    let dropCell = null;
    const setDropCell = (id) => {
      if (id === dropCell) return;
      if (dropCell) { const o = nodesEl.querySelector(`[data-id="${dropCell}"]`); if (o) o.classList.remove("drop-target"); }
      dropCell = id;
      if (id) { const o = nodesEl.querySelector(`[data-id="${id}"]`); if (o) o.classList.add("drop-target"); }
    };
    const cellUnder = (e) => {
      if (!movers.length) return null;
      for (const hit of document.elementsFromPoint(e.clientX, e.clientY)) {
        const ne = hit.closest && hit.closest(".node.cell");
        const t = ne && nodeById(ne.dataset.id);
        if (!t || !isCellLike(t) || movers.some((m) => m.id === t.id)) continue;
        if ((t.type === "voice-cell" || insideVoiceCell(t.id)) && !canEnterVoice(movers)) return null;
        return t.id;
      }
      return null;
    };
    const move = (e) => {
      const dx = (e.clientX - start.x) / c.z, dy = (e.clientY - start.y) / c.z;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      setDropCell(cellUnder(e));
      origin.forEach((o) => {
        const m = nodeById(o.id);
        m.x = Math.round(o.x + dx);
        m.y = Math.round(o.y + dy);
        const ne = nodesEl.querySelector(`[data-id="${o.id}"]`);
        if (ne) { ne.style.left = m.x + "px"; ne.style.top = m.y + "px"; }
      });
      renderCables();
      positionCablePop();
    };
    const up = (e) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const target = moved ? cellUnder(e) : null;
      setDropCell(null);
      if (target) {
        edit("move into cell", (b) => { moveIntoCell(b, new Set(movers.map((m) => m.id)), target, false); sel.clear(); });
      } else if (moved) {
        commit(clone(board), "move");  // positions were updated in place while dragging
      } else if (!ev.shiftKey && !isStructural(n)) {
        toggleView(n.id);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // ---------------------------------------------------------- cable dragging
  let drag = null;  // {from: {node, jack}, type, moving: cable|null, path}

  function startCableDrag(ev, nodeId, jack, movingCable) {
    ev.preventDefault();
    setHoverCable(null);
    const n = nodeById(nodeId);
    const type = outType(n, jack) || "control";
    const tmp = document.createElementNS(SVGNS, "path");
    tmp.setAttribute("class", `cable temp ${type}`);
    tmp.style.setProperty("--c", signalColour(type));
    cablesEl.appendChild(tmp);
    drag = { from: { node: nodeId, jack }, type, moving: movingCable || null, tmp };
    if (movingCable) hideCableEls(movingCable.id);
    markTargets(true);
    const a = jackPos(nodeId, jack, "out");
    const move = (e) => {
      const over = document.elementFromPoint(e.clientX, e.clientY);
      // The port a drop would reach: a knob in a view or an input jack that accepts this cable.
      const port = over && (over.closest(".bv-target.drop-ok") || over.closest(".jack.in.drop-ok"));
      for (const t of document.querySelectorAll(".drop-hover")) if (t !== port) t.classList.remove("drop-hover");
      let b = toWorld(e.clientX, e.clientY);
      if (port) {
        port.classList.add("drop-hover");
        // The cable end snaps onto the port.
        const r = (port.querySelector(".dot") || port).getBoundingClientRect();
        b = toWorld(r.left + r.width / 2, r.top + r.height / 2);
      }
      tmp.setAttribute("d", cablePath(a, b));
      springOpen(over);
    };
    const up = (e) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      tmp.remove();
      const d = drag;
      drag = null;
      dropCable(d, e);
      endSpring(e);
      markTargets(false);  // after the drop: it may land on a view's input strip
    };
    move(ev);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /// Hides the drawn cable (path, pulse and hit area) that is being moved.
  function hideCableEls(id) {
    const hit = cablesEl.querySelector(`.cable-hit[data-id="${id}"]`);
    for (let e = hit && hit.previousElementSibling; e && (e.classList.contains("cable-pulse") || e.classList.contains("cable") && !e.classList.contains("hover")); e = e.previousElementSibling) {
      e.style.display = "none";
      if (e.classList.contains("cable")) break;
    }
  }

  function markTargets(on) {
    const reverse = on && drag.reverse;   // an output end is in hand: output jacks are the targets
    if (!reverse) for (const [id, v] of views) viewInputs(id, v, on);
    for (const row of document.querySelectorAll("#nodes .jack, #views .jack")) {
      row.classList.remove("drop-ok", "drop-no");
      if (!on) { row.classList.remove("drop-hover"); continue; }
      if (row.classList.contains("in") === reverse) continue;
      if (!reverse && row.dataset.jack === "+") { row.classList.add("drop-ok"); continue; }
      const n = nodeById(row.dataset.node);
      const ok = reverse ? n && row.dataset.jack !== "+" && compatible(row.dataset.type, drag.destType) && n.id !== drag.to.node
                         : n && compatible(drag.type, row.dataset.type) && n.id !== drag.from.node;
      row.classList.add(ok ? "drop-ok" : "drop-no");
    }
    for (const k of document.querySelectorAll(".bv-target")) {
      k.classList.toggle("drop-ok", on && !reverse && drag.type !== "notes");
      if (!on) k.classList.remove("drop-hover");
    }
  }

  /// The output end of an existing cable in hand: drop it on another output jack (or a module, to pick one of its outputs).
  function startSourceDrag(ev, cable) {
    ev.preventDefault();
    setHoverCable(null);
    const dst = nodeById(cable.to.node);
    const dj = dst && inputsOf(dst).find((j) => j.id === cable.to.jack);
    const type = outType(nodeById(cable.from.node), cable.from.jack) || "control";
    const tmp = document.createElementNS(SVGNS, "path");
    tmp.setAttribute("class", `cable temp ${type}`);
    tmp.style.setProperty("--c", signalColour(type));
    cablesEl.appendChild(tmp);
    drag = { reverse: true, from: cable.from, to: cable.to, type, destType: dj ? dj.type : "control", moving: cable, tmp };
    hideCableEls(cable.id);
    markTargets(true);
    const fixed = jackPos(cable.to.node, cable.to.jack, "in");
    const move = (e) => {
      const over = document.elementFromPoint(e.clientX, e.clientY);
      const port = over && over.closest(".jack.out.drop-ok");
      for (const t of document.querySelectorAll(".drop-hover")) if (t !== port) t.classList.remove("drop-hover");
      let a = toWorld(e.clientX, e.clientY);
      if (port) {
        port.classList.add("drop-hover");
        const r = (port.querySelector(".dot") || port).getBoundingClientRect();
        a = toWorld(r.left + r.width / 2, r.top + r.height / 2);
      }
      tmp.setAttribute("d", cablePath(a, fixed));
    };
    const up = (e) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      tmp.remove();
      const d = drag;
      drag = null;
      dropSource(d, e);
      markTargets(false);
    };
    move(ev);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function dropSource(d, e) {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const old = d.moving;
    const rewire = (n, jack) => {
      if (n.id === old.from.node && jack === old.from.jack) return render();   // back where it was
      edit("reconnect", (b) => {
        b.cables = b.cables.filter((c) => c.id !== old.id);
        connect(b, { node: n.id, jack }, d.to, old.amount);
      });
    };
    const row = target && target.closest(".jack.out");
    if (row) {
      const n = nodeById(row.dataset.node);
      if (!n || row.dataset.jack === "+" || n.id === d.to.node || !compatible(row.dataset.type, d.destType)) return render();
      return rewire(n, row.dataset.jack);
    }
    const nodeEl = target && target.closest(".node");
    if (nodeEl && nodeEl.dataset.id !== d.to.node) {
      const n = nodeById(nodeEl.dataset.id);
      const items = outputsOf(n).filter((j) => compatible(j.type, d.destType));
      if (!items.length) return render();
      return showMenu(e, items.map((j) => ({ label: j.name, key: j.type, run: () => rewire(n, j.id) })));
    }
    // Empty canvas: a dropped cable end is deleted, as with the input end.
    if (target && canvas.contains(target) && !target.closest(".vwin")) return edit("disconnect", (b) => { b.cables = b.cables.filter((c) => c.id !== old.id); });
    render();
  }

  // While a cable is in hand, open views show the module's input jacks in a
  // strip on their left, so the cable can end there too. The window grows to
  // the left, keeping its controls where they were.
  function viewInputs(id, v, on) {
    const old = v.win.querySelector(".v-ins");
    if (old) {
      v.win.style.left = v.win.offsetLeft + (v.shift || 0) + "px";
      v.win.style.width = v.ownWidth;
      v.win.classList.remove("wiring");
      old.remove();
    }
    const n = nodeById(id);
    const jacks = on && n ? inputsOf(n) : [];
    if (!jacks.length) return;
    const strip = el("div", "v-ins");
    for (const j of jacks) {
      const connected = board.cables.some((c) => c.to.node === id && c.to.jack === j.id);
      strip.appendChild(jackRow(n, j.id, j.name, j.type, "in", connected ? "connected" : ""));
    }
    v.ownWidth = v.win.style.width;
    const w = v.win.offsetWidth;
    v.win.classList.add("wiring");
    v.win.insertBefore(strip, v.win.querySelector(".v-body"));
    v.win.style.width = w + strip.offsetWidth + "px";
    // Grow to the left, but never over the module itself: its ports must stay free.
    const left0 = v.win.offsetLeft;
    let left = Math.max(8, left0 - strip.offsetWidth);
    const ne = nodesEl.querySelector(`[data-id="${id}"]`);
    if (ne) {
      const nodeRight = ne.getBoundingClientRect().right - canvas.getBoundingClientRect().left;
      if (left0 >= nodeRight) left = Math.max(left, nodeRight + 8);
    }
    v.shift = left0 - left;
    v.win.style.left = left + "px";
  }

  // While a cable is in hand, resting on a module opens its view, so the
  // cable can go straight onto a knob (spec §9.5). Views opened this way close
  // again unless the cable ends in them or on their node.
  const kSpringDelay = 250;  // ms
  let spring = { timer: 0, node: null, opened: new Set() };

  function springOpen(over) {
    if (!drag || drag.type === "notes") return;
    if (over && over.closest(".vwin")) { clearTimeout(spring.timer); spring.node = null; return; }
    const ne = over && over.closest(".node");
    const n = ne && nodeById(ne.dataset.id);
    const id = n && n.id !== drag.from.node && !isStructural(n) && modParams(n).length ? n.id : null;
    if (id === spring.node) return;
    clearTimeout(spring.timer);
    spring.node = id;
    if (!id) return;
    spring.timer = setTimeout(() => {
      if (!drag || spring.node !== id) return;
      // Only one view opened by the cable at a time.
      for (const o of spring.opened) if (o !== id) closeView(o);
      spring.opened = new Set([...spring.opened].filter((o) => o === id));
      if (views.has(id)) front(views.get(id).win);
      else { openView(id); spring.opened.add(id); }
      markTargets(true);  // the new view's knobs
    }, kSpringDelay);
  }

  function endSpring(e) {
    clearTimeout(spring.timer);
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const win = target && target.closest(".vwin");
    const ne = target && target.closest(".node");
    const keep = win ? win.dataset.node : ne ? ne.dataset.id : null;
    for (const id of spring.opened) if (id !== keep) closeView(id);
    spring = { timer: 0, node: null, opened: new Set() };
  }

  function connect(b, from, to, amount) {
    if (b.cables.some((c) => c.from.node === from.node && c.from.jack === from.jack &&
                             c.to.node === to.node && c.to.jack === to.jack)) return;
    b.cables.push({ id: uid("k"), from, to, amount });
    // A panel-element module (Dial, Button …) that still has its default name takes the title of what it now drives.
    const src = nodeById(from.node, b), dst = nodeById(to.node, b);
    if (src && dst && src !== dst && typeOf(src).category === "Controllers" &&
        new RegExp("^" + typeOf(src).name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "( \\d+)?$").test(src.name)) {
      const name = jackName(dst, to.jack, false);
      if (name && name !== to.jack) src.name = name;
    }
  }

  function dropCable(d, e) {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const without = (b) => { if (d.moving) b.cables = b.cables.filter((c) => c.id !== d.moving.id); };
    const amount = d.moving ? d.moving.amount : 1;

    // A cable from the "+" of a Cell In: its end becomes a new cell input, named after the jack or knob it lands on.
    if (d.from.jack === "+") {
      const knobEl = target && target.closest(".bv-target");
      const rowEl = target && target.closest(".jack.in");
      const dest = knobEl ? { node: knobEl.closest(".vwin").dataset.node, jack: knobEl.dataset.param, type: "control" }
                 : rowEl && rowEl.dataset.jack !== "+" ? { node: rowEl.dataset.node, jack: rowEl.dataset.jack, type: rowEl.dataset.type } : null;
      if (!dest || dest.node === d.from.node || !compatible("control", dest.type)) return;
      return edit("new cell input", (b) => {
        const cell = nodeById(nodeById(d.from.node, b).parent, b);
        const dn = nodeById(dest.node, b);
        const id = uid("i");
        cell.inputs = cell.inputs || [];
        cell.inputs.push({ id, name: jackName(dn, dest.jack, false), type: dest.type });
        connect(b, { node: d.from.node, jack: id }, { node: dest.node, jack: dest.jack }, 1);
      });
    }

    // A knob in a module view (spec §9.5).
    const knob = target && target.closest(".bv-target");
    if (knob && d.type !== "notes") {
      const nodeId = knob.closest(".vwin").dataset.node;
      return edit("connect", (b) => { without(b); connect(b, d.from, { node: nodeId, jack: knob.dataset.param }, amount); });
    }
    // An input jack, or the "+" of a Cell Out (a new cell output).
    const row = target && target.closest(".jack.in");
    if (row) {
      const n = nodeById(row.dataset.node);
      if (row.dataset.jack === "+" && n.type === "cell-out") {
        return edit("new cell output", (b) => {
          without(b);
          const cell = nodeById(n.parent, b);
          const src = nodeById(d.from.node, b);
          const id = uid("o");
          cell.outputs = cell.outputs || [];
          cell.outputs.push({ id, name: src.type === "patchbay-in" ? src.name : jackName(src, d.from.jack, true), type: d.type });
          connect(b, d.from, { node: n.id, jack: id }, 1);
        });
      }
      if (!compatible(d.type, row.dataset.type) || n.id === d.from.node && !d.moving) return d.moving ? render() : null;
      return edit("connect", (b) => { without(b); connect(b, d.from, { node: n.id, jack: row.dataset.jack }, amount); });
    }
    // A node: pick one of its knobs.
    const nodeEl = target && target.closest(".node");
    if (nodeEl && nodeEl.dataset.id !== d.from.node) {
      const n = nodeById(nodeEl.dataset.id);
      if (d.moving) edit("disconnect", without);
      return showParamPicker(n, d, e);
    }
    // Empty canvas: a dropped cable end is deleted; a new cable opens the search.
    if (d.moving) return edit("disconnect", without);
    if (target && (target === canvas || canvas.contains(target)) && !target.closest(".vwin")) {
      const r = canvas.getBoundingClientRect();
      openSearch(e.clientX - r.left, e.clientY - r.top, { from: d.from, type: d.type });
    }
  }

  function showParamPicker(n, d, e) {
    const items = [];
    for (const j of inputsOf(n))
      if (compatible(d.type, j.type)) items.push({ label: j.name, sub: j.type, jack: j.id });
    if (d.type !== "notes")
      for (const p of modParams(n)) items.push({ label: p.name, sub: "knob", jack: p.id });
    if (!items.length) return;
    showMenu(e, items.map((it) => ({
      label: it.label, key: it.sub,
      run: () => edit("connect", (b) => connect(b, d.from, { node: n.id, jack: it.jack }, 1)),
    })));
  }

  // -------------------------------------------------------------- the canvas
  canvas.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest(".popover") || ev.target.closest(".vwin")) return;
    canvas.focus();
    hidePopovers();
    if (ev.button === 0) closeUnpinnedViews();  // a click elsewhere closes views that are not pinned
    if (ev.button === 1 || (ev.button === 0 && (spaceDown || ev.altKey))) return startPan(ev);
    if (ev.button !== 0) return;
    const keepCables = ev.shiftKey ? selectedCableIds() : [];
    clearCableSel();
    if (!ev.shiftKey) sel.clear();
    renderSelection();
    renderCables();
    startBand(ev, keepCables);
  });
  canvas.addEventListener("dblclick", (ev) => {
    if (ev.target.closest(".node") || ev.target.closest(".vwin") || ev.target.closest(".popover")) return;
    const r = canvas.getBoundingClientRect();
    openSearch(ev.clientX - r.left, ev.clientY - r.top);
  });
  canvas.addEventListener("contextmenu", (ev) => {
    if (ev.target.closest(".node") || ev.target.closest(".vwin")) return;
    ev.preventDefault();
    if (ev.ctrlKey && ev.button === 0) return;   // ctrl-drag on a Mac (a cable band): not the menu
    const r = canvas.getBoundingClientRect();
    const at = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    showMenu(ev, [
      { label: "Add", items: addMenu(at) },
      { label: "Search…", key: "Tab", run: () => openSearch(at.x, at.y) },
      "-",
      { label: "Paste", key: "⌘V", run: () => paste(at) },
      { label: "Select all", key: "⌘A", run: selectAll },
      { label: "Fit to window", key: "F", run: fit },
    ]);
  });
  canvas.addEventListener("wheel", (ev) => {
    if (ev.target.closest(".vwin") || ev.target.closest(".popover")) return;
    ev.preventDefault();
    const c = cam();
    if (ev.ctrlKey || ev.metaKey) {
      const r = canvas.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const z = Math.min(2, Math.max(0.2, c.z * Math.exp(-ev.deltaY * 0.01)));
      c.x = mx - (mx - c.x) * (z / c.z);
      c.y = my - (my - c.y) * (z / c.z);
      c.z = z;
    } else {
      c.x -= ev.deltaX;
      c.y -= ev.deltaY;
    }
    applyCam();
  }, { passive: false });
  $("navbar").addEventListener("pointerdown", (ev) => ev.stopPropagation());
  $("navbar").addEventListener("contextmenu", (ev) => { ev.preventDefault(); ev.stopPropagation(); });
  function navStep(what) {
    const c = cam(), r = canvas.getBoundingClientRect(), step = 120;
    if (what === "zoom-in" || what === "zoom-out") {
      const z = Math.min(2, Math.max(0.2, c.z * (what === "zoom-in" ? 1.25 : 0.8)));
      c.x = r.width / 2 - (r.width / 2 - c.x) * (z / c.z);
      c.y = r.height / 2 - (r.height / 2 - c.y) * (z / c.z);
      c.z = z;
    } else {
      if (what === "left") c.x += step;
      if (what === "right") c.x -= step;
      if (what === "up") c.y += step;
      if (what === "down") c.y -= step;
    }
    applyCam();
  }
  $("navbar").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-nav]");
    if (b) navStep(b.dataset.nav);
  });
  const trackPointer = (ev) => {
    const r = canvas.getBoundingClientRect();
    pointer = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    pointerInside = true;
  };
  canvas.addEventListener("pointermove", trackPointer);
  canvas.addEventListener("pointerdown", trackPointer, true);
  canvas.addEventListener("pointerleave", () => { pointerInside = false; });
  canvas.addEventListener("dragover", (ev) => ev.preventDefault());
  canvas.addEventListener("drop", (ev) => {
    ev.preventDefault();
    let what = null;
    try { what = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch (e) { return; }
    const w = toWorld(ev.clientX, ev.clientY);
    addAt(what, w.x - NODE_W / 2, w.y - 20);
  });

  let spaceDown = false;
  function startPan(ev) {
    const c = cam(), start = { x: ev.clientX, y: ev.clientY, cx: c.x, cy: c.y };
    canvas.style.cursor = "grabbing";
    const move = (e) => { c.x = start.cx + e.clientX - start.x; c.y = start.cy + e.clientY - start.y; applyCam(); };
    const up = () => {
      canvas.style.cursor = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /// The cables drawn through the world rectangle (a, b): any point along the cable inside it counts.
  function cablesInRect(a, b) {
    const ids = [];
    for (const h of cablesEl.querySelectorAll(".cable-hit")) {
      const len = h.getTotalLength();
      for (let d = 0; d <= len + 8; d += 8) {
        const p = h.getPointAtLength(Math.min(d, len));
        if (p.x >= a.x && p.x <= b.x && p.y >= a.y && p.y <= b.y) { ids.push(h.dataset.id); break; }
      }
    }
    return ids;
  }
  /// A band over cables and no node selects the cables; hold ctrl/⌘ to pick cables even over nodes.
  function startBand(ev, keepCables = []) {
    const r = canvas.getBoundingClientRect();
    const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
    const band = $("band");
    const before = new Set(sel);
    const cableMode = ev.ctrlKey || ev.metaKey;
    let picked = keepCables.join();
    const move = (e) => {
      const x = e.clientX - r.left, y = e.clientY - r.top;
      Object.assign(band.style, { left: Math.min(sx, x) + "px", top: Math.min(sy, y) + "px",
        width: Math.abs(x - sx) + "px", height: Math.abs(y - sy) + "px" });
      band.hidden = false;
      const a = toWorld(Math.min(sx, x) + r.left, Math.min(sy, y) + r.top);
      const b = toWorld(Math.max(sx, x) + r.left, Math.max(sy, y) + r.top);
      sel.clear();
      before.forEach((id) => sel.add(id));
      for (const n of nodesAt(level())) {
        if (ownerOf(n.id)) continue;
        const ne = nodesEl.querySelector(`[data-id="${n.id}"]`);
        const h = ne ? ne.offsetHeight : 60;
        if (!cableMode && n.x < b.x && n.x + NODE_W > a.x && n.y < b.y && n.y + h > a.y) sel.add(n.id);
      }
      // Nodes first: cables only when the band holds none (or ctrl/⌘ is down), so a band never mixes the two.
      const ids = sel.size > before.size || (before.size && !cableMode) ? [] : cablesInRect(a, b);
      const all = [...new Set([...keepCables, ...ids])];
      if (all.join() !== picked) {
        picked = all.join();
        clearCableSel();
        all.forEach((id, i) => (i ? selMore.add(id) : (selCable = id)));
        renderCables();
      }
      renderSelection();
    };
    const up = () => {
      if (selCable && !selMore.size) showCablePop(board.cables.find((k) => k.id === selCable));
      band.hidden = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // ---------------------------------------------------------- adding things
  function addAtCentre(what) {
    const r = canvas.getBoundingClientRect();
    const w = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    addAt(what, w.x - NODE_W / 2, w.y - 40);
  }

  /// Adds a module, an empty cell or a cell preset at world position (x, y).
  /// `link` (from a cable dropped on empty canvas) is connected to the new node.
  function addAt(what, x, y, link, checked) {
    if (!board) return;
    if (what.preset && !checked && hasStore && window.BleepStoreView) {  // modules the preset needs: offer to install them first
      const q = presets.find((r) => r.key === what.preset);
      if (q) {
        BleepStoreView.ensureNeeds(q.preset, q.name).then(
          (ok) => {
            if (!ok) return;
            // The store only knows the modules it lists or has installed. A preset may use module types this app has never
            // heard of (a newer module, one not installed on this machine): say so, the board keeps them as placeholders.
            const unknown = [...new Set((q.preset.nodes || []).map((n) => n.type))].filter((t) => !types[t]);
            if (unknown.length) notice(`“${q.name}” uses modules this app doesn't have: ${unknown.join(", ")}. They show as “not installed”.`);
            addAt(what, x, y, link, true);
          },
          (e) => {   // the store check itself failed or did not answer: the preset is still wanted
            notice(`Could not check the store for “${q.name}” (${e && e.message ? e.message : e}); adding it without.`);
            addAt(what, x, y, link, true);
          });
        return;
      }
    }
    // Don't land exactly on another node (e.g. several adds at the canvas centre).
    for (let i = 0; i < 20 && nodesAt(level()).some((n) => Math.abs(n.x - x) < 40 && Math.abs(n.y - y) < 40); i++) {
      x += 36;
      y += 36;
    }
    let newId = null;
    const placed = edit("add", (b) => {
      const lvl = level();
      if (what.preset) {
        const p = presets.find((q) => q.key === what.preset);
        if (!p) return false;
        newId = insertPreset(b, p.preset, lvl, x, y);
      } else if (what.type === "voice-cell") {
        newId = addVoiceCell(b, lvl, x, y);
        if (!newId) return false;
      } else if (what.type === "cell") {
        newId = uid("c");
        b.nodes.push({ id: newId, type: "cell", name: "Cell", x: Math.round(x), y: Math.round(y), parent: lvl,
                       params: {}, inputs: [], outputs: [] });
        b.nodes.push({ id: uid("ci"), type: "cell-in", name: "Cell In", x: 40, y: 120, parent: newId, params: {} });
        b.nodes.push({ id: uid("co"), type: "cell-out", name: "Cell Out", x: 640, y: 120, parent: newId, params: {} });
      } else {
        const t = types[what.type];
        if (!t) return false;
        newId = uid("n");
        const params = {};
        for (const p of t.params) params[p.id] = p.default;
        const node = { id: newId, type: t.type, name: t.name, x: Math.round(x), y: Math.round(y), parent: lvl, params };
        if (t.port) {  // a port the user adds (MIDI Device): the app follows it by this id
          if (lvl) return false;  // ports live on the top level (spec §6)
          node.port = what.port || uid("mdev-");  // an app port (standalone): the one the user picked
          if (what.port && what.name) node.name = node.track = what.name;
        }
        b.nodes.push(node);
        if (t.memoryHeavy && lvl && insideVoiceCell(lvl, b))
          notice(`${t.name} uses a lot of memory: inside a Voice Cell it runs once per voice.`);
        if (link) {
          const j = t.inputs.find((i) => compatible(link.type, i.type));
          if (j) connect(b, link.from, { node: newId, jack: j.id }, 1);
          else if (link.type !== "notes" && t.params.find((p) => p.modulatable && p.kind === "float"))
            connect(b, link.from, { node: newId, jack: t.params.find((p) => p.modulatable && p.kind === "float").id }, 1);
        }
      }
      sel.clear();
      sel.add(newId);
    });
    // The app answers every edit with the board it kept: say so when it did not keep what was just placed.
    Promise.resolve(placed).then(() => {
      if (newId && board && !nodeById(newId)) notice(`The app did not keep the ${what.preset ? "cell" : "module"} you added. Check the Store section for modules that failed to load.`);
    }).catch((e) => notice(`Could not add it: ${e && e.message ? e.message : e}`));
  }

  /// A Dial, Button or Keyboard module for a panel control, in `b`: inside the panel's cell (a Keyboard next to it,
  /// since its notes go in through the cell's Notes jack), or on the board. Returns its id.
  function addControlModule(b, panel, type, name) {
    const t = types[type];
    if (!t) return null;
    const cell = panel.cell && nodeById(panel.cell, b);
    let lvl = cell ? cell.id : "";
    if (cell && type === "keyboard") lvl = cell.parent || "";
    const mine = b.nodes.filter((n) => (n.parent || "") === lvl && !(b.panels || []).some((q2) => (q2.modules || []).includes(n.id)));
    const id = uid("n");
    const params = {};
    for (const p of t.params) params[p.id] = p.default;
    b.nodes.push({ id, type: t.type, name: name || t.name, x: 0, y: 0, parent: lvl, params });
    (panel.modules || (panel.modules = [])).push(id);
    if (!panel.groups) panel.groups = {};
    if (!panel.groups[levelKey(lvl)]) panel.groups[levelKey(lvl)] = { x: 40, y: mine.length ? Math.max(...mine.map((n) => n.y)) + 170 : 40 };
    return id;
  }

  /// A Voice Cell with its fixed nodes and a starter voice (spec §8.3.3):
  /// Oscillator → VCA, an ADSR on the VCA's gain and on Voice Out's Active.
  function addVoiceCell(b, lvl, x, y) {
    if (lvl && insideVoiceCell(lvl, b)) return null;  // no nesting
    const id = uid("vc");
    const vt = types["voice-cell"];
    const params = {};
    for (const p of vt.params) params[p.id] = p.default;
    const defaults = (type) => Object.fromEntries(types[type].params.map((p) => [p.id, p.default]));
    const n = (nid, type, name, nx, ny, extra) =>
      Object.assign({ id: nid, type, name, x: nx, y: ny, parent: id, params: types[type] ? defaults(type) : {} }, extra || {});
    const vin = uid("vi"), vout = uid("vo"), osc = uid("n"), env = uid("n"), amp = uid("n");
    b.nodes.push({ id, type: "voice-cell", name: "Voice Cell", x: Math.round(x), y: Math.round(y), parent: lvl,
                   params, inputs: [], outputs: [] },
      n(vin, "voice-in", "Voice In", 40, 60), n(vout, "voice-out", "Voice Out", 900, 80),
      n(uid("ci"), "cell-in", "Cell In", 40, 460), n(uid("co"), "cell-out", "Cell Out", 900, 460),
      n(osc, "oscillator", "Oscillator", 320, 40), n(env, "adsr", "ADSR", 320, 260), n(amp, "vca", "VCA", 620, 80));
    const k = (fn, fj, tn, tj) => ({ id: uid("k"), from: { node: fn, jack: fj }, to: { node: tn, jack: tj }, amount: 1 });
    b.cables.push(k(vin, "pitch", osc, "pitch"), k(vin, "gate", env, "gate"), k(vin, "trigger", env, "retrig"),
      k(vin, "velocity", env, "velocity"), k(osc, "out", amp, "l"), k(env, "env", amp, "gain"),
      k(amp, "l", vout, "l"), k(amp, "r", vout, "r"), k(env, "active", vout, "active"));
    return id;
  }

  /// Right-click → Make Voice Cell: an ordinary cell gets Voice In and Voice Out (spec §8.3.3).
  function makeVoiceCell(cellId) {
    edit("make voice cell", (b) => {
      const cell = nodeById(cellId, b);
      if (!cell || cell.type !== "cell" || insideVoiceCell(cell.parent, b)) return false;
      if (descendants(cellId, b).some((d) => d.type === "voice-cell" || isPort(d))) return false;
      cell.type = "voice-cell";
      cell.params = Object.fromEntries(types["voice-cell"].params.map((p) => [p.id, p.default]));
      const kids = b.nodes.filter((m) => m.parent === cellId);
      const x0 = Math.min(...kids.map((m) => m.x), 300), x1 = Math.max(...kids.map((m) => m.x), 600);
      b.nodes.push({ id: uid("vi"), type: "voice-in", name: "Voice In", x: x0 - 280, y: 40, parent: cellId, params: {} },
                   { id: uid("vo"), type: "voice-out", name: "Voice Out", x: x1 + 280, y: 40, parent: cellId, params: {} });
    });
  }

  // ----------------------------------------------------------------- search
  let searchState = null;  // {x, y, link, items, active}
  function openSearch(x, y, link) {
    if (!board) return;
    const s = $("search");
    s.hidden = false;
    s.style.left = Math.min(x, canvas.clientWidth - 270) + "px";
    s.style.top = Math.min(y, canvas.clientHeight - 340) + "px";
    searchState = { x, y, link, items: [], active: 0 };
    const input = $("search-input");
    input.value = "";
    renderSearch();
    input.focus();
  }
  function searchItems(q) {
    const out = [];
    const link = searchState && searchState.link;
    const accepts = (t) => !link || t.inputs.some((i) => compatible(link.type, i.type)) ||
      (link.type !== "notes" && t.params.some((p) => p.modulatable && p.kind === "float"));
    for (const t of typeList)
      if (offered(t) && accepts(t) && (t.name + " " + t.category).toLowerCase().includes(q))
        out.push({ label: t.name === "Cell" ? "New Cell" : t.name === "Voice Cell" ? "New Voice Cell" : t.name,
                   sub: t.category.replace(/\//g, " › "), what: { type: t.type } });
    if (!link)  // presets: every word in the name, category, tags or description
      for (const p of presets) {
        const d = p.preset || {};
        const text = [p.name, p.category || "", d.description || "", ...(d.tags || [])].join(" ").toLowerCase();
        if (q.split(/\s+/).every((w) => text.includes(w)))
          out.push({ label: p.name, sub: "cell preset" + (p.category ? " · " + p.category.replace(/\//g, " › ") : ""),
                     hint: d.description, what: { preset: p.key } });
      }
    return out;
  }
  function renderSearch() {
    const q = $("search-input").value.trim().toLowerCase();
    searchState.items = searchItems(q);
    searchState.active = Math.min(searchState.active, Math.max(0, searchState.items.length - 1));
    const list = $("search-list");
    list.innerHTML = "";
    searchState.items.forEach((it, i) => {
      const row = el("div", "s-item" + (i === searchState.active ? " active" : ""));
      row.append(el("span", "", it.label), el("span", "sub", it.sub));
      row.addEventListener("pointerdown", (e) => { e.preventDefault(); chooseSearch(i); });
      list.appendChild(row);
    });
    // The active preset's description, under the list.
    const active = searchState.items[searchState.active], hint = $("search-hint");
    hint.textContent = (active && active.hint) || "";
    hint.hidden = !hint.textContent;
    if (list.children[searchState.active]) list.children[searchState.active].scrollIntoView({ block: "nearest" });
  }
  function chooseSearch(i) {
    const it = searchState && searchState.items[i];
    const st = searchState;
    closeSearch();
    if (!it) return;
    const r = canvas.getBoundingClientRect();
    const w = toWorld(st.x + r.left, st.y + r.top);
    addAt(it.what, w.x, w.y - 12, st.link);
  }
  function closeSearch() {
    $("search").hidden = true;
    searchState = null;
    canvas.focus();
  }
  $("search-input").addEventListener("input", () => { searchState.active = 0; renderSearch(); });
  $("search-input").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { searchState.active++; renderSearch(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { searchState.active = Math.max(0, searchState.active - 1); renderSearch(); e.preventDefault(); }
    else if (e.key === "Enter") { chooseSearch(searchState.active); e.preventDefault(); }
    else if (e.key === "Escape" || e.key === "Tab") { closeSearch(); e.preventDefault(); }
    e.stopPropagation();
  });
  $("search-input").addEventListener("blur", () => setTimeout(() => { if (searchState) closeSearch(); }, 100));
  $("add").addEventListener("click", (ev) => {
    const r = $("add").getBoundingClientRect();
    showMenu({ clientX: r.left, clientY: r.bottom + 4 }, addMenu(null));
  });
  $("panels").addEventListener("click", () => {
    const r = $("panels").getBoundingClientRect();
    panelsMenu({ clientX: r.left, clientY: r.bottom + 4 });
  });

  /// Types this board offers (MIDI Device only in the standalone app, spec §12).
  const offered = (t) => t.creatable && (!t.standaloneOnly || standalone) &&
    !((t.type === "cell-in" || t.type === "cell-out") && !level());  // boundaries live inside a cell

  /// The Add menu (spec §9.6): Module › category › modules; Cell › new cells and presets by category.
  /// `at` is a canvas position, or null for the middle of the canvas.
  function addMenu(at) {
    const place = (what) => () => {
      if (!at) return addAtCentre(what);
      const r = canvas.getBoundingClientRect();
      const w = toWorld(at.x + r.left, at.y + r.top);
      addAt(what, w.x, w.y);
    };
    // A category path nests: "Drums/Ring" is Module › Drums › Ring.
    const cats = [];
    const submenu = (items, label) => {
      let m = items.find((it) => it.items && it.label === label);
      if (!m) items.push(m = { label, items: [] });
      return m.items;
    };
    for (const t of typeList)
      if (offered(t) && t.category !== "Cells")
        t.category.split("/").reduce(submenu, cats).push({ label: t.name, run: place({ type: t.type }) });
    const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true });
    const sortTree = (items) => {
      items.sort(byLabel);
      for (const it of items) if (it.items) sortTree(it.items);
      return items;
    };
    sortTree(cats);
    const cells = [{ label: "New Cell", run: place({ type: "cell" }) },
                   { label: "New Voice Cell", run: place({ type: "voice-cell" }) }];
    if (level()) cells.push("-", { label: "Cell In", run: place({ type: "cell-in" }) },
                                { label: "Cell Out", run: place({ type: "cell-out" }) });
    const byCat = presetCategories();
    if (byCat.size) cells.push("-");
    // Preset categories nest like module categories: "Drums/Kicks" is Cell › Drums › Kicks.
    // Factory presets keep their authored order; the user's own follow, A–Z.
    const tree = [];
    for (const [cat, list] of byCat) {
      const items = cat.split("/").reduce(submenu, tree);
      const entry = (p) => ({ label: p.name, hint: p.preset && p.preset.description, run: place({ preset: p.key }) });
      const own = list.filter((p) => !p.factory).sort((a, b) => byLabel({ label: a.name }, { label: b.name }));
      items.push(...list.filter((p) => p.factory).map(entry), ...own.map((p) => Object.assign(entry(p), { own: true })));
      if (own.length)  // the user's own presets can be deleted here
        items.push({ label: "Delete preset", deletes: true, items: own.map((p) => ({
          label: p.name, run: async () => setPresets((await native("deletePreset", p.name)) || []) })) });
    }
    // Factory categories first, in their order (factory-presets.json), then the user's, A–Z.
    const rank = (label) => {
      const i = presetOrder.findIndex((c) => c === label || c.startsWith(label + "/"));
      return i < 0 ? presetOrder.length : i;
    };
    const sortPresets = (items, top) => {
      const subs = items.filter((it) => it.items && !it.deletes)
        .sort((a, b) => (top ? rank(a.label) - rank(b.label) : 0) || byLabel(a, b));
      const factory = items.filter((it) => !it.items && !it.own), own = items.filter((it) => it.own);
      const del = items.filter((it) => it.deletes);
      for (const it of subs) it.items = sortPresets(it.items, false);
      return [...subs, ...factory, ...(factory.length && own.length ? ["-"] : []), ...own, ...(del.length ? ["-", ...del] : [])];
    };
    cells.push(...sortPresets(tree, true));
    const menu = [{ label: "Module", items: cats }, { label: "Cell", items: cells }];
    // The standalone app's own ports that are not on the board (audio channels, MIDI, Link).
    if (standalone && !level()) {
      const free = Object.entries(ports)
        .filter(([id, p]) => APP_PORTS.has(p.kind) && !board.nodes.some((n) => n.port === id))
        .map(([id, p]) => ({ id, p, t: Object.values(types).find((t) => t.port === p.kind) }))
        .filter((e) => e.t);
      if (free.length)
        menu.push({ label: "Port", items: free.map(({ id, p, t }) => ({
          label: p.kind === "link" ? t.name : `${p.track || t.name} · ${t.name}`, run: place({ type: t.type, port: id, name: p.track || t.name }) })) });
    }
    return menu;
  }

  // ------------------------------------------------------------------ menus
  /// Menus; an item with `items` opens a submenu to its right on hover.
  function showMenu(ev, items) {
    closeSubmenus(0);
    const m = $("menu");
    fillMenu(m, items, 0);
    const r = canvas.getBoundingClientRect();
    m.hidden = false;
    m.style.left = Math.max(4, Math.min(ev.clientX - r.left, canvas.clientWidth - m.offsetWidth - 8)) + "px";
    m.style.top = Math.max(4, Math.min(ev.clientY - r.top, canvas.clientHeight - m.offsetHeight - 8)) + "px";
  }
  const submenus = [];
  function closeSubmenus(depth) {
    while (submenus.length > depth) submenus.pop().remove();
  }
  function fillMenu(m, items, depth) {
    m.innerHTML = "";
    // Items with a hint (preset descriptions) show it in a line under the menu while hovered.
    const hint = items.some((it) => it && it.hint) ? el("div", "m-hint") : null;
    for (const it of items) {
      if (it === "-") { m.appendChild(el("div", "m-sep")); continue; }
      const row = el("div", "m-item" + (it.disabled ? " disabled" : "") + (it.items ? " has-sub" : ""));
      row.append(el("span", "", it.label));
      if (it.key) row.appendChild(el("span", "key", it.key));
      if (it.items) row.appendChild(el("span", "key", "›"));
      // Run on click, and keep focus where it is: the action may open a text field.
      row.addEventListener("pointerdown", (e) => e.stopPropagation());
      row.addEventListener("mousedown", (e) => e.preventDefault());
      row.addEventListener("mouseenter", () => {
        closeSubmenus(depth);
        if (it.items && !it.disabled) openSubmenu(row, it.items, depth);
        if (hint) hint.textContent = it.hint || "";
      });
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        if (it.items) return;
        hidePopovers();
        it.run();
      });
      m.appendChild(row);
    }
    if (hint) m.appendChild(hint);
  }
  function openSubmenu(row, items, depth) {
    const sm = el("div", "popover submenu");
    canvas.appendChild(sm);
    submenus.push(sm);
    fillMenu(sm, items, depth + 1);
    const r = canvas.getBoundingClientRect(), rr = row.getBoundingClientRect();
    let x = rr.right - r.left + 2;
    if (x + sm.offsetWidth > canvas.clientWidth - 4) x = rr.left - r.left - sm.offsetWidth - 2;
    sm.style.left = Math.max(4, x) + "px";
    sm.style.top = Math.max(4, Math.min(rr.top - r.top - 4, canvas.clientHeight - sm.offsetHeight - 8)) + "px";
  }
  /// The help of a cell (its `help: {text, images}` metadata, copied from the preset): paragraphs, then the images, in a popover
  /// under the "?" button. Built from nodes: the text is never parsed as markup.
  function showCellHelp(n, anchor) {
    hidePopovers();
    const pop = $("help-pop");
    pop.innerHTML = "";
    pop.appendChild(el("div", "h-title", n.name));
    for (const para of n.help.text.split(/\n\s*\n/)) pop.appendChild(el("p", "", para.replace(/\s*\n\s*/g, " ")));
    for (const im of n.help.images || []) {
      const fig = el("figure", "h-fig");
      const img = el("img");
      img.src = im.src;
      img.alt = im.alt || "";
      img.addEventListener("error", () => fig.remove());  // a missing picture leaves the text alone
      fig.appendChild(img);
      if (im.caption) fig.appendChild(el("figcaption", "", im.caption));
      pop.appendChild(fig);
    }
    pop.hidden = false;
    const r = anchor.getBoundingClientRect(), host = pop.offsetParent ? pop.offsetParent.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const x = Math.min(r.left - host.left, Math.max(0, host.width - pop.offsetWidth - 8));
    const y = Math.min(r.bottom - host.top + 4, Math.max(0, host.height - pop.offsetHeight - 8));
    pop.style.left = Math.max(0, x) + "px";
    pop.style.top = Math.max(0, y) + "px";
  }

  function hidePopovers() {
    closeSubmenus(0);
    $("menu").hidden = true;
    $("cable-pop").hidden = true;
    $("help-pop").hidden = true;
    if (searchState) closeSearch();
  }

  function showNodeMenu(n, ev) {
    const items = [];
    if (!isStructural(n)) items.push({ label: views.has(n.id) ? "Close view" : "Open view", run: () => toggleView(n.id) });
    if (isCellLike(n)) {
      const mine = panelsOfCell(n.id);
      for (const p of mine) {
        const suffix = mine.length > 1 ? " “" + p.name + "”" : "";
        items.push({ label: (panelOpen(p.id) ? "Close panel" : "Open panel") + suffix, run: () => togglePanel(p.id) });
        items.push({ label: "Edit panel" + suffix, run: () => openPanel(p.id, { edit: true }) });
      }
      items.push({ label: "New panel", run: () => newPanel(n.id) });
      items.push({ label: "Build panel from cell", run: () => buildPanel(n.id) });
    }
    if (isCellLike(n)) items.push({ label: "Enter cell", key: "dbl-click", run: () => enterCell(n.id) });
    items.push({ label: "Rename", run: () => startRename(n, nodesEl.querySelector(`[data-id="${n.id}"]`)) });
    if (!isStructural(n)) items.push({ label: n.muted ? "Unmute" : "Mute", key: "M", run: toggleMute });
    if (canBypass(n)) items.push({ label: n.bypassed ? "Switch on (end bypass)" : "Bypass", run: () => toggleBypass(n.id) });
    items.push("-");
    items.push({ label: "Cut", key: "⌘X", run: cut, disabled: !canDuplicate() });
    items.push({ label: "Copy", key: "⌘C", run: copy, disabled: !canDuplicate() });
    items.push({ label: "Paste", key: "⌘V", run: () => paste() });
    items.push({ label: "Duplicate", key: "⌘D", run: () => duplicate(false), disabled: !canDuplicate() });
    items.push({ label: "Create cell", key: "⌘G", run: () => group(), disabled: !canGroup() });
    items.push({ label: "Create voice cell", run: () => group("voice"), disabled: !canGroupVoice() });
    if (level() && !isPort(n) && !isBoundary(n)) items.push({ label: "Remove from cell", run: removeFromCell });
    if (n.type === "cell") {
      items.push({ label: "Ungroup", key: "⌘⇧G", run: () => ungroup(n.id) });
      items.push({ label: "Make Voice Cell", run: () => makeVoiceCell(n.id), disabled: insideVoiceCell(n.parent) });
    }
    if (isCellLike(n)) items.push({ label: "Save as preset…", run: () => savePreset(n) });
    items.push({ label: "Trace signal flow", key: "T", run: toggleTrace });
    items.push("-");
    items.push({ label: "Delete", key: "⌫", run: deleteSelection, disabled: isFixedPort(n) || isFixedBoundary(n) });
    showMenu(ev, items);
  }

  // -------------------------------------------------------------- renaming
  function startRename(n, nodeEl) {
    if (!nodeEl) return;
    const title = nodeEl.querySelector(".n-title");
    const input = el("input", "n-rename");
    input.value = n.name;
    input.maxLength = 63;
    title.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name && name !== n.name) edit("rename", (b) => { nodeById(n.id, b).name = name; });
      else render();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
  }

  // ------------------------------------------------------------ operations
  function selectedNodes(b = board) { return [...sel].map((id) => nodeById(id, b)).filter(Boolean); }
  const canDuplicate = () => selectedNodes().some((n) => !isPort(n) && !isBoundary(n));
  const canGroup = () => selectedNodes().some((n) => !isPort(n) && !isBoundary(n));

  function selectAll() {
    sel.clear();
    for (const n of nodesAt(level())) sel.add(n.id);
    renderSelection();
  }

  /// True when deleting n would take the last Cell In / Cell Out of its cell, counting those already doomed.
  const doomedBoundary = (n, doomed) =>
    !board.nodes.some((m) => m.id !== n.id && m.parent === n.parent && m.type === n.type && !doomed.has(m.id));

  function deleteSelection(label = "delete") {
    if (selCable) return removeCables(selectedCableIds());
    const doomed = new Set();
    for (const n of selectedNodes()) {
      if (isFixedPort(n) || isFixedBoundary(n) ||  // spec §6, §8.3.1
          (isBoundary(n) && doomedBoundary(n, doomed))) continue;
      doomed.add(n.id);
      if (isCellLike(n)) descendants(n.id).forEach((d) => doomed.add(d.id));
    }
    if (!doomed.size) return;
    for (const id of doomed) closeView(id);
    sel.clear();
    edit(label, (b) => {
      b.nodes = b.nodes.filter((n) => !doomed.has(n.id));
      b.cables = b.cables.filter((c) => !doomed.has(c.from.node) && !doomed.has(c.to.node));
    });
  }

  /// A module with audio in and audio out can be bypassed: its input audio goes straight to its output.
  function canBypass(n) {
    if (isPort(n) || isCellLike(n) || isStructural(n) || !types[n.type]) return false;
    return inputsOf(n).some((j) => j.type === "audio") && outputsOf(n).some((j) => j.type === "audio");
  }
  function setPowerButton(b, n) {
    b.classList.toggle("on", !n.bypassed);
    b.title = n.bypassed ? "Bypassed: the audio passes through. Click to switch the module on." : "On. Click to bypass (pass the audio through unprocessed).";
    b.setAttribute("aria-label", "Power " + n.name);
    b.setAttribute("aria-pressed", n.bypassed ? "false" : "true");
  }
  function toggleBypass(id) {
    const n = nodeById(id);
    if (!n || !canBypass(n)) return;
    const on = !n.bypassed;
    edit(on ? "bypass" : "end bypass", (b) => { nodeById(id, b).bypassed = on; });
  }

  function toggleMute() {
    const ns = selectedNodes().filter((n) => !isStructural(n));
    if (!ns.length) return;
    const mute = !ns.every((n) => n.muted);
    edit(mute ? "mute" : "unmute", (b) => ns.forEach((n) => (nodeById(n.id, b).muted = mute)));
  }

  /// Copies nodes (cells with their contents) with fresh ids. Returns old → new id.
  function copyNodes(b, roots, dx, dy) {
    const map = new Map();
    const all = [];
    for (const r of roots) {
      all.push(r);
      if (isCellLike(r)) all.push(...descendants(r.id, b));
    }
    for (const n of all) map.set(n.id, uid(isCellLike(n) ? "c" : "n"));
    for (const n of all) {
      const c = clone(n);
      c.id = map.get(n.id);
      if (map.has(n.parent)) c.parent = map.get(n.parent);
      if (roots.includes(n)) { c.x += dx; c.y += dy; }
      delete c.port;
      b.nodes.push(c);
    }
    for (const c of [...b.cables])
      if (map.has(c.from.node) && map.has(c.to.node))
        b.cables.push({ id: uid("k"), from: { node: map.get(c.from.node), jack: c.from.jack },
                        to: { node: map.get(c.to.node), jack: c.to.jack }, amount: c.amount });
    addPanels(b, panelsWithLoaded(((board && board.panels) || []).filter((q) => q.cell && map.has(q.cell))), map);
    return map;
  }

  function duplicate(keepIncoming) {
    const roots = selectedNodes().filter((n) => !isPort(n) && !isBoundary(n));
    if (!roots.length) return;
    edit("duplicate", (b) => {
      const rs = roots.map((r) => nodeById(r.id, b));
      const map = copyNodes(b, rs, 30, 30);
      if (keepIncoming)
        for (const c of [...b.cables])
          if (!map.has(c.from.node) && rs.some((r) => r.id === c.to.node))
            b.cables.push({ id: uid("k"), from: clone(c.from), to: { node: map.get(c.to.node), jack: c.to.jack },
                            amount: c.amount });
      sel.clear();
      rs.forEach((r) => sel.add(map.get(r.id)));
    });
  }

  /// ⌘C (spec §9.6): the selection (cells with their contents) and the cables
  /// between them go to the system clipboard as JSON, so they can be pasted
  /// into another cell, another set or another board window.
  const CLIP_FORMAT = "bleep-board-clip";
  function copy() {
    const roots = selectedNodes().filter((n) => !isPort(n) && !isBoundary(n));
    if (!roots.length) return false;
    const nodes = [];
    for (const r of roots) nodes.push(r, ...(isCellLike(r) ? descendants(r.id) : []));
    const ids = new Set(nodes.map((n) => n.id));
    const clip = {
      format: CLIP_FORMAT, version: 1,
      roots: roots.map((r) => r.id),
      nodes: nodes.map((n) => { const c = clone(n); delete c.port; return c; }),
      cables: board.cables.filter((c) => ids.has(c.from.node) && ids.has(c.to.node)).map(clone),
      panels: clone(panelsWithLoaded(panelList().filter((q) => q.cell && ids.has(q.cell)))),
    };
    native("copyText", JSON.stringify(clip));
    return true;
  }

  function cut() {
    if (!copy()) return;
    clearCableSel();
    deleteSelection("cut");
  }

  /// ⌘V: the clipboard's nodes land at the pointer (or `at`, in canvas
  /// coordinates), keeping their layout, with fresh ids; the paste is selected.
  async function paste(at) {
    if (!board) return;
    let clip = null;
    try { clip = JSON.parse(await native("pasteText")); } catch (e) { return; }
    if (!clip || clip.format !== CLIP_FORMAT || !Array.isArray(clip.nodes) || !Array.isArray(clip.roots)) return;
    const lvl = level();
    const byId = new Map(clip.nodes.map((n) => [n.id, n]));
    const known = (n) => isCellLike(n) || isBoundary(n) || !!types[n.type];
    const roots = clip.roots.map((id) => byId.get(id)).filter((n) => n && known(n) && !isPort(n) && !isBoundary(n)
      && !(n.type === "voice-cell" && insideVoiceCell(lvl)));  // no nesting
    if (!roots.length) return;
    // Each root's subtree (its contents, for cells).
    const all = [];
    const walk = (id) => { for (const n of clip.nodes) if (n.parent === id && known(n)) { all.push(n); if (isCellLike(n)) walk(n.id); } };
    for (const r of roots) { all.push(r); if (isCellLike(r)) walk(r.id); }
    // Top-left of the copied roots goes to the pointer; step aside from an exact overlap (repeated pastes).
    const x0 = Math.min(...roots.map((n) => n.x)), y0 = Math.min(...roots.map((n) => n.y));
    const r = canvas.getBoundingClientRect();
    const p = at || (pointerInside ? pointer : { x: r.width / 2, y: r.height / 2 });
    const w = toWorld(r.left + p.x, r.top + p.y);
    let dx = Math.round(w.x - x0), dy = Math.round(w.y - y0);
    const here = nodesAt(lvl);
    for (let i = 0; i < 20 && roots.some((n) => here.some((m) => Math.abs(m.x - n.x - dx) < 20 && Math.abs(m.y - n.y - dy) < 20)); i++) {
      dx += 30;
      dy += 30;
    }
    edit("paste", (b) => {
      const map = new Map(all.map((n) => [n.id, uid(isCellLike(n) ? "c" : "n")]));
      for (const n of all) {
        const c = clone(n);
        c.id = map.get(n.id);
        c.parent = roots.includes(n) ? lvl : map.get(n.parent);
        if (roots.includes(n)) { c.x += dx; c.y += dy; }
        delete c.port;
        b.nodes.push(c);
      }
      for (const c of clip.cables || [])
        if (c && c.from && c.to && map.has(c.from.node) && map.has(c.to.node))
          b.cables.push({ id: uid("k"), from: { node: map.get(c.from.node), jack: c.from.jack },
                          to: { node: map.get(c.to.node), jack: c.to.jack }, amount: c.amount });
      addPanels(b, Array.isArray(clip.panels) ? clip.panels : [], map);
      sel.clear();
      clearCableSel();
      roots.forEach((n) => sel.add(map.get(n.id)));
    });
  }

  /// True when `nodes` may live inside a Voice Cell: no ports, no Voice Cells, nothing inside them that isn't allowed.
  const canEnterVoice = (nodes) => nodes.every((n) => !isPort(n) && n.type !== "voice-cell" &&
    !(isCellLike(n) && descendants(n.id).some((d) => d.type === "voice-cell" || isPort(d))));
  const canGroupVoice = () => {
    const picked = selectedNodes().filter((n) => !isPort(n) && !isBoundary(n));
    return picked.length > 0 && !insideVoiceCell(level()) && canEnterVoice(picked);
  };

  /// Moves the nodes `inside` into the cell `cellId` (all in `b`, all currently on one level) and ports the
  /// cables that cross the border: each becomes a cell input or output (one per source), reusing a cell
  /// input that already carries the same source. `keep` leaves the positions alone (a brand-new cell).
  function moveIntoCell(b, inside, cellId, keep) {
    const cell = nodeById(cellId, b);
    const vout = cell.type === "voice-cell" ? b.nodes.find((n) => n.parent === cellId && n.type === "voice-out") : null;
    const cin = b.nodes.find((n) => n.parent === cellId && n.type === "cell-in");
    const cout = b.nodes.find((n) => n.parent === cellId && n.type === "cell-out");
    const kids = b.nodes.filter((n) => inside.has(n.id));
    if (!keep) {  // right of what is already in the cell, keeping the selection's own layout
      const old = b.nodes.filter((n) => n.parent === cellId && !isBoundary(n));
      const ox = old.length ? Math.max(...old.map((n) => n.x)) + NODE_W + 60 : 320;
      const oy = old.length ? Math.min(...old.map((n) => n.y)) : 120;
      const kx = Math.min(...kids.map((n) => n.x)), ky = Math.min(...kids.map((n) => n.y));
      for (const n of kids) { n.x = ox + n.x - kx; n.y = oy + n.y - ky; }
      const edge = Math.max(...kids.map((n) => n.x)) + NODE_W + 60;   // the cell's outputs make room
      for (const n of b.nodes) if (n.parent === cellId && (n.type === "cell-out" || n.type === "voice-out") && n.x < edge) n.x = edge;
    }
    for (const n of kids) n.parent = cellId;
    cell.inputs = cell.inputs || [];
    cell.outputs = cell.outputs || [];
    const inputs = new Map(), outputs = new Map();
    const next = [];
    const cins = new Set(b.nodes.filter((n) => n.parent === cellId && n.type === "cell-in").map((n) => n.id));
    const couts = new Set(b.nodes.filter((n) => n.parent === cellId && n.type === "cell-out").map((n) => n.id));
    const touched = new Set();  // cell jacks whose cables were joined through
    const joined = new Set();   // inner cables from a cell input / into a cell output that the moved nodes now replace
    for (const c of b.cables) {
      const fi = inside.has(c.from.node), ti = inside.has(c.to.node);
      if (fi === ti) { next.push(c); continue; }
      if (c.from.node === cellId || c.to.node === cellId) {
        // Between the cell and its new content: the content now sits behind the jack, so join straight through it:
        // module → cell input → inner target becomes module → inner target (and the same for outputs).
        if (ti && c.to.node !== cellId) {  // the cell's output jack feeds a node that moved inside
          for (const o of b.cables) if (!inside.has(o.from.node) && couts.has(o.to.node) && o.to.jack === c.from.jack) {
            next.push({ id: uid("k"), from: clone(o.from), to: clone(c.to), amount: o.amount * c.amount });
            joined.add(o.id);
            touched.add(c.from.jack);
          }
        } else if (fi && c.from.node !== cellId) {  // a node that moved inside feeds the cell's input jack
          for (const o of b.cables) if (cins.has(o.from.node) && o.from.jack === c.to.jack && !inside.has(o.to.node)) {
            next.push({ id: uid("k"), from: clone(c.from), to: clone(o.to), amount: c.amount * o.amount });
            joined.add(o.id);
            touched.add(c.to.jack);
          }
        }
        continue;
      }
      const key = c.from.node + "|" + c.from.jack;
      const src = nodeById(c.from.node, b);
      if (ti) {  // entering
        if (!cin) continue;
        if (!inputs.has(key)) {
          const same = b.cables.find((o) => o.to.node === cellId && o.from.node === c.from.node && o.from.jack === c.from.jack);
          if (same) inputs.set(key, same.to.jack);
          else {
            const jack = { id: uid("i"), name: jackName(src, c.from.jack, true), type: outType(src, c.from.jack) || "control" };
            cell.inputs.push(jack);
            inputs.set(key, jack.id);
            next.push({ id: uid("k"), from: clone(c.from), to: { node: cellId, jack: jack.id }, amount: 1 });
          }
        }
        next.push({ id: c.id, from: { node: cin.id, jack: inputs.get(key) }, to: clone(c.to), amount: c.amount });
      } else if (vout && outType(src, c.from.jack) === "audio") {  // a Voice Cell's audio leaves over Voice Out, not a Cell Out
        const ch = /(^|[^a-z])(r|right)$/i.test(c.from.jack) || /(^|[^a-z])(r|right)$/i.test(jackName(src, c.from.jack, true)) ? "r" : "l";
        if (!outputs.has(key)) {
          outputs.set(key, ch);
          next.push({ id: uid("k"), from: clone(c.from), to: { node: vout.id, jack: ch }, amount: 1 });
        }
        next.push({ id: c.id, from: { node: cellId, jack: outputs.get(key) }, to: clone(c.to), amount: c.amount });
      } else {  // leaving
        if (!cout) continue;
        if (!outputs.has(key)) {
          const jack = { id: uid("o"), name: jackName(src, c.from.jack, true), type: outType(src, c.from.jack) || "control" };
          cell.outputs.push(jack);
          outputs.set(key, jack.id);
          next.push({ id: uid("k"), from: clone(c.from), to: { node: cout.id, jack: jack.id }, amount: 1 });
        }
        next.push({ id: c.id, from: { node: cellId, jack: outputs.get(key) }, to: clone(c.to), amount: c.amount });
      }
    }
    b.cables = next.filter((c) => !joined.has(c.id));
    // A cell jack nothing uses any more (the moved nodes took over its cables) goes away.
    cell.inputs = cell.inputs.filter((j) => !touched.has(j.id) || b.cables.some((c) => (c.to.node === cellId && c.to.jack === j.id) || (cins.has(c.from.node) && c.from.jack === j.id)));
    cell.outputs = cell.outputs.filter((j) => !touched.has(j.id) || b.cables.some((c) => (c.from.node === cellId && c.from.jack === j.id) || (couts.has(c.to.node) && c.to.jack === j.id)));
  }

  /// Add → right-click → Create cell (⌘G, spec §8.1) or Create voice cell (`kind` "voice", spec §8.3.3): the
  /// selection moves into a new cell; cables that cross the new border become cell jacks.
  function group(kind) {
    const voice = kind === "voice";
    const picked = selectedNodes().filter((n) => !isPort(n) && !isBoundary(n));
    if (!picked.length) return;
    if (insideVoiceCell(level()) && picked.some((n) => n.type === "voice-cell")) return;
    if (voice && !canGroupVoice()) return;
    edit(voice ? "create voice cell" : "group", (b) => {
      const inside = new Set(picked.map((n) => n.id));
      const lvl = level();
      const xs = picked.map((n) => n.x), ys = picked.map((n) => n.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs);
      const cellId = uid(voice ? "vc" : "c");
      const params = voice ? Object.fromEntries(types["voice-cell"].params.map((p) => [p.id, p.default])) : {};
      const bnd = (id, type, name, x, y) => ({ id, type, name, x, y, parent: cellId, params: {} });
      b.nodes.push({ id: cellId, type: voice ? "voice-cell" : "cell", name: voice ? "Voice Cell" : "Cell", x: x0, y: y0, parent: lvl,
                     params, inputs: [], outputs: [] },
        bnd(uid("ci"), "cell-in", "Cell In", x0 - 260, voice ? y0 + 260 : y0),
        bnd(uid("co"), "cell-out", "Cell Out", x1 + 260, voice ? y0 + 260 : y0));
      if (voice) b.nodes.push(bnd(uid("vi"), "voice-in", "Voice In", x0 - 260, y0), bnd(uid("vo"), "voice-out", "Voice Out", x1 + 260, y0));
      moveIntoCell(b, inside, cellId, true);
      sel.clear();
      sel.add(cellId);
    });
  }

  /// Right-click → Remove from cell: the selected nodes inside the current cell move to the board level next
  /// to the cell. Cables through the border are rerouted over new cell jacks, or joined where they passed
  /// through a jack (as in ungroup). Cables to Voice In / Voice Out can't be kept.
  function removeFromCell() {
    const cellId = level();
    const picked = selectedNodes().filter((n) => n.parent === cellId && !isPort(n) && !isBoundary(n));
    if (!cellId || !picked.length) return;
    edit("remove from cell", (b) => {
      const cell = nodeById(cellId, b);
      if (!cell) return false;
      const out = new Set(picked.map((n) => n.id));
      const kx = Math.min(...picked.map((n) => n.x)), ky = Math.min(...picked.map((n) => n.y));
      for (const n of b.nodes) if (out.has(n.id)) {
        n.parent = cell.parent || "";
        n.x = cell.x + NODE_W + 80 + n.x - kx;
        n.y = cell.y + n.y - ky;
      }
      const cins = b.nodes.filter((n) => n.parent === cellId && n.type === "cell-in");
      const couts = b.nodes.filter((n) => n.parent === cellId && n.type === "cell-out");
      const cinIds = new Set(cins.map((n) => n.id)), coutIds = new Set(couts.map((n) => n.id));
      cell.inputs = cell.inputs || [];
      cell.outputs = cell.outputs || [];
      const inputs = new Map(), outputs = new Map();
      const next = [];
      for (const c of b.cables) {
        const fo = out.has(c.from.node), to = out.has(c.to.node);
        if (fo === to) { next.push(c); continue; }
        const key = c.from.node + "|" + c.from.jack;
        const src = nodeById(c.from.node, b);
        if (to) {  // from the cell's inside to a moved node
          if (cinIds.has(c.from.node)) {  // it came in over a cell input: join the outer cables
            for (const o of b.cables.filter((o) => o.to.node === cellId && o.to.jack === c.from.jack))
              next.push({ id: uid("k"), from: clone(o.from), to: clone(c.to), amount: o.amount * c.amount });
          } else if (!isBoundary(src) && couts[0]) {  // leaves the cell over a new cell output
            if (!outputs.has(key)) {
              const jack = { id: uid("o"), name: jackName(src, c.from.jack, true), type: outType(src, c.from.jack) || "control" };
              cell.outputs.push(jack);
              outputs.set(key, jack.id);
              next.push({ id: uid("k"), from: clone(c.from), to: { node: couts[0].id, jack: jack.id }, amount: 1 });
            }
            next.push({ id: c.id, from: { node: cellId, jack: outputs.get(key) }, to: clone(c.to), amount: c.amount });
          }
        } else {  // from a moved node to the cell's inside
          if (coutIds.has(c.to.node)) {  // it left over a cell output: join the outer cables
            for (const o of b.cables.filter((o) => o.from.node === cellId && o.from.jack === c.to.jack))
              next.push({ id: uid("k"), from: clone(c.from), to: clone(o.to), amount: c.amount * o.amount });
          } else if (!isBoundary(nodeById(c.to.node, b)) && cins[0]) {  // enters the cell over a new cell input
            if (!inputs.has(key)) {
              const jack = { id: uid("i"), name: jackName(src, c.from.jack, true), type: outType(src, c.from.jack) || "control" };
              cell.inputs.push(jack);
              inputs.set(key, jack.id);
              next.push({ id: uid("k"), from: clone(c.from), to: { node: cellId, jack: jack.id }, amount: 1 });
            }
            next.push({ id: c.id, from: { node: cins[0].id, jack: inputs.get(key) }, to: clone(c.to), amount: c.amount });
          }
        }
      }
      b.cables = next;
      sel.clear();
    });
  }

  /// ⌘⇧G: the cell's contents move out; cables through its jacks are joined.
  function ungroup(cellId) {
    edit("ungroup", (b) => {
      const cell = nodeById(cellId, b);
      if (!cell || cell.type !== "cell") return false;
      const cins = b.nodes.filter((n) => n.parent === cellId && n.type === "cell-in");
      const couts = b.nodes.filter((n) => n.parent === cellId && n.type === "cell-out");
      const cinIds = new Set(cins.map((n) => n.id)), coutIds = new Set(couts.map((n) => n.id));
      const kids = b.nodes.filter((n) => n.parent === cellId && n.type !== "cell-in" && n.type !== "cell-out");
      const kx = Math.min(...kids.map((k) => k.x), Infinity), ky = Math.min(...kids.map((k) => k.y), Infinity);
      for (const k of kids) {
        k.parent = cell.parent || "";
        if (isFinite(kx)) { k.x = cell.x + (k.x - kx); k.y = cell.y + (k.y - ky); }
      }
      const boundary = new Set([cellId, ...cinIds, ...coutIds]);
      const next = b.cables.filter((c) => !boundary.has(c.from.node) && !boundary.has(c.to.node));
      for (const outer of b.cables.filter((c) => c.to.node === cellId))
        for (const inner of b.cables.filter((c) => cinIds.has(c.from.node) && c.from.jack === outer.to.jack))
          next.push({ id: uid("k"), from: clone(outer.from), to: clone(inner.to), amount: outer.amount * inner.amount });
      for (const inner of b.cables.filter((c) => coutIds.has(c.to.node)))
        for (const outer of b.cables.filter((c) => c.from.node === cellId && c.from.jack === inner.to.jack))
          next.push({ id: uid("k"), from: clone(inner.from), to: clone(outer.to), amount: outer.amount * inner.amount });
      b.cables = next;
      b.nodes = b.nodes.filter((n) => !boundary.has(n.id));
      sel.clear();
      kids.forEach((k) => sel.add(k.id));
    });
  }

  // ---------------------------------------------------------- cell presets
  /// Small inline text fields (WebViews in plugins may not support prompt()).
  /// Resolves to the trimmed values, or null when cancelled.
  function ask(fields, at) {
    return new Promise((resolve) => {
      const m = $("menu");
      closeSubmenus(0);
      m.innerHTML = "";
      const box = el("div", "m-ask");
      const inputs = fields.map((f) => {
        box.appendChild(el("div", "m-ask-label", f.label));
        const input = el("input", "n-rename");
        input.value = f.value;
        if (f.suggestions) {
          const list = el("datalist");
          list.id = uid("dl");
          for (const sgg of f.suggestions) list.appendChild(new Option(sgg));
          box.appendChild(list);
          input.setAttribute("list", list.id);
        }
        box.appendChild(input);
        return input;
      });
      m.appendChild(box);
      m.hidden = false;
      m.style.left = at.x + "px";
      m.style.top = at.y + "px";
      inputs[0].focus();
      inputs[0].select();
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        m.hidden = true;
        canvas.focus();
        resolve(ok ? inputs.map((i) => i.value.trim()) : null);
      };
      for (const input of inputs) {
        input.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") finish(false);
        });
        input.addEventListener("pointerdown", (e) => e.stopPropagation());
        input.addEventListener("blur", () => setTimeout(() => { if (!box.contains(document.activeElement)) finish(false); }, 0));
      }
    });
  }

  /// Factory presets, read-only: compiled ones (factory-presets.json, built from
  /// patch/presets) and hand-written ones (factory-presets.js); names are unique
  /// across both. Then the user's own (.bleepcell files), by category.
  let compiledPresets = [];
  async function loadFactoryPresets() {
    try {
      const doc = await (await fetch("factory-presets.json")).json();
      presetOrder = (doc.categories || []).map((c) => c.name);
      compiledPresets = doc.presets || [];
    } catch (e) {
      console.warn("factory-presets.json not loaded", e);
    }
  }
  /// Factory panels (factory-panels.json, built from patch/presets/panels.mjs), by preset name:
  /// they travel with the preset and are copied into the board when it is placed.
  let panelDefs = {};
  async function loadFactoryPanels() {
    try {
      panelDefs = (await (await fetch("factory-panels.json")).json()).panels || {};
    } catch (e) {
      console.warn("factory-panels.json not loaded", e);
    }
  }
  function setPresets(user) {
    const factory = compiledPresets.concat(window.BleepFactoryPresets || [])
      .map((p) => Object.assign({ key: "factory:" + p.name, factory: true }, p,
        panelDefs[p.name] ? { preset: Object.assign({}, p.preset, { panels: panelDefs[p.name] }) } : {}));
    presets = factory.concat((user || []).map((p) => Object.assign(
      { key: "user:" + p.name, category: (p.preset && p.preset.category) || "My Cells" }, p)));
  }
  function presetCategories() {
    const byCat = new Map();
    for (const p of presets) {
      const cat = p.category || (p.preset && p.preset.category) || "My Cells";
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(p);
    }
    return byCat;
  }

  async function savePreset(cell) {
    const ne = nodesEl.querySelector(`[data-id="${cell.id}"]`);
    const r = canvas.getBoundingClientRect();
    const at = ne ? { x: ne.getBoundingClientRect().left - r.left, y: ne.getBoundingClientRect().bottom - r.top + 6 }
                  : { x: 40, y: 40 };
    const cats = [...new Set(["Synthesizers", ...presetCategories().keys()])];
    const answer = await ask([{ label: "Save cell as preset", value: cell.name },
                              { label: "Category", value: cell.type === "voice-cell" ? "Synthesizers" : "My Cells", suggestions: cats },
                              { label: "Description (optional)", value: "" }], at);
    if (!answer || !answer[0]) return;
    const [name, category, description] = answer;
    const nodes = [cell, ...descendants(cell.id)].map(clone);
    const ids = new Set(nodes.map((n) => n.id));
    const cables = board.cables.filter((c) => ids.has(c.from.node) && ids.has(c.to.node)).map(clone);
    const preset = { format: 1, root: cell.id, category: category || "My Cells", nodes, cables };
    const needs = window.BleepStoreView ? await BleepStoreView.needsFor(nodes) : {};
    if (Object.keys(needs).length) preset.needs = needs;
    const mine = panelsWithLoaded(panelList().filter((p) => p.cell && ids.has(p.cell)));
    if (mine.length) preset.panels = clone(mine).map((p) => { delete p.open; return p; });
    if (description) preset.description = description;
    if (cell.help && cell.help.text) preset.help = clone(cell.help);
    const saved = await native("savePreset", name, preset);
    if (saved) setPresets(saved);
  }

  /// Panels copied into the board (a placed preset, a paste, a duplicate): new ids, pointing at the new nodes.
  /// `map`: old node id → new. Panels of cells that weren't copied are left out.
  /// Stacks of a placed preset's panels start open: it is there to be looked at.
  function addPanels(b, list, map) {
    if (!list || !list.length) return;
    const pmap = new Map(list.map((q) => [q.id, uid("p")]));
    const key = (k) => (map.has(k) ? map.get(k) : k);   // "this" stays
    const ref = (r) => { const i = r.indexOf("."); return key(r.slice(0, i)) + r.slice(i); };
    for (const q of clone(list)) {
      if (q.cell && !map.has(q.cell)) continue;
      q.id = pmap.get(q.id);
      if (q.cell) q.cell = key(q.cell);
      if (q.modules) q.modules = q.modules.map(key);
      // A panel made with panel-wiring.js: its Panel cell, its bays (by target module: the bays and the jack the bundle uses) and each control's target and module.
      if (q.panelCell) q.panelCell = key(q.panelCell);
      if (q.bays) q.bays = Object.fromEntries(Object.entries(q.bays).map(([t, v]) => [key(t), { ...v, in: key(v.in), out: key(v.out), path: (v.path || []).map(key) }]));
      if (q.groups) {
        q.groups = Object.fromEntries(Object.entries(q.groups).map(([k, g]) => [key(k), g]));
        // Open unless the stack is long: a placed preset is there to be looked at, but not as a wall of nodes.
        for (const k of Object.keys(q.groups))
          if (b.nodes.filter((n) => (q.modules || []).includes(n.id) && (n.parent || "") === k).length <= 8) groupOpen.add(groupKey(q, k));
      }
      delete q.open;
      for (const c of q.controls) {
        for (const w of c.wire || []) {
          for (const k of ["param", "jack", "command"]) if (w[k]) w[k] = ref(w[k]);
          for (const k of ["press", "keyboard"]) if (w[k]) w[k] = key(w[k]);
        }
        if (c.source) c.source.out = [].concat(c.source.out).map(ref);
        if (c.target) c.target.node = key(c.target.node);
        if (c.module) c.module = key(c.module);
        if (c.node) c.node = key(c.node);
        if (c.type === "panel") c.panel = pmap.get(c.panel) || c.panel;
      }
      (b.panels || (b.panels = [])).push(q);
    }
  }

  function insertPreset(b, preset, lvl, x, y) {
    const tmp = { nodes: clone(preset.nodes), cables: clone(preset.cables) };
    const root = tmp.nodes.find((n) => n.id === preset.root);
    if (!root) return null;
    if (root.type === "voice-cell" && insideVoiceCell(lvl, b)) return null;  // no nesting
    const map = new Map(tmp.nodes.map((n) => [n.id, uid(isCellLike(n) ? "c" : "n")]));
    for (const n of tmp.nodes) {
      n.id = map.get(n.id);
      n.parent = n === root ? lvl : map.get(n.parent) || lvl;
      delete n.port;
      b.nodes.push(n);
    }
    root.x = Math.round(x);
    root.y = Math.round(y);
    if (preset.help && preset.help.text) root.help = clone(preset.help);
    else delete root.help;
    for (const c of tmp.cables)
      if (map.has(c.from.node) && map.has(c.to.node))
        b.cables.push({ id: uid("k"), from: { node: map.get(c.from.node), jack: c.from.jack },
                        to: { node: map.get(c.to.node), jack: c.to.jack }, amount: c.amount });
    addPanels(b, preset.panels, map);
    return root.id;
  }

  // ------------------------------------------------------------ navigation
  function enterCell(id) {
    path.push(id);
    sel.clear();
    trace = null;
    closeUnpinnedViews();
    render();
    if (!cams.has(id + "#fitted")) { cams.set(id + "#fitted", true); fit(); }
  }
  function leaveTo(depth) {
    const left = path[depth];
    path = path.slice(0, depth);
    sel.clear();
    if (left) sel.add(left);
    trace = null;
    closeUnpinnedViews();
    render();
  }
  function pathTo(nodeId) {
    const p = [];
    let n = nodeById(nodeId);
    while (n && n.parent) { p.unshift(n.parent); n = nodeById(n.parent); }
    return p;
  }
  function focusNode(id) {
    const n = nodeById(id);
    if (!n) return;
    path = pathTo(id);
    sel.clear();
    sel.add(id);
    render();
    centreOn(n);
    const e = nodesEl.querySelector(`[data-id="${id}"]`);
    if (e) { e.classList.remove("flash"); void e.offsetWidth; e.classList.add("flash"); }
  }

  /// T (spec §9.5): everything feeding into and fed by the selection.
  function toggleTrace() {
    if (trace || !sel.size) { trace = null; render(); return; }
    const here = nodesAt(level()).map((n) => n.id);
    const ups = new Map(here.map((id) => [id, []])), downs = new Map(here.map((id) => [id, []]));
    for (const c of board.cables)
      if (ups.has(c.to.node) && ups.has(c.from.node)) {
        ups.get(c.to.node).push(c.from.node);
        downs.get(c.from.node).push(c.to.node);
      }
    trace = new Set();
    const walk = (id, graph) => {
      for (const next of graph.get(id) || []) if (!trace.has(next)) { trace.add(next); walk(next, graph); }
    };
    for (const id of sel) { trace.add(id); walk(id, ups); walk(id, downs); }
    render();
  }

  // ------------------------------------------------------- floating views
  let viewZ = 1;
  /// Puts a floating window at (x, y), keeping its title bar inside the canvas so it can always be grabbed.
  function placeWin(win, x, y) {
    const head = win.querySelector(".v-head"), hh = head ? head.offsetHeight : 28, keep = 80;
    win.style.left = Math.max(keep - win.offsetWidth, Math.min(x, canvas.clientWidth - keep)) + "px";
    win.style.top = Math.max(0, Math.min(y, canvas.clientHeight - hh)) + "px";
  }
  window.addEventListener("resize", () => { for (const v of views.values()) placeWin(v.win, v.win.offsetLeft, v.win.offsetTop); });
  // Opening a view replaces the other unpinned ones; pinned views stay.
  function toggleView(id) {
    if (views.has(id)) return closeView(id);
    closeUnpinnedViews();
    openView(id);
  }

  /// What a module view (or a panel) calls to change node `id`.
  function makeApi(id) {
    return {
      knobMenu: (pid, ev) => { const items = controlMenuItems(id, { param: pid }); if (items.length) showMenu(ev, items); },
      setParam: (pid, v) => {
        const m = nodeById(id);
        if (m) m.params[pid] = v;
        native("setParam", id, pid, v);
        if (m && m.type === "voice-cell" && pid === "voices") { renderNodes(); renderCables(); }  // ×N and the dots
        else if (m && drivesJacks(m, pid)) { renderNodes(); renderCables(); }  // jacks shown or renamed by a mode
      },
      beginGesture: gesture,
      setAmount: (cableId, v) => {
        const c = board.cables.find((x) => x.id === cableId);
        if (c) c.amount = v;
        native("setAmount", cableId, v);
      },
      removeCable,
      command: (cmd, value) => native("command", id, cmd, value),
      isPatched: (jack) => board.cables.some((c) => c.to.node === id && c.to.jack === jack),
      importMedia: (name, base64) => native("importMedia", name, base64),
      exportMedia: (slot) => native("exportMedia", id, slot),
      setData: (data) => {
        const m = nodeById(id);
        if (m) m.data = clone(data);
        native("setData", id, data);
      },
      // Performance gestures (Button presses, Keyboard keys): not saved, no undo.
      perform: (action, ...args) => native("perform", id, action, args),
      // Preset libraries shared by all sets, e.g. Drum Grid patterns ("drums").
      presets: async (kind) => (await native("presets", kind)) || [],
      savePreset: async (kind, name, preset) => (await native("savePreset", name, preset, kind)) || [],
      deletePreset: async (kind, name) => (await native("deletePreset", name, kind)) || [],
      setNodeProperty: (key, value) => edit("set " + key, (b) => { const m = nodeById(id, b); if (!m) return false; m[key] = value; }),
      cablesInto: (pid) => cablesInto(id, pid).map((c) => {
        const src = nodeById(c.from.node);
        return { id: c.id, amount: c.amount, label: src ? `${src.name} › ${jackName(src, c.from.jack, true)}` : "?" };
      }),
    };
  }

  function openView(id) {
    const n = nodeById(id);
    if (!n || isStructural(n)) return;
    const t = typeOf(n);
    const win = el("div", "vwin");
    win.dataset.node = id;
    win.style.setProperty("--accent", n.colour || t.colour || "#4fd1c5");
    const head = el("div", "v-head");
    const vTitle = el("span", "v-title", n.name);
    const pen = el("button", "pen", "✎");
    pen.title = "Rename";
    pen.setAttribute("aria-label", "Rename " + n.name);
    head.append(vTitle, pen, el("span", "v-sub", t.name), el("span", "spacer"));
    const help = el("button", "help", "?");
    help.title = "Documentation";
    help.hidden = true;
    const pin = el("button", "pin", "📌");
    pin.title = pinTitle(false);
    const close = el("button", "", "×");
    close.title = "Close (Esc)";
    head.append(help, pin, close);
    const body = el("div", "v-body");
    const power = canBypass(n) ? el("button", "power", "⏻") : null;   // a power switch: lit = the module runs
    if (power) {
      setPowerButton(power, n);
      power.addEventListener("click", () => toggleBypass(id));
      head.appendChild(power);
    }
    const doc = el("div", "v-doc");
    doc.hidden = true;
    win.append(head, body);
    const api = makeApi(id);
    const bv = BleepView.create(t, clone(n), api);
    const hook = BleepViews.get(t.type);
    if (hook && hook.width) win.style.width = hook.width + "px";
    else if (isPort(n)) win.classList.add("port");   // In/Out nodes have a few controls: fit them
    if (!n.params) n.params = {};
    body.append(bv.root, doc);
    $("views").appendChild(win);
    const v = { win, bv, pinned: false, power };
    moduleDoc(t.type).then((md) => {
      if (md === null) return;
      help.hidden = false;
      doc.innerHTML = BleepMarkdown.render(md);
    });
    views.set(id, v);

    // Next to the node, inside the canvas.
    const ne = nodesEl.querySelector(`[data-id="${id}"]`);
    const r = canvas.getBoundingClientRect();
    let x = 40, y = 40;
    if (ne) {
      // Beside the node, never over it: its ports must stay reachable.
      // Right if it fits, else left, else (a window as wide as the canvas) below or above.
      const nr = ne.getBoundingClientRect(), w = win.offsetWidth, h = win.offsetHeight, gap = 16;
      const nl = nr.left - r.left, nrt = nr.right - r.left, nt = nr.top - r.top, nb = nr.bottom - r.top;
      y = nt;
      if (nrt + gap + w <= r.width - 10) x = nrt + gap;
      else if (nl - gap - w >= 8) x = nl - gap - w;
      else {
        x = nl;
        y = nb + gap + h <= r.height - 8 || nt - gap - h < 8 ? nb + gap : nt - gap - h;
      }
    }
    x = Math.max(8, Math.min(x, r.width - win.offsetWidth - 10));
    y = Math.max(8, Math.min(y, r.height - Math.min(win.offsetHeight, 200)));
    win.style.left = x + "px";
    win.style.top = y + "px";
    front(win);

    win.addEventListener("pointerdown", () => front(win));
    pin.addEventListener("click", () => { v.pinned = !v.pinned; pin.classList.toggle("on", v.pinned); pin.title = pinTitle(v.pinned); });
    help.addEventListener("click", () => {
      const open = doc.hidden;
      doc.hidden = !open;
      bv.root.hidden = open;
      help.classList.toggle("on", open);
      win.classList.toggle("doc", open);
      help.title = open ? "Back to the controls" : "Documentation";
      body.scrollTop = 0;
      // The docs are wider: keep the window, and its buttons, inside the canvas.
      const maxLeft = canvas.clientWidth - win.offsetWidth - 8;
      if (win.offsetLeft > maxLeft) win.style.left = Math.max(8, maxLeft) + "px";
    });
    doc.addEventListener("click", (e) => { if (e.target.closest("a")) e.preventDefault(); });  // the page must not navigate
    close.addEventListener("click", () => closeView(id));
    pen.addEventListener("click", () => {
      const cur = nodeById(id);
      if (!cur) return;
      const input = el("input", "n-rename v-rename");
      input.value = cur.name;
      input.maxLength = 63;
      vTitle.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        const name = input.value.trim();
        input.replaceWith(vTitle);
        if (save && name && name !== cur.name) edit("rename", (b) => { nodeById(id, b).name = name; });
      };
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      });
      input.addEventListener("blur", () => finish(true));
      input.addEventListener("pointerdown", (e) => e.stopPropagation());
    });
    if (hook && hook.resizable) {  // drag the lower right corner to change the width
      const grip = el("div", "v-grip");
      grip.title = "Drag to resize";
      win.appendChild(grip);
      grip.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        grip.setPointerCapture(e.pointerId);
        const sx = e.clientX, w0 = win.offsetWidth, max = canvas.clientWidth - win.offsetLeft - 8;
        const move = (m) => { win.style.width = Math.max(360, Math.min(max, w0 + m.clientX - sx)) + "px"; };
        const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); };
        grip.addEventListener("pointermove", move);
        grip.addEventListener("pointerup", up);
      });
    }
    head.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const sx = e.clientX - win.offsetLeft, sy = e.clientY - win.offsetTop;
      const move = (m) => placeWin(win, m.clientX - sx, m.clientY - sy);
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    watch();
  }
  // ----------------------------------------------------------- front panels
  // Panels live in the board document (board.panels, doc/specs/panels.md): a cell's
  // panel names nodes inside the cell, a board panel any node; a module panel
  // ("for") is loaded by other panels and names its module "this".
  const panelList = () => (board && board.panels) || [];
  const panelById = (id, b = board) => ((b && b.panels) || []).find((q) => q.id === id);
  const panelsOfCell = (cellId) => panelList().filter((q) => q.cell === cellId);
  const boardPanels = () => panelList().filter((q) => !q.cell && !q.for);
  const hasPanel = (n) => isCellLike(n) && panelsOfCell(n.id).length > 0;
  const panelOpen = (id) => views.has("panel:" + id);
  function togglePanel(id) {
    if (panelOpen(id)) closeView("panel:" + id);
    else openPanel(id);
  }
  /// `list` and every panel they load, directly or not.
  function panelsWithLoaded(list) {
    const out = new Set(list);
    for (const q of out) for (const c of q.controls) {
      const sub = c.type === "panel" && panelById(c.panel);
      if (sub) out.add(sub);
    }
    return [...out];
  }
  /// Panels of cells that are gone, and module panels nobody loads, go with the edit.
  function prunePanels(b) {
    if (!b.panels) return;
    const ids = new Set(b.nodes.map((n) => n.id));
    let list = b.panels.filter((q) => !q.cell || ids.has(q.cell));
    for (let again = true; again;) {
      const loaded = new Set(list.flatMap((q) => q.controls.filter((c) => c.type === "panel").map((c) => c.panel)));
      const next = list.filter((q) => !q.for || loaded.has(q.id));
      again = next.length !== list.length;
      list = next;
    }
    if (list.length) b.panels = list; else delete b.panels;
  }

  /// ▦ on a cell: its panel, or a list when it has several.
  function cellPanels(ev, cell) {
    const mine = panelsOfCell(cell.id);
    if (mine.length === 1) return togglePanel(mine[0].id);
    showMenu(ev, mine.map((q) => ({ label: q.name, run: () => togglePanel(q.id) })));
  }
  /// The toolbar's Panels list.
  function panelsMenu(ev) {
    const items = [];
    const mine = boardPanels();
    for (const q of mine) items.push({ label: q.name, key: q.open ? "on load" : "", run: () => togglePanel(q.id) });
    const cellPanelItems = panelList().filter((q) => q.cell && nodeById(q.cell))
      .map((q) => ({ label: `${nodeById(q.cell).name}: ${q.name}`, run: () => togglePanel(q.id) }));
    if (cellPanelItems.length) items.push({ label: "Cell panels", items: cellPanelItems });
    if (items.length) items.push("-");
    items.push({ label: "New board panel", run: () => newPanel("") });
    const sel1 = selectedNodes().filter(isCellLike);
    if (sel1.length === 1) {
      items.push({ label: `New panel for “${sel1[0].name}”`, run: () => newPanel(sel1[0].id) });
      items.push({ label: `Build panel from “${sel1[0].name}”`, run: () => buildPanel(sel1[0].id) });
    }
    showMenu(ev, items);
  }
  // ---- panel controls that are modules (panel-wiring.js) ------------------------------------------------------------
  /// What `panel-wiring.js` needs: the types, new ids, and where a new control goes on its panel.
  const wiringEnv = () => ({ types, uid, place: (q, type, extra) => BleepPanelEditor.placeControl(q, type, extra, q.tabs && q.tabs[0] ? q.tabs[0].id : null) });
  /// The right-click menu of anything that takes (or gives) a signal: make a panel control for it, or show/remove the one it has.
  function controlMenuItems(nodeId, target) {
    const n = nodeById(nodeId);
    if (!n || !window.BleepPanelWiring || BleepPanelWiring.belongsToPanel(board, n)) return [];
    const have = BleepPanelWiring.controlFor(board, n, target);
    if (have) return [
      { label: "Show panel control", run: () => { if (!panelOpen(have.panel.id)) togglePanel(have.panel.id); } },
      { label: "Remove panel control", run: () => removePanelControl(have.panel.id, have.control.id) },
    ];
    const kinds = BleepPanelWiring.kindsFor(types, n, target);
    if (!kinds.length) return [];
    return [{ label: "Create panel control", items: kinds.map((k) => ({ label: k.label, run: () => createPanelControl(nodeId, target, k.kind) })) }];
  }
  function createPanelControl(nodeId, target, kind) {
    let made = null;
    const done = edit("create panel control", (b) => {
      const n = nodeById(nodeId, b);
      made = n ? BleepPanelWiring.create(b, wiringEnv(), n, target, kind) : { error: "the module is gone" };
      if (made.error) return false;
    });
    Promise.resolve(done).then(() => {
      if (!made || made.error) return notice(`Could not create the panel control: ${made ? made.error : "nothing happened"}.`);
      notice(`Added “${made.control.label}” to the panel “${made.panel.name}”; its ${made.module.name === made.control.label ? "module" : made.module.type} is in the Panel cell.`);
    });
  }
  function removePanelControl(panelId, controlId) {
    edit("remove panel control", (b) => { if (!BleepPanelWiring.remove(b, panelId, controlId)) return false; });
  }
  /// Goes to a node: into the cells around it, selected and in the middle.
  function goToNode(id) {
    const n = nodeById(id);
    if (!n) return;
    path = pathTo(id);
    sel.clear();
    sel.add(id);
    trace = null;
    closeUnpinnedViews();
    render();
    centreOn(n);
  }
  /// A first panel for a cell, built from what is inside it.
  async function buildPanel(cellId) {
    const cell = nodeById(cellId);
    if (!cell) return;
    const order = descendants(cellId).filter((m) => !isBoundary(m) || m.type === "voice-out" || m.type === "cell-out")
      .sort((a, b) => a.x - b.x || a.y - b.y);
    const doc = BleepPanelBuild.build(cell, { nodes: order, types, inputsOf, cables: board.cables });
    doc.id = uid("p");
    await edit("build panel", (b) => { (b.panels || (b.panels = [])).push(doc); });
    if (!pluginMode) openPanel(doc.id);
  }
  async function newPanel(cellId, quiet) {
    const cell = cellId && nodeById(cellId);
    const id = uid("p");
    const name = cell ? cell.name : "Panel";
    await edit("new panel", (b) => {
      (b.panels || (b.panels = [])).push({
        id, name, ...(cell ? { cell: cellId } : {}), cols: 40, rows: 24,
        controls: [{ id: "c1", type: "label", at: [1, 0], size: [24, 2], text: name, style: "title" }],
      });
    });
    if (!quiet) openPanel(id, { edit: true });
    return id;
  }
  /// The panel that opens with the board (panel.open: "window" or "full").
  function openStartPanel() {
    const q = panelList().find((x) => x.open);
    if (q && !panelOpen(q.id)) openPanel(q.id, { full: q.open === "full" });
  }

  /// What the nodes a panel names look like to it. A module panel's own module is "this".
  function panelHost(doc, embeddedViews) {
    const standIn = doc.for && { id: "this", name: (types[doc.for.module] || {}).name || doc.for.module, type: doc.for.module, params: {} };
    const lookup = (id) => (id === "this" ? standIn : nodeById(id));
    return {
      node: (key, bound) => (key === "this" ? bound || standIn || null : nodeById(key)),
      param: (id, pid) => {
        const m = lookup(id);
        const def = m && typeOf(m).params.find((q) => q.id === pid);
        return def ? { node: m, def } : null;
      },
      value: (id, pid) => {
        const m = lookup(id), def = typeOf(m).params.find((q) => q.id === pid);
        return (m.params && m.params[pid]) ?? def.default;
      },
      set: (id, pid, v) => makeApi(id).setParam(pid, v),
      begin: gesture,
      // A panel control wired to a cell's jack or notes drives a hidden source the engine makes (id "~panel:control:wire").
      jackType: (panel, jack) => { const c = panel.cell && nodeById(panel.cell); const j = c && inputsOf(c).find((q) => q.id === jack); return j ? j.type : null; },
      nodeJackType: (id, jack) => { const m = nodeById(id); return m ? inType(m, jack) : null; },
      command: (id, cmd, v) => native("command", id, cmd, v),
      source: (sid, v) => native("setParam", sid, "value", v),
      press: (sid, down) => native("perform", sid, down ? "press" : "release", []),
      // A Button module in Toggle mode: its new state is saved in its data, as its own view does, then pressed and released.
      toggle: (id) => {
        const m = nodeById(id);
        if (!m) return;
        const next = !(m.data && m.data.on);
        m.data = { on: next };
        const api = makeApi(id);
        api.setData(m.data);
        api.perform("press", next ? 1 : 0);
        api.perform("release");
      },
      note: (sid, action, args) => native("perform", sid, action, args),
      save: (pid, cid, x) => edit("panel control", (b) => {
        const q = (b.panels || []).find((r) => r.id === pid), c = q && q.controls.find((r) => r.id === cid);
        if (!c) return false;
        c.value = x;
      }),
      view: (id) => {
        const m = nodeById(id);
        if (!m || isStructural(m)) return null;
        if (!m.params) m.params = {};
        const bv = BleepView.create(typeOf(m), clone(m), makeApi(id));
        embeddedViews.push({ id, bv });
        return bv;
      },
      refreshView: (id, bv) => { const m = nodeById(id); if (m) bv.refresh(m); },
    };
  }
  /// What the editor may wire: the nodes of the panel's cell (or the whole board), in tree order.
  function panelScope(doc) {
    if (doc.for) {
      const t = types[doc.for.module] || { name: doc.for.module, params: [], outputs: [] };
      return [{ id: "this", name: t.name, type: t.type, depth: 0, params: t.params, outputs: t.outputs, inputs: t.inputs || [], buttons: t.buttons || [], view: true }];
    }
    const out = [];
    const walk = (parent, depth) => {
      for (const n of nodesAt(parent)) {
        if (isBoundary(n) || isPort(n)) continue;
        const t = typeOf(n);
        if (t.params.length || t.outputs.length || n.type === "voice-cell") out.push({ id: n.id, name: n.name, type: t.type, depth, params: t.params, outputs: outputsOf(n), inputs: inputsOf(n).filter((j) => j.type !== "audio" && j.type !== "notes"), buttons: t.buttons || [], view: !isStructural(n) });
        if (isCellLike(n)) walk(n.id, depth + 1);
      }
    };
    if (doc.cell) {
      const root = nodeById(doc.cell);
      if (!root) return [];
      if (typeOf(root).params.length) out.push({ id: root.id, name: root.name, type: root.type, depth: 0, params: typeOf(root).params, outputs: outputsOf(root), view: false });
      walk(doc.cell, 1);
    } else walk("", 0);
    return out;
  }

  /// The panel as drawn: what moving a control (its saved "value") does not change.
  const layoutOf = (doc) => JSON.stringify(doc, (k, v) => (k === "value" ? undefined : v));

  /// A panel in a floating window: played, or (✎) edited. ⤢ fills the canvas.
  function openPanel(panelId, opts = {}) {
    const doc0 = panelById(panelId);
    if (!doc0) return;
    const key = "panel:" + panelId;
    if (views.has(key)) { front(views.get(key).win); if (opts.edit) views.get(key).setEdit(true); return; }
    const state = { edit: !!opts.edit || !!doc0.for, full: !!opts.full, tab: null, json: "" };
    let play = null, editor = null, embeddedViews = [];
    const win = el("div", "vwin pwin");
    win.dataset.node = key;
    const head = el("div", "v-head");
    const tools = el("span", "pwin-tools");
    const editBtn = el("button", "", "✎");
    editBtn.title = "Edit the panel";
    const fullBtn = el("button", "", "⤢");
    fullBtn.title = "Fill the canvas";
    const pin = el("button", "pin on", "📌");
    pin.title = pinTitle(true);
    const close = el("button", "", "×");
    close.title = "Close (Esc)";
    const title = el("span", "v-title", doc0.name);
    const sub = el("span", "v-sub", doc0.cell && nodeById(doc0.cell) ? nodeById(doc0.cell).name : doc0.for ? "Module panel" : "Board");
    tools.append(editBtn, fullBtn);
    head.append(title, sub, el("span", "spacer"), tools, pin, close);
    const body = el("div", "v-body");
    win.append(head, body);
    $("views").appendChild(win);

    const fit = () => {
      if (!play) return;
      const r = play.root;
      r.style.transform = "";
      if (state.full) {
        const s = Math.min(body.clientWidth / r.offsetWidth, body.clientHeight / r.offsetHeight, 3);
        r.style.transform = `scale(${Math.max(0.2, s)})`;
      }
    };
    const draw = () => {
      const doc = panelById(panelId);
      if (!doc) return;
      title.textContent = doc.name;
      if (play) { play.destroy(); play = null; }
      if (editor) { editor.destroy(); editor = null; }
      embeddedViews = [];
      body.innerHTML = "";
      state.json = layoutOf(doc);
      win.classList.toggle("editing", state.edit);
      win.classList.toggle("full", state.full && !state.edit);
      editBtn.classList.toggle("on", state.edit);
      fullBtn.classList.toggle("on", state.full);
      fullBtn.hidden = !!doc.for;
      if (state.edit) {
        editor = BleepPanelEditor.mount(body, {
          doc: () => panelById(panelId) || doc,
          panels: () => panelList(),
          mutate: (label, fn) => edit(label, (b) => {
            const q = (b.panels || []).find((x) => x.id === panelId);
            if (!q) return false;
            {
              const make = (type, name) => addControlModule(b, q, type, name);
              make.set = (id, pid, v) => { const n = nodeById(id, b); if (n) n.params[pid] = v; };   // v: normalised
              fn(q, b.panels, make);
            }
          }),
          scope: () => panelScope(panelById(panelId) || doc),
          module: (id) => nodeById(id),
          edit: (label, fn) => edit(label, fn),
          removeControl: (panelId, controlId) => removePanelControl(panelId, controlId),
          reveal: revealPanelModule,
          host: () => panelHost(panelById(panelId) || doc, []),
          editPanel: (id) => openPanel(id, { edit: true }),
        });
      } else {
        const host = panelHost(doc, embeddedViews);
        play = BleepPanels.create(panelList(), panelId, host, { tab: state.tab, onTab: (t) => { state.tab = t; fit(); } });
        body.append(play.root);
        if (!state.full) win.style.width = Math.min(play.root.offsetWidth + 2, canvas.clientWidth - 16) + "px";
        fit();
      }
      watch();
    };
    const entry = {
      win, pinned: true, panelId,
      setEdit: (on) => { state.edit = on; state.full = state.full && !on; draw(); },
      nodes: () => (play && !state.edit ? play.nodeIds() : []),
      destroy: () => { if (play) play.destroy(); },
      bv: {
        update: (s) => { if (play) play.update(s); },
        refresh: (doc) => {
          if (layoutOf(doc) !== state.json) { if (editor) { state.json = layoutOf(doc); title.textContent = doc.name; editor.rebuild(); } else draw(); return; }
          if (play) {
            for (const e of embeddedViews) { const m = nodeById(e.id); if (m) e.bv.refresh(m); }
            play.refresh();
          }
        },
      },
    };
    views.set(key, entry);
    const r = canvas.getBoundingClientRect();
    win.style.left = "8px";
    win.style.top = "56px";
    draw();
    if (!state.full) {
      win.style.left = Math.max(8, (r.width - win.offsetWidth) / 2) + "px";
    }
    front(win);
    win.addEventListener("pointerdown", () => front(win));
    editBtn.addEventListener("click", () => entry.setEdit(!state.edit));
    fullBtn.addEventListener("click", () => {
      state.full = !state.full;
      if (state.full) state.edit = false;
      draw();
    });
    window.addEventListener("resize", fit);
    pin.addEventListener("click", () => { entry.pinned = !entry.pinned; pin.classList.toggle("on", entry.pinned); pin.title = pinTitle(entry.pinned); });
    close.addEventListener("click", () => closeView(key));
    head.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || state.full) return;
      const sx = e.clientX - win.offsetLeft, sy = e.clientY - win.offsetTop;
      const move = (m) => placeWin(win, m.clientX - sx, m.clientY - sy);
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }

  /// A module's documentation (modules/<name>/doc/<type>.md), or null if it has none.
  const docs = new Map();
  function moduleDoc(type) {
    if (!docs.has(type))
      docs.set(type, fetch(encodeURIComponent(type) + ".md")
        .then((r) => (r.ok ? r.text() : null))
        .then((md) => (md && md.trim() ? md : null))
        .catch(() => null));
    return docs.get(type);
  }
  function front(win) {
    for (const w of document.querySelectorAll(".vwin")) w.classList.remove("front");
    win.classList.add("front");
    win.style.zIndex = ++viewZ;
  }
  function closeView(id) {
    const v = views.get(id);
    if (!v) return;
    if (v.panelId) v.destroy();
    v.win.remove();
    views.delete(id);
    watch();
  }
  function pinTitle(on) {
    return (on ? "Pinned: stays open" : "Not pinned: closes") + " when opening other views or entering and leaving cells (click to " + (on ? "unpin" : "pin") + ")";
  }
  function closeUnpinnedViews() { for (const [id, v] of [...views]) if (!v.pinned) closeView(id); }
  function closeTopView() {
    let top = null;
    for (const [id, v] of views) if (!top || +v.win.style.zIndex > +views.get(top).win.style.zIndex) top = id;
    if (top) closeView(top);
    return !!top;
  }
  function watch() {
    native("watch", [...views].flatMap(([id, v]) => (v.panelId ? v.nodes() : [id])));
  }

  // ------------------------------------------------------------ live state
  function drawScope(s, v) {
    s.hist[s.head] = v;
    s.head = (s.head + 1) % s.hist.length;
    const c = s.canvas, w = c.clientWidth, h = c.clientHeight;
    if (!w) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    let lo = Infinity, hi = -Infinity;
    for (const x of s.hist) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    lo = Math.min(lo, 0); hi = Math.max(hi, 1);
    g.strokeStyle = getComputedStyle(c.parentElement).getPropertyValue("--c") || "#888";
    g.lineWidth = 1.2;
    g.beginPath();
    const n = s.hist.length;
    for (let i = 0; i < n; i++) {
      const x = s.hist[(s.head + i) % n];
      const px = i / (n - 1) * w, py = h - 1 - (x - lo) / (hi - lo || 1) * (h - 2);
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.stroke();
  }

  function updatePulses(nodes) {
    for (const [id, ns] of Object.entries(nodes)) {
      const act = ns.activity || {};
      for (const jack of Object.keys(ns.outputs || {})) {
        const key = id + "|" + jack;
        // Swing → 0..1: a full-scale control sweep or audio near unity is "full".
        const target = Math.min(1, Math.sqrt((act[jack] || 0) / 0.5));
        const prev = pulseLevel.get(key) || 0;
        const v = target > prev ? prev + (target - prev) * 0.5 : prev * 0.9;  // quick rise, slow fade
        if (v < 0.01) pulseLevel.delete(key); else pulseLevel.set(key, v);
      }
    }
    for (const { path, key } of pulses.values())
      path.style.setProperty("--act", (pulseLevel.get(key) || 0).toFixed(2));
    if (meter) feedMeter(nodes[meter.node]);
  }

  let portsKey = "";
  onNative("state", (s) => {
    live = s;
    if (s && s.status) $("status").textContent = s.status;
    if (!board || !s || !s.nodes) return;
    for (const [key, sc] of scopes) {
      const [node, jack] = key.split("|");
      const ns = s.nodes[node];
      if (ns && ns.outputs && jack in ns.outputs) drawScope(sc, ns.outputs[jack]);
    }
    for (const [id, v] of views) v.bv.update(v.panelId ? s : s.nodes[id]);
    updatePulses(s.nodes);
    // Voice Cells: which voices play.
    for (const ne of nodesEl.querySelectorAll(".node.voice")) {
      const ns = s.nodes[ne.dataset.id];
      const mask = ns && ns.voices ? ns.voices : 0;
      ne.querySelectorAll(".vdot").forEach((d, k) => d.classList.toggle("on", (mask >> k & 1) === 1));
    }
    // Ports went live or ghost: redraw.
    if (s.ports) {
      const key = Object.entries(s.ports).map(([k, p]) => k + (p.live ? 1 : 0)).sort().join();
      if (key !== portsKey) {
        portsKey = key;
        ports = s.ports;
        renderNodes();
        renderCables();
      }
    }
  });
  onNative("board", applyMessage);
  onNative("focus", (f) => { if (f && f.node) focusNode(f.node); });

  // ------------------------------------------------------------- keyboard
  document.addEventListener("keydown", (e) => {
    if (e.key === " " && !editing()) spaceDown = true;
    if (editing()) return;
    const cmd = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (cmd && k === "r") { e.preventDefault(); location.reload(); return; }  // UI dev builds
    if (!board) return;
    if (cmd && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (cmd && k === "y") { e.preventDefault(); redo(); return; }
    if (cmd && k === "g") { e.preventDefault(); e.shiftKey ? selectedNodes().filter((n) => n.type === "cell").forEach((n) => ungroup(n.id)) : group(); return; }
    if (cmd && k === "d") { e.preventDefault(); duplicate(e.shiftKey); return; }
    if (cmd && k === "a") { e.preventDefault(); selectAll(); return; }
    if (cmd && k === "c") { e.preventDefault(); copy(); return; }
    if (cmd && k === "x") { e.preventDefault(); cut(); return; }
    if (cmd && k === "v") { e.preventDefault(); paste(); return; }
    if (cmd) return;
    if (e.key === "Tab") { e.preventDefault(); openSearch(pointer.x, pointer.y); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelection(); return; }
    if (e.key === "Escape") {
      if (window.BleepPresetBrowser && BleepPresetBrowser.close()) return;
      if (!$("menu").hidden || !$("cable-pop").hidden || !$("help-pop").hidden) return hidePopovers();
      if (trace) { trace = null; return render(); }
      if (closeTopView()) return;
      if (path.length) return leaveTo(path.length - 1);
      sel.clear(); clearCableSel(); renderSelection(); renderCables();
      return;
    }
    if (k === "f") return fit();
    const nav = { "+": "zoom-in", "=": "zoom-in", "-": "zoom-out", ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }[e.key];
    if (nav) { e.preventDefault(); return navStep(nav); }
    if (k === "p" && !cmd) { const r = $("panels").getBoundingClientRect(); return panelsMenu({ clientX: r.left, clientY: r.bottom + 4 }); }
    if (k === "t") return toggleTrace();
    if (k === "m") return toggleMute();
    if (e.key === "Enter") {
      const only = selectedNodes();
      if (only.length === 1 && only[0].type === "cell") enterCell(only[0].id);
      else if (only.length === 1) toggleView(only[0].id);
    }
  });
  document.addEventListener("keyup", (e) => { if (e.key === " ") spaceDown = false; });

  async function undo() { applyMessage(await native("undo")); }
  async function redo() { applyMessage(await native("redo")); }
  $("undo").addEventListener("click", undo);
  $("cell-close").addEventListener("click", () => { if (path.length) leaveTo(path.length - 1); });
  $("redo").addEventListener("click", redo);
  window.addEventListener("resize", () => { renderCables(); positionCablePop(); });

  window.__board = () => board;  // for tests/board_smoke.cpp
  window.__errors = window.__errors || [];  // what the page reported, for tests/board_smoke.cpp
  window.addEventListener("error", (e) => window.__errors.push(String(e.message)));
  window.addEventListener("unhandledrejection", (e) => window.__errors.push("rejected: " + (e.reason && e.reason.message ? e.reason.message : e.reason)));
  /// The Add menu's "Cell › … › name", for tests/board_smoke.cpp.
  window.__findPreset = (name) => presets.find((r) => r.name === name);
  window.__addPreset = (name) => {
    const q = presets.find((r) => r.name === name);
    if (!q) return "no preset " + name;
    addAt({ preset: q.key }, 200 + 60 * (window.__added = (window.__added || 0) + 1), 120);
    return "asked for " + name;
  };

  // ------------------------------------------------------------------ start
  /// Module views (modules/<name>/ui/*.js, served flat): loads the scripts
  /// listed in module-views.json that the page doesn't load yet. Without the
  /// list, tries <type>.js for every module type.
  async function loadModuleViews(list) {
    const loaded = new Set([...document.scripts].map((s) => s.src.split("/").pop()));
    let names = null;
    try {
      const r = await fetch("module-views.json");
      if (r.ok) names = await r.json();
    } catch (e) { /* fall back below */ }
    if (!Array.isArray(names))
      names = list.filter((t) => !t.port && !isStructural(t) && t.type !== "voice-cell" && !BleepViews.get(t.type))
        .map((t) => t.type + ".js");
    return Promise.all(names.filter((n) => !loaded.has(n)).map((n) => new Promise((done) => {
      const s = document.createElement("script");
      s.src = encodeURIComponent(n);
      s.onload = s.onerror = () => done();
      document.head.appendChild(s);
    })));
  }

  /// A module was installed: ask for the node types again, load their views and redraw (placeholders come to life).
  async function refreshTypes() {
    const list = await native("types");
    if (!Array.isArray(list)) return;
    typeList = list;
    types = Object.fromEntries(typeList.map((t) => [t.type, t]));
    await loadModuleViews(typeList);
    const m = await native("init");  // the board as the engine has it now: the node types it kept are compiled again
    if (m) applyMessage(m);
    render();
  }

  // A script error in the board page used to stay in the web view's console, where nobody looks: show it.
  window.addEventListener("error", (e) => {
    if (/ResizeObserver/.test(e.message || "")) return;
    notice(`Board error: ${e.message || "script error"}${e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : ""}`);
  });
  window.addEventListener("unhandledrejection", (e) => notice(`Board error: ${e.reason && e.reason.message ? e.reason.message : e.reason}`));

  async function start() {
    const m = await native("init");
    if (!m) return;
    typeList = m.types || [];
    types = Object.fromEntries(typeList.map((t) => [t.type, t]));
    await loadModuleViews(typeList);
    hasStore = !!m.store;
    if (m.store && window.BleepStoreView) await BleepStoreView.init({ onTypes: refreshTypes, standalone: !!m.standalone, settings: !!m.settings });
    if (m.settings && window.BleepSettingsView) await BleepSettingsView.init({ store: !!m.store });
    if (m.store && window.BleepHelpView) await BleepHelpView.init();
    pluginMode = !!m.plugin || !!panelOf;
    document.body.classList.toggle("plugin", pluginMode);
    dev = !!m.dev;
    standalone = !!m.standalone;
    {  // the preset browser: whole boards (spec §11.5); in a plugin their port nodes map onto the set's ports
      await BleepPresetBrowser.init({ board: () => board, apply: applyMessage, mapPorts: !standalone, cells: !!m.plugin });
      $("presets").hidden = false;
      $("presets").addEventListener("click", () => BleepPresetBrowser.open());
      if (m.plugin) BleepPresetBrowser.open();  // an instrument or FX window opens on its presets
    }
    await loadFactoryPresets();
    await loadFactoryPanels();
    setPresets((await native("presets")) || []);
    $("hint").textContent = "Tab add · drag jacks to patch · ⌘G group · T trace · F fit" + (dev ? " · UI dev build" : "");
    applyMessage(m);
    // Fit once the canvas has its size (the window may still be opening).
    let fitted = false;
    new ResizeObserver(() => {
      if (!fitted && board && nodesAt("").length) fitted = fit();
      renderCables();
    }).observe(canvas);
  }
  start();
})();
