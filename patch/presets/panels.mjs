// SPDX-License-Identifier: MIT
//
// Factory panels (doc/specs/panels.md §6): front panels written by hand for cell
// presets, keyed by the preset's name. build.mjs checks each against its
// preset and writes patch/board/ui/factory-panels.json.
//
// A panel shows what you play with, not everything: a few knobs per module,
// the rest stays in the module's own view. Big cells are split into tabs.
import { types, normalise } from "./kit.mjs";

// One unit is 20 px. Sizes are [columns, rows].
const SIZE = { dial: [4, 4], slider: [2, 8], meter: [2, 8], button: [4, 3], select: [6, 3], switch: [6, 3] };

/// Builds one panel. `tab(id, name)` sets the tab the following controls go on;
/// controls added before the first tab() show on every tab.
class Builder {
  constructor(id, name, opts = {}) {
    this.panel = { id, name, ...opts, controls: [] };
    this.n = 0;
    this.tabId = null;
  }
  tab(id, name, rows) {
    (this.panel.tabs ||= []).push({ id, name, rows });
    this.tabId = id;
    return this;
  }
  add(type, at, size, rest = {}) {
    const c = { id: "c" + ++this.n, type, at, size, ...rest };
    if (this.tabId) c.tab = this.tabId;
    this.panel.controls.push(c);
    return this;
  }
  title(text, at, w) { return this.add("label", at, [w, 2], { text, style: "title" }); }
  /// A framed group; its `items` stand in a row inside it: [type, label, "node.knob"].
  section(text, colour, at, items, width) {
    const inner = items.reduce((sum, [t]) => sum + SIZE[t][0], 0);
    const height = Math.max(...items.map(([t]) => SIZE[t][1])) + 4;
    this.add("section", at, [width || inner + 2, height], { text, colour });
    let x = at[0] + 1;
    for (const [type, label, ref] of items) {
      this.add(type, [x, at[1] + 2], SIZE[type],
               type === "meter" ? { label, source: { out: ref } } : { label, wire: [{ param: ref }] });
      x += SIZE[type][0];
    }
    return this;
  }
  /// Another panel, loaded into this one. `node` is the module it fronts, for a module panel.
  load(panel, at, size, node) { return this.add("panel", at, size, { panel, ...(node ? { node } : {}) }); }
  done() { return this.panel; }
}
const dial = (label, ref) => ["dial", label, ref];
const slider = (label, ref) => ["slider", label, ref];

// Hand-written panels, keyed by preset name, go here: `export default { "Preset Name": [panel, modulePanel…] }`. A cell preset without
// one gets the panel the board's "Build panel from cell" draws (build.mjs), which is what all the factory cells use now.
// (`Builder`, `dial` and `slider` are the helpers for writing one; see the history of this file for Punch Machine's.)
export default {};

