// SPDX-License-Identifier: GPL-3.0-only
// Child modules: a script imports a module of the library and the compiler links the two (compiler/child.mjs, compiler/wasm-merge.mjs).
//   node test/child.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import asc from "assemblyscript/asc";
import { compileScript } from "../compiler/compile.mjs";
import { loadToolFromSource } from "../compiler/wasm-merge.mjs";
import { compileModule, ModuleInstance, CHUNK } from "../../web/js/module-host.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const lib = Object.fromEntries(["abi", "dsp", "format", "notes"].map((n) => [`src/bleep/${n}.ts`, readFileSync(`${root}src/bleep/${n}.ts`, "utf8")]));
const mergeTool = () => loadToolFromSource(readFileSync(`${root}node_modules/binaryen/bin/wasm-merge`, "utf8"));
let failures = 0;
const check = (ok, what, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? "  " + detail : ""}`); if (!ok) failures++; };

// the child: the Gains module of the library, here the file the build made from src/gains.dsp.ts
const gains = { wasm: readFileSync(`${root}build/gains.wasm`), spec: JSON.parse(readFileSync(`${root}build/gains.spec.json`, "utf8"))[0] };

const WRAP = `
import { Gains } from "./bleep/module-gains";

@module({ name: "Wrap", category: "Utility/Script" })
export class Wrap {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Volume", min: 0, max: 1, init: 0.909090909 }) vol: f32 = 0.909090909;

  private fx: Gains;
  constructor(sampleRate: f64) { this.fx = new Gains(sampleRate); }

  chunk(n: i32, ins: StaticArray<f32>, outs: StaticArray<f32>): void {
    this.fx.set(Gains.PARAM_VOL, this.vol);
    this.fx.feed(Gains.INPUT_X, ins, 0);
    this.fx.process(n);
    this.fx.fetch(Gains.OUTPUT_OUT, outs, 0);
  }
}
`;

// ---- 1. a script that uses the module compiles to one file that imports nothing ----------------------------------------------------------
const r = await compileScript(asc, WRAP, { lib, children: { gains }, mergeTool });
check(!!r.wasm, "a script that imports a child module compiles", r.problems.map((p) => p.message).join("; "));
if (r.wasm) {
  check(r.linked.join() === "gains", "and says which child it linked", r.linked.join());
  const module = await compileModule(r.wasm);
  check(WebAssembly.Module.imports(module).length === 0, "the linked file imports nothing", JSON.stringify(WebAssembly.Module.imports(module)));
  const exported = WebAssembly.Module.exports(module);
  check(exported.filter((e) => e.kind === "memory").map((e) => e.name).join() === "memory" && !exported.some((e) => /_\d+$|^(to|from)_child$/.test(e.name)),
    "it exports what a module exports, and one memory: the child's and the glue's are not left", exported.map((e) => e.name).filter((n) => /_\d+$|child|memory/.test(n)).join());
  check(r.specs.length === 1 && r.specs[0].name === "Wrap", "the description is the script's own, not the child's");

  // ---- 2. the child's DSP runs inside the script ------------------------------------------------------------------------------------------
  const m = new ModuleInstance(module, 48000);
  const run = (vol, chunks = 300) => {
    m.params.fill(vol, 0, CHUNK);
    for (let k = 0; k < chunks; k++) { m.inputs.fill(0.5, 0, CHUNK); m.process(CHUNK); }
    return m.outputs[CHUNK - 1];
  };
  const unity = run(0.909090909);
  check(Math.abs(unity - 0.5) < 1e-3, "at 0 dB the child passes the signal through", String(unity));
  const loud = run(1);   // +6 dB
  check(Math.abs(loud - 0.5 * Math.pow(10, 6 / 20)) < 1e-2, "the volume reaches the child: +6 dB is about twice as loud", String(loud));
  const quiet = run(0);   // -60 dB, "-inf"
  check(Math.abs(quiet) < 1e-2, "and -60 dB is nearly silent", String(quiet));
}

// ---- 3. the failures a user can make say what is wrong ---------------------------------------------------------------------------------------
{
  const noTool = await compileScript(asc, WRAP, { lib, children: { gains } });
  check(!noTool.wasm && noTool.problems.some((p) => /wasm-merge/.test(p.message)), "without the merge tool the error says so", noTool.problems.map((p) => p.message).join("; "));
  const noChild = await compileScript(asc, WRAP, { lib, mergeTool });
  check(!noChild.wasm && noChild.problems.length > 0, "a child that was not provided is an error", (noChild.problems[0] || {}).message);
  const plain = await compileScript(asc, `@module({ name: "P" })\nexport class P { @output out: f32 = 0; constructor(sampleRate: f64) {} sample(): void { this.out = 1; } }`, { lib, children: { gains }, mergeTool });
  check(!!plain.wasm && plain.linked.length === 0, "a script that does not import a child is not linked, and does not need the tool");
}

console.log(failures ? `\n${failures} failed` : "\nall ok");
process.exit(failures ? 1 : 0);
