// SPDX-License-Identifier: GPL-3.0-only
// Runs a patch script (layer 1 of Bleep Script, doc/specs/bleep-script.md): TypeScript or JavaScript that builds a cell with
// `cell(...)`. The script runs inside QuickJS compiled to WebAssembly: a JavaScript engine with no network, no files, no clock, no DOM and
// no way out but the data it returns, held to a memory limit and a time limit. Works in node, a worker and a page.
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-singlefile-mjs-release-sync";
import { transform } from "sucrase";
import { PRELUDE } from "./prelude.mjs";

export const LIMITS = { memory: 64 * 1024 * 1024, stack: 1024 * 1024, milliseconds: 3000, sourceBytes: 200000, resultBytes: 4 * 1024 * 1024 };

let quickjs = null;
const engine = () => (quickjs ||= newQuickJSWASMModuleFromVariant(variant));

/// TypeScript or JavaScript source to the script the sandbox runs: types stripped (line numbers kept), `import ... from "bleep/patch"` dropped,
/// `export default` turned into the result.
export function prepare(source) {
  if (source.length > LIMITS.sourceBytes) throw Object.assign(new Error(`the script is longer than ${LIMITS.sourceBytes} characters`), { line: 0 });
  let js;
  try { js = transform(source, { transforms: ["typescript"], disableESTransforms: true, keepUnusedImports: true }).code; }
  catch (e) { throw Object.assign(new Error(String(e.message || e).replace(/ \(\d+:\d+\)$/, "")), { line: (e.loc && e.loc.line) || 0 }); }
  const lines = js.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const imp = /^\s*import\s[\s\S]*?\sfrom\s+["']([^"']+)["']\s*;?\s*$/.exec(lines[i]);
    if (imp) {
      if (imp[1] !== "bleep/patch") throw Object.assign(new Error(`only "bleep/patch" can be imported, not "${imp[1]}"`), { line: i + 1 });
      lines[i] = "";   // the builder is already there; keep the line so the numbers match
    }
  }
  js = lines.join("\n");
  if (!/\bexport\s+default\b/.test(js)) throw Object.assign(new Error("the script must end with: export default cell(...)"), { line: 0 });
  return js.replace(/\bexport\s+default\b/, "globalThis.__result =");
}

const lineOfError = (e) => {
  const m = /script\.js:(\d+)/.exec(String(e && e.stack || ""));
  return e && Number.isInteger(e.bleepLine) && e.bleepLine > 0 ? e.bleepLine : m ? Number(m[1]) : 0;
};

/// Runs a script. settings: { VOICES: 100 } chosen for the settings it declares.
/// Resolves to { ok: true, spec } or { ok: false, problems: [{ severity: "error", message, line }] }; never throws.
export async function runPatchScript(source, settings = {}, limits = {}) {
  const lim = { ...LIMITS, ...limits };
  let code;
  try { code = prepare(source); }
  catch (e) { return { ok: false, problems: [{ severity: "error", message: e.message, line: e.line || null }] }; }
  const QuickJS = await engine();
  const vm = QuickJS.newContext();
  try {
    vm.runtime.setMemoryLimit(lim.memory);
    vm.runtime.setMaxStackSize(lim.stack);
    vm.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + lim.milliseconds));
    const run = (text, name) => {
      const r = vm.evalCode(text, name);
      if (r.error) { const e = vm.dump(r.error); r.error.dispose(); throw Object.assign(new Error(typeof e === "string" ? e : e.message), { stack: e.stack, bleepLine: e.bleepLine }); }
      r.value.dispose();
    };
    run(PRELUDE, "prelude.js");
    run(`globalThis.__settings = ${JSON.stringify(Object.fromEntries(Object.entries(settings).filter(([k, v]) => /^[A-Z][A-Z0-9_]*$/.test(k) && Number.isFinite(Number(v)))))};`, "settings.js");
    try { run(code, "script.js"); }
    catch (e) {
      const message = /interrupted/.test(e.message) ? `the script ran longer than ${lim.milliseconds} ms and was stopped` : /out of memory/i.test(e.message) ? "the script used too much memory and was stopped" : e.message;
      return { ok: false, problems: [{ severity: "error", message, line: lineOfError(e) || null }] };
    }
    const out = vm.evalCode("JSON.stringify(globalThis.__result === undefined ? null : globalThis.__result)", "result.js");
    if (out.error) { out.error.dispose(); return { ok: false, problems: [{ severity: "error", message: "the result could not be read", line: null }] }; }
    const text = vm.getString(out.value);
    out.value.dispose();
    if (text === "null" || !text) return { ok: false, problems: [{ severity: "error", message: "export default must be a cell: export default cell(\"Name\", (c) => { ... })", line: null }] };
    if (text.length > lim.resultBytes) return { ok: false, problems: [{ severity: "error", message: "the patch is too large", line: null }] };
    const spec = JSON.parse(text);
    if (!spec || !Array.isArray(spec.nodes) || !Array.isArray(spec.cables)) return { ok: false, problems: [{ severity: "error", message: "export default must be a cell made with cell(...)", line: null }] };
    return { ok: true, spec };
  } finally { vm.dispose(); }
}
