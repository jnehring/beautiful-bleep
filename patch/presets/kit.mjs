// SPDX-License-Identifier: MIT
//
// The factory preset kit: builds cell presets with knob values in their own
// units (Hz, seconds, choice names) and checks them against the node types in
// patch/board/ui/demo-types.json. build.mjs compiles every category file in
// this folder into patch/board/ui/factory-presets.json. See README.md.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TYPES_FILE = fileURLToPath(new URL("../board/ui/demo-types.json", import.meta.url));
export const types = Object.fromEntries(JSON.parse(readFileSync(TYPES_FILE, "utf8")).map((t) => [t.type, t]));

/// Notes connect only to notes (spec §7.4); every other signal converts.
const compatible = (a, b) => (a === "notes") === (b === "notes");

/// A value already normalised (0..1), passed through as is.
export const raw = (x) => ({ raw: x });

/// Units → 0..1, as ParamSpec::toNormalised (patch/engine/Spec.h).
export function normalise(p, v) {
  const { min, max } = p;
  if (max <= min) return 0;
  v = Math.min(Math.max(v, min), max);
  let x;
  if (p.map === "exp") x = Math.log(v / min) / Math.log(max / min);
  else if (p.map === "skew") {
    const skew = Math.log(0.5) / Math.log((p.centre - min) / (max - min));
    const q = (v - min) / (max - min);
    x = q <= 0 ? 0 : Math.pow(q, skew);
  } else x = (v - min) / (max - min);
  return Math.round(Math.min(Math.max(x, 0), 1) * 1e6) / 1e6;
}

/// 0..1 → units, as ParamSpec::fromNormalised.
export function denormalise(p, x) {
  const { min, max } = p;
  let v;
  if (p.map === "exp") v = min * Math.pow(max / min, x);
  else if (p.map === "skew") {
    const skew = Math.log(0.5) / Math.log((p.centre - min) / (max - min));
    v = x <= 0 ? min : min + (max - min) * Math.exp(Math.log(x) / skew);
  } else v = min + (max - min) * x;
  return p.kind === "float" ? v : Math.round(v);
}

