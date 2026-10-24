// SPDX-License-Identifier: GPL-3.0-only
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

MODULES.env = `
import { Adsr, Ad, Ar, EnvFollower, Slew, Lfo, Line, Ramp, Trigger, Schmitt, Clock, LFO_TRIANGLE } from "./bleep/env";
@module({ name: "EnvTest", category: "Utility/Test" })
export class EnvTest {
  @input gate: f32 = 0;
  @output out: f32 = 0;
  @param({ name: "Attack", min: 0.001, max: 2, init: 0.01 }) attack: f32 = 0.01;
  private adsr: Adsr; private ad: Ad; private ar: Ar; private follower: EnvFollower; private slew: Slew; private lfo: Lfo;
  private line: Line; private ramp: Ramp; private trig: Trigger = new Trigger(); private schmitt: Schmitt = new Schmitt(0.2, 0.8); private clock: Clock;
  constructor(sampleRate: f64) {
    this.adsr = new Adsr(sampleRate); this.ad = new Ad(sampleRate); this.ar = new Ar(sampleRate); this.follower = new EnvFollower(sampleRate);
    this.slew = new Slew(sampleRate); this.lfo = new Lfo(sampleRate, 3); this.line = new Line(sampleRate); this.ramp = new Ramp(sampleRate); this.clock = new Clock(sampleRate);
    this.lfo.shape = LFO_TRIANGLE;
    this.slew.rise = 100.0;
    this.clock.bpm = 140.0;
  }
  block(): void { this.adsr.set(<f64>this.attack, 0.1, 0.6, 0.2); this.ad.set(0.005, 0.1); this.ar.set(0.01, 0.1); this.ramp.setTime(0.1); this.adsr.exponential = false; }
  sample(): void {
    this.clock.next();
    const g = this.gate;
    this.out = 0.1 * (this.adsr.next(g) + this.ad.next(g) + this.ar.next(g) + this.follower.next(g) + this.slew.next(g) + this.lfo.next(4.0) + this.line.next()
      + this.ramp.next(g) + this.trig.next(g) + this.schmitt.next(g) + (this.clock.ticked ? 1.0 : 0.0));
  }
}`;

MODULES.dynamics = `
import { Compressor, Limiter, Gate, softClip, hardClip, foldback, asymSat, chebyshev, Bitcrush, Decimate, Oversampler2x, Oversampler4x } from "./bleep/dynamics";
@module({ name: "DynTest", category: "Utility/Test" })
export class DynTest {
  @input x: f32 = 0;
  @input key: f32 = 0;
  @output out: f32 = 0;
  @probe reduction: f32 = 0;
  @param({ name: "Drive", min: 0, max: 24, init: 6, unit: "dB" }) drive: f32 = 6;
  private comp: Compressor; private limiter: Limiter; private gate: Gate; private crush: Bitcrush = new Bitcrush(6.0); private dec: Decimate = new Decimate();
  private os2: Oversampler2x = new Oversampler2x(); private os4: Oversampler4x = new Oversampler4x();
  constructor(sampleRate: f64) {
    this.comp = new Compressor(sampleRate); this.limiter = new Limiter(sampleRate, 0.002); this.gate = new Gate(sampleRate);
    this.dec.ratio = 0.5;
  }
  block(): void { this.comp.thresholdDb = -20.0; this.comp.ratio = 3.0; this.comp.setTimes(0.005, 0.1); this.gate.openDb = -50.0; this.crush.setBits(10.0); }
  sample(): void {
    const g = this.x * (1.0 + this.drive * 0.1);
    this.os2.up(g);
    const shaped = this.os2.down(softClip(this.os2.a), foldback(this.os2.b, 0.9));
    this.os4.up(shaped);
    const s4 = this.os4.down(hardClip(this.os4.a, 0.8), asymSat(this.os4.b, 0.3), chebyshev(this.os4.c, 3), this.os4.d);
    const c = this.comp.nextKeyed(s4, this.key);
    this.reduction = this.comp.gainReductionDb;
    this.out = this.limiter.next(this.gate.next(this.dec.next(this.crush.next(c))));
  }
}`;

MODULES.fx = `
import { Reverb, Phaser, Chorus, PitchShift } from "./bleep/fx";
import { Fft } from "./bleep/fft";
@module({ name: "FxTest", category: "Utility/Test" })
export class FxTest {
  @input x: f32 = 0;
  @output left: f32 = 0;
  @output right: f32 = 0;
  @probe peakBin: f32 = 0;
  private reverb: Reverb; private phaser: Phaser; private chorus: Chorus; private shifter: PitchShift; private fft: Fft;
  private filled: i32 = 0;
  constructor(sampleRate: f64) {
    this.reverb = new Reverb(sampleRate); this.phaser = new Phaser(sampleRate, 6); this.chorus = new Chorus(sampleRate, 3); this.shifter = new PitchShift(sampleRate);
    this.fft = new Fft(256);
    this.shifter.ratio = 1.5;
  }
  block(): void { this.reverb.roomSize = 0.8; this.reverb.update(); }
  sample(): void {
    const x = this.x;
    this.reverb.next(x);
    this.chorus.next(this.phaser.next(this.shifter.next(x)));
    this.left = this.reverb.left * 0.5 + this.chorus.left * 0.5;
    this.right = this.reverb.right * 0.5 + this.chorus.right * 0.5;
    this.fft.re[this.filled] = x; this.fft.im[this.filled] = 0.0;
    this.filled++;
    if (this.filled >= 256) {
      this.filled = 0;
      this.fft.forward();
      let best: f32 = 0.0, at: i32 = 0;
      for (let k = 1; k < 128; k++) { const m = this.fft.magnitude(k); if (m > best) { best = m; at = k; } }
      this.peakBin = <f32>at;
    }
  }
}`;

