// SPDX-License-Identifier: GPL-3.0-or-later
// Compiles one Bleep Script source: asc (the AssemblyScript compiler) with the Bleep transform, entirely in memory.
// Shared by the playground, the tests and the bundle the board loads (compiler/bundle.mjs).
import { BleepTransform } from "../transform/bleep.mjs";

export const FILE = "src/module.dsp.ts";

function positionOf(text, offset) {
  const before = text.slice(0, offset);
  return { line: before.split("\n").length, column: offset - before.lastIndexOf("\n") };
}

/// `asc`: the compiler module (assemblyscript/asc's default export). `lib`: the sources of src/bleep/*.ts by path.
/// `typeId`: the node type id the module's description gets (a Code node's engine type); default: from the class name.
/// Resolves to { wasm, specs, generated, problems, ms }. `wasm` is null when there is an error.
export async function compileScript(asc, text, { lib, typeId, file = FILE } = {}) {
  const files = { ...lib, [file]: text };
  const transform = new BleepTransform({ typeId });
  const problems = [];
  let wasm = null;
  const t0 = Date.now();
  const { error } = await asc.main([file, "--outFile", "module.wasm", "--runtime", "stub", "--use", "abort=", "--exportStart", "_initialize",
    "--disableWarning", "235", "--optimizeLevel", "3", "--shrinkLevel", "1", "--noAssert"], {
    readFile: (name) => files[name.replace(/^\.\//, "")] ?? null,
    writeFile: (name, data) => { if (name.endsWith(".wasm")) wasm = data; },
    listFiles: () => [],
    stderr: { write() {} },
    transforms: [transform],
    reportDiagnostic(d) {
      if (d.code === 235) return;   // the module class is exported for the generated entry file, not for the host
      const path = d.range && d.range.source.normalizedPath;
      const where = path === file ? positionOf(text, d.range.start) : null;
      problems.push({ severity: d.category === 3 ? "error" : "warning", message: d.message, line: where && where.line, column: where && where.column, file: where ? null : path });
    },
  });
  if (error && !problems.some((p) => p.severity === "error")) {   // a declaration error from the transform: "src/module.dsp.ts:14: message"
    const m = /^(\S+?):(\d+): ([\s\S]*)$/.exec(error.message);
    problems.push({ severity: "error", message: m ? m[3] : error.message, line: m ? Number(m[2]) : null, column: null, file: m && m[1] !== file ? m[1] : null });
  }
  return { wasm: error ? null : wasm, specs: transform.specs, generated: transform.generated, problems, ms: Date.now() - t0 };
}
