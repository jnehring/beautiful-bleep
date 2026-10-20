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

MODULES.filters = `
import { Biquad } from "./bleep/dsp";
import { OnePole, Svf, LadderFilter, Resonz, Formant, Allpass1, Allpass2, CombFilter } from "./bleep/filters";
import { midiToHz, fastTanh, Pan, MidSide, Rms, clamp } from "./bleep/util";
@module({ name: "FilterTest", category: "Utility/Test" })
export class FilterTest {
  @input x: f32 = 0;
  @output out: f32 = 0;
  @param({ name: "Cutoff", min: 20, max: 12000, init: 800 }) cutoff: f32 = 800;
  private bq: Biquad = new Biquad();
  private op: OnePole = new OnePole();
  private svf: Svf = new Svf();
  private ladder: LadderFilter = new LadderFilter();
  private rz: Resonz = new Resonz();
  private formant: Formant = new Formant();
  private ap1: Allpass1 = new Allpass1();
  private ap2: Allpass2 = new Allpass2();
  private comb: CombFilter;
  private pan: Pan = new Pan();
  private ms: MidSide = new MidSide();
  private level: Rms;
  constructor(sampleRate: f64) { this.comb = new CombFilter(512); this.level = new Rms(sampleRate, 0.1); }
  block(): void {
    const f = <f64>this.cutoff;
    this.bq.setBandpass(48000.0, f, 2.0); this.op.setLowpass(48000.0, f); this.svf.set(48000.0, f, 2.0); this.ladder.set(48000.0, f, 0.5);
    this.rz.set(48000.0, f, 100.0); this.formant.setVowel(48000.0, 1.5); this.ap1.set(48000.0, f); this.ap2.set(48000.0, f, 1.0);
    this.comb.setDelay(100.5); this.comb.feedback = 0.5; this.pan.equalPower(0.3);
  }
  sample(): void {
    const x = this.x;
    this.svf.tick(x);
    const y = this.bq.next(x) + this.op.next(x) + this.svf.low + this.ladder.next(x) + this.rz.next(x) + this.formant.next(x) + this.ap1.next(x) + this.ap2.next(x) + this.comb.next(x);
    this.ms.encode(y, x);
    this.out = clamp(fastTanh(this.ms.mid * this.pan.left) * <f32>midiToHz(60.0) * 0.001 + this.level.next(y), -4.0, 4.0);
  }
}`;

MODULES.delay = `
import { DelayLine, TapeDelay, KarplusStrong, interpLinear, interpCubic, interpLagrange } from "./bleep/delay";
import { NoteEvent } from "./bleep/notes";
@module({ name: "DelayTest", category: "Utility/Test" })
export class DelayTest {
  @input x: f32 = 0;
  @input({ type: "notes" }) notes!: NoteStream;
  @output out: f32 = 0;
  @param({ name: "Time", min: 0.01, max: 0.5, init: 0.1 }) time: f32 = 0.1;
  private line: DelayLine;
  private tape: TapeDelay;
  private string: KarplusStrong;
  private table: StaticArray<f32>;
  private ph: f64 = 0;
  constructor(sampleRate: f64) {
    this.line = new DelayLine(2000);
    this.tape = new TapeDelay(sampleRate, 1.0);
    this.string = new KarplusStrong(sampleRate, 55.0);
    this.table = new StaticArray<f32>(256);
    for (let i = 0; i < 256; i++) this.table[i] = <f32>Math.sin(<f64>i * 6.283185307179586 / 256.0);
  }
  block(): void { this.tape.time = this.time; this.tape.feedback = 0.4; this.tape.setTone(3000.0); }
  @on("notes") play(n: NoteEvent): void { if (n.isOn) this.string.pluck(261.0); }
  sample(): void {
    this.line.write(this.x);
    this.ph += 0.01;
    this.out = this.line.read(100.5) + this.line.readCubic(200.25) + this.line.readAllpass(300.7) + this.tape.next(this.x) + this.string.next()
      + interpLinear(this.table, this.ph * 256.0) + interpCubic(this.table, this.ph * 256.0) + interpLagrange(this.table, this.ph * 256.0);
  }
}`.replace('import { NoteEvent }', 'import { NoteEvent, NoteStream }');

MODULES.random = `
import { Xorshift, Lcg, whiteNoise, WhiteNoise, PinkNoise, BrownNoise, SampleAndHold, NoiseLfo } from "./bleep/random";
@module({ name: "RandomTest", category: "Utility/Test" })
export class RandomTest {
  @input gate: f32 = 0;
  @output out: f32 = 0;
  private xs: Xorshift = new Xorshift(7);
  private lcg: Lcg = new Lcg(7);
  private white: WhiteNoise = new WhiteNoise(3);
  private pink: PinkNoise = new PinkNoise(4);
  private brown: BrownNoise = new BrownNoise(5);
  private sh: SampleAndHold = new SampleAndHold();
  private lfo: NoiseLfo;
  constructor(sampleRate: f64) { this.lfo = new NoiseLfo(sampleRate, 9); }
  sample(): void {
    const n = whiteNoise(this.xs);
    this.out = 0.1 * (n + this.lcg.nextBipolar() + this.white.next() + this.pink.next() + this.brown.next() + this.sh.next(n, this.gate) + this.lfo.next(3.0) + this.xs.next());
  }
}`;

for (const [name, source] of Object.entries(MODULES)) {
  const r = await run(source, { inputs: [0.3] });
  check(r.errors.length === 0, `${name}: compiles with the subset checker`, r.errors.map((e) => `${e.line}: ${e.message}`).join("; "));
  if (r.out) {
    check(finiteAll(r.out) && peak(r.out) > 0.05 && peak(r.out) < 8, `${name}: runs in the module host`, `peak ${peak(r.out).toFixed(3)}`);
    check(r.cost && r.cost.ops > 0, `${name}: has a cost estimate`, JSON.stringify(r.cost));
  }
}
finish();
