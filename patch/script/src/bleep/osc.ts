// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// bleep/osc — oscillator shapes for Bleep Script. Phases run 0 to 1 (one cycle) and `dt` is the phase step of one sample (frequency / sampleRate).
// Keep phase accumulators in f64. Everything here is plain AssemblyScript: allocate in constructors only.

const TWO_PI: f64 = 2.0 * Math.PI;

/// The polyBLEP residual of a unit step at phase 0: add it (scaled by the step's height) to a naive waveform to take the aliasing out.
/// `t` is the phase (0 to 1), `dt` the phase step. Non-zero only within one sample of the step.
export function polyBlep(t: f64, dt: f64): f64 {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1.0;
  }
  if (t > 1.0 - dt) {
    const x = (t - 1.0) / dt;
    return x * x + x + x + 1.0;
  }
  return 0.0;
}

/// The polyBLAMP residual of a slope change of 1 per unit phase at phase 0 (scaled by `dt`, so multiply by the slope change only).
/// Add it to a naive waveform with a corner (a triangle) to smooth the corner as a band-limited one.
export function polyBlamp(t: f64, dt: f64): f64 {
  if (t < dt) {
    const x = t / dt - 1.0;
    return -(1.0 / 6.0) * x * x * x * dt;
  }
  if (t > 1.0 - dt) {
    const x = (t - 1.0) / dt + 1.0;
    return (1.0 / 6.0) * x * x * x * dt;
  }
  return 0.0;
}

/// A band-limited sawtooth, rising from -1 to 1 over the cycle.
export function sawBlep(phase: f64, dt: f64): f32 {
  return <f32>(2.0 * phase - 1.0 - polyBlep(phase, dt));
}

/// A band-limited pulse wave: +1 for the first `width` of the cycle (0 to 1, 0.5 is a square), -1 for the rest.
export function squareBlep(phase: f64, dt: f64, width: f64): f32 {
  let v: f64 = phase < width ? 1.0 : -1.0;
  v += polyBlep(phase, dt);
  let t = phase - width + 1.0;
  if (t >= 1.0) t -= 1.0;
  v -= polyBlep(t, dt);
  return <f32>v;
}

/// A band-limited triangle (the naive triangle with polyBLAMP at its two corners; no state, no drift), starting at 0 and rising.
export function triangle(phase: f64, dt: f64): f32 {
  let q = phase + 0.25;
  if (q >= 1.0) q -= 1.0;
  let v = 1.0 - abs(4.0 * q - 2.0);
  v += 8.0 * polyBlamp(q, dt);             // the valley at q = 0
  let r = q + 0.5;
  if (r >= 1.0) r -= 1.0;
  v -= 8.0 * polyBlamp(r, dt);             // the peak at q = 0.5
  return <f32>v;
}

/// A sine from a 9th-order polynomial: error below 4e-6 (-108 dB), no table, no libm. `phase` is in cycles, any value.
export function fastSin(phase: f64): f32 {
  let p = phase - floor(phase);
  if (p > 0.75) p -= 1.0;
  else if (p > 0.25) p = 0.5 - p;
  const x = p * TWO_PI, x2 = x * x;
  return <f32>(x * (1.0 + x2 * (-1.0 / 6.0 + x2 * (1.0 / 120.0 + x2 * (-1.0 / 5040.0 + x2 * (1.0 / 362880.0))))));
}

/// A sine from a lookup table with linear interpolation (4096 points: error below 1e-6 of full scale).
export class SineTable {
  private table: StaticArray<f32>;
  private size: i32;
  constructor(size: i32 = 4096) {
    this.size = size;
    this.table = new StaticArray<f32>(size + 1);
    for (let i = 0; i <= size; i++) this.table[i] = <f32>Math.sin(TWO_PI * <f64>i / <f64>size);
  }
  /// The sine at `phase` (in cycles, any value).
  read(phase: f64): f32 {
    const p = (phase - floor(phase)) * <f64>this.size;
    const i = <i32>p;
    const f = <f32>(p - <f64>i);
    const a = this.table[i];
    return a + (this.table[i + 1] - a) * f;
  }
}

/// A mip-mapped wavetable: one cycle stored at `size` points in `levels` copies, each holding half the harmonics of the one before, so
/// `read(phase, dt)` picks the copy that does not alias at the pitch it is played. Fill it in the constructor or `reset()`, not in `block()`:
/// building takes size x harmonics operations.
export class Wavetable {
  readonly size: i32;
  readonly levels: i32;
  private data: StaticArray<f32>;
  private maxHarmonic: i32;
  constructor(size: i32 = 2048, levels: i32 = 10) {
    this.size = size;
    this.levels = levels;
    this.maxHarmonic = size / 2 - 1;
    this.data = new StaticArray<f32>(levels * (size + 1));
  }

