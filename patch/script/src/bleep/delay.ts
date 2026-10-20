// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// bleep/delay — delay lines and interpolation: DelayLine (linear, cubic and all-pass reads), table interpolators, TapeDelay and a Karplus-Strong string.
// Delays are in samples (fractions allowed) unless a name says seconds. All memory is allocated in the constructors.

import { fastTanh } from "./util";
import { fastSin } from "./osc";

/// Linear interpolation in a table, wrapping around its ends: `pos` is an index (any value, fractions allowed).
export function interpLinear(table: StaticArray<f32>, pos: f64): f32 {
  const n = table.length;
  const fl = floor(pos);
  const f = <f32>(pos - fl);
  let i = <i32>(fl - floor(fl / <f64>n) * <f64>n);
  let j = i + 1; if (j >= n) j -= n;
  const a = table[i];
  return a + (table[j] - a) * f;
}

/// Cubic (Catmull-Rom) interpolation in a table, wrapping around its ends. Smoother than linear; passes through every table value.
export function interpCubic(table: StaticArray<f32>, pos: f64): f32 {
  const n = table.length;
  const fl = floor(pos);
  const t = <f32>(pos - fl);
  let i = <i32>(fl - floor(fl / <f64>n) * <f64>n);
  let h = i - 1; if (h < 0) h += n;
  let j = i + 1; if (j >= n) j -= n;
  let k = j + 1; if (k >= n) k -= n;
  return cubic(table[h], table[i], table[j], table[k], t);
}

/// Third-order Lagrange interpolation in a table, wrapping around its ends: exact for polynomials up to the third degree, flatter in the pass band
/// than Catmull-Rom.
export function interpLagrange(table: StaticArray<f32>, pos: f64): f32 {
  const n = table.length;
  const fl = floor(pos);
  const t = <f32>(pos - fl);
  let i = <i32>(fl - floor(fl / <f64>n) * <f64>n);
  let h = i - 1; if (h < 0) h += n;
  let j = i + 1; if (j >= n) j -= n;
  let k = j + 1; if (k >= n) k -= n;
  return lagrange(table[h], table[i], table[j], table[k], t);
}

function cubic(y0: f32, y1: f32, y2: f32, y3: f32, t: f32): f32 {
  const c1: f32 = 0.5 * (y2 - y0);
  const c2: f32 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
  const c3: f32 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * t + c2) * t + c1) * t + y1;
}

function lagrange(y0: f32, y1: f32, y2: f32, y3: f32, t: f32): f32 {
  const d1 = t - 1.0, d2 = t - 2.0, d0 = t + 1.0;
  return -t * d1 * d2 * (1.0 / 6.0) * y0 + d0 * d1 * d2 * 0.5 * y1 - d0 * t * d2 * 0.5 * y2 + d0 * t * d1 * (1.0 / 6.0) * y3;
}

/// A delay line. `write(x)` puts the next input sample in; the read methods then look back: `read(0)` is the sample just written, `read(1)`
/// the one before, and so on up to `maxSamples`. Write once per sample, then read as often as you need.
///   read(d)        linear interpolation (cheap, dulls the highs a little for fractional d)
///   readCubic(d)   Catmull-Rom (better; d from 1)
///   readAllpass(d) first-order all-pass interpolation: flat response, best for a fixed or slowly changing d (a string, a comb). One tap per line;
///                  d from 1.5, and it clicks on fast modulation.
export class DelayLine {
  readonly maxSamples: i32;
  private buf: StaticArray<f32>;
  private size: i32;
  private pos: i32 = 0;
  private apState: f32 = 0;
  constructor(maxSamples: i32) {
    const size = maxSamples + 4;
    this.maxSamples = maxSamples;
    this.size = size;
    this.buf = new StaticArray<f32>(size);
  }
  reset(): void {
    for (let i = 0; i < this.size; i++) this.buf[i] = 0.0;
    this.apState = 0.0;
  }
  write(x: f32): void {
    this.pos++; if (this.pos >= this.size) this.pos = 0;
    this.buf[this.pos] = x;
  }
  /// The sample `age` steps back (an integer, 0 to maxSamples).
  tap(age: i32): f32 {
    let i = this.pos - age; if (i < 0) i += this.size;
    return this.buf[i];
  }
  read(delay: f32): f32 {
    const d = min(max(delay, 0.0), <f32>this.maxSamples);
    const whole = <i32>d, frac = d - <f32>whole;
    const a = this.tap(whole), b = this.tap(whole + 1);
    return a + (b - a) * frac;
  }
  readCubic(delay: f32): f32 {
    const d = min(max(delay, 1.0), <f32>(this.maxSamples - 1));
    const whole = <i32>d, frac = d - <f32>whole;
    // ages whole-1 (newer) .. whole+2 (older); t runs from the age `whole` towards `whole + 1`
    return cubic(this.tap(whole - 1), this.tap(whole), this.tap(whole + 1), this.tap(whole + 2), frac);
  }
  readAllpass(delay: f32): f32 {
    const d = min(max(delay, 1.5), <f32>(this.maxSamples - 1));
    const whole = <i32>(d - 0.5);
    const frac = d - <f32>whole;               // 0.5 to 1.5
    const a: f32 = (1.0 - frac) / (1.0 + frac);
    const y: f32 = a * (this.tap(whole) - this.apState) + this.tap(whole + 1);
    this.apState = y;
    return y;
  }
}

