// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// bleep/util — small helpers: ranges and mapping, pitch conversion, fast approximations, pan and mid/side, a running RMS.
// Plain AssemblyScript, so it inlines into the modules that use it. Allocate in constructors only. Math takes f64; audio is f32.

// ---- pitch ------------------------------------------------------------------------------------------------------------------------------
/// MIDI note number (fractions allowed) to Hz; note 69 is 440 Hz.
export function midiToHz(note: f64): f64 { return 440.0 * Math.pow(2.0, (note - 69.0) / 12.0); }
/// Hz to a MIDI note number (a fraction between notes). 0 Hz and below give -inf-ish (note -1500): clamp first if that matters.
export function hzToMidi(hz: f64): f64 { return 69.0 + 12.0 * Math.log2(max(hz, 1.0e-9) / 440.0); }
/// Hz to Bleep's pitch in virtual volts (1.0 is one octave, 0 is C4 = 261.6256 Hz).
export function hzToPitch(hz: f64): f64 { return Math.log2(max(hz, 1.0e-9) / 261.6255653005986); }
/// The frequency ratio of `n` semitones (fractions allowed): semitones(12) is 2.
export function semitones(n: f64): f64 { return Math.pow(2.0, n / 12.0); }

// ---- ranges ---------------------------------------------------------------------------------------------------------------------------------
export function clamp(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
/// Wraps `x` into [lo, hi) the way a phase wraps: wrap(1.25, 0, 1) is 0.25, wrap(-0.25, 0, 1) is 0.75.
export function wrap(x: f64, lo: f64, hi: f64): f64 {
  const span = hi - lo;
  return x - span * floor((x - lo) / span);
}
/// Folds `x` back and forth between lo and hi like a mirror (wavefolder): fold(1.25, -1, 1) is 0.75.
export function fold(x: f64, lo: f64, hi: f64): f64 {
  const span = hi - lo;
  const t = wrap(x - lo, 0.0, 2.0 * span);
  return lo + (t > span ? 2.0 * span - t : t);
}
/// a at t = 0, b at t = 1.
export function mix(a: f32, b: f32, t: f32): f32 { return a + (b - a) * t; }
/// Maps x from [inLo, inHi] to [outLo, outHi] linearly (not clamped).
export function mapRange(x: f64, inLo: f64, inHi: f64, outLo: f64, outHi: f64): f64 { return outLo + (x - inLo) * (outHi - outLo) / (inHi - inLo); }
/// Maps a 0 to 1 value exponentially onto [lo, hi] (both above 0): expMap(0.5, 20, 20000) is about 632 Hz.
export function expMap(x: f64, lo: f64, hi: f64): f64 { return lo * Math.pow(hi / lo, x); }

// ---- fast approximations ------------------------------------------------------------------------------------------------------------
/// tanh from a [7/6] Padé fraction: error below 1.1e-4, exactly +-1 beyond |x| = 5. No libm.
export function fastTanh(x: f32): f32 {
  if (x > 5.0) return 1.0;
  if (x < -5.0) return -1.0;
  const x2 = x * x;
  return x * (135135.0 + x2 * (17325.0 + x2 * (378.0 + x2))) / (135135.0 + x2 * (62370.0 + x2 * (3150.0 + x2 * 28.0)));
}
/// 2 to the power `x` (relative error below 2e-7), for -126 <= x < 127; beyond that it clamps.
export function fastExp2(x: f32): f32 {
  const xc = clamp(x, -126.0, 126.0);
  const i = <i32>nearest(xc);
  const f = xc - <f32>i;     // -0.5 to 0.5
  const p: f32 = 1.0 + f * (0.6931472 + f * (0.2402265 + f * (0.0555041 + f * (0.0096181 + f * (0.0013333 + f * 0.000154)))));
  return p * reinterpret<f32>((i + 127) << 23);
}
/// log2 of x > 0 (absolute error below 1e-6).
export function fastLog2(x: f32): f32 {
  const bits = reinterpret<i32>(x);
  let e = <f32>(((bits >> 23) & 255) - 127);
  let m = reinterpret<f32>((bits & 0x007FFFFF) | 0x3F800000);   // 1 <= m < 2
  if (m > 1.4142135) { m *= 0.5; e += 1.0; }
  const s = (m - 1.0) / (m + 1.0), s2 = s * s;
  return e + s * 2.8853901 * (1.0 + s2 * (0.33333334 + s2 * (0.2 + s2 * 0.14285715)));
}
/// base to the power `exponent` for base > 0, from fastLog2 and fastExp2 (about 5 digits).
export function fastPow2(base: f32, exponent: f32): f32 { return fastExp2(exponent * fastLog2(base)); }

// ---- pan, crossfade, mid/side ----------------------------------------------------------------------------------------------------------
/// Left and right gains for a pan position. `pan` runs from -1 (left) to 1 (right).
export class Pan {
  left: f32 = 0.70710678;
  right: f32 = 0.70710678;
  /// Equal power: the sum of the squares of the gains is 1, so the loudness stays the same across the arc (-3 dB in the middle).
  equalPower(pan: f32): void {
    const a = <f64>(clamp(pan, -1.0, 1.0) + 1.0) * Math.PI * 0.25;
    this.left = <f32>Math.cos(a); this.right = <f32>Math.sin(a);
  }
  /// Linear: the gains add to 1 (0 dB in the middle for correlated signals, -6 dB for uncorrelated ones).
  linear(pan: f32): void {
    const t = (clamp(pan, -1.0, 1.0) + 1.0) * 0.5;
    this.left = 1.0 - t; this.right = t;
  }
}

/// The gains of a crossfade between two signals: `a` goes out, `b` comes in as `t` runs from 0 to 1.
export class Crossfade {
  a: f32 = 1;
  b: f32 = 0;
  /// Equal power: for signals that are not related (the sum of the squares of the gains is 1).
  equalPower(t: f32): void {
    const x = <f64>clamp(t, 0.0, 1.0) * Math.PI * 0.5;
    this.a = <f32>Math.cos(x); this.b = <f32>Math.sin(x);
  }
  /// Linear: for signals that are the same or nearly (the gains add to 1).
  linear(t: f32): void { const c = clamp(t, 0.0, 1.0); this.a = 1.0 - c; this.b = c; }
}

/// Mid/side encoding and decoding of a stereo pair. `encode` fills `mid` and `side`; `decode` fills `left` and `right`.
export class MidSide {
  mid: f32 = 0; side: f32 = 0; left: f32 = 0; right: f32 = 0;
  encode(l: f32, r: f32): void { this.mid = (l + r) * 0.5; this.side = (l - r) * 0.5; }
  decode(mid: f32, side: f32): void { this.left = mid + side; this.right = mid - side; }
}

// ---- level ------------------------------------------------------------------------------------------------------------------------------------
/// A running RMS level over about `seconds` (a one-pole average of the square, then the root).
export class Rms {
  value: f32 = 0;
  private mean: f64 = 0;
  private coefficient: f64;
  constructor(sampleRate: f64, seconds: f64) { this.coefficient = 1.0 - Math.exp(-1.0 / (sampleRate * seconds)); }
  reset(): void { this.mean = 0; this.value = 0; }
  next(x: f32): f32 {
    const v = <f64>x;
    this.mean += (v * v - this.mean) * this.coefficient;
    this.value = <f32>Math.sqrt(this.mean);
    return this.value;
  }
}