// ------------------------------------------------------------------- check
/// A control must wire to something that exists, sit inside its panel, and not
/// overlap another on the same tab; loaded panels must exist and not loop.
export function checkPanels(preset, list) {
  const byId = new Map(list.map((p) => [p.id, p]));
  const root = preset.board ? { id: "", type: "board", inputs: [] } : preset.nodes.find((n) => n.id === preset.root);
  const split = (ref) => { const i = ref.indexOf("."); return [ref.slice(0, i), ref.slice(i + 1)]; };
  for (const panel of list) {
    const forModule = panel.for && panel.for.module;
    if (!forModule && (preset.board ? panel.cell !== undefined : panel.cell !== preset.root))
      throw new Error(`${panel.name}: fronts neither ${preset.board ? "the board" : "a cell of the preset"} nor a module`);
    const where = (c) => `${panel.name} › ${c.label || c.text || c.type} (${c.id})`;
    const node = (id, c) => {
      if (id === "this" && forModule) return { type: forModule, id };   // a module panel's own module
      const n = preset.nodes.find((q) => q.id === id);
      if (!n) throw new Error(`${where(c)}: no node '${id}'`);
      return n;
    };
    const tabs = new Set((panel.tabs || []).map((t) => t.id));
    const rowsOf = (c) => ((panel.tabs || []).find((t) => t.id === c.tab) || {}).rows || panel.rows;
    for (const id of panel.modules || []) if (!preset.nodes.some((n) => n.id === id)) throw new Error(`${panel.name}: modules lists '${id}', which is not in the preset`);
    const ids = new Set();
    for (const c of panel.controls) {
      if (ids.has(c.id)) throw new Error(`${panel.name}: duplicate control id ${c.id}`);
      ids.add(c.id);
      if (c.tab && !tabs.has(c.tab)) throw new Error(`${where(c)}: no tab '${c.tab}'`);
      const [x, y] = c.at, [w, h] = c.size;
      if (x < 0 || y < 0 || x + w > panel.cols || y + h > rowsOf(c)) throw new Error(`${where(c)}: outside the panel`);
      for (const t of c.wire || []) {
        if (t.param) {
          const [nid, pid] = split(t.param), n = node(nid, c);
          if (!types[n.type].params.some((p) => p.id === pid)) throw new Error(`${where(c)}: ${n.type} has no knob '${pid}'`);
        } else if (t.cell) {
          if (!(root.inputs || []).some((j) => j.id === t.cell)) throw new Error(`${where(c)}: the cell has no input '${t.cell}'`);
        } else if (t.notes) {
          if (root.type !== "voice-cell" && !(root.inputs || []).some((j) => j.type === "notes")) throw new Error(`${where(c)}: only a Voice Cell or a cell with a Notes input takes notes`);
        } else if (t.jack) {
          const [nid, jack] = split(t.jack), n = node(nid, c), ty = types[n.type];
          if (!ty.inputs.some((j) => j.id === jack) && !ty.params.some((p) => p.id === jack && p.modulatable))
            throw new Error(`${where(c)}: ${n.type} has no input '${jack}'`);
        } else if (t.press || t.keyboard) {
          const n = node(t.press || t.keyboard, c);
          if (n.type !== (t.press ? "button" : "keyboard")) throw new Error(`${where(c)}: '${n.id}' is not a ${t.press ? "Button" : "Keyboard"} module`);
        } else if (t.command) {
          const [nid, cmd] = split(t.command), n = node(nid, c);
          if (!(types[n.type].buttons || []).some((b) => b.id === cmd)) throw new Error(`${where(c)}: ${n.type} has no button '${cmd}'`);
        } else throw new Error(`${where(c)}: a wire that goes nowhere`);
      }
      if (c.source) for (const ref of Array.isArray(c.source.out) ? c.source.out : [c.source.out]) {
        const [nid, jack] = split(ref), n = node(nid, c);
        const outs = n.type === "cell-in" ? root.inputs || [] : types[n.type].outputs;  // Cell In outputs what the cell takes in
        if (!outs.some((o) => o.id === jack)) throw new Error(`${where(c)}: no output '${ref}'`);
      }
      if (c.type === "view" && !types[node(c.node, c).type].creatable) throw new Error(`${where(c)}: '${c.node}' has no view`);
      if (c.type === "panel") {
        const sub = byId.get(c.panel);
        if (!sub) throw new Error(`${where(c)}: no panel '${c.panel}'`);
        if (sub.for && node(c.node, c).type !== sub.for.module)
          throw new Error(`${where(c)}: '${sub.name}' is for ${sub.for.module}, '${c.node}' is not one`);
        if (c.size[0] !== sub.cols || c.size[1] !== sub.rows)
          throw new Error(`${where(c)}: size ${c.size} differs from ${sub.name}'s ${sub.cols}×${sub.rows}`);
      }
      if (["dial", "slider", "wheel", "button", "switch", "select", "keys", "xy"].includes(c.type) && !(c.wire || []).length)
        throw new Error(`${where(c)}: a control with no wire`);
    }
    const seen = (id, trail) => {
      if (trail.includes(id)) throw new Error(`panels load each other: ${[...trail, id].join(" → ")}`);
      for (const c of byId.get(id).controls) if (c.type === "panel") seen(c.panel, [...trail, id]);
    };
    seen(panel.id, []);
    const solid = panel.controls.filter((c) => c.type !== "section" && c.type !== "label");
    for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i], b = solid[j];
      if (a.tab && b.tab && a.tab !== b.tab) continue;
      if (a.at[0] < b.at[0] + b.size[0] && b.at[0] < a.at[0] + a.size[0] &&
          a.at[1] < b.at[1] + b.size[1] && b.at[1] < a.at[1] + a.size[1])
        throw new Error(`${where(a)} overlaps ${where(b)}`);
    }
  }
}

