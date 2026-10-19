// SPDX-License-Identifier: GPL-3.0-or-later
// The Bleep Script transform for the AssemblyScript compiler (doc/specs/bleep-script.md, sections 3 and 7).
//
// It reads the decorators on a module class:
//
//   @module({ name, type, category, colour, description })     the class: one node type
//   @input({ name, type, bipolar })    f32 field: an input jack (type: audio | control | pitch | gate | trigger)
//   @output({ name, type, bipolar })   f32 field: an output jack
//   @param({ name, min, max, init, unit, decimals, group, minText, modulatable })
//                                      f32 field (a number in units), bool field (a toggle) or i32 field with
//                                      `choices: [...]` (a choice) or `min` and `max` (an integer)
//   @probe                             f32 field: a value the view can poll
//
// and the methods `block()`, `sample()` and `reset()`. From them it generates
//   1. the node type description (the JSON of bleep_spec_json, module-abi.md section 7), and
//   2. an entry source file with the bleep_* exports and a glue class that moves the ABI's buffers into the fields:
//      a param holds its value in units, set once per chunk; an input holds its first sample in block(), and the
//      current sample in sample(); an output is read back after each sample().
// The entry file is added to the compilation in `afterParse`, so the compiler type-checks it like the user's code.
//
// Runs wherever the compiler runs: node, a worker, a page. No file system, no eval.

import { ASTBuilder } from "assemblyscript";
import { Subset, BUDGET } from "./subset.mjs";

const CHUNK = 32;

const SIGNAL_TYPES = ["audio", "control", "pitch", "gate", "trigger", "notes"];
const UNIPOLAR = new Set(["gate", "trigger", "notes"]);
const DECORATORS = new Set(["module", "input", "output", "param", "probe", "on", "button"]);

/// A problem in the user's declarations. Carries the position so the editor can mark it.
/// Thrown to stop a compile once the settings of the module are known (the first pass of compile.mjs).
export class SettingsDone extends Error { constructor() { super("bleep-settings-done"); this.name = "SettingsDone"; } }

export class BleepError extends Error {
  constructor(message, file, line) {
    super(`${file}:${line}: ${message}`);
    this.file = file;
    this.line = line;
  }
}

// ---- decorator arguments: a small literal parser (never eval) ---------------------------------------------------------
function parseLiteral(text, idents = {}) {
  let i = 0;
  const fail = (why) => { throw new Error(`${why} in "${text.length > 60 ? text.slice(0, 60) + "…" : text}"`); };
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const value = () => {
    ws();
    const c = text[i];
    if (c === "{") return object();
    if (c === "[") return array();
    if (c === '"' || c === "'") return string();
    if (/[-+0-9.]/.test(c)) return number();
    const word = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
    if (word) {
      i += word[0].length;
      if (word[0] === "true") return true;
      if (word[0] === "false") return false;
      if (word[0] === "null") return null;
      if (Object.prototype.hasOwnProperty.call(idents, word[0])) return idents[word[0]];   // a setting of the module, e.g. count: CHANNELS
      fail(`only literals and the module's settings are allowed in decorator arguments, not '${word[0]}'`);
    }
    return fail("unexpected character " + JSON.stringify(c));
  };
  const string = () => {
    const quote = text[i++];
    let s = "";
    while (i < text.length && text[i] !== quote) {
      if (text[i] === "\\") { i++; s += { n: "\n", t: "\t" }[text[i]] ?? text[i]; } else s += text[i];
      i++;
    }
    if (text[i++] !== quote) fail("unterminated string");
    return s;
  };
  const number = () => {
    const m = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(text.slice(i));
    if (!m) fail("bad number");
    i += m[0].length;
    return Number(m[0]);
  };
  const array = () => {
    const out = [];
    i++;
    ws();
    while (text[i] !== "]") {
      out.push(value());
      ws();
      if (text[i] === ",") { i++; ws(); } else if (text[i] !== "]") fail("expected , or ]");
    }
    i++;
    return out;
  };
  const object = () => {
    const out = {};
    i++;
    ws();
    while (text[i] !== "}") {
      ws();
      let key;
      if (text[i] === '"' || text[i] === "'") key = string();
      else {
        const id = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
        if (!id) fail("expected a key");
        key = id[0];
        i += key.length;
      }
      ws();
      if (text[i++] !== ":") fail("expected :");
      out[key] = value();
      ws();
      if (text[i] === ",") { i++; ws(); } else if (text[i] !== "}") fail("expected , or }");
    }
    i++;
    return out;
  };
  const result = value();
  ws();
  if (i < text.length) fail("unexpected text after the value");
  return result;
}

