// SPDX-License-Identifier: GPL-3.0-or-later
// Compiles src/gains.dsp.ts with asc in the page (no file system, no server-side step), with a transform that reads the
// @module decorator, then runs the result through js/module-host.js and compares it with the build made by node.
import asc from "assemblyscript/asc";
import { BleepTransform } from "/script/transform/bleep.mjs";
import { compileModule, ModuleInstance, CHUNK } from "/web/js/module-host.js";

const out = document.getElementById("out");
const lines = [];
const log = (s) => { lines.push(s); out.textContent = lines.join("\n"); };
let failures = 0;
const check = (ok, what, detail = "") => { log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? "  " + detail : ""}`); if (!ok) failures++; };

try {
  // 1. the sources, into an in-memory file system
  const files = {};
  for (const f of ["src/bleep/abi.ts", "src/bleep/dsp.ts", "src/bleep/format.ts", "src/gains.dsp.ts"]) files[f] = await (await fetch(`/script/${f}`)).text();

  // 2. the Bleep transform: reads the decorators and generates the spec and the bleep_* exports
  const transform = new BleepTransform();

  // 3. compile
  const outputs = {};
  const stderr = [];
  const t0 = performance.now();
  const { error } = await asc.main([
    "src/gains.dsp.ts", "--outFile", "gains.wasm", "--runtime", "stub", "--use", "abort=", "--exportStart", "_initialize",
    "--disableWarning", "235", "--optimizeLevel", "3", "--shrinkLevel", "1", "--noAssert",
  ], {
    readFile: (name) => files[name.replace(/^\.\//, "")] ?? null,
    writeFile: (name, data) => { outputs[name] = data; },
    listFiles: () => [],
    stderr: { write: (s) => stderr.push(typeof s === "string" ? s : new TextDecoder().decode(s)) },
    transforms: [transform],
  });
  const ms = performance.now() - t0;
  if (error) throw new Error(`compile failed: ${error.message}\n${stderr.join("")}`);
  const wasm = outputs["gains.wasm"];
  check(wasm && wasm.length > 1000, "asc compiled the module in the page", `${wasm.length} bytes in ${ms.toFixed(0)} ms`);
  const spec = transform.specs[0];
  check(transform.modules.length === 1 && spec.type === "gains" && spec.params.length === 3 && spec.inputs.length === 2 && spec.outputs.length === 2,
    "the transform read the decorators and generated the description", `${spec.type}: ${spec.params.map((p) => p.id)} / ${spec.inputs.map((p) => p.id)} / ${spec.outputs.map((p) => p.id)}`);
  check(transform.generated.length === 1 && transform.generated[0].text.includes("export function bleep_process"), "and the entry source with the bleep_* exports", transform.generated[0] && transform.generated[0].path);

  // 4. the same bytes as the node build (reproducible)
  const nodeBuild = new Uint8Array(await (await fetch("/script/build/gains.wasm")).arrayBuffer());
  const same = nodeBuild.length === wasm.length && nodeBuild.every((b, i) => b === wasm[i]);
  check(same, "the browser build is byte-identical to the node build", `${wasm.length} vs ${nodeBuild.length} bytes`);

  // 5. run it in the Bleep browser module host
  const module = await compileModule(wasm);
  check(WebAssembly.Module.imports(module).length === 0, "the module imports nothing");
  const m = new ModuleInstance(module, 48000);
  const run = (mute) => {
    for (let c = 0; c < 200; c++) {
      m.params.fill(0.9090909, 0, CHUNK); m.params.fill(mute, CHUNK, 2 * CHUNK); m.params.fill(0, 2 * CHUNK, 3 * CHUNK);
      m.inputs.fill(1, 0, CHUNK); m.inputs.fill(0, CHUNK, 2 * CHUNK);
      m.process(CHUNK);
    }
    return m.outputs[CHUNK - 1];
  };
  check(Math.abs(run(0) - 1) < 1e-4, "unity gain in the module host");
  check(Math.abs(run(1)) < 1e-6, "mute silences in the module host");

  // 6. a compile error is reported with a position, not by crashing
  const bad = { ...files, "src/gains.dsp.ts": files["src/gains.dsp.ts"].replace("this.level = this.meter.next(this.out);", "this.level = nope;") };
  const diagnostics = [];
  const result = await asc.main(["src/gains.dsp.ts", "--outFile", "bad.wasm", "--runtime", "stub", "--use", "abort="], {
    readFile: (name) => bad[name.replace(/^\.\//, "")] ?? null, writeFile: () => {}, listFiles: () => [],
    stderr: { write: () => {} }, reportDiagnostic: (d) => diagnostics.push(d), transforms: [new BleepTransform()],
  });
  const first = diagnostics.find((d) => d.category === 3 || d.code === 2304) || diagnostics[0];
  check(!!result.error && !!first && first.range && first.range.source.normalizedPath.includes("gains.dsp"),
    "a type error comes back as a diagnostic with a source position", first ? `${first.message} @ ${first.range && first.range.source.normalizedPath}:${first.range && first.range.start}` : "");

  const wrong = { ...files, "src/gains.dsp.ts": files["src/gains.dsp.ts"].replace("@input({ name: \"In\", type: \"audio\" }) x: f32", "@input({ name: \"In\", type: \"audio\" }) x: i32") };
  const declared = await asc.main(["src/gains.dsp.ts", "--outFile", "bad.wasm", "--runtime", "stub", "--use", "abort="], {
    readFile: (name) => wrong[name.replace(/^\.\//, "")] ?? null, writeFile: () => {}, listFiles: () => [], stderr: { write: () => {} }, transforms: [new BleepTransform()],
  });
  check(!!declared.error && /gains\.dsp\.ts:\d+: @input field 'x' must be f32/.test(declared.error.message), "a wrong declaration is reported with file and line", declared.error && declared.error.message.split("\n")[0]);
} catch (e) {
  check(false, "unexpected error", String(e && e.stack || e));
}
log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
window.__RESULT = { failures, lines };
document.title = failures ? "FAILED" : "PASSED";