/// One knob value in units → normalised. Floats and ints take numbers in
/// units; choices take the choice's name (or its index); toggles take booleans.
export function resolveParam(where, p, v) {
  if (v && typeof v === "object" && "raw" in v) return v.raw;
  if (p.kind === "choice") {
    let i = typeof v === "number" ? v : p.choices.indexOf(v);
    if (i < 0) i = p.choices.findIndex((c) => c.toLowerCase() === String(v).toLowerCase());
    if (!Number.isInteger(i) || i < 0 || i >= p.choices.length)
      throw new Error(`${where}: '${v}' is not one of ${p.choices.map((c) => `'${c}'`).join(", ")}`);
    return normalise(p, i + p.min);
  }
  if (p.kind === "bool") {
    if (typeof v !== "boolean") throw new Error(`${where}: expected true or false, got ${JSON.stringify(v)}`);
    return v ? 1 : 0;
  }
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${where}: expected a number, got ${JSON.stringify(v)}`);
  if (p.kind === "int" && !Number.isInteger(v)) throw new Error(`${where}: expected a whole number, got ${v}`);
  const eps = 1e-6 * Math.max(1, Math.abs(p.max - p.min));
  if (v < p.min - eps || v > p.max + eps) throw new Error(`${where}: ${v} is outside ${p.min}…${p.max}`);
  return normalise(p, v);
}

/// A preset's help (the "?" on its cell): `"text"` or `{text, images: [{src, alt, caption?}]}`. The text is plain, paragraphs
/// separated by a blank line; an image's `src` is a file in board/ui/ named help-*.png (served flat; checked by build.mjs).
export function normaliseHelp(name, help) {
  if (help === undefined || help === "") return undefined;
  const h = typeof help === "string" ? { text: help } : help;
  if (typeof h.text !== "string" || !h.text.trim()) throw new Error(`${name}: help needs a text`);
  const out = { text: h.text.trim() };
  if (h.images && h.images.length) {
    out.images = h.images.map((im) => {
      if (!im || typeof im.src !== "string" || !/^help-[\w.-]+\.(png|jpe?g|gif|svg|webp)$/i.test(im.src))
        throw new Error(`${name}: a help image needs a src like "help-<name>.png"`);
      if (typeof im.alt !== "string" || !im.alt) throw new Error(`${name}: help image ${im.src} needs an alt text`);
      return { src: im.src, alt: im.alt, ...(im.caption ? { caption: im.caption } : {}) };
    });
  }
  return out;
}

const GRID_X = 300, GRID_Y = 220;  // one layout column / row on the board

/// Builds one preset. `kind`: "voice" (a Voice Cell: notes in, audio out),
/// "cell" (an ordinary cell with the jacks it declares) or "patch" (a whole
/// board: modules at the top level, `p.out` the Out 1/2 port, `p.midi` the
/// Bleep App 1 MIDI input; see patch()).
export class Preset {
  constructor(kind, name, opts = {}) {
    if (kind !== "voice" && kind !== "cell" && kind !== "patch") throw new Error(`${name}: kind must be 'voice', 'cell' or 'patch'`);
    this.kind = kind;
    this.name = name;
    this.description = opts.description || "";
    this.tags = opts.tags || [];
    this.help = normaliseHelp(name, opts.help);
    this.empty = !!opts.empty;  // a starter: a voice cell may stay silent
    this.playsOverride = undefined;
    this.nodes = [];
    this.cables = [];
    this.ids = new Set();
    if (kind === "patch") {
      this.module = opts.module || "";
      this.tempo = opts.tempo || 120;
      this.parent = "";
      this.out = this.#port("out", "audio-out", "Out 1/2", "device-out-1", [6, 1]);
      return;
    }
    this.parent = "root";
    const rootType = kind === "voice" ? "voice-cell" : "cell";
    this.root = { id: "root", type: rootType, name, x: 0, y: 0, parent: "", params: {}, inputs: [], outputs: [] };
    this.nodes.push(this.root);
    this.ids.add("root");
    this.cin = this.#boundary("ci", "cell-in", "Cell In", [-1, 3]);
    this.cout = this.#boundary("co", "cell-out", "Cell Out", [6, 3]);
    if (kind === "voice") {
      this.vin = this.#boundary("vi", "voice-in", "Voice In", [-1, 0]);
      this.vout = this.#boundary("vo", "voice-out", "Voice Out", [6, 0]);
    }
  }

  #port(id, type, name, port, at) {
    const n = { id, type, name, x: 40 + (at[0] + 1) * GRID_X, y: 40 + at[1] * GRID_Y, parent: "", muted: false,
                port, params: {}, track: name };
    this.nodes.push(n);
    this.ids.add(id);
    return n;
  }

  /// Patches: the MIDI input "Bleep App 1" (notes, pitch, gate, CCs), added when first used.
  get midi() {
    if (this.kind !== "patch") throw new Error(`${this.name}: only patches have a MIDI input`);
    if (!this._midi) this._midi = this.#port("midi", "midi-in", "Bleep App 1", "vmidi-1:in", [-1, 0]);
    return this._midi;
  }

  #where(n, what) { return `${this.name} › ${n.name}${what ? " › " + what : ""}`; }

  #boundary(id, type, name, at) {
    const n = { id, type, name, x: 40 + (at[0] + 1) * GRID_X, y: 40 + at[1] * GRID_Y, parent: "root", params: {} };
    this.nodes.push(n);
    this.ids.add(id);
    return n;
  }

  /// Overrides what the cell can be loaded as (see derivePlays); `false` keeps it on the board only.
  plays(spec) {
    this.playsOverride = spec;
    return this;
  }

  /// The cell's own settings (a Voice Cell's Voices, Mode, Glide …), in units.
  settings(values) {
    this.#setParams(this.root, values);
    return this;
  }

  /// A shared input jack on the cell (`type`: control, gate, trigger, pitch, audio; notes on plain cells).
  input(id, name, type = "control") {
    this.root.inputs.push({ id, name, type });
    return this;
  }
  /// An output jack on the cell.
  output(id, name, type = "audio") {
    this.root.outputs.push({ id, name, type });
    return this;
  }
  /// Lets the host's MIDI play the cell's drums: a shared Notes input into a Drum Notes module, whose General MIDI
  /// triggers (kick, snare, rim, clap, hat, open, tom, bell, ride, crash) go to the given [node, jack] targets.
  /// The cell keeps playing its own pattern; the notes add hits.
  gmDrums(targets, at = [0, 2]) {
    this.input("notes", "Notes", "notes");
    const router = this.add("drum-notes", at, {}, { name: "MIDI Drums" });
    this.cable(this.cin, "notes", router, "notes");
    const velocityJacks = new Set();
    for (const [drum, [node, jack]] of Object.entries(targets)) {
      this.cable(router, drum, node, jack);
      // A voice whose velocity the pattern patches also gets the key's velocity (it adds while a key sounds).
      const vel = this.cables.find((c) => c.to.node === node.id && (c.to.jack === "velocity" || c.to.jack === "accent"));
      if (vel) velocityJacks.add(`${node.id}.${vel.to.jack}`);
    }
    for (const key of velocityJacks) {
      const [id, jack] = key.split(".");
      this.cable(router, "velocity", this.nodes.find((n) => n.id === id), jack);
    }
    return this;
  }
  /// Out L / Out R audio outputs (plain cells; Voice Cells have them already).
  stereoOut() { return this.output("l", "Out L").output("r", "Out R"); }
  stereoIn() { return this.input("l", "In L", "audio").input("r", "In R", "audio"); }

  /// Adds a module. `at` is [column, row] on a 300 × 220 grid; values in units.
  add(type, at, values = {}, opts = {}) {
    const t = types[type];
    if (!t || !t.creatable || t.port) throw new Error(`${this.name}: '${type}' is not a module a preset can hold`);
    let id = opts.id || type.replace(/[^a-z]/g, "").slice(0, 6);
    for (let i = 2; this.ids.has(id); i++) id = (opts.id || type.replace(/[^a-z]/g, "").slice(0, 6)) + i;
    this.ids.add(id);
    const n = { id, type, name: opts.name || t.name, x: 40 + (at[0] + 1) * GRID_X, y: 40 + at[1] * GRID_Y,
                parent: this.parent, params: {} };
    if (opts.data !== undefined) n.data = opts.data;
    this.#setParams(n, values);
    this.nodes.push(n);
    return n;
  }

  #setParams(n, values) {
    const t = types[n.type];
    for (const [k, v] of Object.entries(values)) {
      const p = t.params.find((q) => q.id === k);
      if (!p) throw new Error(`${this.#where(n, k)}: no such knob or setting (${t.params.map((q) => q.id).join(", ")})`);
      n.params[k] = resolveParam(this.#where(n, p.name), p, v);
    }
  }

  /// A plain cell inside this one, with its Cell In and Cell Out, at `at` ([column, row]). `outputs`/`inputs` are its jacks
  /// ({id, name, type}). Returns {cell, cin, cout}; build what is in it with `within(cell, () => …)`.
  subcell(id, name, at, { inputs = [], outputs = [] } = {}) {
    if (this.ids.has(id)) throw new Error(`${this.name}: '${id}' is used twice`);
    const node = { id, type: "cell", name, x: 40 + (at[0] + 1) * GRID_X, y: 40 + at[1] * GRID_Y, parent: this.parent, params: {}, inputs, outputs };
    this.ids.add(id);
    this.nodes.push(node);
    const bound = (suffix, type, label, x) => {
      const n = { id: id + suffix, type, name: label, x, y: 40, parent: id, params: {} };
      this.ids.add(n.id);
      this.nodes.push(n);
      return n;
    };
    return { cell: node, cin: bound("_ci", "cell-in", "Cell In", 40), cout: bound("_co", "cell-out", "Cell Out", 40 + 6 * GRID_X) };
  }
  /// Everything added inside `fn` goes into `cell` (a node from subcell()).
  within(cell, fn) {
    const before = this.parent;
    this.parent = cell.id;
    try { fn(); } finally { this.parent = before; }
    return this;
  }
  /// Places a node anywhere on its cell's canvas, in pixels (add() takes grid columns and rows).
  place(n, x, y) { n.x = x; n.y = y; return n; }

  /// A finished preset (a Voice Cell, say) as a cell inside this one, at `at` ([column, row] in this cell), named `name`.
  /// Its nodes get the prefix "v_" (so "oscill" is "v_oscill"). Returns the new cell's node, to cable.
  embed(inner, at, name) {
    const doc = inner.build("");
    const map = new Map(doc.nodes.map((n) => [n.id, "v_" + n.id]));
    for (const n of JSON.parse(JSON.stringify(doc.nodes))) {
      const isRoot = n.id === doc.root;
      n.id = map.get(n.id);
      n.parent = isRoot ? this.root.id : map.get(n.parent);
      if (isRoot) { n.x = 40 + (at[0] + 1) * GRID_X; n.y = 40 + at[1] * GRID_Y; if (name) n.name = name; }
      this.ids.add(n.id);
      this.nodes.push(n);
    }
    for (const c of doc.cables)
      this.cables.push({ ...c, id: "v_" + c.id, from: { ...c.from, node: map.get(c.from.node) }, to: { ...c.to, node: map.get(c.to.node) } });
    return this.nodes.find((n) => n.id === map.get(doc.root));
  }

  #cellOf(n) { return this.nodes.find((q) => q.id === n.parent) || this.root; }

  #outType(n, jack) {
    if (n.type === "cell-in") return (this.#cellOf(n).inputs.find((j) => j.id === jack) || {}).type;
    if (n.type === "patchbay-out" && /^c\d+$/.test(jack)) return "control";   // the channels of a bay: any signal but notes
    if (n.type === "cell" || n.type === "voice-cell") {   // a cell inside this one: its own jacks, and a Voice Cell's Out L/R
      const j = (n.outputs || []).concat(n.type === "voice-cell" ? types[n.type].outputs : []).find((o) => o.id === jack);
      return j && j.type;
    }
    const j = types[n.type].outputs.find((o) => o.id === jack);
    return j && j.type;
  }
  #inType(n, jack) {
    if (n.type === "cell-out") return (this.#cellOf(n).outputs.find((j) => j.id === jack) || {}).type;
    if (n.type === "patchbay-in" && /^c\d+$/.test(jack)) return "control";
    if (n.type === "cell" || n.type === "voice-cell") {
      const j = (n.inputs || []).concat(n.type === "voice-cell" ? types[n.type].inputs : []).find((i) => i.id === jack);
      return j && j.type;
    }
    const t = types[n.type];
    const j = t.inputs.find((i) => i.id === jack);
    if (j) return j.type;
    const p = t.params.find((q) => q.id === jack);
    return p && p.modulatable ? "control" : undefined;
  }

  /// A cable from an output to an input jack or a knob (amount −1…+1).
  cable(from, fromJack, to, toJack, amount = 1) {
    const ft = this.#outType(from, fromJack), tt = this.#inType(to, toJack);
    if (!ft) throw new Error(`${this.#where(from)}: no output '${fromJack}'`);
    if (!tt) throw new Error(`${this.#where(to)}: no input or modulatable knob '${toJack}'`);
    if (!compatible(ft, tt)) throw new Error(`${this.name}: ${from.name}.${fromJack} (${ft}) can't feed ${to.name}.${toJack} (${tt})`);
    if (!(amount >= -1 && amount <= 1)) throw new Error(`${this.name}: cable amount ${amount} is outside −1…+1`);
    // The VCA's Gain knob runs 0 – 400 %, and a cable amount is a share of the knob's whole range. Presets are written for
    // "1 = open to unity" (the old 0 – 100 % knob), so an amount into a VCA's Gain is scaled to a quarter of the range.
    if (to.type === "vca" && toJack === "gain") amount *= VCA_GAIN_SHARE;
    const id = `k${this.cables.length + 1}`;
    this.cables.push({ id, from: { node: from.id, jack: fromJack }, to: { node: to.id, jack: toJack },
                       amount: Math.round(amount * 1e6) / 1e6 });
    return this;
  }
  /// Both channels: from.<l|fromL> → to.<l>, from.<r> → to.<r>.
  stereo(from, to, jacks = {}) {
    const [fl, fr] = jacks.from || ["l", "r"], [tl, tr] = jacks.to || ["l", "r"];
    return this.cable(from, fl, to, tl, jacks.amount ?? 1).cable(from, fr, to, tr, jacks.amount ?? 1);
  }

  /// Whether a module plays in time, so the cell should offer a Clock (and Run) jack for it: it has a
  /// Clock input and either no Sync knob or one that isn't on Free (Zone Delay: Transport; Quad LFO: on).
  #needsTempo(n) {
    const t = types[n.type];
    if (!t || !t.inputs.some((i) => i.id === "clock")) return false;
    if (n.type === "utility" || n.type === "quantizer") return false;  // their Clock is a sample clock
    if (n.type === "bender" && !(n.params.chance > 0)) return false;  // a pure crusher plays no segments in time
    const sync = t.params.find((q) => q.id === "sync");
    if (!sync) return true;
    const x = n.params.sync ?? sync.default;
    if (sync.kind === "bool") return x > 0.5;
    const steps = sync.steps || sync.choices.length;
    const i = Math.round(x * (steps - 1));
    return sync.choices[0] === "Free" ? i > 0 : true;  // Rotating Divider's Sync is a quantise, not a rate
  }

  /// Every module that plays in time gets its Clock (and Run) from shared cell inputs of the same name,
  /// unless a cable already feeds that jack. Left unpatched, they follow the transport as before.
  #wireTempo() {
    const fed = (n, jack) => this.cables.some((c) => c.to.node === n.id && c.to.jack === jack);
    for (const n of [...this.nodes]) {
      if (n.parent !== "root" || !this.#needsTempo(n)) continue;
      for (const [jack, name, type] of [["clock", "Clock", "trigger"], ["run", "Run", "gate"]]) {
        if (!types[n.type].inputs.some((i) => i.id === jack) || fed(n, jack)) continue;
        const have = this.root.inputs.find((j) => j.id === jack);
        if (have && have.type !== type) throw new Error(`${this.name}: cell input '${jack}' must be a ${type}`);
        if (!have) this.input(jack, name, type);
        this.cable(this.cin, jack, n, jack);
      }
    }
  }

  /// The finished preset document (as saved in .bleepcell files), checked.
  build(category) {
    if (!this.description) throw new Error(`${this.name}: needs a description`);
    if (!this.help && this.kind !== "patch") throw new Error(`${this.name}: needs help (opts.help: what it is, how to play or patch it)`);
    if (this.kind === "patch") return this.#buildPatch();
    this.#wireTempo();
    if (this.kind === "voice") {
      if (!this.empty && !this.cables.some((c) => c.to.node === "vo" && c.to.jack === "l"))
        throw new Error(`${this.name}: nothing reaches Voice Out › Out L`);
    }
    for (const j of this.root.outputs)
      if (!this.cables.some((c) => c.to.node === "co" && c.to.jack === j.id))
        throw new Error(`${this.name}: output '${j.name}' isn't patched inside`);
    if (this.kind === "cell" && !this.root.outputs.length) throw new Error(`${this.name}: a cell preset needs an output`);
    const doc = { format: 1, root: "root", category, description: this.description, tags: this.tags,
                  ...(this.help ? { help: this.help } : {}), nodes: this.nodes, cables: this.cables };
    const plays = this.playsOverride === undefined ? derivePlays(doc, category) : this.playsOverride || undefined;
    if (plays) {
      checkPlays(this.name, doc, plays);
      return { ...doc, plays };
    }
    return doc;
  }

  /// A whole board for the preset browser: `{format, description, tags, module, tempo, nodes, cables}`.
  #buildPatch() {
    if (!this.cables.some((c) => c.to.node === "out" && (c.to.jack === "l" || c.to.jack === "r")))
      throw new Error(`${this.name}: nothing reaches Out 1/2`);
    if (!this.module) throw new Error(`${this.name}: needs the module it demonstrates (opts.module)`);
    if (!types[this.module]) throw new Error(`${this.name}: no module type '${this.module}'`);
    if (!this.nodes.some((n) => n.type === this.module))
      throw new Error(`${this.name}: doesn't use the ${this.module} module it demonstrates`);
    return { format: 1, module: this.module, description: this.description, tags: this.tags, tempo: this.tempo,
             nodes: this.nodes, cables: this.cables };
  }
}

