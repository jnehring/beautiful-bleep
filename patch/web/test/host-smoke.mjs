// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Smoke test: the oscillator wasm runs under plain WebAssembly and makes a sine of the right pitch.
import { readFileSync } from "node:fs";
import { compileModule, ModuleInstance } from "../js/module-host.js";
const mod = await compileModule(readFileSync(process.argv[2]));
const m = new ModuleInstance(mod, 48000);
console.log(m.spec.type, m.spec.params.length, "params", m.spec.outputs.length, "outputs");
const sine = m.spec.outputs.findIndex((o) => o.id === "sine");
let out = [];
for (let c = 0; c < 48000 / 32; ++c) {
  m.process(32);
  out.push(...m.outputs.slice(sine * 32, sine * 32 + 32));
}
let cross = 0, peak = 0;
for (let i = 1; i < out.length; ++i) { if (out[i - 1] < 0 && out[i] >= 0) cross++; peak = Math.max(peak, Math.abs(out[i])); }
console.log("zero crossings in 1 s:", cross, "peak:", peak.toFixed(3));
