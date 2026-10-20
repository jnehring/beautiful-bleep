// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// bleep/dynamics — dynamics and distortion: Compressor, Limiter (look-ahead), Gate, wave shapers (softClip, hardClip, foldback, asymSat, chebyshev),
// Bitcrush, Decimate, and the Oversampler2x / Oversampler4x that keep a shaper from aliasing.
// Levels in decibels are plain numbers (dB); audio is f32 and 1.0 is full scale. Allocate in constructors only.

import { fastTanh, fastExp2, fastLog2 } from "./util";

const DB_PER_LOG2: f32 = 6.0205999;          // 20 log10(2)
const LOG2_PER_DB: f32 = 0.16609640;         // 1 / DB_PER_LOG2

/// A level in dB (-120 for silence).
function levelDb(x: f32): f32 {
  const a = abs(x);
  return a < 1.0e-6 ? -120.0 : fastLog2(a) * DB_PER_LOG2;
}

function timeCoefficient(sampleRate: f64, seconds: f64): f32 {
  return seconds <= 0.0 ? 0.0 : <f32>Math.exp(-1.0 / (sampleRate * seconds));
}

/// A feed-forward compressor with a soft knee. Above `thresholdDb` the level rises 1 dB for every `ratio` dB of input (ratio 1 does nothing,
/// 100 is a limiter); the knee rounds the corner over `kneeDb` around the threshold. The gain change is smoothed by `setTimes(attack, release)`
/// (seconds to take about 63 % of a step), and `makeupDb` adds gain after. `next(x)` detects on the signal itself; `nextKeyed(x, key)` detects on
/// another signal (ducking, de-essing). `gainReductionDb` (0 or below) is for a meter.
export class Compressor {
  thresholdDb: f32 = -18.0;
  ratio: f32 = 4.0;
  kneeDb: f32 = 6.0;
  makeupDb: f32 = 0.0;
  gainReductionDb: f32 = 0.0;
  private sampleRate: f64;
  private attack: f32 = 0;
  private release: f32 = 0;
  private reduction: f32 = 0;
  constructor(sampleRate: f64, attackSeconds: f64 = 0.01, releaseSeconds: f64 = 0.15) {
    this.sampleRate = sampleRate;
    this.setTimes(attackSeconds, releaseSeconds);
  }
  reset(): void { this.reduction = 0.0; this.gainReductionDb = 0.0; }
  setTimes(attackSeconds: f64, releaseSeconds: f64): void {
    this.attack = timeCoefficient(this.sampleRate, attackSeconds);
    this.release = timeCoefficient(this.sampleRate, releaseSeconds);
  }
  /// The gain change in dB (0 or negative) the static curve asks for at input level `levelDb`.
  curve(level: f32): f32 {
    const over = level - this.thresholdDb;
    const w = this.kneeDb;
    const slope: f32 = 1.0 / max(this.ratio, 1.0) - 1.0;
    if (2.0 * over < -w) return 0.0;
    if (2.0 * abs(over) <= w) {
      const t: f32 = over + w * 0.5;
      return slope * t * t / (2.0 * w);
    }
    return slope * over;
  }
  next(x: f32): f32 { return this.nextKeyed(x, x); }
  nextKeyed(x: f32, key: f32): f32 {
    const wanted = this.curve(levelDb(key));
    // more reduction (a more negative number) is the attack, less is the release
    const c = wanted < this.reduction ? this.attack : this.release;
    this.reduction = wanted + (this.reduction - wanted) * c;
    this.gainReductionDb = this.reduction;
    return x * fastExp2((this.reduction + this.makeupDb) * LOG2_PER_DB);
  }
}

