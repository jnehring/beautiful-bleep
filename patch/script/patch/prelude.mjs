// SPDX-License-Identifier: GPL-3.0-only
// The Bleep Script patch builder, as the code that runs INSIDE the sandbox (QuickJS, run.mjs) before the user's script. It defines `cell()`
// and the builder the script uses, records what the script asks for as plain data, and has no other way out: no fetch, no storage,
// no host functions. The host reads the result (globalThis.__result) as JSON and checks it against the board's module types
// (materialize.mjs), so a mistake here can only produce a description that is then refused.
export const PRELUDE = String.raw`
"use strict";
(function () {
  const MAX_NODES = 1000, MAX_CABLES = 5000;
  const lineOf = () => {
    try { throw new Error("x"); } catch (e) {
      for (const frame of String(e.stack || "").split("\n")) {
        const m = /script\.js:(\d+)/.exec(frame);
        if (m) return Number(m[1]);
      }
    }
    return 0;
  };
  const fail = (message) => { const e = new Error(message); e.bleepLine = lineOf(); throw e; };
  const isHandle = (h) => h && typeof h === "object" && typeof h.id === "string";
  const slug = (type) => type.replace(/[^a-z]/g, "").slice(0, 6) || "n";

  class Builder {
    constructor(spec) {
      this.spec = spec;
      this.cin = { id: "ci", type: "cell-in", name: "Cell In" };
      this.cout = { id: "co", type: "cell-out", name: "Cell Out" };
      this.ids = new Set(["ci", "co"]);
    }
    /// A shared input jack on the cell (type: control, gate, trigger, pitch, audio or notes).
    input(id, name, type = "control") {
      if (typeof id !== "string" || !id) fail("input needs an id");
      this.spec.inputs.push({ id, name: name || id, type });
      return this;
    }
    /// An output jack on the cell.
    output(id, name, type = "audio") {
      if (typeof id !== "string" || !id) fail("output needs an id");
      this.spec.outputs.push({ id, name: name || id, type });
      return this;
    }
    stereoOut() { return this.output("l", "Out L").output("r", "Out R"); }
    stereoIn() { return this.input("l", "In L", "audio").input("r", "In R", "audio"); }
    /// Adds a module of a type (its id from the Add menu's list, e.g. "oscillator"), with knob values in their own units.
    /// opts: { name, id, at: [column, row], x, y (pixels), data }.
    add(type, values = {}, opts = {}) {
      if (typeof type !== "string") fail("add needs a module type, e.g. c.add(\"oscillator\", { coarse: 7 })");
      if (this.spec.nodes.length >= MAX_NODES) fail("a patch script can add at most " + MAX_NODES + " modules");
      let id = opts.id || slug(type);
      const base = id;
      for (let i = 2; this.ids.has(id); i++) id = base + i;
      this.ids.add(id);
      const node = { id, type, name: opts.name || null, values: values || {}, line: lineOf() };
      if (opts.at) node.at = opts.at;
      if (opts.x !== undefined) node.x = opts.x;
      if (opts.y !== undefined) node.y = opts.y;
      if (opts.data !== undefined) node.data = opts.data;
      this.spec.nodes.push(node);
      return { id, type, name: opts.name || null };
    }
    /// A cable from an output jack to an input jack or a knob (amount -1 to +1).
    cable(from, fromJack, to, toJack, amount = 1) {
      if (!isHandle(from) || !isHandle(to)) fail("cable(from, fromJack, to, toJack): from and to must be modules from c.add, or c.cin / c.cout");
      if (typeof fromJack !== "string" || typeof toJack !== "string") fail("cable: the jack names must be strings");
      if (typeof amount !== "number" || !isFinite(amount)) fail("cable: the amount must be a number");
      if (this.spec.cables.length >= MAX_CABLES) fail("a patch script can add at most " + MAX_CABLES + " cables");
      this.spec.cables.push({ from: { node: from.id, jack: fromJack }, to: { node: to.id, jack: toJack }, amount, line: lineOf() });
      return this;
    }
    /// Both channels: from.l to to.l and from.r to to.r.
    stereo(from, to, jacks = {}) {
      const [fl, fr] = jacks.from || ["l", "r"], [tl, tr] = jacks.to || ["l", "r"];
      return this.cable(from, fl, to, tl, jacks.amount ?? 1).cable(from, fr, to, tr, jacks.amount ?? 1);
    }
    /// Puts a module at a pixel position inside the cell.
    place(handle, x, y) {
      const n = this.spec.nodes.find((q) => q.id === handle.id);
      if (!n) fail("place: not a module of this cell");
      n.x = x; n.y = y;
      return handle;
    }
  }

  /// cell(name, { description, settings: [{ id, name, min, max, init }] }, (c, s) => { ... }): the cell the script builds.
  /// The function runs now; s holds the settings' values (s.VOICES).
  globalThis.cell = function cell(name, options, build) {
    if (typeof options === "function") { build = options; options = {}; }
    options = options || {};
    if (typeof name !== "string" || !name) fail("cell needs a name: cell(\"My cell\", (c) => { ... })");
    if (typeof build !== "function") fail("cell needs a function that builds it: cell(name, (c, settings) => { ... })");
    const declared = Array.isArray(options.settings) ? options.settings : [];
    const values = {};
    for (const d of declared) {
      if (!d || typeof d.id !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(d.id)) fail("a setting needs an id in capitals, e.g. { id: \"VOICES\", name: \"Voices\", min: 1, max: 16, init: 4 }");
      if (![d.min, d.max, d.init].every(Number.isInteger) || d.max < d.min || d.init < d.min || d.init > d.max) fail("setting " + d.id + " needs whole numbers min, max and init, with init from min to max");
      const chosen = Object.prototype.hasOwnProperty.call(globalThis.__settings || {}, d.id) ? Number(globalThis.__settings[d.id]) : d.init;
      values[d.id] = Math.min(d.max, Math.max(d.min, Math.round(chosen)));
    }
    const spec = {
      name, description: typeof options.description === "string" ? options.description : "",
      settings: declared.map((d) => ({ id: d.id, name: d.name || d.id, min: d.min, max: d.max, init: d.init, value: values[d.id] })),
      inputs: [], outputs: [], nodes: [], cables: [],
    };
    build(new Builder(spec), values);
    return spec;
  };
})();
`;
