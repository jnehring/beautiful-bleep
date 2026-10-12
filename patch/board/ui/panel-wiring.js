// SPDX-License-Identifier: MIT
// panel-wiring.js — panel controls that are modules (doc/specs/panels.md, "Panels add modules to the board").
//
// Right-click anything that takes a cable → "Create panel control": a Dial, a Button or a Keyboard module goes
// into the panel's own *Panel cell*, and its signal reaches the target through a patch bay: one Patch Bay In in the
// Panel cell per target module, one bundle cable out of the cell, one Patch Bay Out next to the target. The control on
// the panel shows and drives that module. These functions edit a board document (`b`); they do no drawing.
//
//   BleepPanelWiring.kindsFor(types, node, target)        [{kind, label}] the controls that can drive this target
//   BleepPanelWiring.create(b, env, node, target, kind)   adds the control; returns {panel, control} or {error}
//   BleepPanelWiring.remove(b, panelId, controlId)        takes the control, its module and what it leaves behind away
//   BleepPanelWiring.controlFor(b, node, target)          the control that already drives this target, or null
//
//   target: { param: "cutoff" } (a knob or a setting) or { jack: "gate", dir: "in" | "out" }
//   env:    { types, uid(prefix), place(panel, type, extra) → control }
//
// A panel control made here carries `target: {node, param|jack}` and `module: <id>` (what it is wired through); the panel
// remembers its Panel cell (`panelCell`) and, per target module, the bay (`bays[nodeId] = {in, out, jack, path}`).
(function () {
  "use strict";
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const ROW = 90, COLUMN = 600, GAP = 300;

  // ---------------------------------------------------------------- what can drive what
  const paramOf = (types, node, id) => ((types[node.type] || {}).params || []).find((p) => p.id === id);
  const jackOf = (types, node, id, dir) => {
    const t = types[node.type] || {};
    const list = node.type === "cell" || node.type === "voice-cell" ? (dir === "in" ? node.inputs : node.outputs) || [] : dir === "in" ? t.inputs || [] : t.outputs || [];
    const base = node.type === "voice-cell" ? (dir === "in" ? [{ id: "notes", type: "notes", name: "Notes" }] : [{ id: "l", type: "audio" }, { id: "r", type: "audio" }]) : [];
    return base.concat(list).find((j) => j.id === id);
  };

  function kindsFor(types, node, target) {
    if (target.param) {
      const p = paramOf(types, node, target.param);
      if (!p) return [];
      if (!p.modulatable) return [];   // a setting no cable can drive
      if (p.kind === "bool") return [{ kind: "toggle", label: "Toggle" }];
      if (p.kind === "choice") return [{ kind: "select", label: "Dropdown" }, { kind: "dial", label: "Dial (stepped)" }];
      if (p.kind === "int") return [{ kind: "dial", label: "Dial" }, { kind: "slider", label: "Fader" }, { kind: "select", label: "Dropdown" }];
      return [{ kind: "dial", label: "Dial" }, { kind: "slider", label: "Fader" }];
    }
    const j = jackOf(types, node, target.jack, target.dir || "in");
    if (!j) return [];
    if (target.dir === "out") return j.type === "notes" ? [] : [{ kind: "meter", label: "Meter" }];
    if (j.type === "notes") return [{ kind: "keys", label: "Keys" }];
    if (j.type === "gate" || j.type === "trigger") return [{ kind: "button", label: "Button" }, { kind: "toggle", label: "Toggle" }];
    if (j.type === "control" || j.type === "pitch") return [{ kind: "dial", label: "Dial" }, { kind: "slider", label: "Fader" }];
    return [];
  }

  // ---------------------------------------------------------------- the board document
  const node = (b, id) => b.nodes.find((n) => n.id === id);
  const panelOf = (b, id) => (b.panels || []).find((q) => q.id === id);
  const kids = (b, parent) => b.nodes.filter((n) => (n.parent || "") === (parent || ""));

  /// The cell a panel for `n` belongs to: the nearest plain cell around it, else the board ("").
  function scopeOf(b, n) {
    for (let p = node(b, n.parent); p; p = node(b, p.parent)) if (p.type === "cell") return p.id;
    return "";
  }
  /// The cells between the scope and the node, outermost first (Voice Cells and cells inside them).
  function pathTo(b, n, scope) {
    const chain = [];
    for (let p = node(b, n.parent); p && p.id !== scope; p = node(b, p.parent)) chain.unshift(p.id);
    return chain;
  }
  /// A free place below everything at a level.
  function freeBelow(b, parent, x = 40) {
    const at = kids(b, parent);
    return { x, y: at.length ? Math.max(...at.map((n) => n.y)) + 200 : 40 };
  }

  function ensurePanel(b, env, scope) {
    let q = (b.panels || []).find((p) => !p.for && (p.cell || "") === scope);
    if (q) return q;
    const cellNode = scope ? node(b, scope) : null;
    q = { id: env.uid("p"), name: cellNode ? cellNode.name : "Panel", ...(scope ? { cell: scope } : {}), cols: 40, rows: 24,
          controls: [{ id: "c1", type: "label", at: [1, 0], size: [24, 2], text: cellNode ? cellNode.name : "Panel", style: "title" }] };
    (b.panels || (b.panels = [])).push(q);
    return q;
  }

  /// The Panel cell of a panel: its modules and bays. Made on first use, below the cell's other nodes.
  function ensurePanelCell(b, env, q, scope) {
    let cell = q.panelCell && node(b, q.panelCell);
    if (cell) return cell;
    const at = freeBelow(b, scope);
    cell = { id: env.uid("c"), type: "cell", name: "Panel", x: at.x, y: at.y, parent: scope, params: {}, inputs: [], outputs: [] };
    b.nodes.push(cell,
      { id: env.uid("ci"), type: "cell-in", name: "Cell In", x: 40, y: 40, parent: cell.id, params: {} },
      { id: env.uid("co"), type: "cell-out", name: "Cell Out", x: 1000, y: 40, parent: cell.id, params: {} });
    q.panelCell = cell.id;
    return cell;
  }
  const boundary = (b, cellId, type) => b.nodes.find((n) => n.type === type && n.parent === cellId);

  const newNode = (env, type, name, parent, x, y, params = {}) => {
    const t = env.types[type], n = { id: env.uid("n"), type, name, x, y, parent, params: {} };
    for (const p of t.params) n.params[p.id] = p.id in params ? params[p.id] : p.default;
    return n;
  };
  const cableOf = (env, from, fj, to, tj, amount = 1) => ({ id: env.uid("k"), from: { node: from, jack: fj }, to: { node: to, jack: tj }, amount });
  /// A knob's range is linear for these Dial knobs: units → 0…1.
  const norm = (def, v) => (def.max > def.min ? (v - def.min) / (def.max - def.min) : 0);

  /// The Patch Bay In (Panel cell), the bundle out of the cell, any Voice Cells in between, and the Patch Bay Out beside the target.
  function ensureBay(b, env, q, panelCell, target, scope) {
    q.bays = q.bays || {};
    if (q.bays[target.id] && node(b, q.bays[target.id].in) && node(b, q.bays[target.id].out)) return q.bays[target.id];
    const column = Object.keys(q.bays).length;
    const jack = "b_" + target.id;
    const bayIn = newNode(env, "patchbay-in", target.name, panelCell.id, 340 + column * COLUMN, 40);
    const bayOut = newNode(env, "patchbay-out", target.name, target.parent, Math.max(20, target.x - GAP), target.y);
    b.nodes.push(bayIn, bayOut);
    panelCell.outputs.push({ id: jack, name: target.name, type: "patchbay" });
    const co = boundary(b, panelCell.id, "cell-out");
    co.x = Math.max(co.x, 340 + column * COLUMN + 400);
    b.cables.push(cableOf(env, bayIn.id, "bundle", co.id, jack));
    // The bundle's way: the Panel cell's output, into each cell around the target (a shared input of type patchbay), and out
    // of that cell's Cell In to the next, to the bay beside the target.
    const chain = pathTo(b, target, scope);
    let from = { node: panelCell.id, jack };
    for (const cellId of chain) {
      const c = node(b, cellId);
      c.inputs = c.inputs || [];
      c.inputs.push({ id: jack, name: target.name, type: "patchbay" });
      b.cables.push(cableOf(env, from.node, from.jack, c.id, jack));
      const ci = boundary(b, c.id, "cell-in");
      from = { node: ci.id, jack };
    }
    b.cables.push(cableOf(env, from.node, from.jack, bayOut.id, "bundle"));
    return (q.bays[target.id] = { in: bayIn.id, out: bayOut.id, jack, path: chain });
  }
  const nextChannel = (b, bayInId) => {
    const used = b.cables.filter((c) => c.to.node === bayInId).map((c) => Number(c.to.jack.slice(1)));
    return "c" + (Math.max(0, ...used) + 1);
  };

  // ---------------------------------------------------------------- create
  function controlFor(b, n, target) {
    for (const q of b.panels || [])
      for (const c of q.controls)
        if (c.target && c.target.node === n.id && (c.target.param || "") === (target.param || "") && (c.target.jack || "") === (target.jack || "")) return { panel: q, control: c };
    return null;
  }

  /// The modules of a Panel cell (the controls' own modules, the bays) are not things to make panel controls for.
  const belongsToPanel = (b, n) => n.type === "patchbay-in" || n.type === "patchbay-out" ||
    (b.panels || []).some((q) => q.panelCell && (n.id === q.panelCell || n.parent === q.panelCell));

  function create(b, env, n, target, kind) {
    const types = env.types;
    if (belongsToPanel(b, n)) return { error: "that module is part of the Panel cell" };
    if (!kindsFor(types, n, target).some((k) => k.kind === kind)) return { error: "no such control for this" };
    if (controlFor(b, n, target)) return { error: "it already has a panel control" };
    const scope = scopeOf(b, n);
    const q = ensurePanel(b, env, scope);
    const panelCell = ensurePanelCell(b, env, q, scope);
    const def = target.param ? paramOf(types, n, target.param) : null;
    const label = target.param ? def.name : (jackOf(types, n, target.jack, target.dir || "in") || {}).name || target.jack;   // the target's own title
    const old = def ? (n.params && target.param in n.params ? n.params[target.param] : def.default) : 0.5;   // the knob's value, normalised
    const steps = def && def.kind !== "float" ? (def.kind === "bool" ? 2 : def.kind === "choice" ? def.choices.length : def.steps || 0) : 0;
    // The Dial snaps to at most 24 steps; a longer list (filter types) stays continuous: the setting rounds to the nearest choice.
    const dialSteps = steps > 24 ? 0 : steps;
    const dialDef = (id) => types.dial.params.find((p) => p.id === id);

    let mod, ctl = { label, target: { node: n.id, ...(target.param ? { param: target.param } : { jack: target.jack }) } };
    const modAt = (bay, row) => ({ x: bay ? bay.x - GAP : 40, y: bay ? bay.y + row * ROW : 40 });
    // Keys and meters are not signals a bay can carry: a notes jack takes the Keyboard through the Panel cell's own output.
    if (kind === "keys") {
      if ((n.parent || "") !== scope) return { error: "Keys can go on a note input of the panel's own cell" };
      mod = newNode(env, "keyboard", "Keys", panelCell.id, 40, 40 + 3 * ROW);
      const jack = "n_" + n.id;
      panelCell.outputs.push({ id: jack, name: "Notes", type: "notes" });
      const co = boundary(b, panelCell.id, "cell-out");
      b.nodes.push(mod);
      b.cables.push(cableOf(env, mod.id, "notes", co.id, jack), cableOf(env, panelCell.id, jack, n.id, target.jack));
      ctl = { ...ctl, type: "keys", octaves: 3, from: "C3", wire: [{ keyboard: mod.id }], module: mod.id, jack };
    } else if (kind === "meter") {
      if ((n.parent || "") !== scope) return { error: "a meter needs a module of the panel's own cell" };
      mod = newNode(env, "level-meter", `${n.name} meter`, panelCell.id, 40, 40 + 4 * ROW);
      const jackIn = "m_" + n.id;
      panelCell.inputs.push({ id: jackIn, name: label, type: "audio" });
      const ci = boundary(b, panelCell.id, "cell-in");
      b.nodes.push(mod);
      b.cables.push(cableOf(env, n.id, target.jack, panelCell.id, jackIn), cableOf(env, ci.id, jackIn, mod.id, "l"), cableOf(env, ci.id, jackIn, mod.id, "r"));
      ctl = { ...ctl, type: "meter", source: { out: [`${mod.id}.l`, `${mod.id}.r`] }, module: mod.id, jack: jackIn };
    } else {
      const bay = ensureBay(b, env, q, panelCell, n, scope);
      const bayIn = node(b, bay.in), bayOut = node(b, bay.out);
      const channel = nextChannel(b, bayIn.id);
      const row = Number(channel.slice(1)) - 1;
      const at = modAt(bayIn, row);
      if (kind === "toggle" || kind === "button") {
        const on = !!def && old > 0.5;
        mod = newNode(env, "button", label, panelCell.id, at.x, at.y, { mode: kind === "toggle" ? 1 : 0 });
        if (kind === "toggle") mod.data = { on };
        ctl = { ...ctl, type: "button", wire: [{ press: mod.id }], module: mod.id, ...(kind === "toggle" ? { toggle: true } : {}) };
        b.nodes.push(mod);
        b.cables.push(cableOf(env, mod.id, kind === "toggle" ? "toggle" : "gate", bayIn.id, channel));
      } else {
        const params = { value: old, min: norm(dialDef("min"), 0), max: norm(dialDef("max"), 1), smooth: 0, steps: norm(dialDef("steps"), dialSteps) };
        mod = newNode(env, "dial", label, panelCell.id, at.x, at.y, params);
        ctl = { ...ctl, type: kind === "select" ? "select" : kind === "slider" ? "slider" : "dial", wire: [{ param: `${mod.id}.value` }], module: mod.id };
        if (kind === "select") ctl.options = def.kind === "choice" ? def.choices.slice() : Array.from({ length: steps || 3 }, (_, i) => String(i));
        b.nodes.push(mod);
        b.cables.push(cableOf(env, mod.id, "out", bayIn.id, channel));
      }
      // The bay's output carries it to the target; a knob is parked at 0, so the effective value is the module's.
      b.cables.push(cableOf(env, bayOut.id, channel, n.id, target.param || target.jack));
      if (target.param) n.params[target.param] = 0;
      ctl.channel = channel;
    }
    const placed = env.place(q, ctl.type, ctl);
    return { panel: q, control: placed, module: mod };
  }

  // ---------------------------------------------------------------- remove
  function remove(b, panelId, controlId) {
    const q = panelOf(b, panelId);
    const c = q && q.controls.find((x) => x.id === controlId);
    if (!c) return false;
    q.controls = q.controls.filter((x) => x.id !== controlId);
    const mod = c.module && node(b, c.module);
    const target = c.target && node(b, c.target.node);
    if (mod) {
      if (c.channel && q.bays && q.bays[c.target.node]) {
        const bay = q.bays[c.target.node];
        // The knob goes back to what the control was set to.
        if (target && c.target.param) {
          const set = mod.type === "dial" ? mod.params.value : mod.data && mod.data.on ? 1 : 0;
          target.params[c.target.param] = set;
        }
        b.cables = b.cables.filter((k) => !(k.from.node === mod.id) && !(k.from.node === bay.out && k.from.jack === c.channel));
        b.cables = b.cables.filter((k) => !(k.to.node === bay.in && k.to.jack === c.channel));
        if (!b.cables.some((k) => k.to.node === bay.in)) dropBay(b, q, c.target.node);   // that was its last channel
      }
      b.nodes = b.nodes.filter((n) => n.id !== mod.id);
      b.cables = b.cables.filter((k) => k.from.node !== mod.id && k.to.node !== mod.id);
    }
    if (c.type === "keys" || c.type === "meter") dropKeysOrMeter(b, q, c);
    // Nothing left in the Panel cell: it goes too.
    const cell = q.panelCell && node(b, q.panelCell);
    if (cell && !b.nodes.some((n) => n.parent === cell.id && n.type !== "cell-in" && n.type !== "cell-out")) {
      b.nodes = b.nodes.filter((n) => n.id !== cell.id && n.parent !== cell.id);
      b.cables = b.cables.filter((k) => k.from.node !== cell.id && k.to.node !== cell.id);
      delete q.panelCell;
      delete q.bays;
    }
    return true;
  }

  /// A target module has no controls left: its bays, the bundle's way and the jacks it used go.
  function dropBay(b, q, targetId) {
    const bay = q.bays[targetId];
    if (!bay) return;
    const panelCell = node(b, q.panelCell);
    const drop = new Set([bay.in, bay.out]);
    b.nodes = b.nodes.filter((n) => !drop.has(n.id));
    b.cables = b.cables.filter((k) => !drop.has(k.from.node) && !drop.has(k.to.node));
    const gone = (cells) => { for (const id of cells) { const c = node(b, id); if (c && c.inputs) c.inputs = c.inputs.filter((j) => j.id !== bay.jack); } };
    if (panelCell) panelCell.outputs = panelCell.outputs.filter((j) => j.id !== bay.jack);
    gone(bay.path || []);
    // cables carrying the bundle on the way: into those cells' jack and out of their Cell Ins
    b.cables = b.cables.filter((k) => !(k.to.jack === bay.jack || k.from.jack === bay.jack));
    delete q.bays[targetId];
  }
  function dropKeysOrMeter(b, q, c) {
    const jack = c.jack;   // the Panel cell's jack that carried the notes (or the signal to the meter)
    if (!jack) return;
    const cell = q.panelCell && node(b, q.panelCell);
    if (cell) { cell.outputs = cell.outputs.filter((j) => j.id !== jack); cell.inputs = (cell.inputs || []).filter((j) => j.id !== jack); }
    b.cables = b.cables.filter((k) => k.to.jack !== jack && k.from.jack !== jack);
  }

  const api = { kindsFor, create, remove, controlFor, scopeOf, belongsToPanel, _clone: clone };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.BleepPanelWiring = api;
})();
