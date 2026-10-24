// SPDX-License-Identifier: GPL-3.0-only
// Spike: the Gains module, compiled from AssemblyScript, runs through the Bleep browser module host
// (patch/web/js/module-host.js) and matches a reference model written in plain JS.
//   node test/spike.mjs [path/to/gains.wasm]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compileModule, ModuleInstance, CHUNK } from "../../web/js/module-host.js";

const wasmPath = process.argv[2] || fileURLToPath(new URL("../build/gains.wasm", import.meta.url));
const bytes = readFileSync(wasmPath);
const module = await compileModule(bytes);
const SR = 48000;
let failures = 0;
const check = (ok, what, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? "  " + detail : ""}`); if (!ok) failures++; };

// ---- 1. the file ----------------------------------------------------------------------------------
const imports = WebAssembly.Module.imports(module);
check(imports.length === 0, "the module imports nothing", JSON.stringify(imports));
check(bytes.length < 32 * 1024 * 1024, "file size", `${bytes.length} bytes`);

const m = new ModuleInstance(module, SR);
check(m.x.bleep_chunk() === 32 && m.x.bleep_note_event_size() === 16, "chunk 32, note event 16 bytes");
check(m.spec.type === "gains" && m.spec.params.length === 3 && m.spec.inputs.length === 2 && m.spec.outputs.length === 2,
  "spec JSON read by the host", `${m.spec.params.map((p) => p.id)} / ${m.spec.inputs.map((p) => p.id)} / ${m.spec.outputs.map((p) => p.id)}`);

// ---- 2. a reference model of Gains, in plain JS -----------------------------------------------------
class Reference {
  constructor(sr) {
    this.gc = 1 - Math.exp(-1 / (sr * 0.010)); this.oc = 1 - Math.exp(-1 / (sr * 0.005)); this.decay = Math.exp(-1 / (sr * 0.3));
    this.g = 0; this.on = 1; this.gT = 0; this.oT = 1; this.solo = 0; this.level = 0; this.started = false;
  }
  chunk(x, vol, mute, solo, others) {
    const db = -60 + 66 * vol;
    this.gT = db <= -59.95 ? 0 : Math.pow(10, db / 20);
    this.oT = mute >= 0.5 || (others >= 0.5 && solo < 0.5) ? 0 : 1;
    this.solo = solo >= 0.5 ? 1 : 0;
    if (!this.started) { this.g = this.gT; this.on = this.oT; this.started = true; }
    const out = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) {
      this.g += (this.gT - this.g) * this.gc; this.on += (this.oT - this.on) * this.oc;
      out[i] = x[i] * this.g * this.on;
      this.level = Math.max(Math.abs(out[i]), this.level * this.decay);
    }
    return out;
  }
}

let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const noise = () => rnd() * 2 - 1;

// ---- 3. same noise, random knob changes mid-run: compare with the reference ---------------------------
{
  const ref = new Reference(SR);
  let peak = 0, maxDiff = 0, vol = 0.9090909, mute = 0, solo = 0, others = 0;
  for (let c = 0; c < 2000; c++) {
    if (c % 37 === 0) vol = rnd();
    if (c % 211 === 0) mute = rnd() < 0.3 ? 1 : 0;
    if (c % 301 === 0) solo = rnd() < 0.3 ? 1 : 0;
    if (c % 401 === 0) others = rnd() < 0.5 ? 1 : 0;
    const x = Float64Array.from({ length: CHUNK }, noise);
    m.params.fill(vol, 0, CHUNK); m.params.fill(mute, CHUNK, 2 * CHUNK); m.params.fill(solo, 2 * CHUNK, 3 * CHUNK);
    m.inputs.set(Float32Array.from(x), 0); m.inputs.fill(others, CHUNK, 2 * CHUNK);
    m.process(CHUNK);
    const want = ref.chunk(x, Math.fround(vol), mute, solo, others);
    for (let i = 0; i < CHUNK; i++) {
      peak = Math.max(peak, Math.abs(want[i]));
      maxDiff = Math.max(maxDiff, Math.abs(m.outputs[i] - want[i]));
      if (m.outputs[CHUNK + i] !== ref.solo) { maxDiff = Infinity; }
    }
  }
  check(maxDiff < 1e-4 * Math.max(peak, 1e-9), "output matches the reference", `max difference ${maxDiff.toExponential(2)} on a peak of ${peak.toFixed(3)}`);
}

// ---- 4. behaviour ----------------------------------------------------------------------------------
const fresh = () => new ModuleInstance(module, SR);
const run = (inst, chunks, { vol = 0.9090909, mute = 0, solo = 0, others = 0 } = {}) => {
  let last = new Float32Array(CHUNK);
  for (let c = 0; c < chunks; c++) {
    inst.params.fill(vol, 0, CHUNK); inst.params.fill(mute, CHUNK, 2 * CHUNK); inst.params.fill(solo, 2 * CHUNK, 3 * CHUNK);
    inst.inputs.fill(1, 0, CHUNK); inst.inputs.fill(others, CHUNK, 2 * CHUNK);
    inst.process(CHUNK);
    last = inst.outputs.slice(0, CHUNK);
  }
  return last[CHUNK - 1];
};
check(Math.abs(run(fresh(), 4) - 1) < 1e-4, "unity at 0 dB");
check(Math.abs(run(fresh(), 4, { vol: 0 })) < 1e-9, "fader at the bottom is silent");
check(Math.abs(run(fresh(), 200, { mute: 1 })) < 1e-6, "mute silences");
check(Math.abs(run(fresh(), 200, { others: 1 })) < 1e-6, "another channel soloed silences this one");
check(Math.abs(run(fresh(), 200, { others: 1, solo: 1 }) - 1) < 1e-4, "a soloed channel stays audible");
{
  const inst = fresh(); run(inst, 4);
  inst.params.fill(0, 0, CHUNK); inst.params.fill(1, CHUNK, 2 * CHUNK); inst.process(CHUNK);
  const first = inst.outputs[0], lastSample = inst.outputs[CHUNK - 1];
  check(first > 0.5 && lastSample < first, "mute fades instead of clicking", `${first.toFixed(3)} -> ${lastSample.toFixed(3)} over one chunk`);
}
{
  const inst = fresh(); run(inst, 100);
  check(inst.paramText(0, 0.9090909) === "0.0 dB" && inst.paramText(0, 0) === "-inf" && inst.paramText(0, 1) === "6.0 dB", "param text", JSON.stringify(inst.paramText(0, 0.9090909)));
  const level = inst.live().values.level;
  check(level > 0.9 && level <= 1.0001, "probe (bleep_live) reports the level", `level ${level.toFixed(3)}`);
}

// ---- 5. speed (V8 here; the engine's Wasmtime numbers are in patch/wasm-host/README.md) -----------------
{
  const inst = fresh(); inst.params.fill(0.9, 0, CHUNK); inst.inputs.fill(0.5, 0, CHUNK);
  const chunks = 200000;
  for (let c = 0; c < 2000; c++) inst.process(CHUNK);  // warm up
  const t0 = process.hrtime.bigint();
  for (let c = 0; c < chunks; c++) inst.process(CHUNK);
  const ns = Number(process.hrtime.bigint() - t0) / (chunks * CHUNK);
  check(ns < 200, "speed", `${ns.toFixed(1)} ns / sample, ${(ns * SR / 1e9 * 100).toFixed(2)} % of a core at 48 kHz`);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