/// A delay with the character of a tape echo: the delay time glides to its target (so changing it bends the pitch of the repeats, as speeding up
/// or slowing down the tape does; `maxBend` limits the bend: 0.5 is up to an octave down or a fifth up), the repeats get darker (`tone`) and
/// softly saturated (`saturation`), and `wowDepth`/`wowRate` add a slow pitch drift.
/// Set `time` (seconds), `feedback` (0 to about 1.1; the saturation keeps it bounded) in block(); `next(x)` returns the wet signal only.
export class TapeDelay {
  time: f32 = 0.3;
  feedback: f32 = 0.5;
  saturation: f32 = 1.0;
  /// Depth of the wow in seconds of delay (0.0005 is subtle) and its rate in Hz.
  wowDepth: f32 = 0.0;
  wowRate: f32 = 0.5;
  /// The most the delay may change per sample (0.5 = the pitch of the echo bends by at most half).
  maxBend: f32 = 0.5;
  private line: DelayLine;
  private sampleRate: f64;
  private delay: f32;
  private glide: f32;
  private tone: f32 = 0.5;
  private lp: f32 = 0;
  private wowPhase: f64 = 0;
  /// `glideSeconds`: how long the delay time takes to follow `time` (about 63 % of the way).
  constructor(sampleRate: f64, maxSeconds: f64, glideSeconds: f64 = 0.15) {
    this.line = new DelayLine(<i32>(maxSeconds * sampleRate) + 2);
    this.sampleRate = sampleRate;
    this.delay = <f32>(0.3 * sampleRate);
    this.glide = <f32>(1.0 - Math.exp(-1.0 / (sampleRate * glideSeconds)));
  }
  reset(): void { this.line.reset(); this.lp = 0; this.delay = this.time * <f32>this.sampleRate; }
  /// Jumps the delay time to `time` without a glide (use it for the first block).
  snap(): void { this.delay = this.time * <f32>this.sampleRate; }
  /// The repeats are low-passed at `hz` each trip round the loop.
  setTone(hz: f64): void { this.tone = <f32>(1.0 - Math.exp(-2.0 * Math.PI * min(hz, this.sampleRate * 0.45) / this.sampleRate)); }
  next(x: f32): f32 {
    const step = (this.time * <f32>this.sampleRate - this.delay) * this.glide;
    this.delay += min(max(step, -this.maxBend), this.maxBend);
    this.wowPhase += <f64>this.wowRate / this.sampleRate;
    this.wowPhase -= floor(this.wowPhase);
    const d = this.delay + this.wowDepth * <f32>this.sampleRate * fastSin(this.wowPhase);
    const wet = this.line.readCubic(d);
    this.lp += (wet - this.lp) * this.tone;
    const drive = max(this.saturation, 0.01);
    this.line.write(x + fastTanh(this.lp * drive) / drive * this.feedback);
    return wet;
  }
}

/// A plucked string (Karplus-Strong): a burst of noise circulates in a delay line with a low-pass in the loop, so the highs die first, as on
/// a real string. `pluck(frequency)` starts a note; `next()` returns the string. `damping` (0 to 0.5) is how fast the highs die (0 = bright and long,
/// 0.5 = the plain two-point average); `decay` (0.9 to 1) how long the whole note lasts (0.999 rings for seconds).
/// `lowestHz` sets the longest string the instance can play. pluck() fills the line with noise: call it from a note handler, not in sample().
export class KarplusStrong {
  damping: f32 = 0.3;
  decay: f32 = 0.998;
  private line: DelayLine;
  private sampleRate: f64;
  private delay: f32 = 100;
  private last: f32 = 0;
  private rng: u32 = 0x12345678;
  constructor(sampleRate: f64, lowestHz: f64 = 40.0) {
    this.line = new DelayLine(<i32>(sampleRate / lowestHz) + 4);
    this.sampleRate = sampleRate;
  }
  reset(): void { this.line.reset(); this.last = 0; }
  /// Tunes the string without exciting it (to bend a note).
  setFrequency(frequency: f64): void {
    // the loop is: read at age D, filter (a delay of `damping` samples), write; the write-after-read costs one more
    const d = this.sampleRate / max(frequency, 1.0) - 1.0 - <f64>this.damping;
    this.delay = <f32>min(max(d, 1.5), <f64>(this.line.maxSamples - 1));
  }
  /// Plucks the string at `frequency` with the given `amplitude`. `brightness` (0 to 1) low-passes the burst: a soft finger against a hard pick.
  pluck(frequency: f64, amplitude: f32 = 0.8, brightness: f32 = 1.0): void {
    this.setFrequency(frequency);
    let prev: f32 = 0;
    const n = <i32>this.delay + 2;
    for (let i = 0; i < n; i++) {
      this.rng ^= this.rng << 13; this.rng ^= this.rng >> 17; this.rng ^= this.rng << 5;
      const noise = (<f32>(this.rng >> 8) * (1.0 / 8388608.0) - 1.0) * amplitude;
      prev += (noise - prev) * brightness;
      this.line.write(prev);
    }
    this.last = 0;
  }
  next(): f32 {
    const d = this.line.readAllpass(this.delay);
    const s = this.damping;
    const filtered: f32 = (1.0 - s) * d + s * this.last;
    this.last = d;
    this.line.write(filtered * this.decay);
    return d;
  }
}