export const voice = (name, opts) => new Preset("voice", name, opts);
export const cell = (name, opts) => new Preset("cell", name, opts);
/// A demo board: a whole board that plays by itself with the transport (or from `p.midi`) into `p.out`.
/// opts: {module: the type it demonstrates, description, tags, tempo}.
export const patch = (name, opts) => new Preset("patch", name, opts);

// ------------------------------------------------- what a cell can be loaded as

/// Categories whose cells are for the board only (no audio of their own to load as a plugin).
const BOARD_ONLY = new Set(["Test", "Sequencers", "Modulators"]);
/// Ring-out of the effects that have one, in seconds (an effect's `tail`): the longest module in the cell.
const TAIL = { reverb: 8, "delay-network": 8, "zone-delay": 6, grains: 2, "freq-shifter": 1, "pitch-shifter": 1, chorus: 1, phaser: 1 };
/// General MIDI notes of the hi-hats: pedal and closed close, open opens; anything else closes too.
const HAT_NOTES = { default: "closed", 44: "closed", 46: "open" };

/// What a cell preset can be loaded as in Bleep Instrument and Bleep FX (doc/specs/cell-plugins.md):
///   instrument: { notes: "voice" }  a Voice Cell: notes feed its voice allocator
///               { notes: {trigger?, velocity?, pitch?, gate?} }  a plain cell: MIDI notes drive these cell inputs
///                    (`trigger` is a jack id, or {default, "<midi note>": jack} for a cell with several);
///                    {notes: jack}  a cell input of type notes gets the notes stream itself (a drum machine's MIDI drums)
///                    {} is a cell that plays by itself, with the transport
///   effect:     { in: [jack ids], out: [jack ids], tail: seconds }
/// Derived from the root's jacks; `p.plays(…)` overrides it. Returns undefined for board-only cells.
export function derivePlays(doc, category) {
  const root = doc.nodes.find((n) => n.id === doc.root);
  if (!root || BOARD_ONLY.has(category.split("/")[0])) return undefined;
  if (root.type === "voice-cell") return { instrument: { notes: "voice" } };
  const ins = root.inputs || [], outs = root.outputs || [];
  const audioIn = ins.filter((j) => j.type === "audio").map((j) => j.id);
  const audioOut = outs.filter((j) => j.type === "audio").map((j) => j.id);
  if (!audioOut.length) return undefined;
  if (audioIn.length) {
    const tail = Math.max(0, ...doc.nodes.map((n) => TAIL[n.type] || 0));
    return { effect: { in: audioIn.slice(0, 2), out: audioOut.slice(0, 2), tail } };
  }
  const has = (id) => ins.some((j) => j.id === id);
  const notes = {};
  const notesIn = ins.find((j) => j.type === "notes");
  if (notesIn) notes.notes = notesIn.id;  // a cell that takes the host's notes itself (gmDrums)
  if (has("closed") && has("open")) notes.trigger = HAT_NOTES;
  else if (has("trig")) notes.trigger = "trig";
  if (notes.trigger && has("velocity")) notes.velocity = "velocity";
  if (!notes.trigger) {
    const pitch = ins.find((j) => j.type === "pitch");
    if (pitch) notes.pitch = pitch.id;
  }
  return { instrument: { notes } };
}