const slug = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
const titleCase = (id) => id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
const num = (x) => Number(Number(x).toPrecision(9));   // float32-ish: the engine's own JSON prints 9 digits

// ---- reading a source file ---------------------------------------------------------------------------------------------
function lineOf(source, node) {
  try { return source.text.slice(0, node.range.start).split("\n").length; } catch { return 1; }
}

/// The TSDoc comment (/** ... */) written just before a declaration and its decorators, as plain text; "" if there is none.
function docOf(source, node) {
  try {
    let start = node.range.start;
    for (const d of node.decorators || []) start = Math.min(start, d.range.start);
    const before = source.text.slice(0, start).trimEnd();
    if (!before.endsWith("*/")) return "";
    const open = before.lastIndexOf("/**");
    if (open < 0 || before.slice(open + 3, -2).includes("*/")) return "";
    return before.slice(open + 3, -2).split("\n").map((l) => l.replace(/^\s*\*? ?/, "").trimEnd()).join("\n").trim().replace(/\n{2,}/g, "\n\n").replace(/([^\n])\n(?!\n)/g, "$1 ");
  } catch { return ""; }
}

function decoratorsOf(node, source, idents = {}) {
  const out = {};
  for (const d of node.decorators || []) {
    const name = d.name && d.name.text;
    if (!DECORATORS.has(name)) continue;
    let options = {};
    if (d.args && d.args.length) {
      try {
        const v = parseLiteral(ASTBuilder.build(d.args[0]), idents);
        options = typeof v === "string" ? { name: v } : v;
        if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("expected an object or a name");
        if (d.args[1]) {   // @on("jack", { rising: 0.5 }): the second argument adds options
          const more = parseLiteral(ASTBuilder.build(d.args[1]), idents);
          if (!more || typeof more !== "object" || Array.isArray(more)) throw new Error("the second argument must be an object");
          options = { ...options, ...more };
        }
      } catch (e) { throw new BleepError(`@${name}: ${e.message}`, source.normalizedPath, lineOf(source, d)); }
    }
    out[name] = options;
  }
  return out;
}

const MAX_COUNT = 64;

/// The settings a module declares: [{ id, name, min, max, init }], validated.
function settingsOf(top, bad, st) {
  const list = top.module.settings;
  if (list === undefined) return [];
  if (!Array.isArray(list)) bad(st, "@module settings must be a list: settings: [{ id: \"CHANNELS\", name: \"Channels\", min: 1, max: 32, init: 8 }]");
  const seen = new Set();
  return list.map((s) => {
    if (!s || typeof s.id !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(s.id)) bad(st, "a setting needs an id in capitals, e.g. CHANNELS: it is the constant your code uses");
    if (seen.has(s.id)) bad(st, `setting ${s.id} is declared twice`);
    seen.add(s.id);
    if (![s.min, s.max, s.init].every(Number.isInteger) || !(s.max >= s.min) || s.init < s.min || s.init > s.max) bad(st, `setting ${s.id} needs whole numbers min, max and init, with init from min to max`);
    return { id: s.id, name: s.name || titleCase(s.id.toLowerCase()), min: s.min, max: s.max, init: s.init };
  });
}