  /// kind: 0 = amps (sine phases), 1 = saw, 2 = square, 3 = triangle
  private build(kind: i32, amps: StaticArray<f32> | null, count: i32): void {
    const n = this.size, stride = n + 1;
    for (let lv = 0; lv < this.levels; lv++) {
      const base = lv * stride;
      for (let i = 0; i < stride; i++) this.data[base + i] = 0.0;
      let limit = this.maxHarmonic >> lv;
      if (limit < 1) limit = 1;
      if (kind == 0 && limit > count) limit = count;
      for (let h = 1; h <= limit; h++) {
        let amp: f64 = 0.0;
        if (kind == 0) amp = <f64>(amps as StaticArray<f32>)[h - 1];
        else if (kind == 1) amp = 1.0 / <f64>h;
        else if (kind == 2) amp = (h & 1) ? 1.0 / <f64>h : 0.0;
        else amp = (h & 1) ? (((h >> 1) & 1) ? -1.0 : 1.0) / <f64>(h * h) : 0.0;
        if (amp == 0.0) continue;
        const step = TWO_PI * <f64>h / <f64>n, c = Math.cos(step), s = Math.sin(step);
        let sn: f64 = 0.0, cs: f64 = 1.0;
        for (let i = 0; i < n; i++) {
          this.data[base + i] += <f32>(amp * sn);
          const t = sn * c + cs * s;
          cs = cs * c - sn * s;
          sn = t;
        }
      }
      this.data[base + n] = this.data[base];
    }
    // one gain for every level, so that the full-bandwidth copy peaks at 1 and the others keep their loudness
    let peak: f32 = 0.0;
    for (let i = 0; i < n; i++) peak = max(peak, abs(this.data[i]));
    if (peak > 0.0) {
      const g: f32 = 1.0 / peak;
      for (let i = 0; i < this.levels * stride; i++) this.data[i] *= g;
    }
  }

  /// The wave as a sum of sines: `amps[k]` is the amplitude of harmonic k + 1, `count` of them.
  setHarmonics(amps: StaticArray<f32>, count: i32): void { this.build(0, amps, count); }
  setSaw(): void { this.build(1, null, 0); }
  setSquare(): void { this.build(2, null, 0); }
  setTriangle(): void { this.build(3, null, 0); }

  /// The wave at `phase` (in cycles, any value) when stepping `dt` per sample.
  read(phase: f64, dt: f64): f32 {
    let lv = 0;
    while (lv < this.levels - 1 && <f64>(this.maxHarmonic >> lv) * dt > 0.5) lv++;
    const p = (phase - floor(phase)) * <f64>this.size;
    const i = <i32>p;
    const f = <f32>(p - <f64>i);
    const at = lv * (this.size + 1) + i;
    const a = this.data[at];
    return a + (this.data[at + 1] - a) * f;
  }
}

/// A stack of `voices` detuned band-limited saws (the "supersaw"). Detune is the total spread in cents: voices are spread evenly across
/// it, the outer ones at +-detune / 2. The mix is scaled by 1 / sqrt(voices). Start phases come from a fixed sequence, so every run sounds the same.
export class Supersaw {
  readonly voices: i32;
  private phases: StaticArray<f64>;
  private ratios: StaticArray<f64>;
  private invSampleRate: f64;
  private gain: f32;
  constructor(sampleRate: f64, voices: i32 = 7, detuneCents: f64 = 20.0) {
    this.voices = voices;
    this.invSampleRate = 1.0 / sampleRate;
    this.gain = <f32>(1.0 / Math.sqrt(<f64>voices));
    this.phases = new StaticArray<f64>(voices);
    this.ratios = new StaticArray<f64>(voices);
    let x: f64 = 0.5;
    for (let i = 0; i < voices; i++) { x += 0.6180339887498949; x -= floor(x); this.phases[i] = x; }
    this.setDetune(detuneCents);
  }
  /// Sets the total spread in cents (two pow calls per voice: not for sample()).
  setDetune(cents: f64): void {
    const n = this.voices;
    for (let i = 0; i < n; i++) {
      const spread: f64 = n > 1 ? 2.0 * <f64>i / <f64>(n - 1) - 1.0 : 0.0;
      this.ratios[i] = Math.pow(2.0, spread * cents * 0.5 / 1200.0);
    }
  }
  next(frequency: f64): f32 {
    let sum: f32 = 0.0;
    const base = frequency * this.invSampleRate;
    for (let i = 0; i < this.voices; i++) {
      const dt = min(base * this.ratios[i], 0.49);
      let p = this.phases[i] + dt;
      if (p >= 1.0) p -= 1.0;
      this.phases[i] = p;
      sum += sawBlep(p, dt);
    }
    return sum * this.gain;
  }
}

/// A phase-modulation operator, as in an FM synth: a sine whose phase is moved by `modulation` (in cycles; an operator's output times its
/// index) and, optionally, by its own last output times `feedback`.
export class FmOp {
  private phase: f64 = 0;
  private last: f32 = 0;
  private invSampleRate: f64;
  constructor(sampleRate: f64) { this.invSampleRate = 1.0 / sampleRate; }
  reset(): void { this.phase = 0; this.last = 0; }
  next(frequency: f64, modulation: f32 = 0, feedback: f32 = 0): f32 {
    this.phase += frequency * this.invSampleRate;
    this.phase -= floor(this.phase);
    this.last = fastSin(this.phase + <f64>modulation + <f64>(this.last * feedback));
    return this.last;
  }
}