/// A look-ahead brick-wall limiter: no sample leaves above `ceiling` (linear, 1.0 is full scale). It sees `lookahead` seconds ahead, so the gain eases
/// down before a peak instead of clipping it, and the output is that much late (`latency` samples: report it, or delay the dry path to match).
/// `release` is how fast the gain comes back (seconds, about 63 %). Longer look-ahead is smoother and slower to react.
export class Limiter {
  ceiling: f32 = 1.0;
  gainReductionDb: f32 = 0.0;
  readonly latency: i32;
  private length: i32;
  private audio: StaticArray<f32>;
  private required: StaticArray<f32>;
  private minimum: StaticArray<f32>;
  private pos: i32 = 0;
  private sum: f64 = 0;
  private gain: f32 = 1;
  private releaseCoef: f32;
  constructor(sampleRate: f64, lookaheadSeconds: f64 = 0.002, releaseSeconds: f64 = 0.08) {
    const n = <i32>min(max(lookaheadSeconds * sampleRate, 2.0), 512.0);
    this.length = n;
    this.latency = n - 1;
    this.audio = new StaticArray<f32>(n);
    this.required = new StaticArray<f32>(n);
    this.minimum = new StaticArray<f32>(n);
    this.releaseCoef = timeCoefficient(sampleRate, releaseSeconds);
    this.reset();
  }
  reset(): void {
    for (let i = 0; i < this.length; i++) { this.audio[i] = 0.0; this.required[i] = 1.0; this.minimum[i] = 1.0; }
    this.sum = <f64>this.length;
    this.gain = 1.0;
    this.gainReductionDb = 0.0;
  }
  next(x: f32): f32 {
    const n = this.length;
    const p = this.pos;
    // the gain this sample needs, and the smallest need in the last n samples
    const a = abs(x);
    this.required[p] = a > this.ceiling ? this.ceiling / a : 1.0;
    let low: f32 = 1.0;
    for (let i = 0; i < n; i++) low = min(low, this.required[i]);
    // a moving average of that minimum: it slopes down over the look-ahead and is never above what any sample in the window needs
    this.sum += <f64>low - <f64>this.minimum[p];
    this.minimum[p] = low;
    const target = <f32>(this.sum / <f64>n);
    this.gain = target < this.gain ? target : target + (this.gain - target) * this.releaseCoef;
    // the audio that left the window n - 1 samples ago
    const q = (p + 1) % n;
    const out = this.audio[q] * this.gain;
    this.audio[p] = x;
    this.pos = q;
    this.gainReductionDb = levelDb(this.gain);
    return out;
  }
}

/// A noise gate with hysteresis: it opens when the level rises above `openDb`, stays open until the level has been below `closeDb` (lower, so a signal
/// hovering around the threshold does not chatter) for `holdSeconds`, then closes to `rangeDb` (-80 = silence, -12 = a gentle expander) over `release`.
/// `setTimes(attack, release)` in seconds; `next(x)` detects on x, `nextKeyed(x, key)` on another signal.
export class Gate {
  openDb: f32 = -40.0;
  closeDb: f32 = -46.0;
  holdSeconds: f32 = 0.05;
  rangeDb: f32 = -80.0;
  /// 1 while open.
  isOpen: bool = false;
  private sampleRate: f64;
  private attack: f32 = 0; private release: f32 = 0;
  private detector: f32 = 0;
  private detectorRelease: f32;
  private hold: i32 = 0;
  private gain: f32 = 0;
  constructor(sampleRate: f64, attackSeconds: f64 = 0.001, releaseSeconds: f64 = 0.1) {
    this.sampleRate = sampleRate;
    this.detectorRelease = timeCoefficient(sampleRate, 0.005);
    this.setTimes(attackSeconds, releaseSeconds);
  }
  reset(): void { this.isOpen = false; this.detector = 0.0; this.hold = 0; this.gain = 0.0; }
  setTimes(attackSeconds: f64, releaseSeconds: f64): void {
    this.attack = timeCoefficient(this.sampleRate, attackSeconds);
    this.release = timeCoefficient(this.sampleRate, releaseSeconds);
  }
  next(x: f32): f32 { return this.nextKeyed(x, x); }
  nextKeyed(x: f32, key: f32): f32 {
    const a = abs(key);
    this.detector = a > this.detector ? a : a + (this.detector - a) * this.detectorRelease;
    const level = levelDb(this.detector);
    if (level >= this.openDb) { this.isOpen = true; this.hold = <i32>(<f64>this.holdSeconds * this.sampleRate); }
    else if (this.isOpen && level < this.closeDb) {
      if (this.hold > 0) this.hold--; else this.isOpen = false;
    } else if (this.isOpen) this.hold = <i32>(<f64>this.holdSeconds * this.sampleRate);
    const floorGain = fastExp2(this.rangeDb * LOG2_PER_DB);
    const target: f32 = this.isOpen ? 1.0 : floorGain;
    const c = target > this.gain ? this.attack : this.release;
    this.gain = target + (this.gain - target) * c;
    return x * this.gain;
  }
}

// ---- wave shapers -------------------------------------------------------------------------------------------------------------------------
// Memoryless shapers: x in, y out. Hard edges alias; run them inside an Oversampler2x or 4x when the input is loud or bright.