/// The module classes of one parsed source, as plain descriptions. `constants`: { SETTING: value } chosen for the module's settings
/// (a setting not in it takes its init). `settingsOnly`: read the settings and nothing else.
function readModules(source, constants = {}, settingsOnly = false) {
  const modules = [];
  const file = source.normalizedPath;
  for (const st of source.statements) {
    if (!st.decorators || !st.members) continue;
    const top = decoratorsOf(st, source);
    if (!top.module) continue;
    const bad = (node, message) => { throw new BleepError(message, file, lineOf(source, node)); };
    const className = st.name.text;
    const settings = settingsOf(top, bad, st);
    const values = {};
    for (const x of settings) values[x.id] = Math.min(x.max, Math.max(x.min, Math.round(Number(constants[x.id] ?? x.init))));
    const mod = {
      className, file, source, values,
      settings: settings.map((x) => ({ ...x, value: values[x.id] })),
      name: top.module.name || className,
      type: top.module.type || slug(top.module.name || className),
      category: top.module.category || "Utility/Script",
      colour: top.module.colour || "#94a3b8",
      description: top.module.description || docOf(source, st),
      params: [], inputs: [], outputs: [], probes: [], methods: new Set(), handlers: [], buttons: [],
    };
    modules.push(mod);
    if (settingsOnly) continue;
    // the jacks, knobs and probes with `count` expand to numbered ones: low1, low2, ...; each remembers its field and index
    const counted = (opts, m, name, elem, key) => {
      if (opts.count === undefined) return { n: 0, tname: elem };
      if (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > MAX_COUNT) bad(m, `@${key} '${name}': count must be a whole number from 1 to ${MAX_COUNT}`);
      return { n: opts.count, tname: `StaticArray<${elem}>` };
    };
    const expand = (opts, name, n, fill) => {
      if (!n) return [fill(name, opts.name || titleCase(name), -1)];
      const names = Array.isArray(opts.names) ? opts.names : null;
      return Array.from({ length: n }, (_, k) => fill(`${name}${k + 1}`, names && names[k] ? String(names[k]) : `${opts.name || titleCase(name)} ${k + 1}`, k));
    };
    for (const m of st.members) {
      const name = m.name && m.name.text;
      if (m.decorators && m.decorators.length && !m.type) {
        const found = decoratorsOf(m, source, mod.values);
        delete found.on; delete found.button;   // @on and @button are the decorators a method takes
        if (Object.keys(found).length) bad(m, `a decorator on '${name}' needs a field`);
      }
      if (m.type === undefined || m.type === null) {   // a method (or constructor)
        if (name) mod.methods.add(name);
        const found = decoratorsOf(m, source, mod.values);
        if (found.on) mod.handlers.push({ method: name, jack: found.on.name, rising: found.on.rising, falling: found.on.falling, node: m });
        if (found.button) mod.buttons.push({ id: name, name: found.button.name || titleCase(name), momentary: found.button.momentary === true, doc: found.button.description || docOf(source, m), node: m });
        continue;
      }
      const dec = decoratorsOf(m, source, mod.values);
      const keys = Object.keys(dec);
      if (keys.length === 0) continue;
      if (keys.length > 1) bad(m, `'${name}' has more than one of @${keys.join(", @")}`);
      const key = keys[0];
      const opts = dec[key];
      const tname = ASTBuilder.build(m.type);
      const initial = m.initializer ? ASTBuilder.build(m.initializer) : "";
      const doc = opts.description || docOf(source, m);
      if (key === "module") bad(m, "@module goes on a class");
      if (key === "on" || key === "button") bad(m, `@${key} goes on a method`);
      if (key === "input" || key === "output" || key === "probe") {
        const notes = key !== "probe" && opts.type === "notes";
        if (notes && opts.count !== undefined) bad(m, `@${key} '${name}': a notes jack cannot have a count`);
        const { n, tname: wanted } = counted(opts, m, name, notes ? "NoteStream" : "f32", key);
        if (tname !== wanted) bad(m, `@${key} field '${name}' must be ${wanted}, not ${tname}${notes ? " (a notes jack; import { NoteStream } from \"./bleep/notes\")" : ""}`);
        if (key === "probe") {
          mod.probes.push(...expand(opts, name, n, (id, label, k) => ({ id, name: label, doc, field: name, index: k, ref: k < 0 ? name : `${name}[${k}]`, arrayType: n ? wanted : null, count: n })));
        } else {
          const type = opts.type || "audio";
          if (!SIGNAL_TYPES.includes(type)) bad(m, `@${key} '${name}': type must be one of ${SIGNAL_TYPES.join(", ")}`);
          (key === "input" ? mod.inputs : mod.outputs).push(...expand(opts, name, n, (id, label, k) => ({
            id, name: label, type, bipolar: opts.bipolar ?? !UNIPOLAR.has(type), doc, field: name, index: k, ref: k < 0 ? name : `${name}[${k}]`, arrayType: n ? wanted : null, count: n,
          })));
        }
      } else {   // param
        const isBool = tname === "bool" || tname === "StaticArray<bool>";
        const elem = isBool ? "bool" : opts.choices ? "i32" : (tname === "i32" || tname === "StaticArray<i32>") ? "i32" : "f32";
        const { n, tname: wanted } = counted(opts, m, name, elem, key);
        if (tname !== wanted) bad(m, `@param field '${name}' must be ${wanted}, not ${tname}${n ? " (a param with count is a StaticArray)" : ""}`);
        // the default is `init`, or else the field's own initial value; giving both and different ones is a mistake
        let fromField;
        if (initial && !n) { try { fromField = parseLiteral(initial); } catch { /* not a literal: ignored */ } }
        let init = opts.init;
        if (typeof fromField === "boolean") fromField = fromField ? 1 : 0;
        if (typeof init === "boolean") init = init ? 1 : 0;
        if (typeof fromField === "number") {
          if (init === undefined) init = fromField;
          else if (init !== fromField) bad(m, `@param '${name}': init ${init} differs from the field's initial value ${fromField}; give only one`);
        }
        const base = { doc, unit: opts.unit, minText: opts.minText, field: name, arrayType: n ? wanted : null, count: n };
        const group = (k) => (opts.group === undefined ? undefined : String(opts.group).replace("{n}", String(k + 1)));
        const make = (extra) => expand(opts, name, n, (id, label, k) => ({ ...base, id, name: label, group: group(k), index: k, ref: k < 0 ? name : `${name}[${k}]`, ...extra }));
        if (isBool) {
          mod.params.push(...make({ kind: "bool", min: 0, max: 1, def: init ?? 0, steps: 2, format: "toggle", decimals: 0, modulatable: opts.modulatable ?? false }));
        } else if (opts.choices) {
          if (elem !== "i32") bad(m, `@param '${name}' with choices must be i32, not ${tname}`);
          if (!Array.isArray(opts.choices) || opts.choices.length < 2) bad(m, `@param '${name}': choices needs at least two names`);
          mod.params.push(...make({ kind: "choice", min: 0, max: opts.choices.length - 1, def: init ?? 0, steps: opts.choices.length, format: "choice", decimals: 2, choices: opts.choices, modulatable: opts.modulatable ?? false }));
        } else {
          const isInt = elem === "i32";
          if (typeof opts.min !== "number" || typeof opts.max !== "number" || !(opts.max > opts.min)) bad(m, `@param '${name}' needs min and max, with max above min`);
          const map = opts.map || "linear";
          if (!["linear", "exp", "skew"].includes(map)) bad(m, `@param '${name}': map must be "linear", "exp" or "skew"`);
          if (map !== "linear" && isInt) bad(m, `@param '${name}': an integer parameter is linear`);
          if (map === "exp" && !(opts.min > 0)) bad(m, `@param '${name}': an exponential parameter needs min above 0`);
          if (map === "skew" && !(opts.centre > opts.min && opts.centre < opts.max)) bad(m, `@param '${name}': a skewed parameter needs centre (the value in the middle of the knob) between min and max`);
          const def = init ?? opts.min;
          if (def < opts.min || def > opts.max) bad(m, `@param '${name}': init ${def} is outside ${opts.min} to ${opts.max}`);
          mod.params.push(...make({
            kind: isInt ? "int" : "float", min: opts.min, max: opts.max, def, steps: isInt ? opts.max - opts.min + 1 : 0, format: isInt ? "integer" : "number",
            decimals: opts.decimals ?? 2, modulatable: opts.modulatable ?? true, map, centre: opts.centre,
          }));
        }
      }
    }
    for (const b of mod.buttons) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(b.id)) bad(b.node, `@button '${b.id}': the method name is the button's id and must be a plain identifier`);
    for (const h of mod.handlers) {
      const jack = mod.inputs.find((j) => j.id === h.jack);
      if (!h.jack || !jack) bad(h.node, `@on('${h.jack}'): there is no @input field of that name`);
      if (jack.type === "notes") {
        if (h.rising !== undefined || h.falling !== undefined) bad(h.node, `@on('${h.jack}'): a notes input takes no rising or falling option`);
        h.kind = "notes";
      } else {
        if ((h.rising === undefined) === (h.falling === undefined)) bad(h.node, `@on('${h.jack}', { rising: level }) or { falling: level }: a ${jack.type} input needs exactly one`);
        if (typeof (h.rising ?? h.falling) !== "number") bad(h.node, `@on('${h.jack}'): the level must be a number`);
        h.kind = h.rising !== undefined ? "rising" : "falling";
        h.level = h.rising ?? h.falling;
      }
      h.index = mod.inputs.indexOf(jack);
    }
    if (!mod.params.length && !mod.inputs.length && !mod.outputs.length) bad(st, `module '${className}' declares nothing: add @input, @output or @param fields`);
  }
  return modules;
}

