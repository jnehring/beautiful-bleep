// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// panel-wiring.js — "Add to panel" (doc/specs/panels.md): put a knob, or a controller module, on a panel.
//
// Right-click a knob → Add to panel ▸ a panel, or a new one: a control wired straight to the knob. Right-click a controller
// module (Dial, Wheel, XY Pad, Button, Keyboard, Level Meter) → the same: a control that draws and drives the module. Every
// panel of the board is offered. These functions edit a board
// document (`b`); they do no drawing.
//
//   BleepPanelWiring.panelsFor(b)                          the panels a control can go on: all of them
//   BleepPanelWiring.addKnob(b, env, node, paramId, where) a control wired to the knob; `where` is a panel id or "new"
//   BleepPanelWiring.knobControls(b, node, paramId)        [{panel, control}] the controls wired to this knob
//   BleepPanelWiring.addModule(b, env, node, where)        a control for a controller module on the board
//   BleepPanelWiring.moduleControls(b, node)               [{panel, control}] the controls that show this module
//   BleepPanelWiring.addView(b, env, node, part, where)    the module's view, or one part of it (a display, a section of knobs, the
//                                                          buttons: {id, name, kind, knobs} from BleepView.partsOf), as a Module view control
//   BleepPanelWiring.viewControls(b, node)                 [{panel, control, part}] the Module view controls that show this node
//   BleepPanelWiring.remove(b, panelId, controlId)         takes a control away (older panels: with the module they made)
//
//   env: { types, typeOf(node) (optional: the node's own description), uid(prefix), place(panel, type, extra) → control, knobControl(node, param) → the control for a knob,
//          hasView(node) → bool (structural nodes have none) }
//
// Panels made before this carried `target: {node, param|jack}` and `module` (a module in a Panel cell, `panelCell`, `bays`).
// They keep working; only `remove` still knows about them.
(function () {
  "use strict";
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // ---------------------------------------------------------------- the board document
  const node = (b, id) => b.nodes.find((n) => n.id === id);
  const panelOf = (b, id) => (b.panels || []).find((q) => q.id === id);

  /// The cell a panel for `n` belongs to: the nearest plain cell around it, else the board ("").
  function scopeOf(b, n) {
    for (let p = node(b, n.parent); p; p = node(b, p.parent)) if (p.type === "cell") return p.id;
    return "";
  }
  /// Every panel of the board that shows modules (not the module panels): wires name nodes by id, so any of them can hold a control for any node.
  const panelsFor = (b) => (b.panels || []).filter((q) => !q.for);
  /// A new empty panel for a scope, named after its cell and numbered when the name is taken.
  function newPanel(b, env, scope) {
    const cellNode = scope ? node(b, scope) : null;
    const base = cellNode ? cellNode.name : "Panel";
    let name = base;
    for (let i = 2; (b.panels || []).some((q) => q.name === name); i++) name = `${base} ${i}`;
    const q = { id: env.uid("p"), name, ...(scope ? { cell: scope } : {}), cols: 40, rows: 24,
                controls: [{ id: "c1", type: "label", at: [1, 0], size: [24, 2], text: name, style: "title" }] };
    (b.panels || (b.panels = [])).push(q);
    return q;
  }
  /// The panel `where` names ("new": a fresh one for the node's cell), or an error.
  function target(b, env, n, where) {
    if (where === "new") return { panel: newPanel(b, env, scopeOf(b, n)) };
    const q = panelsFor(b).find((x) => x.id === where);
    return q ? { panel: q } : { error: "that panel cannot show this" };
  }

  /// The modules of a Panel cell (made by older panels) are not things to put on a panel.
  const belongsToPanel = (b, n) => n.type === "patchbay-in" || n.type === "patchbay-out" ||
    (b.panels || []).some((q) => q.panelCell && (n.id === q.panelCell || n.parent === q.panelCell));

  // ---------------------------------------------------------------- a controller already on the board
  // The controllers a panel can show: right-click one on the board → "Add to panel". The control draws and drives the module
  // itself; there is no target and no Panel cell. You cable the module's outputs on the board like any other module.
  const SHOWN_AS = {
    dial: (m) => ({ type: "dial", wire: [{ param: `${m.id}.value` }] }),
    wheel: (m) => ({ type: "wheel", spring: true, wire: [{ param: `${m.id}.value` }] }),
    button: (m) => ({ type: "button", wire: [{ press: m.id }], ...((m.params || {}).mode === 1 ? { toggle: true } : {}) }),
    "xy-pad": (m) => ({ type: "xy", size: [12, 10], wire: [{ param: `${m.id}.x`, axis: "x" }, { param: `${m.id}.y`, axis: "y" }] }),
    keyboard: (m) => ({ type: "keys", octaves: 3, from: "C3", wire: [{ keyboard: m.id }] }),
    "level-meter": (m) => ({ type: "meter", source: { out: [`${m.id}.l`, `${m.id}.r`] } }),
  };
  const canAddModule = (b, n) => !!SHOWN_AS[n.type] && !belongsToPanel(b, n);

  /// The controls that show this module: made by "Add to panel" (no target), on any panel.
  function moduleControls(b, n) {
    const out = [];
    for (const q of b.panels || []) for (const c of q.controls) if (c.module === n.id && !c.target) out.push({ panel: q, control: c });
    return out;
  }

  function addModule(b, env, n, where) {
    if (!canAddModule(b, n)) return { error: "this module cannot go on a panel" };
    const t = target(b, env, n, where);
    if (t.error) return t;
    if (t.panel.controls.some((c) => c.module === n.id && !c.target)) return { error: "it is on that panel already" };
    const ctl = { label: n.name, ...SHOWN_AS[n.type](n), module: n.id };
    return { panel: t.panel, control: env.place(t.panel, ctl.type, ctl), module: n };
  }

  // ---------------------------------------------------------------- a module's view, or a part of it
  // Any module with a view can go on a panel whole, or as one of its parts: the display of Grains, the curve of Function, the
  // drawing of an ADSR, a section of knobs, the button bar. Both are Module view controls ({type: "view", node, part?}); the
  // panel shows the module's real view (or the part alone), so it is as live there as in the module's window. Nothing is
  // added to the board.
  /// A node's type description: the node's own where it has one (a Code node), else its type's.
  const typeFor = (env, n) => (env.typeOf ? env.typeOf(n) : env.types[n.type]);
  const canAddView = (b, env, n) => !belongsToPanel(b, n) && !!env.types[n.type] && (!env.hasView || env.hasView(n));

  /// The Module view controls that show this node: [{panel, control, part: part id or null}].
  function viewControls(b, n) {
    const out = [];
    for (const q of b.panels || []) for (const c of q.controls) if (c.type === "view" && c.node === n.id) out.push({ panel: q, control: c, part: c.part || null });
    return out;
  }

  /// A box for a part that fits what is in it (grid units; one unit is 20 px).
  function partSize(part) {
    if (!part) return [24, 14];
    if (part.size) return part.size;
    if (part.kind === "buttons") return [16, 3];
    if (part.kind === "controls") { const n = Math.max(1, part.knobs || 1); return [Math.max(8, 4 * Math.min(n, 6) + 2), 8 * Math.ceil(n / 6)]; }
    return [24, 10];
  }

  function addView(b, env, n, part, where) {
    if (!canAddView(b, env, n)) return { error: "this module has no view to show" };
    const t = target(b, env, n, where);
    if (t.error) return t;
    const id = part ? part.id : null;
    if (t.panel.controls.some((c) => c.type === "view" && c.node === n.id && (c.part || null) === id)) return { error: "it is on that panel already" };
    const ctl = { label: part ? `${n.name} · ${part.name}` : n.name, node: n.id, ...(part ? { part: part.id } : {}), size: partSize(part) };
    return { panel: t.panel, control: env.place(t.panel, "view", ctl), module: n };
  }

  // ---------------------------------------------------------------- a knob
  const knobWire = (n, paramId) => `${n.id}.${paramId}`;
  const knobControls = (b, n, paramId) => {
    const out = [];
    for (const q of b.panels || []) for (const c of q.controls) if ((c.wire || [])[0] && c.wire[0].param === knobWire(n, paramId) && !c.module) out.push({ panel: q, control: c });
    return out;
  };

  /// A control wired straight to the knob: it is the knob, both move together.
  function addKnob(b, env, n, paramId, where) {
    if (belongsToPanel(b, n)) return { error: "that module is part of a Panel cell" };
    const def = ((typeFor(env, n) || {}).params || []).find((p) => p.id === paramId);
    if (!def) return { error: "no such knob" };
    const t = target(b, env, n, where);
    if (t.error) return t;
    if (t.panel.controls.some((c) => (c.wire || [])[0] && c.wire[0].param === knobWire(n, paramId))) return { error: "it is on that panel already" };
    const ctl = env.knobControl(n, def);
    return { panel: t.panel, control: env.place(t.panel, ctl.type, ctl), module: n };
  }

  // ---------------------------------------------------------------- remove
  function remove(b, panelId, controlId) {
    const q = panelOf(b, panelId);
    const c = q && q.controls.find((x) => x.id === controlId);
    if (!c) return false;
    q.controls = q.controls.filter((x) => x.id !== controlId);
    // "Add to panel" controls have no target: the module is the user's own and stays on the board.
    const mod = c.target && c.module && node(b, c.module);
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

  const api = { remove, addModule, moduleControls, addKnob, knobControls, addView, viewControls, canAddView, panelsFor, canAddModule, scopeOf, belongsToPanel, _clone: clone };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.BleepPanelWiring = api;
})();