for (const [name, source] of Object.entries(MODULES)) {
  const r = await run(source, { inputs: [0.9] });
  check(r.errors.length === 0, `${name}: compiles with the subset checker`, r.errors.map((e) => `${e.line}: ${e.message}`).join("; "));
  if (r.out) {
    check(finiteAll(r.out) && peak(r.out) > 0.05 && peak(r.out) < 8, `${name}: runs in the module host`, `peak ${peak(r.out).toFixed(3)}`);
    check(r.cost && r.cost.ops > 0, `${name}: has a cost estimate`, JSON.stringify(r.cost));
  }
}
// ---- the shipped example: src/synth-voice.dsp.ts (a note in, sound out; silence without a note) ----------------------------------------------
{
  const source = readFileSync(`${root}src/synth-voice.dsp.ts`, "utf8");
  const r = await compileScript(asc, source, { lib });
  check(!!r.wasm && r.problems.filter((p) => p.severity === "error").length === 0, "synth-voice example compiles with the subset checker", r.problems.map((p) => `${p.line}: ${p.message}`).join("; "));
  if (r.wasm) {
    const m = new ModuleInstance(await compileModule(r.wasm), 48000, r.specs[0].type);
    const render = (chunks, events) => { const out = []; for (let c = 0; c < chunks; c++) { m.setNotesIn(0, c === 0 ? events : []); m.process(CHUNK); out.push(...m.outputs.slice(0, CHUNK)); } return Float32Array.from(out); };
    // knobs at their defaults: the host takes normalised values, so ask the description for them
    r.specs[0].params.forEach((p, i) => m.params.fill(p.default, i * CHUNK, (i + 1) * CHUNK));
    const silent = render(100, []);
    check(peak(silent) === 0, "synth-voice: silent until a note arrives");
    const played = render(300, [{ type: 0, offset: 0, note: 57, pitch: -0.25, value: 0.8 }]);
    check(finiteAll(played) && peak(played) > 0.05 && peak(played) < 1.5, "synth-voice: a note makes sound at a sane level", `peak ${peak(played).toFixed(3)}`);
    // the pitch: zero crossings of the low-passed signal give about 220 Hz (A3) for a 7-voice supersaw ... count the strongest autocorrelation lag instead
    let best = 0, lag = 0; const seg = played.slice(4800, 4800 + 4800);
    for (let l = 60; l < 600; l++) { let acc = 0; for (let i = 0; i + l < seg.length; i++) acc += seg[i] * seg[i + l]; if (acc > best) { best = acc; lag = l; } }
    check(Math.abs(48000 / lag - 220) < 12, "synth-voice: plays the note it was given (A3 = 220 Hz)", `${(48000 / lag).toFixed(1)} Hz`);
    const released = render(700, [{ type: 1, offset: 0, note: 57, pitch: -0.25, value: 0 }]);
    check(peak(released.slice(-1000)) < 1e-3, "synth-voice: a note off releases to silence", peak(released.slice(-1000)).toExponential(2));
  }
}

// ---- the subset checker resolves this.items[i].method() by the element type of the field --------------------------------------------------
{
  const body = (field) => `
class Cheap { v: f32 = 0; tick(x: f32): f32 { this.v += x; return this.v; } }
class Costly { v: f32 = 0; tick(x: f32): f32 { for (let i = 0; i < 1000; i++) this.v += x * <f32>i; return this.v; } }
@module({ name: "Arr", category: "Utility/Test" })
export class Arr {
  @input x: f32 = 0;
  @output out: f32 = 0;
  private items: ${field};
  private other: Costly = new Costly();
  constructor(sampleRate: f64) { this.items = new ${field}(4); for (let i = 0; i < 4; i++) this.items[i] = new Cheap(); }
  sample(): void { let s: f32 = 0; for (let i = 0; i < 4; i++) s += this.items[i].tick(this.x); this.out = s + this.other.tick(0.0); }
}`;
  const typed = await run(body("StaticArray<Cheap>"), { chunks: 2, inputs: [0.1] });
  const costly = await run(body("StaticArray<Cheap>").replace("this.other.tick(0.0)", "0.0"), { chunks: 2, inputs: [0.1] });
  check(typed.errors.length === 0 && costly.cost && costly.cost.sample < 120, "checker: this.items[i].tick() is costed as the element type's method, not the dearest tick in the file", costly.cost ? JSON.stringify(costly.cost) : typed.errors.map((e) => e.message).join(";"));
}
finish();
