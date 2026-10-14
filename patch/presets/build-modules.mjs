// SPDX-License-Identifier: MIT
//
// Module presets: compiles the factory presets of the individual modules (patch/presets/modules/<type>.mjs,
// knob values in their own units) into patch/board/ui/module-presets.json, which every module view reads
// for its preset bar (patch/common/ui/bleep-view.js). Not to be confused with the cell presets (build.mjs).
//
//   node patch/presets/build-modules.mjs                     write module-presets.json
//   node patch/presets/build-modules.mjs --check             fail if it is out of date (CI)
//   node patch/presets/build-modules.mjs --only filter,lfo   compile and check just these (writes nothing)
//
// A module file default-exports an array of presets, in menu order:
//
//   export default [
//     ["Warm Low-Pass", { cutoff: 800, resonance: 0.2, type: "Ladder Tanh" }, "Optional one-line description."],
//   ];
//
// Values are in units (Hz, seconds, semitones; choices by name; toggles as booleans), exactly as in the cell
// presets (README.md). A preset sets only the knobs it lists: every other knob goes to the module's default
// when it is loaded. Ten to twenty presets per module; a module without a file gets no preset bar.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { types, resolveParam } from "./kit.mjs";

const DIR = fileURLToPath(new URL("./modules/", import.meta.url));
const OUT = fileURLToPath(new URL("../board/ui/module-presets.json", import.meta.url));
const MIN = 10, MAX = 20;

/// One module's presets, checked against its type: [{name, description?, params: {id: 0..1}}].
export function compileModule(type, list) {
  const t = types[type];
  if (!t) throw new Error(`${type}: no such module type`);
  const byId = new Map(t.params.map((p) => [p.id, p]));
  if (!Array.isArray(list)) throw new Error(`${type}: the file must default-export an array of presets`);
  if (list.length < MIN || list.length > MAX) throw new Error(`${type}: ${list.length} presets, want ${MIN}–${MAX}`);
  const names = new Set(), shapes = new Map(), out = [];
  for (const entry of list) {
    const [name, values, description] = Array.isArray(entry) ? entry : [entry.name, entry.values, entry.description];
    if (typeof name !== "string" || !name.trim() || name.length > 40) throw new Error(`${type}: a preset name must be 1–40 characters (${JSON.stringify(name)})`);
    if (names.has(name.toLowerCase())) throw new Error(`${type}: two presets are named '${name}'`);
    names.add(name.toLowerCase());
    if (!values || typeof values !== "object") throw new Error(`${type} › ${name}: values must be an object`);
    const params = {};
    for (const [id, v] of Object.entries(values)) {
      const p = byId.get(id);
      if (!p) throw new Error(`${type} › ${name}: no knob '${id}' (has ${[...byId.keys()].join(", ")})`);
      params[id] = resolveParam(`${type} › ${name} › ${id}`, p, v);
    }
    // a value equal to the default is dropped: it would do nothing, and the preset stays readable
    for (const [id, x] of Object.entries(params)) if (Math.abs(x - byId.get(id).default) < 1e-6) delete params[id];
    const shape = JSON.stringify(Object.entries(params).sort());
    if (shapes.has(shape)) throw new Error(`${type}: '${name}' sets the same values as '${shapes.get(shape)}'`);
    shapes.set(shape, name);
    if (description !== undefined && (typeof description !== "string" || description.length > 140)) throw new Error(`${type} › ${name}: the description is a string of at most 140 characters`);
    out.push({ name, ...(description ? { description } : {}), params });
  }
  return out;
}

export async function compile(only) {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => f.slice(0, -4)).sort();
  const modules = {};
  for (const type of files) {
    if (only && !only.includes(type)) continue;
    modules[type] = compileModule(type, (await import(DIR + type + ".mjs")).default);
  }
  return { format: 1, modules };
}

function format(doc) {
  const line = (x) => JSON.stringify(x);
  const mods = Object.entries(doc.modules).map(([type, list]) =>
    `    ${line(type)}: [\n${list.map((p) => "      " + line(p)).join(",\n")}\n    ]`);
  return `{\n  "format": 1,\n  "modules": {\n${mods.join(",\n")}\n  }\n}\n`;
}

// Run as a script (not when imported).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
  try {
    const doc = await compile(only);
    const count = Object.values(doc.modules).reduce((n, l) => n + l.length, 0);
    const where = `${count} presets in ${Object.keys(doc.modules).length} modules`;
    if (only) console.log(`${where} check out`);
    else if (args.includes("--check")) {
      let old = "";
      try { old = readFileSync(OUT, "utf8"); } catch {}
      if (old !== format(doc)) { console.error("patch/board/ui/module-presets.json out of date: run node patch/presets/build-modules.mjs"); process.exit(1); }
      console.log(`module presets current: ${where}`);
    } else {
      writeFileSync(OUT, format(doc));
      console.log(`${where} written to patch/board/ui/module-presets.json`);
    }
  } catch (e) {
    console.error("module presets: " + e.message);
    process.exit(1);
  }
}
