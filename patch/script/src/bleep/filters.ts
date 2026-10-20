// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// bleep/filters — filters beyond Biquad (which is in bleep/dsp): one-pole, state-variable, Moog ladder, resonz, formants, all-passes, combs.
// Every set* method takes trig/exp calls: call it in block() and only when a setting changed, not in sample(). next() is per sample.
// Frequencies are in Hz and are clamped below Nyquist, so a modulated cutoff cannot blow a filter up.

import { fastTanh } from "./util";

const PI: f64 = Math.PI;

function limitFrequency(sampleRate: f64, frequency: f64): f64 {
  return min(max(frequency, 1.0), sampleRate * 0.4999);
}

/// A one-pole filter, 6 dB per octave: low-pass or high-pass, exactly -3 dB at the cutoff (trapezoidal integration).
export class OnePole {
  private g: f64 = 0.1;
  private z: f64 = 0;
  private high: bool = false;
  reset(): void { this.z = 0; }
  /// A low-pass with its -3 dB point at `frequency`.
  setLowpass(sampleRate: f64, frequency: f64): void {
    const t = Math.tan(PI * limitFrequency(sampleRate, frequency) / sampleRate);
    this.g = t / (1.0 + t);
    this.high = false;
  }
  /// A high-pass with its -3 dB point at `frequency`.
  setHighpass(sampleRate: f64, frequency: f64): void {
    this.setLowpass(sampleRate, frequency);
    this.high = true;
  }
  next(x: f32): f32 {
    const v = (<f64>x - this.z) * this.g;
    const lp = v + this.z;
    this.z = lp + v;
    return this.high ? <f32>(<f64>x - lp) : <f32>lp;
  }
}