/// A `plays` entry names real jacks of the cell's root; a hand-written override cannot invent them.
export function checkPlays(name, doc, plays) {
  const root = doc.nodes.find((n) => n.id === doc.root);
  const ins = new Set((root.inputs || []).map((j) => j.id)), outs = new Set((root.outputs || []).map((j) => j.id));
  const need = (set, id, what) => { if (!set.has(id)) throw new Error(`${name}: plays › ${what} '${id}' isn't a jack of the cell`); };
  const { instrument, effect } = plays;
  if (!instrument && !effect) throw new Error(`${name}: plays needs an instrument or an effect`);
  if (instrument) {
    const { notes } = instrument;
    if (root.type === "voice-cell" ? notes !== "voice" : typeof notes !== "object")
      throw new Error(`${name}: plays › instrument › notes is "voice" for a Voice Cell and an object for a plain cell`);
    if (notes !== "voice") {
      for (const k of Object.keys(notes)) if (!["trigger", "velocity", "pitch", "gate", "notes"].includes(k))
        throw new Error(`${name}: plays › instrument › notes › ${k} is not a note target`);
      const t = notes.trigger;
      for (const id of typeof t === "object" ? Object.values(t) : t ? [t] : []) need(ins, id, "trigger");
      for (const k of ["velocity", "pitch", "gate", "notes"]) if (notes[k]) need(ins, notes[k], k);
    }
    if (![...outs].some((id) => root.outputs.find((j) => j.id === id).type === "audio") && root.type !== "voice-cell")
      throw new Error(`${name}: an instrument needs an audio output`);
  }
  if (effect) {
    for (const id of effect.in || []) need(ins, id, "in");
    for (const id of effect.out || []) need(outs, id, "out");
    if (!effect.in?.length || !effect.out?.length) throw new Error(`${name}: plays › effect needs in and out jacks`);
    if (!(effect.tail >= 0)) throw new Error(`${name}: plays › effect › tail is seconds, 0 or more`);
  }
}

