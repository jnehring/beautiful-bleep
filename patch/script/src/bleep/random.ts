// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// bleep/random — seeded random numbers and noise. A generator with the same seed gives the same sequence on every run (a patch that
// renders offline sounds like the one that played live). Allocate in constructors only; the generators are plain integer state.

/// Xorshift32: fast, small, good enough for noise and modulation (not for anything secret). A seed of 0 is replaced (it would stick).
export class Xorshift {
  private state: u32;
  constructor(seed: u32 = 2463534242) { this.state = seed == 0 ? 2463534242 : seed; }
  setSeed(seed: u32): void { this.state = seed == 0 ? 2463534242 : seed; }
  /// The next 32 random bits.
  nextU32(): u32 {
    let x = this.state;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    this.state = x;
    return x;
  }
  /// A float in [0, 1).
  next(): f32 { return <f32>(this.nextU32() >> 8) * (1.0 / 16777216.0); }
  /// A float in [-1, 1).
  nextBipolar(): f32 { return <f32>(this.nextU32() >> 8) * (1.0 / 8388608.0) - 1.0; }
}

/// A linear congruential generator (the Numerical Recipes constants): even cheaper and weaker than Xorshift; its low bits are poor, so the
/// floats use the high ones. Handy when you want a different stream from an Xorshift with the same seed.
export class Lcg {
  private state: u32;
  constructor(seed: u32 = 1) { this.state = seed; }
  setSeed(seed: u32): void { this.state = seed; }
  nextU32(): u32 {
    this.state = this.state * 1664525 + 1013904223;
    return this.state;
  }
  next(): f32 { return <f32>(this.nextU32() >> 8) * (1.0 / 16777216.0); }
  nextBipolar(): f32 { return <f32>(this.nextU32() >> 8) * (1.0 / 8388608.0) - 1.0; }
}

/// White noise from a generator: a flat spectrum, uniformly spread over -1 to 1 (rms 0.577).
export function whiteNoise(rng: Xorshift): f32 { return rng.nextBipolar(); }

/// White noise with its own generator, for when you do not want to share one.
export class WhiteNoise {
  private rng: Xorshift;
  constructor(seed: u32 = 1) { this.rng = new Xorshift(seed); }
  next(): f32 { return this.rng.nextBipolar(); }
}

/// Pink noise (-3 dB per octave, equal power in every octave): Paul Kellet's filter bank, within 0.5 dB of 1/f from 10 Hz to Nyquist. About rms 0.2.
export class PinkNoise {
  private rng: Xorshift;
  private b0: f32 = 0; private b1: f32 = 0; private b2: f32 = 0; private b3: f32 = 0; private b4: f32 = 0; private b5: f32 = 0; private b6: f32 = 0;
  constructor(seed: u32 = 1) { this.rng = new Xorshift(seed); }
  next(): f32 {
    const w = this.rng.nextBipolar();
    this.b0 = 0.99886 * this.b0 + w * 0.0555179;
    this.b1 = 0.99332 * this.b1 + w * 0.0750759;
    this.b2 = 0.96900 * this.b2 + w * 0.1538520;
    this.b3 = 0.86650 * this.b3 + w * 0.3104856;
    this.b4 = 0.55000 * this.b4 + w * 0.5329522;
    this.b5 = -0.7616 * this.b5 - w * 0.0168980;
    const pink = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362;
    this.b6 = w * 0.115926;
    return pink * 0.11;
  }
}

/// Brown (red) noise, -6 dB per octave: leaky-integrated white noise, kept within -1 to 1.
export class BrownNoise {
  private rng: Xorshift;
  private last: f32 = 0;
  constructor(seed: u32 = 1) { this.rng = new Xorshift(seed); }
  next(): f32 {
    this.last = (this.last + 0.02 * this.rng.nextBipolar()) / 1.02;
    return this.last * 3.5;
  }
}

/// Sample and hold: `next(x, gate)` takes a new sample of x each time the gate rises through 0.5 and holds it until the next.
export class SampleAndHold {
  value: f32 = 0;
  private wasHigh: bool = false;
  reset(): void { this.value = 0; this.wasHigh = false; }
  next(x: f32, gate: f32): f32 {
    const high = gate >= 0.5;
    if (high && !this.wasHigh) this.value = x;
    this.wasHigh = high;
    return this.value;
  }
}

/// A random low-frequency oscillator: picks a new random value `rate` times a second and moves to it. `smooth` 0 steps (a stepped random), 1
/// glides along a smooth curve (value noise); in between blends. The output runs from -1 to 1; use it to wander a cutoff or a pitch.
export class NoiseLfo {
  smooth: f32 = 1.0;
  private rng: Xorshift;
  private phase: f64 = 0;
  private from: f32 = 0;
  private to: f32 = 0;
  private invSampleRate: f64;
  constructor(sampleRate: f64, seed: u32 = 1) {
    this.rng = new Xorshift(seed);
    this.invSampleRate = 1.0 / sampleRate;
    this.from = this.rng.nextBipolar();
    this.to = this.rng.nextBipolar();
  }
  next(rate: f64): f32 {
    this.phase += rate * this.invSampleRate;
    if (this.phase >= 1.0) {
      this.phase -= floor(this.phase);
      this.from = this.to;
      this.to = this.rng.nextBipolar();
    }
    const t = <f32>this.phase;
    const curve = t * t * (3.0 - 2.0 * t);
    return this.from + (this.to - this.from) * curve * this.smooth;
  }
}