/// A state-variable filter (Cytomic / Simper, trapezoidal integration): stable and well-behaved when the cutoff is modulated fast.
/// Call tick(x) per sample, then read the output you want: low, high, band (the raw band-pass, peak gain q), bandUnity (peak gain 1),
/// notch, peak, all (all-pass).
export class Svf {
  low: f32 = 0; high: f32 = 0; band: f32 = 0; bandUnity: f32 = 0; notch: f32 = 0; peak: f32 = 0; all: f32 = 0;
  private a1: f64 = 0; private a2: f64 = 0; private a3: f64 = 0; private k: f64 = 1;
  private ic1: f64 = 0; private ic2: f64 = 0;
  constructor() { this.set(48000.0, 1000.0, 0.7071); }
  reset(): void { this.ic1 = 0; this.ic2 = 0; this.low = 0; this.high = 0; this.band = 0; this.bandUnity = 0; this.notch = 0; this.peak = 0; this.all = 0; }
  /// Cutoff `frequency` in Hz, `q` from 0.5 (no resonance) up; 0.7071 is Butterworth, high values ring.
  set(sampleRate: f64, frequency: f64, q: f64): void {
    const g = Math.tan(PI * limitFrequency(sampleRate, frequency) / sampleRate);
    this.k = 1.0 / max(q, 0.01);
    this.a1 = 1.0 / (1.0 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  tick(x: f32): void {
    const v0 = <f64>x;
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2.0 * v1 - this.ic1;
    this.ic2 = 2.0 * v2 - this.ic2;
    const hp = v0 - this.k * v1 - v2;
    this.low = <f32>v2; this.band = <f32>v1; this.high = <f32>hp;
    this.bandUnity = <f32>(this.k * v1);
    this.notch = <f32>(v2 + hp);
    this.peak = <f32>(v2 - hp);
    this.all = <f32>(v0 - 2.0 * this.k * v1);
  }
}

/// A Moog-style 24 dB per octave ladder low-pass with tanh saturation in every stage (Huovilainen's model). `resonance` runs from 0
/// to 1 (self-oscillation at about 1; the tanh keeps it bounded). `drive` multiplies the input: loud, driven signals are distorted by the
/// stages (the gain for small signals stays 1). Like the real ladder, the passband level drops as the resonance goes up.
export class LadderFilter {
  private g: f64 = 0.1;
  private resonance: f64 = 0;
  private drive: f64 = 1;
  private s0: f64 = 0; private s1: f64 = 0; private s2: f64 = 0; private s3: f64 = 0;
  private t0: f64 = 0; private t1: f64 = 0; private t2: f64 = 0;
  reset(): void { this.s0 = 0; this.s1 = 0; this.s2 = 0; this.s3 = 0; this.t0 = 0; this.t1 = 0; this.t2 = 0; }
  set(sampleRate: f64, frequency: f64, resonance: f64, drive: f64 = 1.0): void {
    // half the step per substep: the filter runs twice per sample, which keeps the cutoff accurate and the feedback stable
    this.g = 1.0 - Math.exp(-PI * limitFrequency(sampleRate, frequency) / sampleRate);
    this.resonance = min(max(resonance, 0.0), 1.2) * 4.3;
    this.drive = drive;
  }
  next(x: f32): f32 {
    const input = <f64>x * this.drive;
    for (let i = 0; i < 2; i++) {
      const u = <f32>(input - this.resonance * this.s3);
      const tu = <f64>fastTanh(u);
      this.s0 += this.g * (tu - this.t0);
      this.t0 = <f64>fastTanh(<f32>this.s0);
      this.s1 += this.g * (this.t0 - this.t1);
      this.t1 = <f64>fastTanh(<f32>this.s1);
      this.s2 += this.g * (this.t1 - this.t2);
      this.t2 = <f64>fastTanh(<f32>this.s2);
      this.s3 += this.g * (this.t2 - <f64>fastTanh(<f32>this.s3));
    }
    return <f32>this.s3;
  }
}

/// SuperCollider's Resonz: a two-pole resonator with peak gain 1 at `frequency` and `bandwidth` Hz between the -3 dB points.
export class Resonz {
  private a0: f64 = 0; private b1: f64 = 0; private b2: f64 = 0;
  private y1: f64 = 0; private y2: f64 = 0;
  reset(): void { this.y1 = 0; this.y2 = 0; }
  set(sampleRate: f64, frequency: f64, bandwidth: f64): void {
    const w = 2.0 * PI * limitFrequency(sampleRate, frequency) / sampleRate;
    const bw = 2.0 * PI * min(max(bandwidth, 1.0), sampleRate * 0.45) / sampleRate;
    const c = 1.0 / Math.tan(bw * 0.5);
    this.a0 = 1.0 / (1.0 + c);
    this.b1 = this.a0 * 2.0 * c * Math.cos(w);
    this.b2 = this.a0 * (1.0 - c);
  }
  next(x: f32): f32 {
    const y0 = <f64>x + this.b1 * this.y1 + this.b2 * this.y2;
    const out = this.a0 * (y0 - this.y2);
    this.y2 = this.y1; this.y1 = y0;
    return <f32>out;
  }
}

/// A formant filter: three parallel resonators tuned to the first three formants of a vowel, for talking pads and vocal-ish sounds.
/// `setVowel(position)` morphs through a e i o u (0 to 4, fractions blend); `shift` scales all three formants (1.0 = a male voice,
/// about 1.15 female, 0.8 a giant). Feed it a buzzy source (a saw, a pulse, noise).
export class Formant {
  private r0: Resonz = new Resonz();
  private r1: Resonz = new Resonz();
  private r2: Resonz = new Resonz();
  private gain1: f32 = 0.5; private gain2: f32 = 0.25;
  private static f1: StaticArray<f32> = [800, 400, 350, 450, 325];
  private static f2: StaticArray<f32> = [1150, 1600, 1700, 800, 700];
  private static f3: StaticArray<f32> = [2900, 2700, 2700, 2830, 2530];
  reset(): void { this.r0.reset(); this.r1.reset(); this.r2.reset(); }
  setVowel(sampleRate: f64, position: f64, shift: f64 = 1.0): void {
    const p = min(max(position, 0.0), 3.9999);
    const i = <i32>p, t = <f32>(p - <f64>i);
    const s = <f32>shift;
    const a = Formant.f1[i], b = Formant.f1[i + 1];
    const f1 = (a + (b - a) * t) * s;
    const c = Formant.f2[i], d = Formant.f2[i + 1];
    const f2 = (c + (d - c) * t) * s;
    const e = Formant.f3[i], f = Formant.f3[i + 1];
    const f3 = (e + (f - e) * t) * s;
    this.r0.set(sampleRate, f1, 80.0);
    this.r1.set(sampleRate, f2, 90.0);
    this.r2.set(sampleRate, f3, 120.0);
  }
  next(x: f32): f32 { return this.r0.next(x) + this.r1.next(x) * this.gain1 + this.r2.next(x) * this.gain2; }
}

/// A first-order all-pass: gain 1 everywhere, the phase turns a quarter cycle at `frequency`. Chain a few for a phaser.
export class Allpass1 {
  private a: f64 = 0;
  private z: f64 = 0;
  reset(): void { this.z = 0; }
  set(sampleRate: f64, frequency: f64): void {
    const t = Math.tan(PI * limitFrequency(sampleRate, frequency) / sampleRate);
    this.a = (t - 1.0) / (t + 1.0);
  }
  next(x: f32): f32 {
    const y = this.a * <f64>x + this.z;
    this.z = <f64>x - this.a * y;
    return <f32>y;
  }
}

/// A second-order all-pass: gain 1 everywhere, the phase turns half a cycle around `frequency`; `q` sets how sharply.
export class Allpass2 {
  private a1: f64 = 0; private a2: f64 = 0;
  private x1: f64 = 0; private x2: f64 = 0; private y1: f64 = 0; private y2: f64 = 0;
  reset(): void { this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  set(sampleRate: f64, frequency: f64, q: f64): void {
    const w = 2.0 * PI * limitFrequency(sampleRate, frequency) / sampleRate;
    const alpha = Math.sin(w) / (2.0 * max(q, 0.01)), a0 = 1.0 + alpha;
    this.a1 = -2.0 * Math.cos(w) / a0;
    this.a2 = (1.0 - alpha) / a0;
  }
  next(x: f32): f32 {
    // y[n] = a2 x[n] + a1 x[n-1] + x[n-2] - a1 y[n-1] - a2 y[n-2]
    const xi = <f64>x;
    const y = this.a2 * xi + this.a1 * this.x1 + this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = xi; this.y2 = this.y1; this.y1 = y;
    return <f32>y;
  }
}

/// A comb filter: y[n] = x[n] + feedforward * x[n - D] + feedback * y[n - D]. With feedback 0 it is the FIR comb (notches, flanger); with
/// feedforward 0 it is the IIR comb (rings at multiples of sampleRate / D; Karplus-Strong without the damping; reverb building block).
/// The delay `D` is in samples and may be fractional (linear interpolation); `maxDelay` is the longest D you will set.
export class CombFilter {
  feedforward: f32 = 0;
  feedback: f32 = 0;
  private xs: StaticArray<f32>;
  private ys: StaticArray<f32>;
  private size: i32;
  private pos: i32 = 0;
  private delay: f32 = 1;
  constructor(maxDelay: i32) {
    const size = maxDelay + 2;
    this.size = size;
    this.xs = new StaticArray<f32>(size);
    this.ys = new StaticArray<f32>(size);
  }
  reset(): void {
    for (let i = 0; i < this.size; i++) { this.xs[i] = 0.0; this.ys[i] = 0.0; }
  }
  /// The delay in samples, from 1 to maxDelay.
  setDelay(samples: f32): void { this.delay = min(max(samples, 1.0), <f32>(this.size - 2)); }
  next(x: f32): f32 {
    const d = this.delay;
    const whole = <i32>d, frac = d - <f32>whole;
    let i0 = this.pos - whole; if (i0 < 0) i0 += this.size;
    let i1 = i0 - 1; if (i1 < 0) i1 += this.size;
    const dx = this.xs[i0] + (this.xs[i1] - this.xs[i0]) * frac;
    const dy = this.ys[i0] + (this.ys[i1] - this.ys[i0]) * frac;
    const y = x + this.feedforward * dx + this.feedback * dy;
    this.xs[this.pos] = x;
    this.ys[this.pos] = y;
    this.pos++; if (this.pos >= this.size) this.pos = 0;
    return y;
  }
}