// ------------------------------------------------------------ small helpers

/// One full unit of VCA gain as a share of the Gain knob's 0 – 400 % range.
const VCA_GAIN_SHARE = 0.25;

/// Pitch in 1 V/oct for a cable amount: semitones → the amount on a pitch input.
export const semis = (n) => n / 12;

/// The usual voice ending: Voice In's gate, trigger and velocity drive an ADSR,
/// which opens a VCA and keeps the voice alive (Active → Voice Out).
export function ampEnvelope(p, src, at, adsr, opts = {}) {
  const env = p.add("adsr", at, adsr, { name: opts.name || "Amp Env" });
  const amp = p.add("vca", [at[0] + 1, at[1]], opts.vca || {}, { name: "VCA" });
  p.cable(p.vin, "gate", env, "gate").cable(p.vin, "trigger", env, "retrig").cable(p.vin, "velocity", env, "velocity");
  if (src.stereo) p.stereo(src.node, amp, { from: src.jacks || ["l", "r"] });
  else p.cable(src.node, src.jack || "out", amp, "l");
  p.cable(env, "env", amp, "gain").cable(env, "active", p.vout, "active");
  p.stereo(amp, p.vout);
  return { env, amp };
}

/// A gate/trigger/velocity driven ADSR (filter or mod envelopes).
export function envelope(p, at, adsr, name = "Env") {
  const env = p.add("adsr", at, adsr, { name });
  p.cable(p.vin, "gate", env, "gate").cable(p.vin, "trigger", env, "retrig").cable(p.vin, "velocity", env, "velocity");
  return env;
}