// ---- parameter mappings: the engine's (ParamSpec::toNormalised / fromNormalised in engine/Spec.h) ---------------------------------
const skewOf = (p) => Math.log(0.5) / Math.log((p.centre - p.min) / (p.max - p.min));
/// A value in units to the knob's 0 to 1.
function normalise(p, v) {
  if (p.map === "exp") return Math.log(v / p.min) / Math.log(p.max / p.min);
  if (p.map === "skew") { const x = (v - p.min) / (p.max - p.min); return x <= 0 ? 0 : Math.pow(x, skewOf(p)); }
  return (v - p.min) / (p.max - p.min);
}
/// AssemblyScript source for the value in units of a normalised expression `x` (an f64 expression), as an f64 expression.
function unitsExpr(p, x) {
  if (p.map === "exp") return `${f(p.min)} * Math.pow(${f(p.max / p.min)}, ${x})`;
  if (p.map === "skew") return `(${x} <= 0.0 ? ${f(p.min)} : ${f(p.min)} + ${f(p.max - p.min)} * Math.exp(Math.log(${x}) / ${skewOf(p)}))`;
  return `${f(p.min)} + ${f(p.max - p.min)} * ${x}`;
}

// ---- generated: the node type description -------------------------------------------------------------------------------
export function specOf(mod) {
  return {
    type: mod.type, name: mod.name, category: mod.category, colour: mod.colour, description: mod.description,
    port: "", creatable: true, standaloneOnly: false,
    params: mod.params.map((p) => {
      const out = {
        id: p.id, name: p.name, kind: p.kind, default: num(normalise(p, p.def)), steps: p.steps,
        modulatable: p.modulatable, min: p.min, max: p.max, def: p.def, format: p.format, decimals: p.decimals,
      };
      if (p.map && p.map !== "linear") { out.map = p.map; if (p.map === "skew") out.centre = p.centre; }
      if (p.doc) out.description = p.doc;
      if (p.unit) out.label = p.unit;
      if (p.group) out.group = p.group;
      if (p.choices) out.choices = p.choices;
      return out;
    }),
    inputs: mod.inputs.map(({ id, name, type, bipolar, doc }) => ({ id, name, type, bipolar, ...(doc ? { description: doc } : {}) })),
    outputs: mod.outputs.map(({ id, name, type, bipolar, doc }) => ({ id, name, type, bipolar, ...(doc ? { description: doc } : {}) })),
    buttons: mod.buttons.map(({ id, name, momentary, doc }) => ({ id, name, momentary, ...(doc ? { description: doc } : {}) })),
    probes: mod.probes.map(({ id, name, doc }) => ({ id, name, ...(doc ? { description: doc } : {}) })),   // not in the ABI's description (hosts ignore unknown fields): what a view can poll
    settings: mod.settings || [],
    cost: mod.cost || { ops: 0, block: 0, sample: 0, handlers: 0, limit: BUDGET.error },   // estimated ops per chunk (subset.mjs): for the editor, ignored by hosts
  };
}

