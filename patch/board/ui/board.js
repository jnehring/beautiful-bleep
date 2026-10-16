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
  // The page's lock (common/ui/bleep-bridge.js): the native bridge and the board's private namespace are not on `window`.
  const { native, onNative, priv: P, seal, testHooks } = window.BleepSeal;

  // ------------------------------------------------------------------ state
  let board = null;            // the board document, or null (no Bleep Board)
  let hasLibrary = false;        // the app has a module library (the native side's init says so); without one, nothing is checked against it
  let types = {};              // type → description
  let typeList = [];
  let ports = {};              // port id → {kind, track, live, main}
  let canUndo = false, canRedo = false;
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
  const credits = () => window.BleepCredits;   // bleep-credits.js: the credits that travel with a copied preset
  const uid = (p) => p + Math.random().toString(36).slice(2, 10);
  const editing = () => {
    const a = document.activeElement;
    return a && (a.tagName === "INPUT" || a.tagName === "SELECT" || a.tagName === "TEXTAREA");
  };

  // --------------------------------------------------------------- the model (board-model.js)
  const { level, nodeById, nodesAt, typeOf, isPort, isCellLike, isBoundary, inVoiceCell, isFixedBoundary, isBay, isStructural, isFixedPort, APP_PORTS, VOICE_IN, VOICE_OUT, compatible, isChannel, bundleSource, bayChannels, bayInputs, bayOutputs, outputsOf, inputsOf, modParams, outType, inType, jackName, cablesInto, portInfo, paramValue, isShown, shownName, drivesJacks, insideVoiceCell, isGhost, descendants } = P.BoardModel.create({
    get board() { return board; }, get types() { return types; }, get ports() { return ports; },
    get standalone() { return standalone; }, get path() { return path; },
  });
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
    if (m.status) setAudio(m.status);
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
    P.BleepAppMenu.refresh();
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
    if (!path.length) return;  // at the top level there is nothing to show: the board is the only place
    const crumb = (label, depth) => {
      const here = depth === path.length;
      const a = el(here ? "span" : "a", here ? "here" : "", label);
      if (!here) a.addEventListener("click", () => leaveTo(depth));
      c.appendChild(a);
    };
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
      if (P.BleepLibraryView) {
        const b = el("button", "n-install", "Install");
        b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        b.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          b.disabled = true;
          b.textContent = "Installing…";
          const ok = await P.BleepLibraryView.installType(n.type);
          if (!ok) { b.disabled = false; b.textContent = "Install"; note.textContent = n.type + ": " + (P.BleepLibraryView.lastMessage() || "not found in the library"); }
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
    if (n.type === "cell-in" || n.type === "voice-in") outs.appendChild(jackRow(n, "+", "new input", "control", "out", "add"));
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
      // On a knob row of the node: add it to a panel.
      const row = ev.target.closest(".jack.param");
      if (row) {
        const items = knobMenuItems(n.id, row.dataset.jack);
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
      hit.addEventListener("pointerenter", () => { if (!cableDragging()) setHoverCable(c.id, p); });
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
    else if (!cableDragging()) hideMeter();
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
  // ------------------------------------------------------- cable tools (board-cabletools.js)
  const cableTools = P.BoardCableTools.create({
    get board() { return board; }, get live() { return live; }, get types() { return types; },
    $, canvas, clearCableSel, clone, edit, el, jackPos, level, nodeById, outType, sel, selectedCableIds, showMenu,
    signalColour, toCanvas, uid,
  });
  const { meterShown, showMeter, hideMeter, feedMeter, removeCable, removeCables, showCableMenu, meterNode } = cableTools;

  // ----------------------------------------------------------- node dragging
  function onNodePointerDown(ev, n) {
    if (ev.button !== 0) return;
    const dot = ev.target.closest(".dot");
    if (dot) {
      ev.stopPropagation();
      const row = dot.closest(".jack");
      if (ev.altKey && row.classList.contains("out")) {
        // Alt-drag: pick up the last cable out of this jack by its output end and move it to another output.
        const outOf = board.cables.filter((c) => c.from.node === n.id && c.from.jack === row.dataset.jack);
        if (outOf.length) return startSourceDrag(ev, outOf[outOf.length - 1]);
      }
      if (row.classList.contains("out") && (row.dataset.jack !== "+" || n.type === "cell-in" || n.type === "voice-in")) return startCableDrag(ev, n.id, row.dataset.jack);
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

  // ---------------------------------------------------------- cable dragging (board-cabledrag.js)
  const cableDrag = P.BoardCableDrag.create({
    get board() { return board; }, $, el, uid, canvas, cablesEl, nodesEl, SVGNS, views, nodeById, typeOf, inputsOf, outputsOf, outType, jackName, compatible,
    isStructural, modParams, signalColour, setHoverCable, jackPos, cablePath, toWorld, jackRow, edit, render, showMenu, openSearch: (...a) => openSearch(...a),
    openView: (...a) => openView(...a), closeView: (...a) => closeView(...a), front: (...a) => front(...a),
  });
  const { startCableDrag, startSourceDrag, connect, isDragging: cableDragging } = cableDrag;

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
    if (what.preset && !checked && hasLibrary && P.BleepLibraryView) {  // modules the preset needs: offer to install them first
      const q = presetList().find((r) => r.key === what.preset);
      if (q) {
        P.BleepLibraryView.ensureNeeds(q.preset, q.name).then(
          (ok) => {
            if (!ok) return;
            // The library only knows the modules it lists or has installed. A preset may use module types this app has never
            // heard of (a newer module, one not installed on this machine): say so, the board keeps them as placeholders.
            const unknown = [...new Set((q.preset.nodes || []).map((n) => n.type))].filter((t) => !types[t]);
            if (unknown.length) notice(`“${q.name}” uses modules this app doesn't have: ${unknown.join(", ")}. They show as “not installed”.`);
            addAt(what, x, y, link, true);
          },
          (e) => {   // the library check itself failed or did not answer: the preset is still wanted
            notice(`Could not check the library for “${q.name}” (${e && e.message ? e.message : e}); adding it without.`);
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
        const p = presetList().find((q) => q.key === what.preset);
        if (!p) return false;
        newId = insertPreset(b, p.preset, lvl, x, y, p.factory ? credits().factory(p.name) : null);
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
      if (newId && board && !nodeById(newId)) notice(`The app did not keep the ${what.preset ? "cell" : "module"} you added. Check the Library section for modules that failed to load.`);
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
      n(uid("co"), "cell-out", "Cell Out", 900, 460),
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

  // ----------------------------------------------------------------- search (board-search.js)
  const search = P.BoardSearch.create({
    $, el, canvas, get board() { return board; }, get typeList() { return typeList; }, presets: () => presetList(), compatible,
    offered: (t) => offered(t), toWorld: (x, y) => toWorld(x, y), addAt: (...a) => addAt(...a),
  });
  const { open: openSearch, close: closeSearch, isOpen: searchOpen } = search;


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
      const i = presetOrder().findIndex((c) => c === label || c.startsWith(label + "/"));
      return i < 0 ? presetOrder().length : i;
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
    // The canvas is clipped, not scrolled, yet the browser may scroll it to reveal a focused panel window: positions follow its scroll.
    m.style.left = Math.max(4, Math.min(ev.clientX - r.left, canvas.clientWidth - m.offsetWidth - 8)) + canvas.scrollLeft + "px";
    m.style.top = Math.max(4, Math.min(ev.clientY - r.top, canvas.clientHeight - m.offsetHeight - 8)) + canvas.scrollTop + "px";
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
    sm.style.left = Math.max(4, x) + canvas.scrollLeft + "px";
    sm.style.top = Math.max(4, Math.min(rr.top - r.top - 4, canvas.clientHeight - sm.offsetHeight - 8)) + canvas.scrollTop + "px";
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
    // Credits: the presets this cell was copied from (text nodes only).
    const made = credits().merge(n.credits);
    if (made.length) {
      const line = el("p", "h-credits", "Based on " + made.map((c) => c.name + (c.author ? " by " + c.author : "")).join(", ") + " (" + made[0].license + ").");
      pop.appendChild(line);
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
    if (searchOpen()) closeSearch();
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
    items.push(...controllerMenuItems(n));
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
    if (isCellLike(n)) items.push({ label: "Unbuild cell", key: "⌘⇧G", run: () => ungroup(n.id), disabled: insideVoiceCell(n.parent) && n.type === "voice-cell" });
    if (n.type === "cell") {
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

  // ------------------------------------------------------------ operations (board-edit.js)
  const ops = P.BoardEdit.create({
    get board() { return board; }, get pointer() { return pointer; }, get pointerInside() { return pointerInside; }, get selCable() { return selCable; }, get types() { return types; },
    canvas, clearCableSel, clone, descendants, edit, inVoiceCell, inputsOf, insideVoiceCell, isBoundary,
    isCellLike, isFixedBoundary, isFixedPort, isPort, isStructural, level, nodeById, nodesAt, outputsOf,
    removeCables, renderSelection, sel, selectedCableIds, toWorld, uid,
    addPanels: (...a) => addPanels(...a), panelList: (...a) => panelList(...a),
    closeView: (...a) => closeView(...a), panelsWithLoaded: (...a) => panelsWithLoaded(...a),
  });
  const { selectedNodes, canDuplicate, canGroup, selectAll, deleteSelection, canBypass, setPowerButton, toggleBypass,
          toggleMute, duplicate, copy, cut, paste } = ops;

  // ------------------------------------------------------------ cells (board-cells.js)
  const cells = P.BoardCells.create({
    get types() { return types; },
    NODE_W, clone, descendants, edit, insideVoiceCell, isBoundary, isCellLike, isPort, jackName, level, nodeById,
    outType, sel, selectedNodes, uid,
  });
  const { canEnterVoice, canGroupVoice, moveIntoCell, group, removeFromCell, ungroup } = cells;

  // ---------------------------------------------------------- cell presets (board-presets.js)
  const cp = P.BoardPresets.create({
    get board() { return board; }, $, el, uid, clone, canvas, nodesEl, closeSubmenus, descendants, isCellLike, insideVoiceCell, groupOpen, groupKey,
    panelList: () => panelList(), panelsWithLoaded: (list) => panelsWithLoaded(list), credits,
  });
  const { setPresets, categories: presetCategories, save: savePreset, insert: insertPreset, addPanels, list: presetList, order: presetOrder } = cp;

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

  // ------------------------------------------------------- floating views (board-views.js)
  const viewsApi = P.BoardViews.create({
    get board() { return board; },
    $, cablesInto, canBypass, canvas, clone, drivesJacks, edit, el, gesture, isPort, isStructural, jackName,
    nodeById, nodesEl, removeCable, renderCables, renderNodes, savePreset,
    setPowerButton, showMenu, toggleBypass, typeOf, views,
    knobMenuItems: (...a) => knobMenuItems(...a), panelMenuFor: (...a) => panelMenuFor(...a),
  });
  const { placeWin, toggleView, makeApi, openView, front, closeView, pinTitle, closeUnpinnedViews, closeTopView, watch } = viewsApi;

  // ----------------------------------------------------------- front panels (board-panels.js)
  const panelsApi = P.BoardPanels.create({
    get board() { return board; }, get path() { return path; }, set path(v) { path = v; }, get pluginMode() { return pluginMode; }, get trace() { return trace; }, set trace(v) { trace = v; }, get types() { return types; },
    $, addControlModule, canvas, centreOn, clone, edit, closeUnpinnedViews, closeView, descendants, el, front, gesture,
    inType, inputsOf, isBoundary, isCellLike, isPort, isStructural, makeApi, nodeById, nodesAt, notice, outputsOf,
    pathTo, pinTitle, placeWin, render, revealPanelModule, sel, selectedNodes, showMenu, typeOf, uid, views, watch,
  });
  const { panelList, panelById, panelsOfCell, hasPanel, panelOpen, togglePanel, panelsWithLoaded, prunePanels,
          cellPanels, panelsMenu, panelMenuFor, knobMenuItems, goToNode, buildPanel, newPanel, openStartPanel,
          openPanel, controllerMenuItems } = panelsApi;

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
    if (meterShown()) feedMeter(nodes[meterNode()]);
  }

  let portsKey = "";
  onNative("state", (s) => {
    live = s;
    if (s && s.status) setAudio(s.status);
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
    if (document.querySelector(".modal-back:not([hidden])")) return;   // a dialog is open: the board's keys wait
    const cmd = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (cmd && k === "r") { e.preventDefault(); location.reload(); return; }  // UI dev builds
    if (!board) return;
    if (cmd && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (cmd && k === "y") { e.preventDefault(); redo(); return; }
    if (cmd && k === "g") { e.preventDefault(); e.shiftKey ? selectedNodes().filter(isCellLike).forEach((n) => ungroup(n.id)) : group(); return; }
    if (cmd && k === "d") { e.preventDefault(); duplicate(e.shiftKey); return; }
    if (cmd && k === "a") { e.preventDefault(); selectAll(); return; }
    if (cmd && k === "c") { e.preventDefault(); copy(); return; }
    if (cmd && k === "x") { e.preventDefault(); cut(); return; }
    if (cmd && k === "v") { e.preventDefault(); paste(); return; }
    if (cmd) return;
    if (e.key === "Tab") { e.preventDefault(); openSearch(pointer.x, pointer.y); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelection(); return; }
    if (e.key === "Escape") {
      if (P.BleepProjectBrowser && P.BleepProjectBrowser.close()) return;
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
    if (k === "p" && !cmd) return panelsMenu({ clientX: 12, clientY: 48 });
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
  $("cell-close").addEventListener("click", () => { if (path.length) leaveTo(path.length - 1); });

  /// The audio indicator: the engine's status line ("Demo · no audio · latency 256 smp") is its tooltip; a hollow dot means no audio.
  function setAudio(text) {
    const b = $("audio");
    b.title = text + (document.getElementById("settings") && !pluginMode ? " (click for the audio settings)" : "");
    b.classList.toggle("off", /no audio|not running|stopped|suspended|no device/i.test(text));
  }
  // In a plugin Live owns the audio device: the indicator opens nothing there.
  $("audio").addEventListener("click", () => { if (!pluginMode && P.BleepSettingsView && document.getElementById("settings")) P.BleepSettingsView.show("audio"); });

  // The menu bar's commands (app-menu.js); the file commands of the app are the native side's.
  const hasSel = () => selectedNodes();
  P.BleepAppMenu.register({
    "edit.undo": undo, "edit.redo": redo,
    "edit.cut": cut, "edit.copy": copy, "edit.paste": () => paste(),
    "edit.duplicate": () => duplicate(false), "edit.delete": () => deleteSelection(), "edit.selectAll": selectAll,
    "edit.group": () => group(), "edit.ungroup": () => hasSel().filter(isCellLike).forEach((n) => ungroup(n.id)),
    "edit.add": () => { const r = canvas.getBoundingClientRect(); openSearch(r.width / 2, r.height / 2); },
    "view.panels": (anchor) => panelsMenu(anchor), "view.fit": fit, "view.trace": toggleTrace,
    "view.zoomIn": () => navStep("zoom-in"), "view.zoomOut": () => navStep("zoom-out"),
  }, { "edit.undo": () => canUndo, "edit.redo": () => canRedo });  window.addEventListener("resize", () => { renderCables(); positionCablePop(); });

  // Test hooks (tests/board_smoke.cpp drives the page from outside). They hand out the board and place presets, so a release build
  // does not define them: BleepSeal.testHooks is only true when the smoke-test build asked for an unsealed page.
  if (testHooks) {
    window.__board = () => board;
    window.__errors = window.__errors || [];  // what the page reported, for tests/board_smoke.cpp
    window.addEventListener("error", (e) => window.__errors.push(String(e.message)));
    window.addEventListener("unhandledrejection", (e) => window.__errors.push("rejected: " + (e.reason && e.reason.message ? e.reason.message : e.reason)));
    /// The Add menu's "Cell › … › name", for tests/board_smoke.cpp.
    window.__findPreset = (name) => presetList().find((r) => r.name === name);
    window.__addPreset = (name) => {
      const q = presetList().find((r) => r.name === name);
      if (!q) return "no preset " + name;
      addAt({ preset: q.key }, 200 + 60 * (window.__added = (window.__added || 0) + 1), 120);
      return "asked for " + name;
    };
  }

  // ------------------------------------------------------------------ start
  /// Module views (modules/<name>/ui/*.js, served flat): loads the scripts
  /// listed in module-views.json that the page doesn't load yet. Without the
  /// list, tries <type>.js for every module type.
  async function loadModuleViews(list) {
    seal();  // from here on the page runs code that is not the app's own: take the bridge and the privileged globals out of reach
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
    hasLibrary = !!m.library;
    if (m.account && P.BleepAccount) { P.BleepAccount.enabled = true; P.BleepAccount.client = m.standalone ? "Bleep Standalone" : "Bleep plugin"; }
    if (m.library && P.BleepLibraryView) await P.BleepLibraryView.init({ onTypes: refreshTypes, standalone: !!m.standalone, settings: !!m.settings });
    if (m.settings && P.BleepSettingsView) await P.BleepSettingsView.init({ library: !!m.library });
    if (m.library && P.BleepHelpView) await P.BleepHelpView.init();
    pluginMode = !!m.plugin || !!panelOf;
    document.body.classList.toggle("plugin", pluginMode);
    dev = !!m.dev;
    standalone = !!m.standalone;
    {  // the preset browser: whole boards (spec §11.5); in a plugin their port nodes map onto the set's ports
      await P.BleepProjectBrowser.init({
        board: () => board, apply: applyMessage, mapPorts: !standalone, cells: !!m.plugin,
        // The cell presets of the Add menu, for the browser, and placing one as the menu does.
        cellPresets: () => presetList().map((q) => ({ key: q.key, name: q.name, factory: !!q.factory, category: q.category || (q.preset && q.preset.category) || "My Cells",
                                                 description: q.preset && q.preset.description, tags: q.preset && q.preset.tags, plays: q.preset && q.preset.plays })),
        placeCell: (key) => addAtCentre({ preset: key }),
      });
      if (m.plugin) P.BleepProjectBrowser.open();  // an instrument or FX window opens on its presets
    }
    P.BleepAppMenu.init({ nativeMenu: !!m.nativeMenu, version: m.version || "" });
    P.BleepSideMenu.init({ mode: m.plugin ? "plugin" : window.BleepWeb ? "web" : "app", board: () => board });
    await cp.load();
    setPresets((await native("presets")) || []);
    $("hint").textContent = "Tab add · drag jacks to patch · ⌘G group · T trace · F fit" + (dev ? " · UI dev build" : "");
    applyMessage(m);
    {  // Bleep Play opened from a library preset: /play/index.html?preset=author/slug, or from a module's demo: ?demo=Grains: Frozen Cloud
      const q = new URLSearchParams(location.search);
      const shared = q.get("preset"), demo = q.get("demo");
      if (shared && !pluginMode) P.BleepProjectBrowser.loadShared(shared).catch((e) => notice(e.message));
      else if (demo && !pluginMode) P.BleepProjectBrowser.loadDemo(demo).catch((e) => notice(e.message));
    }
    // Fit once the canvas has its size (the window may still be opening).
    let fitted = false;
    new ResizeObserver(() => {
      if (!fitted && board && nodesAt("").length) fitted = fit();
      renderCables();
    }).observe(canvas);
  }
  seal();  // every script of the app is loaded and has what it needs: from here on no script runs that the app did not ship (module views come after)
  start();
})();