/// Soft saturation: about x for small signals, bending smoothly towards +-1 (a tanh).
export function softClip(x: f32): f32 { return fastTanh(x); }
/// Clips at +-limit with a hard corner.
export function hardClip(x: f32, limit: f32 = 1.0): f32 { return x > limit ? limit : (x < -limit ? -limit : x); }
/// Folds the signal back from +-threshold instead of clipping it (a wavefolder): the output stays inside the threshold and gets brighter the harder it is driven.
export function foldback(x: f32, threshold: f32 = 1.0): f32 {
  const t = threshold;
  if (x <= t && x >= -t) return x;
  const span: f32 = 4.0 * t;
  let u: f32 = (x - t) - span * <f32>floor(<f64>((x - t) / span));   // 0 to 4t
  u = u - 2.0 * t;                                                 // -2t to 2t
  return abs(u) - t;
}
/// Asymmetric saturation: the positive and negative halves are shaped differently, which adds even harmonics (a tube-like warmth). `amount` 0 is a plain
/// soft clip, up to 1. The DC the asymmetry makes is removed and the small-signal gain stays 1.
export function asymSat(x: f32, amount: f32): f32 {
  const b: f32 = clamp01(amount) * 1.2;
  const slope: f32 = 1.0 - fastTanh(b) * fastTanh(b);
  return (fastTanh(x + b) - fastTanh(b)) / slope;
}
/// The Chebyshev polynomial of order `order` (1 is x itself, 2 doubles the frequency, 3 triples it ...): a clean single harmonic from a sine of amplitude
/// 1 or less. Mix a few for a harmonic exciter. Orders above 32 are cut to 32.
export function chebyshev(x: f32, order: i32): f32 {
  const n = min(order, 32);
  if (n <= 0) return 1.0;
  let prev: f32 = 1.0, cur: f32 = x;
  for (let i = 1; i < n; i++) {
    const next: f32 = 2.0 * x * cur - prev;
    prev = cur; cur = next;
  }
  return cur;
}

function clamp01(x: f32): f32 { return x < 0.0 ? 0.0 : (x > 1.0 ? 1.0 : x); }

/// Bit-depth reduction: rounds the signal to `bits` bits (1 to 24; fractions give in-between steps). Lo-fi grit and quantisation noise.
export class Bitcrush {
  private step: f32 = 0;
  private inverse: f32 = 0;
  constructor(bits: f32 = 8.0) { this.setBits(bits); }
  /// Sets the depth (uses a pow call: in block(), not sample()).
  setBits(bits: f32): void {
    const levels = Math.pow(2.0, <f64>min(max(bits, 1.0), 24.0) - 1.0);
    this.step = <f32>(1.0 / levels);
    this.inverse = <f32>levels;
  }
  next(x: f32): f32 { return <f32>nearest(<f64>(x * this.inverse)) * this.step; }
}

/// Sample-rate reduction: holds a sample for 1 / `ratio` samples. ratio 1 passes the signal, 0.25 keeps every 4th sample, 0.1 a tenth of them; fractions
/// work. The imaging (metallic aliasing) is the point.
export class Decimate {
  ratio: f32 = 1.0;
  private phase: f32 = 1.0;
  private held: f32 = 0;
  reset(): void { this.phase = 1.0; this.held = 0.0; }
  next(x: f32): f32 {
    this.phase += this.ratio;
    if (this.phase >= 1.0) { this.phase -= 1.0; this.held = x; }
    return this.held;
  }
}

// ---- oversampling ---------------------------------------------------------------------------------------------------------------------------
// Half-band FIR (Kaiser window, 47 taps: flat to about 0.375 of the sample rate, more than 80 dB down above 0.625 of it).

const HB_M: i32 = 11;                  // 4M + 3 = 47 taps; M + 1 = 12 odd taps on each side of the centre
const HB_TAPS: i32 = HB_M + 1;

function bessel0(x: f64): f64 {
  let sum: f64 = 1.0, term: f64 = 1.0;
  const q = x * x * 0.25;
  for (let k = 1; k < 40; k++) { term *= q / <f64>(k * k); sum += term; }
  return sum;
}

function halfBandCoefficients(into: StaticArray<f32>): void {
  const beta: f64 = 9.0;
  const centre = <f64>(2 * HB_M + 1);
  const norm = bessel0(beta);
  for (let j = 0; j < HB_TAPS; j++) {
    const k = <f64>(2 * j + 1);
    const w = bessel0(beta * Math.sqrt(1.0 - (k / centre) * (k / centre))) / norm;
    // h[k] = sin(pi k / 2) / (pi k), nonzero for odd k
    into[j] = <f32>(Math.sin(Math.PI * 0.5 * k) / (Math.PI * k) * w);
  }
}

