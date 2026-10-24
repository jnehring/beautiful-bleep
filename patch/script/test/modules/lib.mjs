// SPDX-License-Identifier: GPL-3.0-only
// Test helpers for whole module scripts (src/<name>.dsp.ts): compile one with the Bleep transform and the subset checker, run it in the
// browser module host (V8), feed it signals and read its outputs by jack id.
//   import { loadModule, render, ... } from "./lib.mjs";
//   const m = await loadModule("tone-eq");                     // compiles src/tone-eq.dsp.ts; throws on a compile error
//   const out = render(m, { inputs: { l: sig }, params: { drive: 0.5 } });      // out.l, out.r: Float32Array
import { readFileSync, readdirSync } from "node:fs";
import asc from "assemblyscript/asc";
import { compileScript } from "../../compiler/compile.mjs";
import { compileModule, ModuleInstance, CHUNK } from "../../../web/js/module-host.js";
import { root } from "../dsp/lib.mjs";
import { scriptModules } from "../../modules.mjs";

export { check, finish, SR, spectrum, db, rms, peak, finiteAll, noise } from "../dsp/lib.mjs";
export { CHUNK };

const lib = Object.fromEntries(readdirSync(`${root}src/bleep`).filter((f) => f.endsWith(".ts")).map((f) => [`src/bleep/${f}`, readFileSync(`${root}src/bleep/${f}`, "utf8")]));

/// A value in the knob's units to the 0..1 the module host's parameter buffer holds (the engine's mapping: linear, exp or skew).
export function normalise(p, v) {
  if (p.kind === "bool") return v ? 1 : 0;
  const x = p.max === p.min ? 0 : (v - p.min) / (p.max - p.min);
  if (p.map === "exp") return Math.log(v / p.min) / Math.log(p.max / p.min);
  if (p.map === "skew") return x <= 0 ? 0 : Math.pow(x, Math.log(0.5) / Math.log((p.centre - p.min) / (p.max - p.min)));
  return Math.min(1, Math.max(0, x));
}

/// Compiles src/<name>.dsp.ts. Returns { spec, cost ({ ops, limit, ... } per 32-sample chunk), warnings, wasm, module }; throws if there is an error (the message lists them).
export async function loadModule(name, { constants = {} } = {}) {
  const mod = scriptModules().find((m) => m.slug === name);
  const text = readFileSync(mod ? mod.source : `${root}src/${name}.dsp.ts`, "utf8");   // a module of patch/modules/, else an example of src/
  const r = await compileScript(asc, text, { lib, constants, typeId: mod ? name : undefined });
  const errors = r.problems.filter((p) => p.severity === "error");
  if (errors.length || !r.wasm) throw new Error(`${name}: ${errors.map((p) => `line ${p.line}: ${p.message}`).join("; ")}`);
  return { spec: r.specs[0], cost: r.specs[0].cost, warnings: r.problems.filter((p) => p.severity !== "error"), wasm: r.wasm, module: await compileModule(r.wasm) };
}

/// Runs a loaded module for `n` samples (default: the longest input, or one second) and returns { <output id>: Float32Array, gr... }.
/// inputs:  { id: Float32Array | number }   a number is a constant; ids not given are 0 (and unconnected for normalled inputs)
/// params:  { id: value | Float32Array | (i) => value }   in the knob's own units (dB, Hz, a choice index, 0/1 for a toggle); a Float32Array or function
///          is read per sample, to test modulation; a value is set per chunk, so a change at a chunk boundary can be tested with a function.
/// Returns also .probes (the final value of every probe, by id) and .instance.
export function render(m, { sampleRate = 48000, n, inputs = {}, params = {}, connected = null, seed = 0 } = {}) {
  const inst = new ModuleInstance(m.module, sampleRate, m.spec.type);
  const spec = inst.spec;
  const len = n ?? Math.max(0, ...Object.values(inputs).map((v) => v.length ?? 0)) ?? sampleRate;
  const total = len || sampleRate;
  const outs = Object.fromEntries(spec.outputs.map((o) => [o.id, new Float32Array(total)]));
  const conn = spec.inputs.map((i) => (connected ? (connected[i.id] ? 1 : 0) : inputs[i.id] !== undefined ? 1 : 0));
  inst.setConnected(conn, spec.outputs.map(() => 1));
  for (let start = 0; start < total; start += CHUNK) {
    const c = Math.min(CHUNK, total - start);
    spec.params.forEach((p, k) => {
      const v = params[p.id];
      for (let i = 0; i < CHUNK; i++) {
        const x = v === undefined ? p.def : typeof v === "function" ? v(start + Math.min(i, c - 1)) : v.length !== undefined ? v[Math.min(start + i, total - 1)] : v;
        inst.params[k * CHUNK + i] = normalise(p, x);
      }
    });
    spec.inputs.forEach((inp, k) => {
      const v = inputs[inp.id];
      for (let i = 0; i < CHUNK; i++) inst.inputs[k * CHUNK + i] = v === undefined ? 0 : typeof v === "number" ? v : start + i < v.length ? v[start + i] : 0;
    });
    inst.process(c);
    spec.outputs.forEach((o, k) => outs[o.id].set(inst.outputs.subarray(k * CHUNK, k * CHUNK + c), start));
  }
  outs.instance = inst;
  return outs;
}

/// A sine of `freq` Hz and amplitude `amp`, `n` samples.
export const sine = (freq, amp, n, sampleRate = 48000) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * freq * i / sampleRate));

/// Gain in dB of the module's output `out` for a sine at `freq` (amplitude `amp`), measured over the second half, with the given params.
export function gainAt(m, freq, { amp = 0.1, params = {}, out = "l", input = "l", n = 32768, sampleRate = 48000 } = {}) {
  const x = sine(freq, amp, n, sampleRate);
  const y = render(m, { sampleRate, inputs: { [input]: x }, params })[out];
  const h = n / 2;
  const corr = (s) => { let re = 0, im = 0; for (let i = h; i < n; i++) { const w = 2 * Math.PI * freq * i / sampleRate, win = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i - h) / h); re += win * s[i] * Math.cos(w); im -= win * s[i] * Math.sin(w); } return Math.hypot(re, im); };
  return 20 * Math.log10(Math.max(corr(y), 1e-30) / corr(x));
}

/// Level in dB of a harmonic: |H(k·f0)| relative to |H(f0)| in the output for a sine at f0 (power-of-two length, Hann window).
export function harmonicsDb(y, f0, sampleRate = 48000, count = 6) {
  const n = y.length;
  const bin = (f) => { let re = 0, im = 0; for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)), ph = 2 * Math.PI * f * i / sampleRate; re += w * y[i] * Math.cos(ph); im -= w * y[i] * Math.sin(ph); } return Math.hypot(re, im); };
  const f1 = bin(f0);
  return Array.from({ length: count }, (_, k) => 20 * Math.log10(Math.max(bin(f0 * (k + 1)), 1e-30) / f1));
}