/// Step Sequencer data: a pattern string per lane. `notes` are semitones above
/// the root per step (null or "." = rest, "_" = tie); `vel` optional 1–127.
export function steps(notes, vel) {
  const out = notes.map((n, i) => {
    const v = vel ? vel[i % vel.length] : 100;
    if (n === null || n === ".") return { g: 0, p: 0, v };
    if (n === "_") return { g: 2, p: 0, v };
    return { g: 1, p: n, v };
  });
  // Ties hold the previous pitch.
  for (let i = 1; i < out.length; i++) if (out[i].g === 2) out[i].p = out[i - 1].p;
  while (out.length < 32) out.push({ g: 0, p: 0, v: 100 });
  return { steps: out };
}

/// Drum Grid data: 8 tracks; patterns as 16-char strings (X accent, x hit, . rest).
export function drumGrid(trackNames, patterns) {
  return {
    tracks: trackNames.map((name) => ({ name, mute: false, solo: false })),
    current: 0,
    patterns: patterns.concat(new Array(16 - patterns.length).fill(null)),
  };
}
export const pattern = (name, steps, length = 16) => ({ name, length, steps });

/// A category: its name, one sentence about it, and its presets (functions or Preset objects).
export function category(name, blurb, presets) {
  return { name, blurb, presets };
}

