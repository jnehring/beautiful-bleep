// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
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
  let spaceDown = false;       // the space bar is held: a drag on the canvas pans
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

  // ---------------------------------------------------------------- render (board-render.js)
  const renderApi = P.BoardRender.create({
    get board() { return board; }, get path() { return path; }, get hoverCable() { return hoverCable; }, set hoverCable(v) { hoverCable = v; }, get selCable() { return selCable; }, set selCable(v) { selCable = v; }, get trace() { return trace; }, get types() { return types; },
    $, SVGNS, applyCam, cablesEl, cam, canvas, centreOn, clearCableSel, edit, el, enterCell, expanded, gesture,
    inputsOf, isBoundary, isCableSel, isCellLike, isGhost, isPort, isShown, jackName, leaveTo, level, modParams,
    nodeById, nodesAt, nodesEl, outType, outputsOf, paramValue, portInfo, scopes, sel, selMore, shownName, toCanvas,
    toWorld, typeOf,
    cableDragging: (...a) => cableDragging(...a), cellPanels: (...a) => cellPanels(...a), goToNode: (...a) => goToNode(...a), hasPanel: (...a) => hasPanel(...a), hideMeter: (...a) => hideMeter(...a), hidePopovers: (...a) => hidePopovers(...a), knobMenuItems: (...a) => knobMenuItems(...a), onNodePointerDown: (...a) => onNodePointerDown(...a), panelById: (...a) => panelById(...a), panelList: (...a) => panelList(...a), removeCable: (...a) => removeCable(...a), setPowerButton: (...a) => setPowerButton(...a), showCableMenu: (...a) => showCableMenu(...a), showCellHelp: (...a) => showCellHelp(...a), showMenu: (...a) => showMenu(...a), showMeter: (...a) => showMeter(...a), showNodeMenu: (...a) => showNodeMenu(...a), startCableDrag: (...a) => startCableDrag(...a), startRename: (...a) => startRename(...a), startSourceDrag: (...a) => startSourceDrag(...a),
    views, kShownOutputs,
  });
  const { render, signalColour, renderNodes, groupOpen, ownerOf, groupKey, levelKey, revealPanelModule, jackRow,
          renderSelection, jackPos, cablePath, pulses, pulseLevel, setHoverCable, renderCables, showCablePop,
          positionCablePop } = renderApi;

  // ------------------------------------------------------- cable tools (board-cabletools.js)
  const cableTools = P.BoardCableTools.create({
    get board() { return board; }, get live() { return live; }, get types() { return types; },
    $, canvas, clearCableSel, clone, edit, el, jackPos, level, nodeById, outType, sel, selectedCableIds, signalColour, toCanvas, uid,
    showMenu: (...a) => showMenu(...a),
  });
  const { meterShown, showMeter, hideMeter, feedMeter, removeCable, removeCables, showCableMenu, meterNode } = cableTools;

  // ---------------------------------------------------------- cable dragging (board-cabledrag.js)
  const cableDrag = P.BoardCableDrag.create({
    get board() { return board; }, $, el, uid, canvas, cablesEl, nodesEl, SVGNS, views, nodeById, typeOf, inputsOf, outputsOf, outType, jackName, compatible,
    isStructural, modParams, signalColour, setHoverCable, jackPos, cablePath, toWorld, jackRow, edit, render, openSearch: (...a) => openSearch(...a),
    openView: (...a) => openView(...a), closeView: (...a) => closeView(...a), front: (...a) => front(...a),
    showMenu: (...a) => showMenu(...a),
  });
  const { startCableDrag, startSourceDrag, connect, isDragging: cableDragging } = cableDrag;

  // ------------------------------------------------------------- the canvas (board-canvas.js)
  const canvasApi = P.BoardCanvas.create({
    get board() { return board; }, get pointer() { return pointer; }, set pointer(v) { pointer = v; }, get pointerInside() { return pointerInside; }, set pointerInside(v) { pointerInside = v; }, get selCable() { return selCable; }, set selCable(v) { selCable = v; }, get spaceDown() { return spaceDown; },
    $, NODE_W, applyCam, cablesEl, cablesInto, cam, canvas, clearCableSel, clone, commit, edit, fit, insideVoiceCell,
    isBoundary, isCellLike, isPort, isStructural, level, nodeById, nodesAt, nodesEl, ownerOf, positionCablePop,
    renderCables, renderSelection, sel, selMore, selectedCableIds, showCablePop, startCableDrag, startSourceDrag,
    toWorld,
    addAt: (...a) => addAt(...a), addMenu: (...a) => addMenu(...a), canEnterVoice: (...a) => canEnterVoice(...a), closeUnpinnedViews: (...a) => closeUnpinnedViews(...a), hidePopovers: (...a) => hidePopovers(...a), moveIntoCell: (...a) => moveIntoCell(...a), openSearch: (...a) => openSearch(...a), paste: (...a) => paste(...a), selectAll: (...a) => selectAll(...a), showMenu: (...a) => showMenu(...a), toggleView: (...a) => toggleView(...a),
  });
  const { onNodePointerDown, navStep } = canvasApi;

  // ----------------------------------------------------------------- search (board-search.js)
  const search = P.BoardSearch.create({
    $, el, canvas, get board() { return board; }, get typeList() { return typeList; }, presets: () => presetList(), compatible,
    offered: (t) => offered(t), toWorld: (x, y) => toWorld(x, y), addAt: (...a) => addAt(...a),
  });
  const { open: openSearch, close: closeSearch, isOpen: searchOpen } = search;

  // ---------------------------------------------------------- adding things, menus and renaming (board-menus.js)
  const menusApi = P.BoardMenus.create({
    get board() { return board; }, get hasLibrary() { return hasLibrary; }, get ports() { return ports; }, get standalone() { return standalone; }, get typeList() { return typeList; }, get types() { return types; },
    $, APP_PORTS, NODE_W, canvas, closeSearch, compatible, connect, credits, descendants, edit, el, enterCell,
    insideVoiceCell, isBoundary, isCellLike, isFixedBoundary, isFixedPort, isPort, isStructural, level, levelKey,
    nodeById, nodesAt, nodesEl, notice, render, searchOpen, sel, toWorld, toggleTrace, uid, views,
    buildPanel: (...a) => buildPanel(...a), canBypass: (...a) => canBypass(...a), canDuplicate: (...a) => canDuplicate(...a), canGroup: (...a) => canGroup(...a), canGroupVoice: (...a) => canGroupVoice(...a), copy: (...a) => copy(...a), cut: (...a) => cut(...a), deleteSelection: (...a) => deleteSelection(...a), duplicate: (...a) => duplicate(...a), group: (...a) => group(...a), insertPreset: (...a) => insertPreset(...a), newPanel: (...a) => newPanel(...a), openPanel: (...a) => openPanel(...a), panelOpen: (...a) => panelOpen(...a), panelsOfCell: (...a) => panelsOfCell(...a), paste: (...a) => paste(...a), presetCategories: (...a) => presetCategories(...a), presetList: (...a) => presetList(...a), presetOrder: (...a) => presetOrder(...a), removeFromCell: (...a) => removeFromCell(...a), savePreset: (...a) => savePreset(...a), setPresets: (...a) => setPresets(...a), toggleBypass: (...a) => toggleBypass(...a), toggleMute: (...a) => toggleMute(...a), togglePanel: (...a) => togglePanel(...a), toggleView: (...a) => toggleView(...a), ungroup: (...a) => ungroup(...a),
    controllerMenuItems: (...a) => controllerMenuItems(...a),
  });
  const { addAtCentre, addAt, addControlModule, offered, addMenu, showMenu, closeSubmenus, showCellHelp,
          hidePopovers, showNodeMenu, startRename } = menusApi;

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
    panelList: () => panelList(), panelsWithLoaded: (list) => panelsWithLoaded(list), credits, notice: (text) => notice(text),
  });
  const { setPresets, categories: presetCategories, save: savePreset, insert: insertPreset, addPanels, list: presetList, order: presetOrder } = cp;

  /// Bleep Play: a factory cell preset on its own, wired as the plugins wire it (play-wrap.js). An instrument takes MIDI In; an effect takes a
  /// self-playing instrument preset as its source (`sourceName`), or the Audio In port, fed with the microphone or a file, when `sourceName` is
  /// "@input" (`input` says which, for the source bar). Replaces the board; throws what Play cannot do.
  async function playCell(name, role, sourceName, input) {
    const W = window.BleepPlayWrap;
    const everything = presetList(), factory = everything.filter((r) => r.factory);
    const q = factory.find((r) => r.name === name) || everything.find((r) => r.name === name);   // the user's own presets too
    if (!q) throw new Error(`There is no preset called “${name}”.`);
    const plan = W.plan(q.preset, role);
    if (!plan.ok) throw new Error(plan.message);
    const b = { format: 1, id: uid("b"), nodes: [], cables: [], panels: [] };
    // The ports the board has stay (they cannot be deleted, spec §6): the new board reuses them, so no port is added twice or comes back.
    const ports = (board.nodes || []).filter((n) => n.port && !n.parent).map(clone);
    const find = (type) => ports.find((n) => n.type === type);
    const keys = find("midi-in"), speakers = find("audio-out");
    if (!speakers || (role === "instrument" && !keys)) throw new Error(`This board has no ${!speakers ? "Audio Out" : "MIDI In"} port to play through.`);
    ports.forEach((n, i) => { n.x = n === keys ? 20 : n === speakers ? 900 : 20; n.y = n === keys || n === speakers ? 40 : 300 + 110 * i; });
    b.nodes.push(...ports);
    const cable = (from, fj, to, tj) => b.cables.push({ id: uid("k"), from: { node: from, jack: fj }, to: { node: to, jack: tj }, amount: 1 });
    let rootId, current = "";
    if (role === "instrument") {
      rootId = insertPreset(b, q.preset, "", 340, 40, (q.factory ? credits().factory(q.name) : null));
      for (const c of plan.midi) cable(keys.id, c.from, rootId, c.to);
      if (plan.drums) {   // a drum map: Drum Notes turns the General MIDI drum notes into one trigger per drum
        const dn = { id: uid("n"), type: "drum-notes", name: "Drum Notes", x: 180, y: 40, parent: "", muted: false, params: {} };
        b.nodes.push(dn);
        cable(keys.id, "notes", dn.id, "notes");
        for (const d of plan.drums) cable(dn.id, d.from, rootId, d.to);
      }
    } else {
      const sources = W.sources(factory);
      let sid, sout;
      if (sourceName === "@input") {   // the microphone or a file, through the Audio In port
        const audioIn = find("audio-in");
        if (!audioIn) throw new Error("This board has no Audio In port.");
        audioIn.x = 20; audioIn.y = 40;
        sid = audioIn.id; sout = ["l", "r"];
        current = input === "file" ? "file" : "mic";
      } else {
        const s = sources.find((x) => x.name === sourceName) || sources[0];
        if (!s) throw new Error("There is no source to play through the effect.");
        sout = W.plan(s.preset, "instrument").out;
        sid = insertPreset(b, s.preset, "", 20, 40, credits().factory(s.name));
        current = "loop:" + s.name;
      }
      rootId = insertPreset(b, q.preset, "", 460, 40, (q.factory ? credits().factory(q.name) : null));
      plan.in.forEach((j, i) => cable(sid, sout[Math.min(i, sout.length - 1)], rootId, j));
    }
    plan.out.forEach((j, i) => cable(rootId, j, speakers.id, i ? "r" : "l"));
    if (plan.out.length === 1) cable(rootId, plan.out[0], speakers.id, "r");
    applyMessage(await native("loadPatch", b, 0, q.name));
    if (role === "instrument") {
      window.BleepPlayKeys.show(q.name);
      window.BleepPlaySource.hide();
      const octave = plan.octave; // a drum map starts the keys at the General MIDI drum notes, everything else where it always did
      window.BleepPlayKeys.setOctave(octave === undefined ? 3 : octave);
      if (window.BleepWeb && window.BleepWeb.setOctave) window.BleepWeb.setOctave(octave === undefined ? 4 : octave);
    }
    else {
      window.BleepPlayKeys.hide();
      const choose = async (c) => {
        const web = window.BleepWeb;
        try {
          if (c.kind === "loop") {
            if (web && web.input) web.input.stop();   // the microphone is let go
            await playCell(name, "effect", c.name);
            return;
          }
          if (!web || !web.input) throw new Error("Audio input works in Bleep Play, in the browser.");
          if (c.kind === "mic") await web.input.useMic(); else await web.input.useFile(c.file);
          await playCell(name, "effect", "@input", c.kind);
        } catch (e) {
          notice(e.message);
          window.BleepPlaySource.show({ name: q.name, loops: W.sources(factory).map((x) => x.name), current, choose });   // back to what plays
        }
      };
      window.BleepPlaySource.show({ name: q.name, loops: W.sources(factory).map((x) => x.name), current, choose });
    }
    if (plan.notes.length) notice(plan.notes.join(" "));
    fit();
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

  // ------------------------------------------------------- floating views (board-views.js)
  const viewsApi = P.BoardViews.create({
    get board() { return board; },
    $, cablesInto, canBypass, canvas, clone, drivesJacks, edit, el, gesture, isPort, isStructural, jackName,
    nodeById, nodesEl, removeCable, renderCables, renderNodes, savePreset,
    setPowerButton, showMenu, toggleBypass, typeOf, views, hidePopovers,
    knobMenuItems: (...a) => knobMenuItems(...a), panelMenuFor: (...a) => panelMenuFor(...a),
  });
  const { placeWin, toggleView, makeApi, openView, front, closeView, pinTitle, closeUnpinnedViews, closeTopView, watch } = viewsApi;

  // ----------------------------------------------------------- front panels (board-panels.js)
  const panelsApi = P.BoardPanels.create({
    get board() { return board; }, get path() { return path; }, set path(v) { path = v; }, get pluginMode() { return pluginMode; }, get trace() { return trace; }, set trace(v) { trace = v; }, get types() { return types; },
    $, addControlModule, canvas, centreOn, clone, edit, closeUnpinnedViews, closeView, descendants, el, front, gesture,
    inType, inputsOf, isBoundary, isCellLike, isPort, isStructural, makeApi, nodeById, nodesAt, notice, outputsOf,
    pathTo, pinTitle, placeWin, render, revealPanelModule, sel, selectedNodes, showMenu, typeOf, uid, views, watch, hidePopovers,
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
    "view.keyboard": () => { const k = window.BleepPlayKeys; if (k.visible()) k.hide(); else k.show("Screen keyboard"); },
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
    // Bleep Play with a local development build (local-modules/, build-web.sh --modules-only): its view scripts go first, so they win
    // over the page's own copies (the first registration of a type stays). Only while unsigned modules are allowed, as for the modules.
    try {
      if (window.BleepLibrary && (await BleepLibrary.localIndex())) {
        const r = await fetch("local-modules/views.json", { cache: "no-store" });
        const mine = r.ok ? await r.json() : [];
        await Promise.all((Array.isArray(mine) ? mine : []).filter((n) => !loaded.has(n)).map((n) => new Promise((done) => {
          const s = document.createElement("script");
          s.src = "local-modules/views/" + encodeURIComponent(n);
          s.onload = s.onerror = () => done();
          document.head.appendChild(s);
          loaded.add(n);
        })));
      }
    } catch (e) { /* no local build: the page's own views */ }
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
        // A cell preset on its own, wired as an instrument or an effect (what Bleep Play's ?play= does); replaces the board.
        playCell: (name, role) => playCell(name, role).catch((e) => notice(e.message)),
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
      else if (q.get("play") && !pluginMode)   // an instrument or effect preset on its own: /play/index.html?play=Slate Stabs&as=instrument
        playCell(q.get("play"), q.get("as") === "effect" ? "effect" : "instrument", q.get("source") || "").catch((e) => notice(e.message));
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