// ---- generated: the entry source --------------------------------------------------------------------------------------------
const f = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));   // an AssemblyScript f64 literal

function glueOf(mod, index) {
  const cls = `Bleep_${mod.className}`;
  const P = mod.params, I = mod.inputs, O = mod.outputs;
  const has = (name) => mod.methods.has(name);
  const isNotes = (j) => j.type === "notes";
  const withIndex = (list) => list.map((j, i) => [j, i]);
  const signalIn = withIndex(I).filter(([j]) => !isNotes(j)), signalOut = withIndex(O).filter(([j]) => !isNotes(j));
  const notesIn = withIndex(I).filter(([j]) => isNotes(j)), notesOut = withIndex(O).filter(([j]) => isNotes(j));
  const noteHandlers = mod.handlers.filter((h) => h.kind === "notes");
  const edges = mod.handlers.map((h, hi) => ({ ...h, hi })).filter((h) => h.kind !== "notes");
  const arrayFields = [...new Map([...P, ...I, ...O, ...mod.probes].filter((x) => x.arrayType).map((x) => [x.field, x])).values()];   // one allocation per array field
  const loadParams = P.map((p, i) => {
    const norm = `this.params[${i} * CHUNK]`;
    if (p.kind === "bool") return `    m.${p.ref} = ${norm} >= 0.5;`;
    if (p.kind === "float") return `    m.${p.ref} = <f32>(${unitsExpr(p, `<f64>${norm}`)});`;
    return `    m.${p.ref} = <i32>Math.round(${f(p.min)} + ${f(p.max - p.min)} * <f64>${norm});`;   // int and choice
  });
  const loadInputs = (at) => signalIn.map(([j, i]) => `m.${j.ref} = this.inputs[${i} * CHUNK + ${at}];`);
  const paramText = P.filter((p) => p.kind === "float" || p.kind === "int").map((p) => {
    const i = P.indexOf(p);
    const value = unitsExpr(p, "<f64>normalised");
    const unit = p.unit ? ` + " ${p.unit}"` : "";
    const digits = p.kind === "int" ? 0 : p.decimals;
    const minText = p.minText ? `      if (v <= ${f(p.min + (p.max - p.min) * 0.001)}) return ${JSON.stringify(p.minText)};\n` : "";
    return `    if (index == ${i}) {\n      const v: f64 = ${value};\n${minText}      return formatNumber(v, ${digits})${unit};\n    }`;
  });
  const choiceText = P.filter((p) => p.kind === "choice").map((p) => {
    const i = P.indexOf(p);
    const names = JSON.stringify(p.choices);
    return `    if (index == ${i}) {\n      const names: string[] = ${names};\n      return names[<i32>Math.round(<f64>normalised * ${p.choices.length - 1}.0)];\n    }`;
  });
  const live = mod.probes.map((p) => `'"${p.id}":' + m.${p.ref}.toString()`).join(` + ',' + `) || "''";

  // the notes jacks that have handlers: events are read in order and fired before the sample they are at
  const noteJacks = [...new Set(noteHandlers.map((h) => h.index))].map((ji) => ({ ji, id: I[ji].id, calls: noteHandlers.filter((h) => h.index === ji).map((h) => `m.${h.method}(this.ev);`).join(" ") }));
  const fire = (nj, cond) => `while (p${nj.ji} < c${nj.ji}${cond}) { m.${nj.id}.read(p${nj.ji}, this.ev); ${nj.calls} p${nj.ji}++; }`;
  const edgeCode = edges.map((e) => {
    const cmp = e.kind === "rising" ? `this.prev${e.hi} < ${f(e.level)} && v >= ${f(e.level)}` : `this.prev${e.hi} > ${f(e.level)} && v <= ${f(e.level)}`;
    return `{ const v = this.inputs[${e.index} * CHUNK + i]; if (${cmp}) m.${e.method}(); this.prev${e.hi} = v; }`;
  });
  const needsLoop = has("sample") || signalIn.length || signalOut.length || edges.length || noteJacks.length;
  return `
class ${cls} extends Module {
  readonly m: ${mod.className};
  readonly ev: NoteEvent = new NoteEvent();
  started: bool = false;
${edges.map((e) => `  prev${e.hi}: f32 = 0;`).join("\n")}
  constructor(sampleRate: f64) {
    super(${P.length}, ${I.length}, ${O.length});
    this.m = new ${mod.className}(sampleRate);
${arrayFields.map((x) => `    this.m.${x.field} = new ${x.arrayType}(${x.count});`).join("\n")}
${notesIn.map(([j, i]) => `    this.notesIn[${i}] = new ArrayBuffer(NOTE_BUFFER_BYTES);\n    this.m.${j.id} = new NoteStream(changetype<usize>(this.notesIn[${i}]));`).join("\n")}
${notesOut.map(([j, i]) => `    this.notesOut[${i}] = new ArrayBuffer(NOTE_BUFFER_BYTES);\n    this.m.${j.id} = new NoteStream(changetype<usize>(this.notesOut[${i}]));`).join("\n")}
  }
  reset(): void {${has("reset") ? " this.m.reset();" : ""} this.started = false; }
  process(n: i32): void {
    const m = this.m;
    // block rate: params in units, inputs at their first sample
${loadParams.join("\n")}
    ${loadInputs(0).join("\n    ")}
    ${notesOut.map(([j]) => `m.${j.id}.clear();`).join("\n    ")}
    if (!this.started) {
      ${edges.map((e) => `this.prev${e.hi} = this.inputs[${e.index} * CHUNK];`).join("\n      ")}
      this.started = true;
    }
${has("block") ? "    m.block();" : ""}
    ${noteJacks.map((nj) => `const c${nj.ji}: i32 = m.${nj.id}.length; let p${nj.ji}: i32 = 0;`).join("\n    ")}
${needsLoop ? `    for (let i = 0; i < n; i++) {
      ${loadInputs("i").join("\n      ")}
      ${noteJacks.map((nj) => fire(nj, ` && m.${nj.id}.offsetAt(p${nj.ji}) <= i`)).join("\n      ")}
      ${edgeCode.join("\n      ")}
${has("sample") ? "      m.sample();" : ""}
      ${signalOut.map(([j, k]) => `this.outputs[${k} * CHUNK + i] = m.${j.ref};`).join("\n      ")}
    }` : ""}
    ${noteJacks.map((nj) => fire(nj, "")).join("\n    ")}
  }
  command(value: f32): void {
${mod.buttons.map((b) => `    if (scratchEquals("${b.id}")) { this.m.${b.id}(); return; }`).join("\n")}
  }
  paramText(index: i32, normalised: f32): string {
${paramText.concat(choiceText).join("\n")}
    return "";
  }
  live(): string {
    const m = this.m;
    return '{"values":{' + ${live} + '},"arrays":{}}';
  }
}`;
}