/// Compact reference of every module (units, ranges, defaults), for authors.
export function reference() {
  const lines = [];
  for (const t of Object.values(types)) {
    if (t.port || (!t.creatable && !["voice-in", "voice-out", "cell-in", "cell-out"].includes(t.type))) continue;
    lines.push(`## ${t.type} — ${t.name} (${t.category}): ${t.description}`);
    lines.push("  in:  " + t.inputs.map((j) => `${j.id}:${j.type}`).join(", "));
    lines.push("  out: " + t.outputs.map((j) => `${j.id}:${j.type}${j.bipolar === false ? "(uni)" : ""}`).join(", "));
    for (const p of t.params) {
      const d = denormalise(p, p.default);
      let desc;
      if (p.kind === "choice") desc = `choice [${p.choices.join(" | ")}] default '${p.choices[d - p.min]}'`;
      else if (p.kind === "bool") desc = `bool default ${!!d}`;
      else if (p.kind === "int") desc = `int ${p.min}..${p.max} default ${d}`;
      else desc = `float ${p.min}..${+p.max.toPrecision(6)} ${p.map || "lin"} default ${+d.toPrecision(4)}`;
      lines.push(`    ${p.id}${p.modulatable ? "" : " (setting)"}: ${p.name} — ${desc}`);
    }
  }
  return lines.join("\n");
}
