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
function resolveParam(where, p, v) {
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

const GRID_X = 300, GRID_Y = 220;  // one layout column / row on the board

/// Builds one preset. `kind`: "voice" (a Voice Cell: notes in, audio out) or
/// "cell" (an ordinary cell with the jacks it declares).
export class Preset {
  constructor(kind, name, opts = {}) {
    if (kind !== "voice" && kind !== "cell") throw new Error(`${name}: kind must be 'voice' or 'cell'`);
    this.kind = kind;
    this.name = name;
    this.description = opts.description || "";
    this.tags = opts.tags || [];
    this.nodes = [];
    this.cables = [];
    this.ids = new Set();
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

  #where(n, what) { return `${this.name} › ${n.name}${what ? " › " + what : ""}`; }

  #boundary(id, type, name, at) {
    const n = { id, type, name, x: 40 + (at[0] + 1) * GRID_X, y: 40 + at[1] * GRID_Y, parent: "root", params: {} };
    this.nodes.push(n);
    this.ids.add(id);
    return n;
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
                parent: "root", params: {} };
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

  #outType(n, jack) {
    if (n.type === "cell-in") return (this.root.inputs.find((j) => j.id === jack) || {}).type;
    const j = types[n.type].outputs.find((o) => o.id === jack);
    return j && j.type;
  }
  #inType(n, jack) {
    if (n.type === "cell-out") return (this.root.outputs.find((j) => j.id === jack) || {}).type;
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
    this.#wireTempo();
    if (this.kind === "voice") {
      if (!this.cables.some((c) => c.to.node === "vo" && c.to.jack === "l"))
        throw new Error(`${this.name}: nothing reaches Voice Out › Out L`);
    }
    for (const j of this.root.outputs)
      if (!this.cables.some((c) => c.to.node === "co" && c.to.jack === j.id))
        throw new Error(`${this.name}: output '${j.name}' isn't patched inside`);
    if (this.kind === "cell" && !this.root.outputs.length) throw new Error(`${this.name}: a cell preset needs an output`);
    return { format: 1, root: "root", category, description: this.description, tags: this.tags,
             nodes: this.nodes, cables: this.cables };
  }
}

export const voice = (name, opts) => new Preset("voice", name, opts);
export const cell = (name, opts) => new Preset("cell", name, opts);

// ------------------------------------------------------------ small helpers

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