/// Doubles the sample rate: `up(x)` takes one sample and sets `a` and `b`, the two samples at twice the rate (a first). Delays by 12 input samples.
export class HalfBandUp {
  a: f32 = 0;
  b: f32 = 0;
  private h: StaticArray<f32>;
  private hist: StaticArray<f32>;
  private pos: i32 = 0;
  constructor() {
    this.h = new StaticArray<f32>(HB_TAPS);
    this.hist = new StaticArray<f32>(2 * HB_TAPS);
    halfBandCoefficients(this.h);
  }
  reset(): void { for (let i = 0; i < 2 * HB_TAPS; i++) this.hist[i] = 0.0; }
  up(x: f32): void {
    const size = 2 * HB_TAPS;
    this.pos++; if (this.pos >= size) this.pos = 0;
    this.hist[this.pos] = x;
    // n0 = the sample HB_TAPS back from the newest: it needs HB_TAPS future samples (j + 1) and HB_TAPS - 1 past ones (j)
    let acc: f32 = 0.0;
    for (let j = 0; j < HB_TAPS; j++) {
      let future = this.pos - (HB_TAPS - 1 - j); if (future < 0) future += size;
      let past = this.pos - (HB_TAPS + j); if (past < 0) past += size;
      acc += this.h[j] * (this.hist[future] + this.hist[past]);
    }
    let centre = this.pos - HB_TAPS; if (centre < 0) centre += size;
    this.a = this.hist[centre];
    this.b = 2.0 * acc;
  }
}

/// Halves the sample rate: `down(a, b)` takes two samples (a first) and returns one, with everything above a quarter of the double rate taken out first.
export class HalfBandDown {
  private h: StaticArray<f32>;
  private hist: StaticArray<f32>;
  private pos: i32 = 0;
  constructor() {
    this.h = new StaticArray<f32>(HB_TAPS);
    this.hist = new StaticArray<f32>(4 * HB_M + 3);
    halfBandCoefficients(this.h);
  }
  reset(): void { for (let i = 0; i < 4 * HB_M + 3; i++) this.hist[i] = 0.0; }
  private push(x: f32): void {
    this.pos++; if (this.pos >= 4 * HB_M + 3) this.pos = 0;
    this.hist[this.pos] = x;
  }
  down(a: f32, b: f32): f32 {
    const size = 4 * HB_M + 3;
    this.push(a);
    this.push(b);
    // m0 = 2M + 1 samples before the newest, so that 2M + 1 future samples exist; the half-band filter is symmetric about it
    let c = this.pos - (2 * HB_M + 1); if (c < 0) c += size;
    let acc: f32 = 0.5 * this.hist[c];
    for (let j = 0; j < HB_TAPS; j++) {
      const k = 2 * j + 1;
      let lo = c - k; if (lo < 0) lo += size;
      let hi = c + k; if (hi >= size) hi -= size;
      acc += this.h[j] * (this.hist[lo] + this.hist[hi]);
    }
    return acc;
  }
}

/// 2x oversampling around a non-linear step. Per sample: `os.up(x)`, then run your shaper on `os.a` and `os.b`, then `y = os.down(shapedA, shapedB)`.
/// The pair costs 47 taps of delay: `latency` input samples (23).
export class Oversampler2x {
  a: f32 = 0;
  b: f32 = 0;
  readonly latency: i32 = 2 * HB_M + 1;
  private upper: HalfBandUp = new HalfBandUp();
  private lower: HalfBandDown = new HalfBandDown();
  reset(): void { this.upper.reset(); this.lower.reset(); }
  up(x: f32): void { this.upper.up(x); this.a = this.upper.a; this.b = this.upper.b; }
  down(a: f32, b: f32): f32 { return this.lower.down(a, b); }
}

/// 4x oversampling: `up(x)` sets `a`, `b`, `c`, `d` (four samples in time order); shape each; `down(a, b, c, d)` returns the filtered sample. Two half-band
/// stages each way (latency 34 input samples, give or take a half).
export class Oversampler4x {
  a: f32 = 0; b: f32 = 0; c: f32 = 0; d: f32 = 0;
  readonly latency: i32 = 3 * HB_M + 1;
  private up1: HalfBandUp = new HalfBandUp();
  private up2: HalfBandUp = new HalfBandUp();
  private down1: HalfBandDown = new HalfBandDown();
  private down2: HalfBandDown = new HalfBandDown();
  reset(): void { this.up1.reset(); this.up2.reset(); this.down1.reset(); this.down2.reset(); }
  up(x: f32): void {
    this.up1.up(x);
    const p = this.up1.a, q = this.up1.b;
    this.up2.up(p); this.a = this.up2.a; this.b = this.up2.b;
    this.up2.up(q); this.c = this.up2.a; this.d = this.up2.b;
  }
  down(a: f32, b: f32, c: f32, d: f32): f32 {
    const p = this.down2.down(a, b);
    const q = this.down2.down(c, d);
    return this.down1.down(p, q);
  }
}
