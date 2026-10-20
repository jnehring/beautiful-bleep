// SPDX-License-Identifier: GPL-3.0-or-later
// The library as a module script uses it: a Code-node-style source compiled with the Bleep transform and the subset checker (no real-time
// rule broken by calling library code, a cost is estimated), then run in the module host.   node test/dsp/module.test.mjs
import { readFileSync, readdirSync } from "node:fs";
import asc from "assemblyscript/asc";
import { compileScript } from "../../compiler/compile.mjs";
import { compileModule, ModuleInstance, CHUNK } from "../../../web/js/module-host.js";
import { root, check, finish, finiteAll, peak } from "./lib.mjs";

const lib = Object.fromEntries(readdirSync(`${root}src/bleep`).filter((f) => f.endsWith(".ts")).map((f) => [`src/bleep/${f}`, readFileSync(`${root}src/bleep/${f}`, "utf8")]));

/// Compiles `source` and runs it for `chunks` chunks with the given inputs; returns { problems, out, cost }.
export async function run(source, { chunks = 40, inputs = [], params = [] } = {}) {
  const r = await compileScript(asc, source, { lib });
  const errors = r.problems.filter((p) => p.severity === "error");
  if (!r.wasm) return { errors, problems: r.problems };
  const m = new ModuleInstance(await compileModule(r.wasm), 48000, r.specs[0].type);
  const out = [];
  for (let c = 0; c < chunks; c++) {
    params.forEach((v, i) => m.params.fill(v, i * CHUNK, (i + 1) * CHUNK));
    inputs.forEach((v, i) => m.inputs.fill(v, i * CHUNK, (i + 1) * CHUNK));
    m.process(CHUNK);
    out.push(...m.outputs.slice(0, CHUNK));
  }
  return { errors, problems: r.problems, out: Float32Array.from(out), cost: r.specs[0].cost };
}

const MODULES = {};

MODULES.osc = `
import { sawBlep, squareBlep, triangle, fastSin, SineTable, Wavetable, Supersaw, FmOp } from "./bleep/osc";
@module({ name: "OscTest", category: "Utility/Test" })
export class OscTest {
  @output out: f32 = 0;
  @param({ name: "Freq", min: 20, max: 8000, init: 440 }) freq: f32 = 440;
  private phase: f64 = 0;
  private dt: f64 = 0;
  private table: Wavetable;
  private stack: Supersaw;
  private fm: FmOp;
  private sine: SineTable;
  constructor(sampleRate: f64) {
    this.table = new Wavetable(1024, 8);
    this.stack = new Supersaw(sampleRate, 5, 15);
    this.fm = new FmOp(sampleRate);
    this.sine = new SineTable(1024);
    this.dt = 440.0 / sampleRate;
    this.table.setSaw();
  }
  block(): void { this.dt = <f64>this.freq / 48000.0; this.stack.setDetune(12); }
  sample(): void {
    this.phase += this.dt; if (this.phase >= 1.0) this.phase -= 1.0;
    this.out = 0.2 * (sawBlep(this.phase, this.dt) + squareBlep(this.phase, this.dt, 0.4) + triangle(this.phase, this.dt) + fastSin(this.phase) + this.sine.read(this.phase)
      + this.table.read(this.phase, this.dt) + this.stack.next(<f64>this.freq) + this.fm.next(<f64>this.freq, 0.1, 0.2));
  }
}`;

for (const [name, source] of Object.entries(MODULES)) {
  const r = await run(source);
  check(r.errors.length === 0, `${name}: compiles with the subset checker`, r.errors.map((e) => `${e.line}: ${e.message}`).join("; "));
  if (r.out) {
    check(finiteAll(r.out) && peak(r.out) > 0.05 && peak(r.out) < 8, `${name}: runs in the module host`, `peak ${peak(r.out).toFixed(3)}`);
    check(r.cost && r.cost.ops > 0, `${name}: has a cost estimate`, JSON.stringify(r.cost));
  }
}
finish();