export function entryOf(mods, { importFrom, abiFrom }) {
  const specs = JSON.stringify(mods.map(specOf));
  const imports = [...new Set(mods.map((m) => m.className))];
  return `// Generated by the Bleep Script transform (transform/bleep.mjs). Do not edit.
import { CHUNK, NOTE_BUFFER_BYTES, Module, addressOf, asModule, handleOf, notesPtr, scratch, scratchEquals, setText, textAddress } from "${abiFrom}/abi";
import { NoteEvent, NoteStream } from "${abiFrom}/notes";
import { formatNumber } from "${abiFrom}/format";
import { ${imports.join(", ")} } from "${importFrom}";
${mods.map(glueOf).join("\n")}

const specJson: ArrayBuffer = String.UTF8.encode(${JSON.stringify(specs)}, false);
const errorText: ArrayBuffer = String.UTF8.encode("", true);

export function bleep_error(): usize { return changetype<usize>(errorText); }
export function bleep_spec_json(): usize { return changetype<usize>(specJson); }
export function bleep_spec_json_length(): i32 { return specJson.byteLength; }
export function bleep_type_count(): i32 { return ${mods.length}; }
export function bleep_chunk(): i32 { return CHUNK; }
export function bleep_note_event_size(): i32 { return 16; }

export function bleep_create(typeIndex: i32, sampleRate: f64): usize {
${mods.map((m, i) => `  if (typeIndex == ${i}) return handleOf(new Bleep_${m.className}(sampleRate));`).join("\n")}
  return 0;
}
export function bleep_destroy(h: usize): void {}           // the stub runtime never frees; the host drops the whole instance
export function bleep_reset(h: usize): void { asModule(h).reset(); }

export function bleep_params_ptr(h: usize): usize { return addressOf(asModule(h).params); }
export function bleep_inputs_ptr(h: usize): usize { return addressOf(asModule(h).inputs); }
export function bleep_outputs_ptr(h: usize): usize { return addressOf(asModule(h).outputs); }
export function bleep_in_connected_ptr(h: usize): usize { return addressOf(asModule(h).inConnected); }
export function bleep_out_connected_ptr(h: usize): usize { return addressOf(asModule(h).outConnected); }

export function bleep_set_knob(h: usize, index: i32, normalised: f32): void { asModule(h).setKnob(index, normalised); }
export function bleep_set_transport(h: usize, bpm: f64, ppq: f64, playing: i32, samplePos: i64): void {}
export function bleep_process(h: usize, numSamples: i32): i32 {
  if (numSamples < 1 || numSamples > CHUNK) return 1;
  asModule(h).process(numSamples);
  return 0;
}

export function bleep_notes_in_ptr(h: usize, jack: i32): usize { return notesPtr(asModule(h).notesIn, jack); }
export function bleep_notes_out_ptr(h: usize, jack: i32): usize { return notesPtr(asModule(h).notesOut, jack); }

export function bleep_scratch(h: usize, size: i32): usize { return scratch(size); }
export function bleep_text(h: usize): usize { return textAddress(); }
export function bleep_text_length(h: usize): i32 { return 0; }
export function bleep_set_data(h: usize, length: i32): void {}
export function bleep_sanitise_data(h: usize, typeIndex: i32, length: i32): i32 { return -1; }
export function bleep_perform(h: usize, argOffset: i32, numArgs: i32): void {}
export function bleep_command(h: usize, value: f32): void { asModule(h).command(value); }
export function bleep_live(h: usize): i32 { return setText(asModule(h).live()); }
export function bleep_param_text(h: usize, index: i32, normalised: f32): i32 { return setText(asModule(h).paramText(index, normalised)); }
export function bleep_output_display(h: usize, index: i32): f32 { return asModule(h).outputDisplay(index); }
export function bleep_take_data(h: usize): i32 { return -1; }
`;
}

