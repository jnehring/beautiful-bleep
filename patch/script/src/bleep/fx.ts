// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// bleep/fx — larger effect blocks built from the smaller ones: Reverb (Freeverb), Phaser, Chorus, PitchShift.
// They allocate their buffers in the constructor (a reverb takes about 1 MB at 48 kHz) and nothing after.
// set* methods may call trig and exp: call them in block() when a setting changed. next() is per sample.

import { DelayLine } from "./delay";
import { fastSin } from "./osc";

const PI: f64 = Math.PI;

// ---- Reverb ---------------------------------------------------------------------------------------------------------------------------------
// Jezar's Freeverb: eight damped feedback combs in parallel, then four all-passes in series, for each of the two channels (the right one slightly longer).

class DampedComb {
  private buf: StaticArray<f32>;
  private size: i32;
  private pos: i32 = 0;
  private store: f32 = 0;
  constructor(size: i32) { this.size = size; this.buf = new StaticArray<f32>(size); }
  reset(): void { for (let i = 0; i < this.size; i++) this.buf[i] = 0.0; this.store = 0.0; }
  next(x: f32, feedback: f32, damp: f32): f32 {
    const out = this.buf[this.pos];
    this.store = out * (1.0 - damp) + this.store * damp;
    this.buf[this.pos] = x + this.store * feedback;
    this.pos++; if (this.pos >= this.size) this.pos = 0;
    return out;
  }
}

class SchroederAllpass {
  private buf: StaticArray<f32>;
  private size: i32;
  private pos: i32 = 0;
  constructor(size: i32) { this.size = size; this.buf = new StaticArray<f32>(size); }
  reset(): void { for (let i = 0; i < this.size; i++) this.buf[i] = 0.0; }
  next(x: f32): f32 {
    const b = this.buf[this.pos];
    const out = b - x;
    this.buf[this.pos] = x + b * 0.5;
    this.pos++; if (this.pos >= this.size) this.pos = 0;
    return out;
  }
}

/// A Freeverb reverb: a mono input, a stereo wet output (`left`, `right` after `next(x)`). `roomSize` 0 to 1 (the tail: about 0.5 s to 10 s and beyond at 1),
/// `damping` 0 to 1 (how fast the highs die in the tail), `width` 0 to 1 (0 = both channels the same). The output is the reverb only: mix it with the dry
/// signal yourself. Call `update()` in block() after changing roomSize or damping.
export class Reverb {
  roomSize: f32 = 0.7;
  damping: f32 = 0.5;
  width: f32 = 1.0;
  left: f32 = 0;
  right: f32 = 0;
  private feedback: f32 = 0.84;
  private damp: f32 = 0.2;
  private combsL: StaticArray<DampedComb>;
  private combsR: StaticArray<DampedComb>;
  private allL: StaticArray<SchroederAllpass>;
  private allR: StaticArray<SchroederAllpass>;
  constructor(sampleRate: f64) {
    const k = sampleRate / 44100.0;
    const combTunings: StaticArray<i32> = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
    const allTunings: StaticArray<i32> = [556, 441, 341, 225];
    const spread = <i32>(23.0 * k);
    this.combsL = new StaticArray<DampedComb>(8);
    this.combsR = new StaticArray<DampedComb>(8);
    this.allL = new StaticArray<SchroederAllpass>(4);
    this.allR = new StaticArray<SchroederAllpass>(4);
    for (let i = 0; i < 8; i++) {
      this.combsL[i] = new DampedComb(<i32>(<f64>combTunings[i] * k));
      this.combsR[i] = new DampedComb(<i32>(<f64>combTunings[i] * k) + spread);
    }
    for (let i = 0; i < 4; i++) {
      this.allL[i] = new SchroederAllpass(<i32>(<f64>allTunings[i] * k));
      this.allR[i] = new SchroederAllpass(<i32>(<f64>allTunings[i] * k) + spread);
    }
    this.update();
  }
  reset(): void {
    for (let i = 0; i < 8; i++) { this.combsL[i].reset(); this.combsR[i].reset(); }
    for (let i = 0; i < 4; i++) { this.allL[i].reset(); this.allR[i].reset(); }
  }
  update(): void {
    this.feedback = min(max(this.roomSize, 0.0), 1.0) * 0.28 + 0.7;
    this.damp = min(max(this.damping, 0.0), 1.0) * 0.4;
  }
  next(x: f32): void {
    const input = x * 0.015;
    let l: f32 = 0.0, r: f32 = 0.0;
    for (let i = 0; i < 8; i++) {
      l += this.combsL[i].next(input, this.feedback, this.damp);
      r += this.combsR[i].next(input, this.feedback, this.damp);
    }
    for (let i = 0; i < 4; i++) { l = this.allL[i].next(l); r = this.allR[i].next(r); }
    const w: f32 = this.width * 0.5, a: f32 = 0.5 + w, b: f32 = 0.5 - w;
    this.left = (l * a + r * b) * 3.0;
    this.right = (r * a + l * b) * 3.0;
  }
}

// ---- Phaser -----------------------------------------------------------------------------------------------------------------------------------

