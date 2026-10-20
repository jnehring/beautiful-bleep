// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// bleep/dsp — the start of the Bleep Script standard library (doc/specs/bleep-script.md, section 3.5).
// Plain AssemblyScript, so it inlines into the modules that use it. Allocate in constructors only.

export function dbToLin(db: f64): f32 { return <f32>Math.pow(10.0, db / 20.0); }
/// A linear gain to decibels (-144 for silence).
export function linToDb(g: f64): f32 { return g <= 0.0000000631 ? <f32>-144.0 : <f32>(20.0 * Math.log10(g)); }
/// `a` at 0, `b` at 1, in between for `t` in between.
export function lerp(a: f32, b: f32, t: f32): f32 { return a + (b - a) * t; }
/// A pitch in volts (1.0 is one octave, 0 is C4) to a frequency in Hz.
export function pitchToHz(volts: f64): f64 { return 261.6255653005986 * Math.pow(2.0, volts); }

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

/// ln(cosh(x)), without overflowing for large x: the antiderivative of tanh.
function lnCosh(x: f64): f64 {
  const a = abs(x);
  return a + Math.log(1.0 + Math.exp(-2.0 * a)) - Math.LN2;
}

/// tanh as a soft clipper that aliases much less than Math.tanh: first-order antiderivative anti-aliasing (ADAA). Instead of tanh at one
/// point it returns the average of tanh between the previous and the current sample, which is what an ideally band-limited
/// waveshaper would be closer to. One call to next() per sample; no oversampling is needed for moderate drive.
export class AdaaTanh {
  private x1: f64 = 0;
  private f1: f64 = 0;
  reset(): void { this.x1 = 0; this.f1 = 0; }
  next(x: f32): f32 {
    const xi = <f64>x;
    const f = lnCosh(xi);
    const dx = xi - this.x1;
    // for two nearly equal samples the difference quotient is 0/0: tanh at the midpoint is the limit
    const y = abs(dx) < 0.00001 ? Math.tanh(0.5 * (xi + this.x1)) : (f - this.f1) / dx;
    this.x1 = xi;
    this.f1 = f;
    return <f32>y;
  }
}

/// Removes a constant offset (a one-pole high-pass at `hz`, 20 Hz is a good value). Put it after anything that can add DC.
export class DcBlocker {
  private x1: f64 = 0;
  private y1: f64 = 0;
  private r: f64;
  constructor(sampleRate: f64, hz: f64) { this.r = 1.0 - 2.0 * Math.PI * hz / sampleRate; }
  reset(): void { this.x1 = 0; this.y1 = 0; }
  next(x: f32): f32 {
    const xi = <f64>x;
    this.y1 = xi - this.x1 + this.r * this.y1;
    this.x1 = xi;
    return <f32>this.y1;
  }
}

/// A phase that runs from 0 up to 1 and wraps: the core of an oscillator or an LFO. Set `frequency` in Hz (in block()), call next() per sample.
export class Phasor {
  phase: f64 = 0;
  frequency: f64 = 0;
  private inverse: f64;
  constructor(sampleRate: f64) { this.inverse = 1.0 / sampleRate; }
  reset(): void { this.phase = 0; }
  /// The phase before this sample's step, from 0 to 1.
  next(): f32 {
    const p = this.phase;
    this.phase += this.frequency * this.inverse;
    this.phase -= Math.floor(this.phase);
    return <f32>p;
  }
}
