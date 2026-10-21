// SPDX-License-Identifier: GPL-3.0-or-later
// The documentation's code: every ```ts compile block in website/content/developers/bleep-script compiles, and the tutorials' modules do what
// the text says (a step sequencer's timing, a drive's aliasing, a sample and hold, ...).   node test/docs.test.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import asc from "assemblyscript/asc";
import { compileScript } from "../compiler/compile.mjs";
import { compileModule, ModuleInstance, CHUNK } from "../../web/js/module-host.js";
import { wrapExample } from "./doc-examples.mjs";
import { runPatchScript } from "../patch/run.mjs";
import { materialize } from "../patch/materialize.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const docs = fileURLToPath(new URL("../../../website/content/developers/bleep-script/", import.meta.url));
const libraries = readdirSync(`${root}src/bleep`).filter((f) => f.endsWith(".ts")).map((f) => f.slice(0, -3));
const lib = Object.fromEntries(libraries.map((n) => [`src/bleep/${n}.ts`, readFileSync(`${root}src/bleep/${n}.ts`, "utf8")]));
let failures = 0;
const check = (ok, what, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? "  " + detail : ""}`); if (!ok) failures++; };
const SR = 48000;

const files = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : n.endsWith(".md") ? [join(dir, n)] : []));
const blocks = [];
for (const file of files(docs)) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/```ts compile\n([\s\S]*?)```/g)) blocks.push({ file: file.slice(docs.length), source: m[1] });
}
const built = new Map();   // module name -> { r, spec, wasm }
for (const b of blocks) {
  const r = await compileScript(asc, b.source, { lib });
  const spec = r.specs[0];
  check(!!r.wasm, `${b.file}: ${spec ? spec.name : "a module"} compiles`, r.problems.filter((p) => p.severity === "error").map((p) => `${p.line}: ${p.message}`).join(" | "));
  if (r.wasm) built.set(spec.name, { r, spec, wasm: await compileModule(r.wasm) });
}
check(blocks.length >= 18, "the docs have their examples", `${blocks.length} blocks`);

function make(name, values = {}) {
  const { spec, wasm } = built.get(name);
  const m = new ModuleInstance(wasm, SR);
  const index = (id) => spec.params.findIndex((p) => p.id === id);
  const inputIndex = (id) => spec.inputs.findIndex((p) => p.id === id);
  const outputIndex = (id) => spec.outputs.findIndex((p) => p.id === id);
  const norm = (p, v) => (p.kind === "bool" ? (v ? 1 : 0) : p.kind === "choice" ? v / (p.choices.length - 1) : p.map === "exp" ? Math.log(v / p.min) / Math.log(p.max / p.min) : p.map === "skew" ? Math.pow(Math.max(0, (v - p.min) / (p.max - p.min)), Math.log(0.5) / Math.log((p.centre - p.min) / (p.max - p.min))) : (v - p.min) / (p.max - p.min));
  const set = (id, v) => { const p = spec.params[index(id)]; m.params.fill(norm(p, v), index(id) * CHUNK, (index(id) + 1) * CHUNK); };
  for (const p of spec.params) m.params.fill(p.default, index(p.id) * CHUNK, (index(p.id) + 1) * CHUNK);
  for (const [k, v] of Object.entries(values)) if (index(k) >= 0) set(k, v);
  return { m, spec, set, inputIndex, outputIndex };
}
/// Runs `n` samples through a module: feed(i, sampleNumber) gives the input values; returns the outputs per sample.
function run(h, n, feed = () => 0, { transport } = {}) {
  const out = h.spec.outputs.map(() => new Float32Array(n));
  for (let c = 0; c * CHUNK < n; c++) {
    for (let k = 0; k < CHUNK; k++) for (let i = 0; i < h.spec.inputs.length; i++) h.m.inputs[i * CHUNK + k] = feed(i, c * CHUNK + k);
    if (transport) h.m.setTransport(...transport(c * CHUNK)); else h.m.setTransport(120, 0, false, c * CHUNK);
    h.m.process(CHUNK);
    for (let o = 0; o < out.length; o++) for (let k = 0; k < CHUNK; k++) out[o][c * CHUNK + k] = h.m.outputs[o * CHUNK + k];
  }
  return out;
}
const rises = (a) => { const r = []; for (let i = 0; i < a.length; i++) if (a[i] > 0.5 && (i === 0 ? true : a[i - 1] <= 0.5)) r.push(i); return r; };
const tone = (hz, amp = 1) => (_, n) => amp * Math.sin(2 * Math.PI * hz * n / SR);
const maxJump = (a) => { let j = 0; for (let i = 1; i < a.length; i++) j = Math.max(j, Math.abs(a[i] - a[i - 1])); return j; };

// ---- smoothing ----
if (built.has("Gain Naive") && built.has("Gain")) {
  const jump = (name) => { const h = make(name, { level: 1 }); run(h, 4800, () => 1); h.set("level", 0); return maxJump([1, ...run(h, 2400, () => 1)[0]]); };
  const naive = jump("Gain Naive"), smooth = jump("Gain");
  check(naive > 0.9 && smooth < 0.01, "smoothing: a knob jump is a step without the smoother and a glide with it", `naive ${naive.toFixed(3)}, smoothed ${smooth.toFixed(4)}`);
}

// ---- drive: aliasing ----
if (built.has("Drive Naive") && built.has("Drive")) {
  const N = 8192;
  const bin = (sig, k) => { let re = 0, im = 0; for (let n = 0; n < sig.length; n++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / sig.length); re += sig[n] * w * Math.cos(2 * Math.PI * k * n / sig.length); im -= sig[n] * w * Math.sin(2 * Math.PI * k * n / sig.length); } return Math.hypot(re, im); };
  // a tone on an FFT bin, so its harmonics fall on bins too: everything that is not a multiple of it is folded
  const f0bin = 853, hz = f0bin * SR / N;
  const spectrum = (name) => { const h = make(name, { drive: 30, mix: 1 }); const y = run(h, N + 4800, tone(hz, 0.5))[0].slice(4800); return y; };
  const alias = (y) => { let a = 0, total = 0; for (let k = 20; k < N / 2; k += 1) { const e = bin(y, k) ** 2; total += e; if (k % f0bin !== 0 && Math.abs(((k + f0bin / 2) % f0bin) - f0bin / 2) > 4) a += e; } return a / total; };
  const low = (y) => { let a = 0, total = 0; for (let k = 20; k < N / 2; k += 1) { const e = bin(y, k) ** 2; total += e; if (k < f0bin * 0.8) a += e; } return a / total; };
  const ny = spectrum("Drive Naive"), ay = spectrum("Drive");
  const lowReduction = 10 * Math.log10(low(ny) / low(ay));
  console.log(`     below the fundamental: ${(10 * Math.log10(low(ny))).toFixed(1)} dB (naive), ${(10 * Math.log10(low(ay))).toFixed(1)} dB (ADAA), ${lowReduction.toFixed(1)} dB lower`);
  const naive = alias(ny), adaa = alias(ay);
  const reduction = 10 * Math.log10(naive / adaa);
  check(reduction > 5, "drive: anti-derivative anti-aliasing lowers the folded partials", `${reduction.toFixed(1)} dB lower (30 dB drive, ${hz.toFixed(0)} Hz)`);
  console.log(`     measured: folded energy ${(10 * Math.log10(naive)).toFixed(1)} dB (naive) and ${(10 * Math.log10(adaa)).toFixed(1)} dB (ADAA)`);
}

// ---- sample and hold ----
if (built.has("Sample and Hold")) {
  const h = make("Sample and Hold");
  const sig = (i, n) => (i === 0 ? n / 1000 : (n >= 100 && n < 160) || (n >= 500 && n < 560) ? 1 : 0);   // a ramp, and two triggers
  const out = run(h, 800, sig)[0];
  check(Math.abs(out[99]) < 1e-6 && Math.abs(out[100] - 0.1) < 1e-6 && Math.abs(out[300] - 0.1) < 1e-6 && Math.abs(out[500] - 0.5) < 1e-6 && Math.abs(out[790] - 0.5) < 1e-6,
    "sample and hold: takes the signal at the trigger's sample and holds it", `${out[99]} ${out[100]} ${out[300]} ${out[500]}`);
  const t = make("Sample and Hold", { mode: 1 });
  const tr = run(t, 300, (i, n) => (i === 0 ? n / 1000 : n >= 100 && n < 200 ? 1 : 0))[0];
  check(Math.abs(tr[150] - 0.15) < 1e-6 && Math.abs(tr[250] - 0.199) < 1e-3, "sample and hold: track mode follows while the trigger is high", `${tr[150]} ${tr[250]}`);
  const g = make("Sample and Hold", { glide: 0.05 });
  const gl = run(g, 6000, (i, n) => (i === 0 ? 1 : n >= 100 && n < 160 ? 1 : 0))[0];
  check(gl[110] < 0.2 && gl[3000] > 0.5 && gl[5990] > 0.9, "sample and hold: glide slews to the new value", `${gl[110].toFixed(3)} ${gl[3000].toFixed(3)} ${gl[5990].toFixed(3)}`);
}

// ---- inputs ----
if (built.has("Follower")) {
  const h = make("Follower");
  const o = run(h, 24000, tone(440, 0.5))[0];
  check(Math.abs(o[23999] - 0.5) < 0.05, "follower: the level of a tone", `${o[23999].toFixed(3)}`);
}
if (built.has("Transpose")) {
  const h = make("Transpose", { semitones: 12 });
  const [out, hz] = run(h, 4800, () => 0);
  check(Math.abs(out[4799] - 1) < 1e-3 && Math.abs(hz[4799] - 523.25) < 0.5, "transpose: an octave up is +1 volt and 523 Hz", `${out[4799].toFixed(3)} V, ${hz[4799].toFixed(2)} Hz`);
}
if (built.has("Gate Envelope")) {
  const h = make("Gate Envelope", { attack: 0.01, release: 0.1 });
  const [env, eoc] = run(h, 24000, (i, n) => (i === 0 && n >= 1000 && n < 10000 ? 1 : 0));
  check(env[900] === 0 && env[1240] > 0.4 && env[1240] < 0.6 && env[9000] === 1 && env[24000 - 1] === 0, "gate envelope: rises while the gate is high, falls after", `${env[1240].toFixed(2)} ${env[9000]} ${env[23999]}`);
  check(rises(eoc).length === 1 && rises(eoc)[0] > 14000, "gate envelope: a pulse at the end of the release", `${rises(eoc)}`);
}
if (built.has("Mono Note")) {
  const h = make("Mono Note");
  const ev = (offset, type, note, value) => ({ type, channel: 0, offset, note, pitch: (note - 60) / 12, value });
  h.m.setNotesIn(0, [ev(5, 0, 64, 0.8), ev(20, 0, 67, 0.6)]);
  let o = run(h, 32);
  check(o[1][4] === 0 && o[1][5] === 1 && Math.abs(o[0][10] - 4 / 12) < 1e-6 && Math.abs(o[0][25] - 7 / 12) < 1e-6 && Math.abs(o[2][25] - 0.6) < 1e-6, "mono note: pitch, gate and velocity, at the event's sample");
  h.m.setNotesIn(0, [ev(3, 1, 67, 0)]);
  o = run(h, 32);
  check(o[1][10] === 1 && Math.abs(o[0][10] - 4 / 12) < 1e-6, "mono note: releasing the top key goes back to the one still down");
  h.m.setNotesIn(0, [ev(3, 1, 64, 0)]);
  o = run(h, 32);
  check(o[1][2] === 1 && o[1][10] === 0, "mono note: the last key up closes the gate");
}

// ---- toolbox ----
if (built.has("Saw Osc")) {
  const h = make("Saw Osc");
  const pitch = Math.log2(1000 / 261.6255653);
  const [saw, sine] = run(h, 4800, () => pitch);
  let cross = 0; for (let i = 1; i < 4800; i++) if (sine[i] >= 0 && sine[i - 1] < 0) cross++;
  check(cross >= 99 && cross <= 101 && Math.max(...saw) < 1.1 && Math.min(...saw) > -1.1, "saw osc: 1 kHz from a pitch voltage", `${cross} cycles in 0.1 s`);
}
if (built.has("Noise")) {
  const [w] = run(make("Noise"), 20000);
  const mean = w.reduce((a, b) => a + b, 0) / w.length, peak = Math.max(...w.map(Math.abs));
  check(Math.abs(mean) < 0.02 && peak > 0.4 && peak <= 0.5, "noise: centred, within its level", `mean ${mean.toFixed(4)}, peak ${peak.toFixed(3)}`);
}
if (built.has("Echo")) {
  const h = make("Echo", { time: 0.1, feedback: 0, mix: 1 });
  run(h, 48000, () => 0);
  const o = run(h, 12000, (i, n) => (n === 0 ? 1 : 0))[0];
  const at = o.findIndex((v) => Math.abs(v) > 0.5);
  check(Math.abs(at - 4800) <= 2, "echo: a click comes back after the delay time", `at sample ${at}`);
}
if (built.has("Pan")) {
  const h = make("Pan", { pan: -1 });
  const l = run(h, 4800, () => 1); const left = l[0][4799], right = l[1][4799];
  h.set("pan", 0); const c = run(h, 4800, () => 1);
  check(left > 0.99 && right < 0.01 && Math.abs(c[0][4799] ** 2 + c[1][4799] ** 2 - 1) < 1e-3, "pan: hard left, and equal power in the middle");
}
if (built.has("Divider")) {
  const h = make("Divider", { "divide": 4 });
  const [out] = run(h, 4800, (i, n) => (i === 0 && n % 300 < 30 ? 1 : 0));
  const r = rises(out);
  check(r.length === 4 && r[1] - r[0] === 1200, "divider: every fourth pulse", `${r}`);
}
if (built.has("Beat LFO")) {
  const h = make("Beat LFO", { beats: 1 });
  const sr = SR, bpm = 120;
  const [o] = run(h, 24000, () => 0, { transport: (n) => [bpm, n / sr * bpm / 60, true, n] });
  let up = 0; for (let i = 1; i < o.length; i++) if (o[i] >= 0 && o[i - 1] < 0) up++;
  check(up === 1 || up === 2, "beat LFO: one cycle per beat (0.5 s at 120 bpm)", `${up} rising zero crossings in 0.5 s`);
  const [o2] = run(h, 4800, () => 0, { transport: (n) => [bpm, 10.25 + n / sr * bpm / 60, true, n] });
  check(Math.abs(o2[0] - Math.sin(2 * Math.PI * 0.25)) < 0.01, "beat LFO: follows the host's position after a jump", `${o2[0].toFixed(3)}`);
}

// ---- the step sequencer ----
if (built.has("Step Sequencer 4x8")) {
  const lanes = { a: [1, 1, 1, 1, 1, 1, 1, 1], b: [1, 0, 1, 0, 1, 0, 1, 0], c: [1, 0, 0, 0, 0, 0, 0, 0], d: [0, 0, 0, 0, 0, 0, 0, 0] };
  const setup = (values) => { const h = make("Step Sequencer 4x8", values); for (const [l, steps] of Object.entries(lanes)) steps.forEach((v, i) => h.set(l + (i + 1), v)); return h; };
  const h = setup({ source: 0, division: 2, steps: 8 });
  let ppq = 0;
  const g = run(h, SR * 2, () => 0, { transport: (n) => [120, n / SR * 2, true, n] });
  const l = g.slice(0, 4).map(rises);
  const spacing = new Set(l[0].slice(1).map((v, i) => Math.round((v - l[0][i]) / 100) * 100));
  check(l[0].length === 16 && [...spacing].join() === "6000", "sequencer: 16th notes at 120 bpm are 6000 samples apart (lane 1)", `${l[0].length} steps, spacing ${[...spacing]}`);
  check(l[1].length === 8 && l[2].length === 2 && l[3].length === 0, "sequencer: each lane plays its own pattern, over two bars", `${l[1].length} ${l[2].length} ${l[3].length}`);
  const width = g[0].findIndex((v, i) => i > l[0][0] && v < 0.5) - l[0][0];
  check(Math.abs(width - 3000) <= 40, "sequencer: the gate is half a step long", `${width} samples`);
  // the tempo changes: a step takes less time
  const f = setup({ source: 0, division: 2, steps: 8 });
  const fast = run(f, SR, () => 0, { transport: (n) => [240, n / SR * 4, true, n] })[0];
  check(rises(fast).length === 16 && Math.abs(rises(fast)[1] - rises(fast)[0] - 3000) <= 2, "sequencer: follows a faster tempo", `${rises(fast).length} steps in a second`);
  // stopped: silent
  const s = setup({ source: 0 });
  const stopped = run(s, SR / 2, () => 0)[0];
  check(Math.max(...stopped) === 0, "sequencer: silent while the transport is stopped");
  // a different position: step 5 sounds when the host jumps to beat 1.0
  // clock in
  const c = setup({ source: 1, pulses: 2, steps: 8 });
  const clocks = run(c, SR * 3, (i, n) => (i === 0 && n >= 4800 && n % 4800 < 48 ? 1 : 0));
  const lc = clocks.slice(0, 4).map(rises);
  const gap = lc[0].slice(1).map((v, i) => v - lc[0][i]);
  check(lc[0][0] >= 4800 && lc[0][0] < 4810 && gap.every((x) => Math.abs(x - 9600) <= 2), "sequencer: runs from a clock input, two pulses per step", `first ${lc[0][0]}, gaps ${[...new Set(gap)]}`);
  check(lc[2].length === 1 || lc[2].length === 2, "sequencer: lane 3 plays step 1 only", `${lc[2]}`);
  // reset input
  const r = setup({ source: 1, pulses: 1, steps: 8 });
  const rs = run(r, 30000, (i, n) => (i === 0 && n >= 4800 && n % 4800 < 48 ? 1 : i === 1 && n >= 21000 && n < 21050 ? 1 : 0));
  const lr = rises(rs[2]);
  const both = run(setup({ source: 1, pulses: 1, steps: 8 }), 30000, (i, n) => (i === 0 && n >= 4800 && n % 4800 < 48 ? 1 : i === 1 && n >= 19200 && n < 19250 ? 1 : 0));
  check(rises(both[2]).length === 2 && rises(both[2])[1] === 19200, "sequencer: a reset on the same sample as a clock pulse wins", `${rises(both[2])}`);
  check(lr.length === 2 && lr[1] >= 21000 && lr[1] < 21010, "sequencer: a trigger on Reset starts again at step 1", `${lr}`);
}


// ---- oscillators ----
const crossings = (a) => { let c = 0; for (let i = 1; i < a.length; i++) if (a[i] >= 0 && a[i - 1] < 0) c++; return c; };
const volts = (hz) => Math.log2(hz / 261.6255653);
if (built.has("Sine")) {
  const [o] = run(make("Sine", { frequency: 440 }), SR);
  const peak = Math.max(...o), c = crossings(o);
  check(Math.abs(c - 440) <= 1 && Math.abs(peak - 1) < 1e-3, "sine: 440 Hz, full scale", `${c} cycles per second, peak ${peak.toFixed(4)}`);
}
if (built.has("Sine Osc")) {
  const h = make("Sine Osc", { level: 1 });
  const [o] = run(h, SR, () => volts(440));
  check(Math.abs(crossings(o) - 440) <= 1, "sine osc: the pitch input in volts per octave gives 440 Hz", `${crossings(o)}`);
  const t = make("Sine Osc", { level: 1, octave: 1, semitones: 7, fine: 0 });
  const [o2] = run(t, SR, () => volts(440));
  const want = 440 * 2 * Math.pow(2, 7 / 12);
  check(Math.abs(crossings(o2) - want) <= 1.5, "sine osc: an octave and a fifth up", `${crossings(o2)} vs ${want.toFixed(1)}`);
}
if (built.has("Sine Table")) {
  const [o] = run(make("Sine Table", { frequency: 440 }), SR);
  let worst = 0; const inc = 440 / SR;
  for (let n = 0; n < 2000; n++) { const p = (n * inc) % 1; worst = Math.max(worst, Math.abs(o[n] - Math.sin(2 * Math.PI * p))); }
  check(worst < 1e-5, "sine table: within 1e-5 of Math.sin", `worst error ${worst.toExponential(2)}`);
}
if (built.has("Oscillator")) {
  const base = { level: 1, "fmAmount": 0 };
  const bins = (y, n = y.length) => (k) => { let re = 0, im = 0; for (let i = 0; i < n; i++) { re += y[i] * Math.cos(2 * Math.PI * k * i / n); im -= y[i] * Math.sin(2 * Math.PI * k * i / n); } return 2 * Math.hypot(re, im) / n; };
  // every waveform at 1 kHz
  for (const [name, w] of [["sine", 0], ["triangle", 1], ["saw", 2], ["square", 3]]) {
    const h = make("Oscillator", { ...base, waveform: w });
    const [o] = run(h, SR, () => volts(1000));
    check(Math.abs(crossings(o) - 1000) <= 2 && Math.max(...o) <= 1.1 && Math.min(...o) >= -1.1, `oscillator: ${name} at 1 kHz`, `${crossings(o)} cycles, ${Math.min(...o).toFixed(2)}..${Math.max(...o).toFixed(2)}`);
  }
  // PolyBLEP: a saw at 3.2 kHz folds much less than the naive one. Non-harmonic energy relative to the total, on an exact FFT bin.
  {
    const N = 8192, k0 = 560, hz = k0 * SR / N;   // 3281 Hz: its harmonics fall on bins
    const h = make("Oscillator", { ...base, waveform: 2 });
    const y = run(h, N + 4800, () => volts(hz))[0].slice(4800);
    const naive = Float32Array.from({ length: N }, (_, n) => { const t = (n * hz / SR + 0) % 1; return 0.5 * (2 * t - 1); });   // level 1 * 0.5 smoothing differences are irrelevant here
    const foldedShare = (sig) => { const b = bins(sig, N); let a = 0, total = 0; for (let k = 20; k < N / 2; k += 1) { const e = b(k) ** 2; total += e; if (Math.abs(((k + k0 / 2) % k0) - k0 / 2) > 3) a += e; } return a / total; };
    const polyblep = foldedShare(y), plain = foldedShare(naive);
    const gain = 10 * Math.log10(plain / polyblep);
    console.log(`     saw at ${hz.toFixed(0)} Hz: folded energy ${(10 * Math.log10(plain)).toFixed(1)} dB naive, ${(10 * Math.log10(polyblep)).toFixed(1)} dB PolyBLEP (${gain.toFixed(1)} dB lower)`);
    check(gain > 10, "oscillator: PolyBLEP lowers the folded partials of a saw", `${gain.toFixed(1)} dB`);
  }
  // FM: carrier 1 kHz, modulator 200 Hz at amplitude 1, amount 400 Hz: modulation index 2 -> J0(2) = 0.2239, J1(2) = 0.5767
  {
    const N = 48000;
    const h = make("Oscillator", { ...base, waveform: 0, fmAmount: 400 });
    const y = run(h, N, (i, n) => (i === 0 ? volts(1000) : i === 1 ? Math.sin(2 * Math.PI * 200 * n / SR) : 0))[0];
    const b = bins(y, N);
    check(Math.abs(b(1000) - 0.2239) < 0.02 && Math.abs(b(800) - 0.5767) < 0.02 && Math.abs(b(1200) - 0.5767) < 0.02, "oscillator: FM with index 2 has the Bessel amplitudes (J0 0.224, J1 0.577)", `${b(1000).toFixed(3)} ${b(800).toFixed(3)} ${b(1200).toFixed(3)}`);
  }
  // sync: a slave at 1.5x the master restarts with the master's period
  {
    const master = make("Oscillator", { ...base, waveform: 2 }), slave = make("Oscillator", { ...base, waveform: 2 });
    const n = 24000, mp = SR / 200;                           // master 200 Hz: 240 samples
    const m = run(master, n, () => volts(200));
    const syncPulses = rises(m[1]);
    check(syncPulses.length >= 99 && Math.abs(syncPulses[10] - syncPulses[9] - mp) <= 1, "oscillator: the sync output pulses once per cycle", `${syncPulses.length} pulses, spacing ${syncPulses[10] - syncPulses[9]}`);
    const s = run(slave, n, (i, k) => (i === 0 ? volts(300) : i === 2 ? m[1][k] : 0))[0];
    let worst = 0; for (let i = 4800; i < n - 240; i++) worst = Math.max(worst, Math.abs(s[i] - s[i + 240]));
    check(worst < 0.02, "oscillator: a synced slave repeats with the master's period", `worst difference ${worst.toExponential(2)}`);
    const free = run(make("Oscillator", { ...base, waveform: 2 }), n, () => volts(300))[0];
    let wf = 0; for (let i = 4800; i < n - 240; i++) wf = Math.max(wf, Math.abs(free[i] - free[i + 240]));
    check(wf > 0.1, "oscillator: without sync it does not (a control for the test above)", `difference ${wf.toFixed(2)}`);
  }
  // pulse width
  {
    const h = make("Oscillator", { ...base, waveform: 3, width: 0.25 });
    const [o] = run(h, 48000, () => volts(100));
    const high = o.slice(4800).filter((v) => v > 0).length / (o.length - 4800);
    check(Math.abs(high - 0.25) < 0.01, "oscillator: a pulse width of 0.25 is high a quarter of the time", `${high.toFixed(3)}`);
  }
}

// the tutorials' modules are also in the Code node's Examples menu
{
  const { EXAMPLES } = await import("../playground/examples.mjs");
  for (const id of ["seq4x8", "drive", "sample-hold", "sample-hold-ui", "mono-note", "echo", "sine", "sine-osc", "sine-table", "oscillator"]) {
    const e = EXAMPLES.find((x) => x.id === id);
    const r = e ? await compileScript(asc, e.source, { lib }) : null;
    check(!!(r && r.wasm), `example '${id}' compiles`, r ? r.problems.map((p) => p.message).join(" | ") : "missing");
  }
}

// the library page: every function and class of the bleep/ libraries has an example, and every example compiles
{
  const page = readFileSync(`${docs}library.md`, "utf8");
  const examples = [...page.matchAll(/^#### (.+)\n\n```ts example\n([\s\S]*?)```/gm)].map((m) => ({ title: m[1], code: m[2] }));
  for (const e of examples) {
    const r = await compileScript(asc, wrapExample(e.code), { lib });
    check(!!r.wasm, `library.md: example ${e.title} compiles`, r.problems.filter((p) => p.severity === "error").map((p) => `${p.line}: ${p.message}`).join(" | "));
  }
  const text = examples.map((e) => e.code).join("\n");
  const missing = libraries.filter((f) => !["abi", "format"].includes(f)).flatMap((f) =>
    [...lib[`src/bleep/${f}.ts`].matchAll(/^export (?:function|class) (\w+)/gm)].map((m) => m[1]).filter((name) => !new RegExp(`\\b${name}\\b`).test(text)).map((name) => `${f}/${name}`));
  check(missing.length === 0, "the library page has an example for every function and class", missing.join(", "));
}

// the built-ins reference: every patch script example runs and is valid against the board's module types
{
  const types = Object.fromEntries(JSON.parse(readFileSync(fileURLToPath(new URL("../../board/ui/demo-types.json", import.meta.url)), "utf8")).map((t) => [t.type, t]));
  const page = readFileSync(`${docs}reference.md`, "utf8");
  let n = 0;
  for (const m of page.matchAll(/```ts patch\n([\s\S]*?)```/g)) {
    n++;
    const r = await runPatchScript(m[1], {});
    const built = r.ok ? materialize(r.spec, types, { cellId: "gen-1", parent: "", x: 0, y: 0, generatedBy: "code-1" }) : null;
    check(!!(r.ok && built && built.ok), `reference.md: patch example ${n} builds`, (r.ok ? (built.problems || []) : r.problems).map((p) => `${p.line}: ${p.message}`).join(" | "));
  }
  check(n >= 6, "reference.md has the patch builder examples", String(n));
}

// the AI programming prompt: its code compiles, and it names every export of the library
{
  const page = readFileSync(`${docs}ai-programming.md`, "utf8");
  const prompt = page.match(/^~~~~markdown\n([\s\S]*?)\n~~~~$/m)?.[1] ?? "";
  check(prompt.length > 10000, "the AI prompt is on its page", `${prompt.length} characters`);
  const dummy = `\n@module({ name: "Dummy" }) export class Dummy { @output({ name: "Out", type: "audio" }) out: f32 = 0; constructor(sampleRate: f64) {} sample(): void {} }\n`;
  let n = 0;
  for (const m of prompt.matchAll(/```ts\n([\s\S]*?)```/g)) {
    // a complete module, or helpers (functions, classes) that are compiled next to a dummy module
    if (m[1].includes("export default cell(")) continue;                  // a patch script, built by a different compiler
    const complete = /export class/.test(m[1]);
    if (!complete && /^\s*@/m.test(m[1])) continue;                        // a fragment of decorators, shown to explain them
    const source = complete ? m[1] : m[1] + dummy;
    const r = await compileScript(asc, source, { lib });
    n++;
    check(!!r.wasm, `ai-programming.md: code block ${n} compiles`, r.problems.filter((p) => p.severity === "error").map((p) => `${p.line}: ${p.message}`).join(" | "));
  }
  const exported = ["dsp", "env", "notes", "osc", "filters", "delay", "random", "dynamics", "fx", "fft", "util"].flatMap((f) => [...lib[`src/bleep/${f}.ts`].matchAll(/^export (?:function|class|const) (\w+)/gm)].map((x) => x[1]));
  const missing = exported.filter((name) => !new RegExp(`\\b${name}\\b`).test(prompt));
  check(missing.length === 0, "the AI prompt names every export of the bleep/ libraries", missing.join(", "));
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