/// A phaser: `stages` first-order all-passes (an even number from 2 to 12) whose corner sweeps between `minHz` and `maxHz` at `rate` Hz, mixed with the dry signal
/// so that notches travel through the spectrum (stages / 2 notches). `feedback` (-0.95 to 0.95) deepens and sharpens them. `mix` 0 dry, 1 half dry half phased.
/// The sweep is updated every 8 samples. Set `rate` to 0 and `centre` to hold it still (`centre` 0 to 1 places the sweep, with the LFO off).
export class Phaser {
  rate: f32 = 0.4;
  minHz: f32 = 300.0;
  maxHz: f32 = 3000.0;
  feedback: f32 = 0.4;
  mix: f32 = 1.0;
  centre: f32 = 0.5;
  private stages: i32;
  private z: StaticArray<f32>;
  private a: f32 = 0;
  private fb: f32 = 0;
  private phase: f64 = 0;
  private counter: i32 = 0;
  private sampleRate: f64;
  constructor(sampleRate: f64, stages: i32 = 4) {
    this.stages = min(max(stages, 2), 12);
    this.z = new StaticArray<f32>(12);
    this.sampleRate = sampleRate;
    this.sweep(0.5);
  }
  reset(): void { for (let i = 0; i < 12; i++) this.z[i] = 0.0; this.fb = 0.0; }
  private sweep(position: f64): void {
    const lo = <f64>this.minHz, hi = <f64>this.maxHz;
    const f = lo * Math.pow(hi / lo, position);
    const t = Math.tan(PI * min(f, this.sampleRate * 0.45) / this.sampleRate);
    this.a = <f32>((t - 1.0) / (t + 1.0));
  }
  next(x: f32): f32 {
    if ((this.counter & 7) == 0) {
      let pos: f64 = <f64>this.centre;
      if (this.rate > 0.0) {
        this.phase += <f64>this.rate * 8.0 / this.sampleRate;
        this.phase -= floor(this.phase);
        pos = 0.5 + 0.5 * <f64>fastSin(this.phase);
      }
      this.sweep(pos);
    }
    this.counter++;
    let y = x + this.fb * this.feedback;
    const a = this.a;
    for (let i = 0; i < this.stages; i++) {
      const out = a * y + this.z[i];
      this.z[i] = y - a * out;
      y = out;
    }
    this.fb = y;
    return x * (1.0 - 0.5 * this.mix) + y * 0.5 * this.mix;
  }
}

// ---- Chorus -----------------------------------------------------------------------------------------------------------------------------------

/// A chorus: `voices` (1 to 4) copies of the input, each delayed by `delayMs` plus a slow sine sweep of +-`depthMs`, the voices a quarter-turn or so apart in
/// phase and spread across left and right. `next(x)` sets `left` and `right` (dry plus chorus: `mix` 0 is dry, 1 is the voices only) and returns their average.
/// Typical: delayMs 15, depthMs 3, rate 0.8 Hz.
export class Chorus {
  rate: f32 = 0.8;
  delayMs: f32 = 15.0;
  depthMs: f32 = 3.0;
  mix: f32 = 0.5;
  left: f32 = 0;
  right: f32 = 0;
  private voices: i32;
  private line: DelayLine;
  private phase: f64 = 0;
  private sampleRate: f64;
  constructor(sampleRate: f64, voices: i32 = 2) {
    this.voices = min(max(voices, 1), 4);
    this.line = new DelayLine(<i32>(sampleRate * 0.06) + 4);
    this.sampleRate = sampleRate;
  }
  reset(): void { this.line.reset(); }
  next(x: f32): f32 {
    this.line.write(x);
    this.phase += <f64>this.rate / this.sampleRate;
    this.phase -= floor(this.phase);
    const base = <f32>(<f64>this.delayMs * 0.001 * this.sampleRate);
    const depth = <f32>(<f64>this.depthMs * 0.001 * this.sampleRate);
    let l: f32 = 0.0, r: f32 = 0.0;
    const n = this.voices;
    for (let v = 0; v < n; v++) {
      const lfo = fastSin(this.phase + <f64>v / <f64>n);
      const wet = this.line.readCubic(base + depth * lfo);
      const pan = n > 1 ? <f32>v / <f32>(n - 1) : 0.5;
      l += wet * (1.0 - pan); r += wet * pan;
    }
    const norm: f32 = 2.0 / <f32>n;
    const dry: f32 = 1.0 - this.mix;
    this.left = x * dry + l * norm * this.mix;
    this.right = x * dry + r * norm * this.mix;
    return (this.left + this.right) * 0.5;
  }
}

// ---- PitchShift -------------------------------------------------------------------------------------------------------------------------------

/// A pitch shifter: two read heads sweep a delay line at a different speed than it is written, cross-faded by a raised-cosine window so each is silent at
/// the point it jumps back. `ratio` is the frequency ratio (2 = an octave up; use semitones() from bleep/util). It works well on single notes and gives a
/// mild, grainy flutter on chords and percussion; `windowSeconds` (default 0.06) trades flutter against smearing. Latency is up to a window.
export class PitchShift {
  ratio: f32 = 1.0;
  private line: DelayLine;
  private window: f32;
  private phase: f32 = 0;
  constructor(sampleRate: f64, windowSeconds: f64 = 0.06) {
    const window = <f32>(windowSeconds * sampleRate);
    this.window = window;
    this.line = new DelayLine(<i32>window + 4);
  }
  reset(): void { this.line.reset(); this.phase = 0.0; }
  next(x: f32): f32 {
    this.line.write(x);
    // each head's delay runs 0..window; it moves by (1 - ratio) per sample, so reading it speeds up by `ratio`
    this.phase += (1.0 - this.ratio) / this.window;
    this.phase -= <f32>floor(<f64>this.phase);
    const p2 = this.phase < 0.5 ? this.phase + 0.5 : this.phase - 0.5;
    const w1: f32 = 0.5 - 0.5 * fastSin(<f64>this.phase + 0.25);          // raised cosine: 0 at the wrap, 1 half a window later
    const w2: f32 = 0.5 - 0.5 * fastSin(<f64>p2 + 0.25);
    const d1: f32 = this.phase * this.window + 1.0, d2: f32 = p2 * this.window + 1.0;
    return this.line.readCubic(d1) * w1 + this.line.readCubic(d2) * w2;
  }
}
