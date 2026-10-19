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
