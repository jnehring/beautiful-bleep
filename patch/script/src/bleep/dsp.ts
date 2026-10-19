// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// bleep/dsp — the start of the Bleep Script standard library (doc/specs/bleep-script.md, section 3.5).
// Plain AssemblyScript, so it inlines into the modules that use it. Allocate in constructors only.

export function dbToLin(db: f64): f32 { return <f32>Math.pow(10.0, db / 20.0); }

/// One-pole smoothing towards `target`. `next()` is called once per sample.
export class Smoother {
  target: f32 = 0;
  value: f32 = 0;
  private coefficient: f32;
  constructor(sampleRate: f64, seconds: f64) {
    this.coefficient = <f32>(1.0 - Math.exp(-1.0 / (sampleRate * seconds)));
  }
  /// Jumps to the target without gliding (after a reset, or the first block).
  snap(): void { this.value = this.target; }
  next(): f32 {
    this.value += (this.target - this.value) * this.coefficient;
    return this.value;
  }
}

/// A peak meter: follows the signal up at once and falls with `seconds` as the time constant.
export class PeakHold {
  value: f32 = 0;
  private decay: f32;
  constructor(sampleRate: f64, seconds: f64) {
    this.decay = <f32>Math.exp(-1.0 / (sampleRate * seconds));
  }
  reset(): void { this.value = 0; }
  next(x: f32): f32 {
    this.value = max(abs(x), this.value * this.decay);
    return this.value;
  }
}

/// A second-order filter section (the RBJ cookbook forms), in transposed direct form II. Set it up with one of the set* methods when
/// the settings change (each takes a few trig calls: do it in block(), not in sample()), then call next() for every sample.
export class Biquad {
  private b0: f64 = 1; private b1: f64 = 0; private b2: f64 = 0;
  private a1: f64 = 0; private a2: f64 = 0;
  private z1: f64 = 0; private z2: f64 = 0;

  reset(): void { this.z1 = 0; this.z2 = 0; }

  private set(b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64): void {
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
  }

  /// A low shelf: `gainDb` below `frequency`.
  setLowShelf(sampleRate: f64, frequency: f64, gainDb: f64): void {
    const A = Math.pow(10.0, gainDb / 40.0);
    const w = 2.0 * Math.PI * frequency / sampleRate, cs = Math.cos(w), alpha = Math.sin(w) / 2.0 * Math.SQRT2, r = 2.0 * Math.sqrt(A) * alpha;
    this.set(A * ((A + 1.0) - (A - 1.0) * cs + r), 2.0 * A * ((A - 1.0) - (A + 1.0) * cs), A * ((A + 1.0) - (A - 1.0) * cs - r),
      (A + 1.0) + (A - 1.0) * cs + r, -2.0 * ((A - 1.0) + (A + 1.0) * cs), (A + 1.0) + (A - 1.0) * cs - r);
  }
  /// A high shelf: `gainDb` above `frequency`.
  setHighShelf(sampleRate: f64, frequency: f64, gainDb: f64): void {
    const A = Math.pow(10.0, gainDb / 40.0);
    const w = 2.0 * Math.PI * frequency / sampleRate, cs = Math.cos(w), alpha = Math.sin(w) / 2.0 * Math.SQRT2, r = 2.0 * Math.sqrt(A) * alpha;
    this.set(A * ((A + 1.0) + (A - 1.0) * cs + r), -2.0 * A * ((A - 1.0) + (A + 1.0) * cs), A * ((A + 1.0) + (A - 1.0) * cs - r),
      (A + 1.0) - (A - 1.0) * cs + r, 2.0 * ((A - 1.0) - (A + 1.0) * cs), (A + 1.0) - (A - 1.0) * cs - r);
  }
  /// A bell: `gainDb` around `frequency`, `q` wide.
  setPeaking(sampleRate: f64, frequency: f64, q: f64, gainDb: f64): void {
    const A = Math.pow(10.0, gainDb / 40.0);
    const w = 2.0 * Math.PI * frequency / sampleRate, cs = Math.cos(w), alpha = Math.sin(w) / (2.0 * q);
    this.set(1.0 + alpha * A, -2.0 * cs, 1.0 - alpha * A, 1.0 + alpha / A, -2.0 * cs, 1.0 - alpha / A);
  }
  /// A low-pass at `frequency`.
  setLowpass(sampleRate: f64, frequency: f64, q: f64): void {
    const w = 2.0 * Math.PI * frequency / sampleRate, cs = Math.cos(w), alpha = Math.sin(w) / (2.0 * q);
    this.set((1.0 - cs) / 2.0, 1.0 - cs, (1.0 - cs) / 2.0, 1.0 + alpha, -2.0 * cs, 1.0 - alpha);
  }

  next(x: f32): f32 {
    const xi = <f64>x;
    const y = this.b0 * xi + this.z1;
    this.z1 = this.b1 * xi - this.a1 * y + this.z2;
    this.z2 = this.b2 * xi - this.a2 * y;
    return <f32>y;
  }
}
