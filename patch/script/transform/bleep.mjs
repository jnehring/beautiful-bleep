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

const SIGNAL_TYPES = ["audio", "control", "pitch", "gate", "trigger"];
const UNIPOLAR = new Set(["gate", "trigger"]);
const DECORATORS = new Set(["module", "input", "output", "param", "probe"]);

/// A problem in the user's declarations. Carries the position so the editor can mark it.
export class BleepError extends Error {
  constructor(message, file, line) {
    super(`${file}:${line}: ${message}`);
    this.file = file;
    this.line = line;
  }
}

// ---- decorator arguments: a small literal parser (never eval) ---------------------------------------------------------
function parseLiteral(text) {
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
      fail(`only literals are allowed in decorator arguments, not '${word[0]}'`);
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

function decoratorsOf(node, source) {
  const out = {};
  for (const d of node.decorators || []) {
    const name = d.name && d.name.text;
    if (!DECORATORS.has(name)) continue;
    let options = {};
    if (d.args && d.args.length) {
      try {
        const v = parseLiteral(ASTBuilder.build(d.args[0]));
        options = typeof v === "string" ? { name: v } : v;
        if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("expected an object or a name");
      } catch (e) { throw new BleepError(`@${name}: ${e.message}`, source.normalizedPath, lineOf(source, d)); }
    }
    out[name] = options;
  }
  return out;
}

/// The module classes of one parsed source, as plain descriptions.
function readModules(source) {
  const modules = [];
  const file = source.normalizedPath;
  for (const st of source.statements) {
    if (!st.decorators || !st.members) continue;
    const top = decoratorsOf(st, source);
    if (!top.module) continue;
    const bad = (node, message) => { throw new BleepError(message, file, lineOf(source, node)); };
    const className = st.name.text;
    const mod = {
      className, file, source,
      name: top.module.name || className,
      type: top.module.type || slug(top.module.name || className),
      category: top.module.category || "Utility/Script",
      colour: top.module.colour || "#94a3b8",
      description: top.module.description || "",
      params: [], inputs: [], outputs: [], probes: [], methods: new Set(),
    };
    for (const m of st.members) {
      const kind = m.kind;
      const name = m.name && m.name.text;
      if (m.decorators && m.decorators.length && !m.type) {
        const found = decoratorsOf(m, source);
        if (Object.keys(found).length) bad(m, `a decorator on '${name}' needs a field`);
      }
      if (m.type === undefined || m.type === null) {   // a method (or constructor)
        if (name) mod.methods.add(name);
        continue;
      }
      const dec = decoratorsOf(m, source);
      const keys = Object.keys(dec);
      if (keys.length === 0) continue;
      if (keys.length > 1) bad(m, `'${name}' has more than one of @${keys.join(", @")}`);
      const key = keys[0];
      const opts = dec[key];
      const tname = ASTBuilder.build(m.type);
      const initial = m.initializer ? ASTBuilder.build(m.initializer) : "";
      if (key === "module") bad(m, "@module goes on a class");
      if (key === "input" || key === "output" || key === "probe") {
        if (tname !== "f32") bad(m, `@${key} field '${name}' must be f32, not ${tname}`);
      }
      if (key === "input" || key === "output") {
        const type = opts.type || "audio";
        if (!SIGNAL_TYPES.includes(type)) bad(m, `@${key} '${name}': type must be one of ${SIGNAL_TYPES.join(", ")}`);
        (key === "input" ? mod.inputs : mod.outputs).push({
          id: name, name: opts.name || titleCase(name), type, bipolar: opts.bipolar ?? !UNIPOLAR.has(type),
        });
      } else if (key === "probe") {
        mod.probes.push({ id: name, name: opts.name || titleCase(name) });
      } else {   // param
        // the default is `init`, or else the field's own initial value; giving both and different ones is a mistake
        let fromField;
        if (initial) { try { fromField = parseLiteral(initial); } catch { /* not a literal: ignored */ } }
        if (typeof fromField === "boolean") fromField = fromField ? 1 : 0;
        if (typeof opts.init === "boolean") opts.init = opts.init ? 1 : 0;
        if (typeof fromField === "number") {
          if (opts.init === undefined) opts.init = fromField;
          else if (opts.init !== fromField) bad(m, `@param '${name}': init ${opts.init} differs from the field's initial value ${fromField}; give only one`);
        }
        const p = { id: name, name: opts.name || titleCase(name), unit: opts.unit, group: opts.group, minText: opts.minText, tname, initial };
        if (tname === "bool") {
          Object.assign(p, { kind: "bool", min: 0, max: 1, def: opts.init ?? 0, steps: 2, format: "toggle", decimals: 0, modulatable: opts.modulatable ?? false });
        } else if (opts.choices) {
          if (tname !== "i32") bad(m, `@param '${name}' with choices must be i32, not ${tname}`);
          if (!Array.isArray(opts.choices) || opts.choices.length < 2) bad(m, `@param '${name}': choices needs at least two names`);
          Object.assign(p, { kind: "choice", min: 0, max: opts.choices.length - 1, def: opts.init ?? 0, steps: opts.choices.length, format: "choice", decimals: 2, choices: opts.choices, modulatable: opts.modulatable ?? false });
        } else {
          const isInt = tname === "i32";
          if (!isInt && tname !== "f32") bad(m, `@param '${name}' must be f32, bool or i32, not ${tname}`);
          if (typeof opts.min !== "number" || typeof opts.max !== "number" || !(opts.max > opts.min)) bad(m, `@param '${name}' needs min and max, with max above min`);
          if (opts.map) bad(m, `@param '${name}': map is not supported yet (only linear parameters)`);
          Object.assign(p, {
            kind: isInt ? "int" : "float", min: opts.min, max: opts.max, def: opts.init ?? opts.min,
            steps: isInt ? opts.max - opts.min + 1 : 0, format: isInt ? "integer" : "number",
            decimals: opts.decimals ?? (isInt ? 2 : 2), modulatable: opts.modulatable ?? true,
          });
          if (p.def < p.min || p.def > p.max) bad(m, `@param '${name}': init ${p.def} is outside ${p.min} to ${p.max}`);
        }
        mod.params.push(p);
      }
    }
    if (!mod.params.length && !mod.inputs.length && !mod.outputs.length) bad(st, `module '${className}' declares nothing: add @input, @output or @param fields`);
    modules.push(mod);
  }
  return modules;
}

// ---- generated: the node type description -------------------------------------------------------------------------------
export function specOf(mod) {
  return {
    type: mod.type, name: mod.name, category: mod.category, colour: mod.colour, description: mod.description,
    port: "", creatable: true, standaloneOnly: false,
    params: mod.params.map((p) => {
      const out = {
        id: p.id, name: p.name, kind: p.kind, default: num((p.def - p.min) / (p.max - p.min)), steps: p.steps,
        modulatable: p.modulatable, min: p.min, max: p.max, def: p.def, format: p.format, decimals: p.decimals,
      };
      if (p.unit) out.label = p.unit;
      if (p.group) out.group = p.group;
      if (p.choices) out.choices = p.choices;
      return out;
    }),
    inputs: mod.inputs.map(({ id, name, type, bipolar }) => ({ id, name, type, bipolar })),
    outputs: mod.outputs.map(({ id, name, type, bipolar }) => ({ id, name, type, bipolar })),
  };
}

// ---- generated: the entry source --------------------------------------------------------------------------------------------
const f = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));   // an AssemblyScript f64 literal