/// A Dial module for every knob a panel control sets directly (doc/specs/panels.md), kept in a Panel cell: the dials of
/// one module meet in a Patch Bay In, one bundle cable per module leaves the Panel cell, and next to the module a Patch
/// Bay Out hands the channels to its knobs. The knobs are parked at 0 and a cable of 100 % carries each Dial into its
/// knob, so the effective value is what the knob had (the engine adds a cable's signal to the knob's own value, both
/// normalised). Only knobs of modules in the cell `root` that take cables are converted; settings (a filter's Type)
/// stay direct. `extras` are further channels, each from a module that is made once per `key` in the Panel cell:
/// [{ key, type, name, params (units), to: node, toJack, amount }], e.g. a wheel.
/// Changes `doc` (the panel) and `preset` (the Panel cell, its modules and cables). Returns the Panel cell.
export function panelCell(doc, preset, extras = []) {
  const split = (ref) => { const i = ref.indexOf("."); return [ref.slice(0, i), ref.slice(i + 1)]; };
  const dial = types.dial, knob = (id) => dial.params.find((q) => q.id === id);
  const root = preset.nodes.find((n) => n.id === preset.root);
  const ids = new Set(preset.nodes.map((n) => n.id));
  const fresh = (base) => { let id = base, k = 2; while (ids.has(id)) id = `${base}${k++}`; ids.add(id); return id; };
  const cellOf = (n) => preset.nodes.find((q) => q.id === n.parent);
  const inside = (n) => n.parent === root.id || (cellOf(n) && cellOf(n).parent === root.id && cellOf(n).type === "voice-cell");   // in the cell, or in its Voice Cell
  const groups = new Map();   // module id → { node, items: [{ kind, ... }] }
  const group = (node) => { if (!groups.has(node.id)) groups.set(node.id, { node, items: [] }); return groups.get(node.id); };
  for (const c of doc.controls) {
    if (!["dial", "slider", "button", "select"].includes(c.type)) continue;
    const w = c.wire;
    if (!w || w.length !== 1 || !w[0].param || w[0].mode || w[0].range) continue;
    const [nid, pid] = split(w[0].param);
    const node = preset.nodes.find((n) => n.id === nid);
    if (!node || !inside(node)) continue;
    const def = types[node.type].params.find((q) => q.id === pid);
    if (!def || !def.modulatable || def.steps > 24) continue;
    group(node).items.push({ control: c, def, pid });
  }
  for (const e of extras) group(e.to).items.push({ extra: e, pid: e.toJack });
  if (![...groups.values()].some((g) => g.items.length)) return null;

  const panel = { id: fresh("panel"), type: "cell", name: "Panel", x: 40, y: 40 + 3 * 220, parent: root.id, params: {}, inputs: [],
                  outputs: [...groups.values()].map((g) => ({ id: g.node.id, name: g.node.name, type: "patchbay" })) };
  const ci = { id: panel.id + "_ci", type: "cell-in", name: "Cell In", x: 40, y: 40, parent: panel.id, params: {} };
  const co = { id: panel.id + "_co", type: "cell-out", name: "Cell Out", x: 40 + 2 * 300 + 40 * groups.size * 8, y: 40, parent: panel.id, params: {} };
  preset.nodes.push(panel, ci, co);
  ids.add(ci.id); ids.add(co.id);
  const make = (type, id, name, parent, x, y, params = {}) => {
    const t = types[type], n = { id, type, name, x, y, parent, params: {} };
    for (const q of t.params) n.params[q.id] = q.id in params ? params[q.id] : q.default;
    preset.nodes.push(n);
    return n;
  };
  const cable = (id, from, fj, to, tj, amount = 1) => preset.cables.push({ id, from: { node: from.id, jack: fj }, to: { node: to.id, jack: tj }, amount });
  const shared = new Map();
  let col = 0;
  for (const g of groups.values()) {
    const bayIn = make("patchbay-in", fresh(`${g.node.id}_in`), g.node.name, panel.id, 40 + (col * 2 + 1) * 300, 40);
    // Next to the module, in its cell. A Voice Cell takes the bundle at a shared input of its own, and inside, its Cell In
    // hands it to the bay.
    const home = cellOf(g.node).id === root.id ? null : cellOf(g.node);
    const bayOut = make("patchbay-out", fresh(`${g.node.id}_out`), g.node.name, home ? home.id : root.id, g.node.x - 300, g.node.y);
    cable(`${bayIn.id}_c`, bayIn, "bundle", co, g.node.id);
    if (!home) cable(`${bayOut.id}_c`, panel, g.node.id, bayOut, "bundle");
    else {
      home.inputs = [...(home.inputs || []), { id: g.node.id, name: g.node.name, type: "patchbay" }];
      const homeIn = preset.nodes.find((n) => n.type === "cell-in" && n.parent === home.id);
      cable(`${bayOut.id}_p`, panel, g.node.id, home, g.node.id);
      cable(`${bayOut.id}_c`, homeIn, g.node.id, bayOut, "bundle");
    }
    let k = 0;
    g.items.forEach((item, row) => {
      const ch = "c" + ++k;
      let src, srcJack = "out";
      if (item.extra) {   // one source for every channel that has its key (a wheel, for two saws)
        const e = item.extra;
        if (!shared.has(e.key)) {
          const params = {};
          for (const q of types[e.type].params) params[q.id] = q.id in e.params ? normalise(q, e.params[q.id]) : q.default;
          shared.set(e.key, make(e.type, fresh(e.key), e.name, panel.id, 40 + col * 2 * 300, 40 + row * 90, params));
        }
        src = shared.get(e.key);
      } else {
        const { control: c, def, pid } = item;
        const base = g.node.params[pid] ?? def.default;
        const params = { value: base, min: normalise(knob("min"), 0), max: normalise(knob("max"), 1), smooth: normalise(knob("smooth"), 0),
                         steps: normalise(knob("steps"), def.kind === "float" ? 0 : def.steps) };
        src = make("dial", fresh(`${g.node.id}_${pid}`), `${g.node.name} ${def.name}`, panel.id, 40 + col * 2 * 300, 40 + row * 90, params);
        g.node.params[pid] = 0;
        c.wire = [{ param: `${src.id}.value` }];
        if (c.type === "select" && def.choices) c.options = def.choices.slice();
      }
      cable(`${bayIn.id}_${ch}`, src, srcJack, bayIn, ch);
      cable(`${bayOut.id}_${ch}`, bayOut, ch, g.node, item.pid, item.extra ? item.extra.amount : 1);
    });
    col++;
  }
  return panel;
}