// ---- the transform ---------------------------------------------------------------------------------------------------------------
/// `new BleepTransform()` and pass it to asc as `transforms: [transform]`. After the compile, `transform.modules` has what it found
/// and `transform.specs` the generated node type descriptions.
export class BleepTransform {
  /// abiFrom: where bleep/abi.ts and bleep/format.ts are, as an import path from the module's directory.
  /// typeId: the node type id of the first module (a Code node gives its engine type); default: from the class name.
  /// constants: { NAME: value } chosen for the module's settings (a setting left out takes its init).
  /// settingsOnly: read the settings (this.settings) and stop: the first pass of compile.mjs, before the constants are known.
  constructor({ abiFrom = "./bleep", typeId, constants = {}, settingsOnly = false } = {}) {
    this.abiFrom = abiFrom;
    this.typeId = typeId;
    this.constants = constants;
    this.settingsOnly = settingsOnly;
    this.settings = [];   // [{ id, name, min, max, init }] of the first module
    this.problems = [];   // errors and warnings of the subset checker: [{ severity, message, line, file }]
    this.modules = [];
    this.specs = [];
    this.generated = [];
  }

  afterParse(parser) {
    const bySource = new Map();
    for (const source of parser.sources) {
      const path = source.normalizedPath;
      if (path.startsWith("~lib/") || path.endsWith(".bleep-entry.ts")) continue;
      if (source.sourceKind !== 0 && source.sourceKind !== 1) continue;   // user files only
      const found = readModules(source, this.constants, this.settingsOnly);
      if (found.length) bySource.set(path, found);
      if (found.length && this.typeId && !this.typeApplied) { found[0].type = this.typeId; this.typeApplied = true; }
    }
    if (this.settingsOnly) {
      const first = [...bySource.values()][0];
      this.settings = first ? first[0].settings.map(({ value, ...x }) => x) : [];
      throw new SettingsDone();
    }
    // the subset: no host imports or raw memory anywhere in the user's files, and real-time rules and a cost for every module
    const subset = new Subset(parser.sources, { constants: Object.assign({}, ...[...bySource.values()].flat().map((m) => m.values)) });
    for (const source of subset.user) subset.checkFile(source);
    for (const mods of bySource.values()) {
      for (const mod of mods) {
        for (const h of mod.handlers) subset.markHandler(mod.className, h.method, h.kind === "notes" ? 64 : CHUNK);
        for (const b of mod.buttons) subset.markHandler(mod.className, b.id, 1);
        subset.costOfFn(subset.fns.find((f) => f.owner === mod.className && f.name === "reset" && !f.trusted) || { cost: 0, trusted: true });
        mod.cost = { ...subset.moduleCost(mod.className), limit: BUDGET.error };
        const file = mod.file, at = (name) => { const f = subset.fns.find((x) => x.owner === mod.className && x.name === name && !x.trusted); return f ? subset.line(f.source, f.node) : 1; };
        if (mod.cost.ops > BUDGET.error)
          subset.problems.push({ severity: "error", message: `module '${mod.className}' costs about ${mod.cost.ops} ops per chunk; the limit is ${BUDGET.error}`, line: at("sample"), file });
        else if (mod.cost.ops > BUDGET.warn)
          subset.problems.push({ severity: "warning", message: `module '${mod.className}' costs about ${mod.cost.ops} ops per chunk (${Math.round(100 * mod.cost.ops / BUDGET.error)} % of the limit)`, line: at("sample"), file });
      }
    }
    this.problems = subset.problems;
    const errors = subset.problems.filter((p) => p.severity === "error");
    if (errors.length) throw new BleepError(errors[0].message + (errors.length > 1 ? ` (and ${errors.length - 1} more)` : ""), errors[0].file, errors[0].line);

    for (const [path, mods] of bySource) {
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
      const base = path.slice(dir.length).replace(/\.ts$/, "");
      const entryPath = `${dir}${base}.bleep-entry.ts`;
      const text = entryOf(mods, { importFrom: `./${base}`, abiFrom: this.abiFrom });
      parser.parseFile(text, entryPath, true);
      this.generated.push({ path: entryPath, text });
      this.modules.push(...mods);
      this.specs.push(...mods.map(specOf));
    }
  }
}
