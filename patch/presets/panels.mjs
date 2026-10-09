// SPDX-License-Identifier: MIT
//
// Factory panels (specs/panels.md §6): front panels written by hand for cell
// presets, keyed by the preset's name. build.mjs checks each against its
// preset and writes patch/board/ui/factory-panels.json.
//
// A panel shows what you play with, not everything: a few knobs per module,
// the rest stays in the module's own view. Big cells are split into tabs.
import { types } from "./kit.mjs";

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

// ---------------------------------------------------------------- Punch Machine
// Play: the drum grid and a mixer. Sound: two or three knobs for each voice.
const drumGrid = new Builder("drum-grid", "Drum Grid", { for: { module: "drum-grid" }, cols: 46, rows: 26 })
  .add("view", [1, 1], [44, 24], { node: "this" })
  .done();

const punch = new Builder("punch-machine", "Punch Machine", { cell: "root", cols: 69, rows: 29 });
punch.title("Punch Machine", [1, 0], 67);
punch.tab("play", "Play", 29)
  .load("drum-grid", [1, 3], [46, 26], "grid")
  .section("Mixer", "#fb7185", [48, 3], [
    slider("Kick", "mixA.level1"), slider("Snr", "mixA.level2"), slider("Hat", "mixA.level3"), slider("Clap", "mixA.level4"),
    slider("L Tom", "mixB.level1"), slider("H Tom", "mixB.level2"), slider("Rim", "mixB.level3"),
    slider("Master", "master.master"), ["meter", "Out", ["master.outl", "master.outr"]],
  ], 20);
punch.tab("sound", "Sound", 21)
  .section("Kick", "#f59e0b", [1, 3], [dial("Tune", "kick.tune"), dial("Decay", "kick.decay"), dial("Sweep", "kick.sweep")])
  .section("Snare", "#f59e0b", [16, 3], [dial("Tune", "snare.tune"), dial("Snappy", "snare.snappy"), dial("Decay", "snare.decay")])
  .section("Hats", "#f59e0b", [31, 3], [dial("Tune", "hats.tune"), dial("Closed", "hats.closed"), dial("Open", "hats.open")])
  .section("Clap", "#f59e0b", [1, 12], [dial("Tone", "clap.tone"), dial("Decay", "clap.decay"), dial("Spread", "clap.spread")])
  .section("Low Tom", "#f59e0b", [16, 12], [dial("Tune", "tomlo.tune"), dial("Decay", "tomlo.decay")])
  .section("High Tom", "#f59e0b", [27, 12], [dial("Tune", "tomhi.tune"), dial("Decay", "tomhi.decay")])
  .section("Rim", "#f59e0b", [38, 12], [dial("Tune", "perc.tune"), dial("Decay", "perc.decay")]);

export default { "Punch Machine": [punch.done(), drumGrid] };

// ------------------------------------------------------------------- check
/// A control must wire to something that exists, sit inside its panel, and not
/// overlap another on the same tab; loaded panels must exist and not loop.
export function checkPanels(preset, list) {
  const byId = new Map(list.map((p) => [p.id, p]));
  const root = preset.nodes.find((n) => n.id === preset.root);
  const split = (ref) => { const i = ref.indexOf("."); return [ref.slice(0, i), ref.slice(i + 1)]; };
  for (const panel of list) {
    const forModule = panel.for && panel.for.module;
    if (!forModule && panel.cell !== preset.root) throw new Error(`${panel.name}: fronts neither a cell of the preset nor a module`);
    const where = (c) => `${panel.name} › ${c.label || c.text || c.type} (${c.id})`;
    const node = (id, c) => {
      if (id === "this" && forModule) return { type: forModule, id };   // a module panel's own module
      const n = preset.nodes.find((q) => q.id === id);
      if (!n) throw new Error(`${where(c)}: no node '${id}'`);
      return n;
    };
    const tabs = new Set((panel.tabs || []).map((t) => t.id));
    const rowsOf = (c) => ((panel.tabs || []).find((t) => t.id === c.tab) || {}).rows || panel.rows;
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
          if (root.type !== "voice-cell") throw new Error(`${where(c)}: only a Voice Cell takes notes`);
        } else throw new Error(`${where(c)}: a wire that goes nowhere`);
      }
      if (c.source) for (const ref of Array.isArray(c.source.out) ? c.source.out : [c.source.out]) {
        const [nid, jack] = split(ref), n = node(nid, c);
        if (!types[n.type].outputs.some((o) => o.id === jack)) throw new Error(`${where(c)}: no output '${ref}'`);
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
      if (["dial", "slider", "wheel", "button", "switch", "select", "keys"].includes(c.type) && !(c.wire || []).length)
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
