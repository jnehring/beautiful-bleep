// SPDX-License-Identifier: GPL-3.0-or-later
// Compiles one Bleep Script source: asc (the AssemblyScript compiler) with the Bleep transform, entirely in memory.
// Shared by the playground, the tests and the bundle the board loads (compiler/bundle.mjs).
import { BleepTransform } from "../transform/bleep.mjs";
import { childNames, childSource, usedChildren, linkChildren } from "./child.mjs";

export const FILE = "src/module.dsp.ts";

function positionOf(text, offset) {
  const before = text.slice(0, offset);
  return { line: before.split("\n").length, column: offset - before.lastIndexOf("\n") };
}

/// `asc`: the compiler module (assemblyscript/asc's default export). `lib`: the sources of src/bleep/*.ts by path.
/// `typeId`: the node type id the module's description gets (a Code node's engine type); default: from the class name.
/// `constants`: { SETTING: value } for the settings the module declares in @module (a setting left out takes its init).
/// `children`: { id: { wasm, spec, typeIndex } } the library modules the script may import as `./bleep/module-<id>` (child.mjs): their file, and
/// the node type description of the type to use (typeIndex: its place in the file, default 0). `mergeTool`: wasm-merge.mjs's tool, or a
/// function that loads it; needed only when the script uses a child.
/// Resolves to { wasm, specs, generated, problems, ms, linked }. `wasm` is null when there is an error. `linked`: the ids of the children in it.
export async function compileScript(asc, text, { lib, typeId, constants = {}, file = FILE, children = {}, mergeTool } = {}) {
  const files = { ...lib, [file]: text };
  for (const [id, c] of Object.entries(children)) files[childNames(id, c.spec).file] = childSource(id, c.spec, c.typeIndex ?? 0);
  const t0 = Date.now();
  const flags = ["--runtime", "stub", "--use", "abort=", "--exportStart", "_initialize", "--disableWarning", "235"];
  const run = (transform, extra, writeFile, reportDiagnostic) => asc.main([file, "--outFile", "module.wasm", ...flags, ...extra], {
    readFile: (name) => files[name.replace(/^\.\//, "")] ?? null,
    writeFile,
    listFiles: () => [],
    stderr: { write() {} },
    transforms: [transform],
    reportDiagnostic,
  });

  // pass 1, only when the source declares settings: read them. The counts they set are constants of the compile (--use), so they must be
  // known before the compiler runs; the pass stops right after parsing and costs little.
  const use = [];
  const values = {};
  if (/settings\s*:/.test(text)) {
    const first = new BleepTransform({ typeId, constants, settingsOnly: true });
    const { error } = await run(first, ["--noEmit"], () => {}, () => {});
    if (error && error.name !== "SettingsDone") return { wasm: null, specs: [], generated: [], problems: [problemOf(error, file)], ms: Date.now() - t0 };
    for (const s of first.settings) {
      values[s.id] = Math.min(s.max, Math.max(s.min, Math.round(Number(constants[s.id] ?? s.init))));
      use.push("--use", `${s.id}=${values[s.id]}`);
    }
  }

  const transform = new BleepTransform({ typeId, constants: values });
  const problems = [];
  let wasm = null;
  const { error } = await run(transform, ["--optimizeLevel", "3", "--shrinkLevel", "1", "--noAssert", ...use], (name, data) => { if (name.endsWith(".wasm")) wasm = data; }, (d) => {
    if (d.code === 235) return;   // the module class is exported for the generated entry file, not for the host
    const path = d.range && d.range.source.normalizedPath;
    const where = path === file ? positionOf(text, d.range.start) : null;
    problems.push({ severity: d.category === 3 ? "error" : "warning", message: d.message, line: where && where.line, column: where && where.column, file: where ? null : path });
  });
  for (const p of transform.problems) if (!problems.some((q) => q.line === p.line && q.message === p.message)) problems.push({ column: null, ...p, file: p.file === file ? null : p.file });
  if (error && !problems.some((p) => p.severity === "error")) problems.push(problemOf(error, file));
  let linked = [];
  if (!error && wasm) {
    const ids = usedChildren(wasm);
    if (ids.length) {
      try { wasm = await linkChildren(wasm, ids, children, mergeTool); linked = ids; }
      catch (e) { problems.push({ severity: "error", message: e.message, line: null, column: null, file: null }); wasm = null; }
    }
  }
  return { wasm: error ? null : wasm, specs: transform.specs, generated: transform.generated, problems, ms: Date.now() - t0, linked };
}

/// A transform error ("src/module.dsp.ts:14: message") as a problem.
function problemOf(error, file) {
  const m = /^(\S+?):(\d+): ([\s\S]*)$/.exec(error.message);
  return { severity: "error", message: m ? m[3] : error.message, line: m ? Number(m[2]) : null, column: null, file: m && m[1] !== file ? m[1] : null };
}