/// Edits to the panels the build generates, for presets whose panel shows off controls that are modules in the cell
/// (doc/specs/panels.md, "Panels add modules to the board"). `doc` is the generated panel, `preset` the cell preset.
/// The modules sit in a stack on the cell's board, below its other nodes.
export const panelEdits = {};

// Slate Stabs: the Phaser and the Reverb after the voices, in a row above the keys (the generated panel is the Voice Cell's).
panelEdits["Slate Stabs"] = (doc) => {
  const keys = doc.controls.find((c) => c.type === "keys"), y = keys.at[1], h = 8;
  keys.at[1] += h;
  doc.rows += h;
  let x = 1, n = doc.controls.length;
  const add = (c) => doc.controls.push({ ...c, id: "c" + ++n });
  for (const [title, colour, node, knobs] of [
    ["Phaser", "#c084fc", "phaser", [["rate", "Rate"], ["depth", "Depth"], ["feedback", "Feedback"], ["mix", "Mix"]]],
    ["Reverb", "#60a5fa", "reverb", [["size", "Size"], ["decay", "Decay"], ["damping", "Damping"], ["mix", "Mix"]]],
  ]) {
    const w = knobs.length * 4 + 2;
    add({ type: "section", at: [x, y], size: [w, h], text: title, colour });
    knobs.forEach(([id, label], i) => add({ type: "dial", wire: [{ param: `${node}.${id}` }], label, at: [x + 1 + i * 4, y + 2], size: [4, 4] }));
    x += w + 1;
  }
};
