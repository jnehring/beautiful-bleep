// SPDX-License-Identifier: GPL-3.0-or-later
// Test helpers for the Bleep Script library: compile an AssemblyScript harness (a file that wraps library classes as `Unit`s, see
// test/dsp/*.harness.ts), run it in node, and analyse the output.
import { fileURLToPath } from "node:url";
import asc from "assemblyscript/asc";

export const root = fileURLToPath(new URL("../..", import.meta.url));
export const SR = 48000;
let failures = 0;
export const check = (ok, what, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? "  " + detail : ""}`); if (!ok) failures++; };
export const finish = () => { console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed"); process.exit(failures ? 1 : 0); };

/// Compiles test/dsp/<name>.harness.ts the way modules are compiled (stub runtime, no imports) and returns a runner.
export async function harness(name) {
  let wasm = null;
  const { error } = await asc.main([`test/dsp/${name}.harness.ts`, "--outFile", "o.wasm", "--baseDir", root, "--runtime", "stub", "--exportRuntime", "--use", "abort=", "--disableWarning", "235",
    "--noAssert", "--optimizeLevel", "3", "--shrinkLevel", "1"], { writeFile: (n, d) => { if (n.endsWith(".wasm")) wasm = d; }, stderr: process.stderr });
  if (error) throw new Error(`${name} harness: ${error.message}`);
  const { instance } = await WebAssembly.instantiate(wasm, {});
  const x = instance.exports;
  const mem = () => new Float32Array(x.memory.buffer);
  const out = () => x.outPtr() >>> 2, inn = () => x.inPtr() >>> 2;
  return {
    exports: x,
    /// run(id, params, n, input): sets up unit `id` with up to six numbers and runs it for n samples; returns a Float32Array copy of the output.
    run(id, params = [], n = 4096, input = null) {
      x.setup(id, ...[...params, 0, 0, 0, 0, 0, 0].slice(0, 6));
      return this.process(n, input);
    },
    process(n, input = null) {
      if (input) mem().set(input.subarray(0, n), inn());
      else mem().fill(0, inn(), inn() + n);
      x.process(n);
      return mem().slice(out(), out() + n);
    },
    /// The number of bytes the runtime handed out while `fn` ran (0 = allocation-free).
    allocated(fn) {
      const a = x.__new(0, 0), b = x.__new(0, 0), unit = b - a;
      const before = x.__new(0, 0);
      fn();
      return x.__new(0, 0) - before - unit;
    },
  };
}

/// Magnitude spectrum (Hann-windowed) of a signal whose length is a power of two: Float64Array of N/2 power values.
export function spectrum(sig) {
  const n = sig.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = sig[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const wr = Math.cos(ang * k), wi = Math.sin(ang * k), a = i + k, b = i + k + len / 2;
      const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
  const p = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i];
  return p;
}
export const db = (x) => 10 * Math.log10(Math.max(x, 1e-30));
export const rms = (a, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / (to - from)); };
export const peak = (a, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s = Math.max(s, Math.abs(a[i])); return s; };
export const finiteAll = (a) => a.every((v) => Number.isFinite(v));

/// The response of a unit at `freq`, measured with a sine after letting it settle: { gain (dB), phase (radians, output relative to input) }.
export function responseAt(h, id, params, freq, { n = 16384, amp = 0.1 } = {}) {
  const input = new Float32Array(n);
  for (let i = 0; i < n; i++) input[i] = amp * Math.sin(2 * Math.PI * freq * i / SR);
  const out = h.run(id, params, n, input);
  // correlate with a complex exponential under a Hann window over the second half, so the image at -freq does not leak in
  const corr = (sig) => {
    let re = 0, im = 0;
    for (let i = n / 2; i < n; i++) { const w = 2 * Math.PI * freq * i / SR, win = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i - n / 2) / (n / 2)); re += win * sig[i] * Math.cos(w); im -= win * sig[i] * Math.sin(w); }
    return [re, im];
  };
  const [ar, ai] = corr(input), [br, bi] = corr(out);
  const a = Math.hypot(ar, ai), b = Math.hypot(br, bi);
  let phase = Math.atan2(bi, br) - Math.atan2(ai, ar);
  phase -= 2 * Math.PI * Math.round(phase / (2 * Math.PI));
  return { gain: 20 * Math.log10(Math.max(b, 1e-30) / a), phase };
}
export const gainAt = (h, id, params, freq, opts) => responseAt(h, id, params, freq, opts).gain;

/// White-ish noise in [-1, 1) from a seeded generator (mulberry32), so tests are repeatable.
export function noise(n, seed = 1) {
  const out = new Float32Array(n);
  let a = seed >>> 0;
  for (let i = 0; i < n; i++) {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  return out;
}