function glueOf(mod, index) {
  const cls = `Bleep_${mod.className}`;
  const P = mod.params, I = mod.inputs, O = mod.outputs;
  const has = (name) => mod.methods.has(name);
  const loadParams = P.map((p, i) => {
    const norm = `this.params[${i} * CHUNK]`;
    if (p.kind === "bool") return `    m.${p.id} = ${norm} >= 0.5;`;
    if (p.kind === "float") return `    m.${p.id} = <f32>(${f(p.min)} + ${f(p.max - p.min)} * <f64>${norm});`;
    return `    m.${p.id} = <i32>Math.round(${f(p.min)} + ${f(p.max - p.min)} * <f64>${norm});`;   // int and choice
  });
  const loadInputs = (at) => I.map((j, i) => `m.${j.id} = this.inputs[${i} * CHUNK + ${at}];`);
  const paramText = P.filter((p) => p.kind === "float" || p.kind === "int").map((p) => {
    const i = P.indexOf(p);
    const value = `${f(p.min)} + ${f(p.max - p.min)} * <f64>normalised`;
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
  const live = mod.probes.map((p) => `'"${p.id}":' + m.${p.id}.toString()`).join(` + ',' + `) || "''";
  return `
class ${cls} extends Module {
  readonly m: ${mod.className};
  constructor(sampleRate: f64) {
    super(${P.length}, ${I.length}, ${O.length});
    this.m = new ${mod.className}(sampleRate);
  }
  reset(): void {${has("reset") ? " this.m.reset();" : ""} }
  process(n: i32): void {
    const m = this.m;
    // block rate: params in units, inputs at their first sample
${loadParams.join("\n")}
    ${loadInputs(0).join("\n    ")}
${has("block") ? "    m.block();" : ""}
    for (let i = 0; i < n; i++) {
      ${loadInputs("i").join("\n      ")}
${has("sample") ? "      m.sample();" : ""}
      ${O.map((j, k) => `this.outputs[${k} * CHUNK + i] = m.${j.id};`).join("\n      ")}
    }
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
import { CHUNK, Module, addressOf, asModule, emptyNotes, handleOf, scratch, setText, textAddress } from "${abiFrom}/abi";
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

export function bleep_notes_in_ptr(h: usize, jack: i32): usize { return changetype<usize>(emptyNotes); }
export function bleep_notes_out_ptr(h: usize, jack: i32): usize { return changetype<usize>(emptyNotes); }

export function bleep_scratch(h: usize, size: i32): usize { return scratch(size); }
export function bleep_text(h: usize): usize { return textAddress(); }
export function bleep_text_length(h: usize): i32 { return 0; }
export function bleep_set_data(h: usize, length: i32): void {}
export function bleep_sanitise_data(h: usize, typeIndex: i32, length: i32): i32 { return -1; }
export function bleep_perform(h: usize, argOffset: i32, numArgs: i32): void {}
export function bleep_command(h: usize, value: f32): void {}
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
  constructor({ abiFrom = "./bleep" } = {}) {
    this.abiFrom = abiFrom;
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
      const found = readModules(source);
      if (found.length) bySource.set(path, found);
    }
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
