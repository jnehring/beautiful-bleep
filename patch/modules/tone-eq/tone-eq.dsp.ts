// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Tone EQ: a passive, interactive, musical equaliser. Three modes (passive shelving network, tilt, guitar-amp tone stack), each built
// from an analog prototype that is discretised with the bilinear transform (pre-warped at the filter's own frequency), then a
// valve-style make-up stage with level-dependent even-harmonic colour and a slow component drift. Written in Bleep Script.

import { Smoother, DcBlocker, PeakHold } from "./bleep/dsp";
import { Xorshift } from "./bleep/random";

const PI: f64 = 3.141592653589793;
const TWO_PI: f64 = 6.283185307179586;

// ---- stepped frequencies ------------------------------------------------------------------------------------------------------------

function lowFreq(i: i32): f64 { return i == 0 ? 20.0 : i == 1 ? 30.0 : i == 2 ? 60.0 : 100.0; }
function highFreq(i: i32): f64 {
  return i == 0 ? 3000.0 : i == 1 ? 4000.0 : i == 2 ? 5000.0 : i == 3 ? 8000.0 : i == 4 ? 10000.0 : i == 5 ? 12000.0 : 16000.0;
}
function attFreq(i: i32): f64 { return i == 0 ? 5000.0 : i == 1 ? 10000.0 : 20000.0; }
function pivotFreq(i: i32): f64 { return i == 0 ? 250.0 : i == 1 ? 400.0 : i == 2 ? 650.0 : i == 3 ? 1000.0 : i == 4 ? 1600.0 : 2500.0; }

/// dB per knob step (the knobs run 0 to 10).
const LOW_BOOST_DB: f64 = 1.5;
const LOW_ATTEN_DB: f64 = 1.2;
const HIGH_BOOST_DB: f64 = 1.6;
const HIGH_ATTEN_DB: f64 = 1.4;
/// The low attenuation shelf turns over this many times above the boost shelf, so the two overlap and a dip opens above the boost.
const CUT_RATIO: f64 = 2.4;
/// Gain recovered after the tone stack's insertion loss, in dB.
const STACK_MAKEUP_DB: f64 = 9.0;

// ---- analog prototypes, discretised ---------------------------------------------------------------------------------------------------

/// One biquad section (transposed direct form II, f64), designed from an analog prototype in the normalised variable sn = s / w0
/// with sn -> kn (1 - z^-1) / (1 + z^-1) and kn = 1 / tan(pi f0 / fs): the analog frequency f0 lands exactly on the digital f0.
class Bq {
  b0: f64 = 1.0; b1: f64 = 0.0; b2: f64 = 0.0; a1: f64 = 0.0; a2: f64 = 0.0;
  private z1: f64 = 0.0; private z2: f64 = 0.0;
  reset(): void { this.z1 = 0.0; this.z2 = 0.0; }
  identity(): void { this.b0 = 1.0; this.b1 = 0.0; this.b2 = 0.0; this.a1 = 0.0; this.a2 = 0.0; }
  /// (nb2 sn^2 + nb1 sn + nb0) / (na2 sn^2 + na1 sn + na0)
  analog2(nb2: f64, nb1: f64, nb0: f64, na2: f64, na1: f64, na0: f64, kn: f64): void {
    const k2 = kn * kn;
    const a0 = na2 * k2 + na1 * kn + na0;
    const inv = 1.0 / a0;
    this.b0 = (nb2 * k2 + nb1 * kn + nb0) * inv;
    this.b1 = 2.0 * (nb0 - nb2 * k2) * inv;
    this.b2 = (nb2 * k2 - nb1 * kn + nb0) * inv;
    this.a1 = 2.0 * (na0 - na2 * k2) * inv;
    this.a2 = (na2 * k2 - na1 * kn + na0) * inv;
  }
  /// (nb1 sn + nb0) / (na1 sn + na0)
  analog1(nb1: f64, nb0: f64, na1: f64, na0: f64, kn: f64): void {
    const inv = 1.0 / (na1 * kn + na0);
    this.b0 = (nb1 * kn + nb0) * inv;
    this.b1 = (nb0 - nb1 * kn) * inv;
    this.b2 = 0.0;
    this.a1 = (na0 - na1 * kn) * inv;
    this.a2 = 0.0;
  }
  next(x: f64): f64 {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

function warp(fs: f64, f: f64): f64 { return 1.0 / Math.tan(PI * min(f, 0.45 * fs) / fs); }

/// Second-order low shelf (DC gain `gainDb`, midpoint at f, resonance Q): A (s^2 + sqrt(A)/Q s + A) / (A s^2 + sqrt(A)/Q s + 1).
function lowShelf2(q: Bq, fs: f64, f: f64, gainDb: f64, Q: f64): void {
  const A = Math.pow(10.0, gainDb / 40.0), r = Math.sqrt(A) / Q;
  q.analog2(A, A * r, A * A, A, r, 1.0, warp(fs, f));
}
/// Second-order bell: gain gainDb at f, width set by Q: (s^2 + A/Q s + 1) / (s^2 + 1/(A Q) s + 1).
function bell(q: Bq, fs: f64, f: f64, gainDb: f64, Q: f64): void {
  const A = Math.pow(10.0, gainDb / 40.0);
  q.analog2(1.0, A / Q, 1.0, 1.0, 1.0 / (A * Q), 1.0, warp(fs, f));
}
/// First-order low shelf (6 dB per octave): DC gain gainDb, 0 dB at high frequencies, midpoint at f.
function lowShelf1(q: Bq, fs: f64, f: f64, gainDb: f64): void {
  const rg = Math.pow(10.0, gainDb / 40.0);
  q.analog1(1.0, rg, 1.0, 1.0 / rg, warp(fs, f));
}
/// First-order high shelf: 0 dB at low frequencies, gainDb at high frequencies, midpoint at f.
function highShelf1(q: Bq, fs: f64, f: f64, gainDb: f64): void {
  const rg = Math.pow(10.0, gainDb / 40.0);
  q.analog1(rg * rg, rg, 1.0, rg, warp(fs, f));
}

// ---- the tone stack: nodal analysis of a passive RC network ---------------------------------------------------------------------------

/// The generic bass / mid / treble tone stack of a guitar amplifier, from textbook values: treble pot R1 250 kOhm, bass pot R2 1 MOhm
/// (audio taper), mid pot R3 25 kOhm, slope resistor R4 56 kOhm, C1 250 pF, C2 = C3 = 20 nF. The netlist:
///   In - C1 - A;  A - R1 - B (the output is the treble wiper, a fraction t of the way from B to A);  In - R4 - E;  E - C2 - B;  E - C3 - W3;
///   B - (l R2 + (1-m) R3) - W3;  W3 - m R3 - ground.
/// The solver builds the 4x4 nodal admittance matrix of (A, B, E, W3) at four values of s, takes its determinant (the denominator) and the
/// output voltage times it (the numerator), and interpolates both cubics. It runs at block rate, once per channel.
class StackSolver {
  /// numerator and denominator in u = s * 1 ms, normalised so that the denominator starts with 1
  n: StaticArray<f64> = new StaticArray<f64>(4);
  d: StaticArray<f64> = new StaticArray<f64>(4);
  private pn: StaticArray<f64> = new StaticArray<f64>(4);
  private pd: StaticArray<f64> = new StaticArray<f64>(4);
  private vw: f64 = 0.0;

  /// The determinant at u (= s * 1 ms) of the nodal admittance matrix, and (in vw) the output voltage for a unit input. A and E are eliminated
  /// by hand (each touches the input and two or three other nodes), which leaves a 2x2 system for B and W3.
  private evalAt(u: f64, l: f64, m: f64, t: f64, capScale: f64): f64 {
    const k = u * capScale * 25000.0 / 0.001;     // admittance of 1 F, normalised to 25 kOhm and 1 ms
    const rmin: f64 = 50.0;
    const yc1 = k * 250.0e-12, yc2 = k * 20.0e-9, yc3 = k * 20.0e-9;
    const g1 = 0.1, g4 = 25000.0 / 56000.0;
    const gb = 25000.0 / max(l * 1000000.0 + (1.0 - m) * 25000.0, rmin);
    const gm = 25000.0 / max(m * 25000.0, rmin);
    const pa = yc1 + g1, pe = g4 + yc2 + yc3;
    const m11 = g1 + yc2 + gb - g1 * g1 / pa - yc2 * yc2 / pe;
    const m12 = -gb - yc2 * yc3 / pe;
    const m22 = gb + yc3 + gm - yc3 * yc3 / pe;
    const r1 = g1 * yc1 / pa + yc2 * g4 / pe;
    const r2 = yc3 * g4 / pe;
    const det2 = m11 * m22 - m12 * m12;
    const vb = (r1 * m22 - m12 * r2) / det2;
    const va = (yc1 + g1 * vb) / pa;
    this.vw = t * va + (1.0 - t) * vb;
    return pa * pe * det2;
  }

  /// l: bass pot position 0..1 (already tapered), m: mid, t: treble; capScale scales all three capacitors (component drift).
  solve(l: f64, m: f64, t: f64, capScale: f64): void {
    for (let i = 0; i < 4; i++) {
      const det = this.evalAt(<f64>i, l, m, t, capScale);
      this.pd[i] = det;
      this.pn[i] = this.vw * det;
    }
    // Newton interpolation through u = 0, 1, 2, 3
    const d0 = this.pd[0];
    const inv = 1.0 / d0;
    for (let pass = 0; pass < 2; pass++) {
      const p0 = (pass == 0 ? this.pd[0] : this.pn[0]) * inv, p1 = (pass == 0 ? this.pd[1] : this.pn[1]) * inv;
      const p2 = (pass == 0 ? this.pd[2] : this.pn[2]) * inv, p3 = (pass == 0 ? this.pd[3] : this.pn[3]) * inv;
      const e1 = p1 - p0, e2 = p2 - 2.0 * p1 + p0, e3 = p3 - 3.0 * p2 + 3.0 * p1 - p0;
      const c0 = pass == 0 ? p0 : 0.0;       // the numerator vanishes at DC
      const c1 = e1 - 0.5 * e2 + e3 / 3.0;
      const c2 = 0.5 * e2 - 0.5 * e3;
      const c3 = e3 / 6.0;
      if (pass == 0) { this.d[0] = c0; this.d[1] = c1; this.d[2] = c2; this.d[3] = c3; }
      else { this.n[0] = c0; this.n[1] = c1; this.n[2] = c2; this.n[3] = c3; }
    }
  }
}

/// A third-order section from H(u) = (n1 u + n2 u^2 + n3 u^3) / (1 + a1 u + a2 u^2 + a3 u^3), u = s * 1 ms, by the bilinear transform with
/// the analog frequency fm mapped to itself.
class Cubic {
  b0: f64 = 1.0; b1: f64 = 0.0; b2: f64 = 0.0; b3: f64 = 0.0; a1: f64 = 0.0; a2: f64 = 0.0; a3: f64 = 0.0;
  private z1: f64 = 0.0; private z2: f64 = 0.0; private z3: f64 = 0.0;
  reset(): void { this.z1 = 0.0; this.z2 = 0.0; this.z3 = 0.0; }
  setFrom(sv: StackSolver, fs: f64, fm: f64): void {
    const w = TWO_PI * min(fm, 0.4 * fs);
    const kap = 0.001 * w / Math.tan(w / (2.0 * fs));
    const k1 = kap, k2 = kap * kap, k3 = k2 * kap;
    const n1 = sv.n[1] * k1, n2 = sv.n[2] * k2, n3 = sv.n[3] * k3;
    const d1 = sv.d[1] * k1, d2 = sv.d[2] * k2, d3 = sv.d[3] * k3;
    // (1+x)^3, (1-x)(1+x)^2, (1-x)^2(1+x), (1-x)^3 with x = z^-1
    // numerator: n1*(1,1,-1,-1) + n2*(1,-1,-1,1) + n3*(1,-3,3,-1)
    const nb0 = n1 + n2 + n3, nb1 = n1 - n2 - 3.0 * n3, nb2 = -n1 - n2 + 3.0 * n3, nb3 = -n1 + n2 - n3;
    // denominator: (1,3,3,1) + d1*(1,1,-1,-1) + d2*(1,-1,-1,1) + d3*(1,-3,3,-1)
    const da0 = 1.0 + d1 + d2 + d3, da1 = 3.0 + d1 - d2 - 3.0 * d3, da2 = 3.0 - d1 - d2 + 3.0 * d3, da3 = 1.0 - d1 + d2 - d3;
    const inv = 1.0 / da0;
    this.b0 = nb0 * inv; this.b1 = nb1 * inv; this.b2 = nb2 * inv; this.b3 = nb3 * inv;
    this.a1 = da1 * inv; this.a2 = da2 * inv; this.a3 = da3 * inv;
  }
  next(x: f64): f64 {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y + this.z3;
    this.z3 = this.b3 * x - this.a3 * y;
    return y;
  }
}

// ---- component drift ------------------------------------------------------------------------------------------------------------------

/// Three slow random values in -1..1, each wandering with a time constant of a few seconds; one generator per channel.
class Drift {
  v0: f64 = 0.0; v1: f64 = 0.0; v2: f64 = 0.0;
  private t0: f64 = 0.0; private t1: f64 = 0.0; private t2: f64 = 0.0;
  private rng: Xorshift;
  private count: i32 = 0;
  private every: i32;
  private k: f64;
  constructor(sampleRate: f64, initial: u32) {
    this.rng = new Xorshift(initial);
    this.every = <i32>(sampleRate * 2.5 / 32.0);
    this.k = 1.0 - Math.exp(-32.0 / (sampleRate * 3.0));
    this.t0 = <f64>this.rng.nextBipolar(); this.t1 = <f64>this.rng.nextBipolar(); this.t2 = <f64>this.rng.nextBipolar();
    this.v0 = this.t0; this.v1 = this.t1; this.v2 = this.t2;
  }
  /// once per block of 32 samples
  step(): void {
    this.count++;
    if (this.count >= this.every) {
      this.count = 0;
      this.t0 = <f64>this.rng.nextBipolar(); this.t1 = <f64>this.rng.nextBipolar(); this.t2 = <f64>this.rng.nextBipolar();
    }
    this.v0 += (this.t0 - this.v0) * this.k;
    this.v1 += (this.t1 - this.v1) * this.k;
    this.v2 += (this.t2 - this.v2) * this.k;
  }
}

// ---- the input choice (Auto / Stereo / Mono) --------------------------------------------------------------------------------------

class InputSel {
  private zeros: i32 = 0;
  private mono: f32 = 0.0;
  private auto: bool = false;
  private coef: f32;
  constructor(sampleRate: f64) { this.coef = <f32>(1.0 - Math.exp(-1.0 / (sampleRate * 0.005))); }
  reset(): void { this.zeros = 0; this.mono = 0.0; this.auto = false; }
  /// mode: 0 Auto, 1 Stereo, 2 Mono. Returns the sample the right channel should process.
  right(l: f32, r: f32, mode: i32): f32 {
    if (r == 0.0) { if (this.zeros < 1000000) this.zeros++; } else { this.zeros = 0; this.auto = false; }
    if (this.zeros >= 2048 && l != 0.0) this.auto = true;
    const target: f32 = mode == 2 ? 1.0 : mode == 1 ? 0.0 : this.auto ? 1.0 : 0.0;
    this.mono += (target - this.mono) * this.coef;
    return r + (l - r) * this.mono;
  }
}

// ---- one channel ----------------------------------------------------------------------------------------------------------------------

/// Bias and constants of the valve make-up stage: y = (tanh(b + k x) - tanh(b)) / (k sech^2(b)); unity small-signal gain, even and odd harmonics
/// that grow with the level, bounded for any input.
const VALVE_BIAS: f64 = 0.45;


class ToneChannel {
  s0: Bq = new Bq(); s1: Bq = new Bq(); s2: Bq = new Bq(); s3: Bq = new Bq();
  stack: Cubic = new Cubic();
  drift: Drift;
  private dc: DcBlocker;
  private sb: f64 = VALVE_BIAS / Math.sqrt(1.0 + VALVE_BIAS * VALVE_BIAS);
  private isl: f64 = Math.pow(1.0 + VALVE_BIAS * VALVE_BIAS, 1.5);
  private u1: f64 = 0.0;
  private f1: f64 = Math.pow(1.0 + VALVE_BIAS * VALVE_BIAS, 1.5) * Math.sqrt(1.0 + VALVE_BIAS * VALVE_BIAS);
  constructor(sampleRate: f64, initial: u32) {
    this.drift = new Drift(sampleRate, initial);
    this.dc = new DcBlocker(sampleRate, 4.0);
  }
  reset(): void {
    this.s0.reset(); this.s1.reset(); this.s2.reset(); this.s3.reset(); this.stack.reset();
    this.dc.reset(); this.u1 = 0.0; this.f1 = this.isl * Math.sqrt(1.0 + VALVE_BIAS * VALVE_BIAS);
  }
  /// mode 0 passive network (four sections), 1 tilt (two), 2 tone stack (one third-order section)
  filter(x: f64, mode: i32): f64 {
    const xi = x + 1.0e-18;
    if (mode == 0) return this.s3.next(this.s2.next(this.s1.next(this.s0.next(xi))));
    if (mode == 1) return this.s1.next(this.s0.next(xi));
    return this.stack.next(xi);
  }
  /// The valve stage: y = (s(b + k x) - s(b)) / (k s'(b)) with the algebraic sigmoid s(x) = x / sqrt(1 + x^2): unity small-signal gain, even and odd
  /// harmonics that grow with the level, bounded for any input. The curve is split into the straight line u and the residual h(u) = g(u) - u; only
  /// the residual is evaluated with first-order antiderivative anti-aliasing (the average of h between this and the previous sample, from its
  /// antiderivative), so the straight part keeps a flat response up to the top. The offset the asymmetry makes is blocked.
  valve(x: f32, k: f32): f32 {
    const kd = <f64>k;
    const u = kd * <f64>x;
    const w = VALVE_BIAS + u;
    const f = this.isl * (Math.sqrt(1.0 + w * w) - this.sb * u) - 0.5 * u * u;
    const du = u - this.u1;
    const um = 0.5 * (u + this.u1);
    const wm = VALVE_BIAS + um;
    const h = abs(du) < 0.0001 ? this.isl * (wm / Math.sqrt(1.0 + wm * wm) - this.sb) - um : (f - this.f1) / du;
    this.u1 = u; this.f1 = f;
    return this.dc.next(<f32>((u + h) / kd));
  }
}

/**
 * A passive, interactive tone control: the musical opposite of a surgical parametric equaliser. Three modes:
 * a passive shelving network whose boost and attenuation controls interact, a two-knob tilt, and a guitar-amp bass / mid / treble tone stack.
 * A valve-style make-up stage adds a little level-dependent warmth, and an ageing control lets the component values drift slowly.
 */
@module({
  name: "Tone EQ",
  category: "Effects/Dynamics & EQ",
  colour: "#38bdf8",
  description: "A passive, musical EQ: interacting shelving network, tilt or guitar-amp tone stack, with a valve make-up stage and slow component drift. Stereo.",
  layout: [
    { row: [{ select: "mode" }, { select: "pivot" }, { select: "input" }] },
    { row: [
      { title: "Low", column: [{ select: "lowFreq" }, { row: ["lowBoost", "lowAtten"] }] },
      { title: "High", column: [{ select: "hiFreq" }, { row: ["hiBoost", "bandwidth"] }] },
      { title: "Attenuate", column: [{ select: "attFreq" }, { row: ["hiAtten"] }] },
    ] },
    { row: [
      { title: "Tilt", row: ["tilt"] },
      { title: "Tone Stack", row: ["bass", "mid", "treble"] },
      { title: "Make-up", row: ["drive", "age", "output"] },
    ] },
  ],
})
export class ToneEq {
  /** Left input. */
  @input({ name: "In L", type: "audio" }) l: f32 = 0;
  /** Right input; in Auto mode the left signal is used when nothing is patched here. */
  @input({ name: "In R", type: "audio" }) r: f32 = 0;
  @output({ name: "Out L", type: "audio" }) outL: f32 = 0;
  @output({ name: "Out R", type: "audio" }) outR: f32 = 0;

  /** Passive Shelf: a network of interacting shelves. Tilt: bass and treble seesaw around a pivot. Tone Stack: a guitar-amp bass / mid / treble network with its mid scoop. */
  @param({ name: "Mode", choices: ["Passive Shelf", "Tilt", "Tone Stack"], group: "Mode" }) mode: i32 = 0;

  /** Turnover frequency of the low boost and low attenuation shelves. */
  @param({ name: "Low Freq", choices: ["20 Hz", "30 Hz", "60 Hz", "100 Hz"], group: "Passive Shelf" }) lowFreq: i32 = 2;
  /** Low boost, 0 to 10 (about 15 dB at 10): a resonant shelf at the chosen frequency. */
  @param({ name: "Low Boost", min: 0, max: 10, init: 3, decimals: 1, group: "Passive Shelf" }) lowBoost: f32 = 3;
  /** Low attenuation, 0 to 10 (about 12 dB at 10): a gentler shelf that turns over higher up. Used together with the boost it opens a dip above the boost and leaves a tight, smooth bottom. */
  @param({ name: "Low Atten", min: 0, max: 10, init: 1.5, decimals: 1, group: "Passive Shelf" }) lowAtten: f32 = 1.5;
  /** Centre frequency of the high boost. */
  @param({ name: "High Freq", choices: ["3 kHz", "4 kHz", "5 kHz", "8 kHz", "10 kHz", "12 kHz", "16 kHz"], group: "Passive Shelf" }) hiFreq: i32 = 3;
  /** High boost, 0 to 10 (about 16 dB at 10): a broad bell at the chosen frequency. */
  @param({ name: "High Boost", min: 0, max: 10, init: 2, decimals: 1, group: "Passive Shelf" }) hiBoost: f32 = 2;
  /** Width of the high boost, 0 (narrow) to 10 (very broad). */
  @param({ name: "Bandwidth", min: 0, max: 10, init: 5, decimals: 1, group: "Passive Shelf" }) bandwidth: f32 = 5;
  /** Turnover frequency of the high attenuation shelf. */
  @param({ name: "Atten Freq", choices: ["5 kHz", "10 kHz", "20 kHz"], group: "Passive Shelf" }) attFreq: i32 = 1;
  /** High attenuation, 0 to 10 (about 14 dB at 10): a gentle shelf cut above the chosen frequency. */
  @param({ name: "High Atten", min: 0, max: 10, init: 1, decimals: 1, group: "Passive Shelf" }) hiAtten: f32 = 1;

  /** Tilt amount: positive brightens (treble up, bass down), negative darkens, with broad gentle slopes either side of the pivot. */
  @param({ name: "Tilt", min: -6, max: 6, init: 0, unit: "dB", decimals: 1, group: "Tilt" }) tilt: f32 = 0;
  /** The frequency around which the tilt turns. */
  @param({ name: "Pivot", choices: ["250 Hz", "400 Hz", "650 Hz", "1 kHz", "1.6 kHz", "2.5 kHz"], group: "Tilt" }) pivot: i32 = 2;

  /** Tone Stack bass, 0 to 10 (an audio-taper pot). */
  @param({ name: "Bass", min: 0, max: 10, init: 5, decimals: 1, group: "Tone Stack" }) bass: f32 = 5;
  /** Tone Stack mid, 0 to 10. Low settings dig the mid scoop deeper. */
  @param({ name: "Mid", min: 0, max: 10, init: 5, decimals: 1, group: "Tone Stack" }) mid: f32 = 5;
  /** Tone Stack treble, 0 to 10. */
  @param({ name: "Treble", min: 0, max: 10, init: 5, decimals: 1, group: "Tone Stack" }) treble: f32 = 5;

  /** Valve make-up stage drive: a small, level-dependent even-harmonic warmth. 0 is almost clean. */
  @param({ name: "Drive", min: 0, max: 1, init: 0.3, decimals: 2, group: "Make-up" }) drive: f32 = 0.3;
  /** Output level after the make-up stage. */
  @param({ name: "Output", min: -12, max: 12, init: 0, unit: "dB", decimals: 1, group: "Make-up" }) output: f32 = 0;
  /** Slow random drift of the component values (gains, turnover frequencies, pot positions), different in the left and right channel. */
  @param({ name: "Age", min: 0, max: 1, init: 0.2, decimals: 2, group: "Make-up" }) age: f32 = 0.2;

  /** Auto uses the left input for both channels while nothing is patched to the right one; Stereo uses both; Mono feeds the left signal to both. */
  @param({ name: "Input", choices: ["Auto", "Stereo", "Mono"], group: "Setup" }) input: i32 = 0;

  /** The output level. */
  @probe level: f32 = 0;

  private sampleRate: f64;
  private chL: ToneChannel;
  private chR: ToneChannel;
  private sel: InputSel;
  private solver: StackSolver = new StackSolver();
  private fade: Smoother;
  private drv: Smoother;
  private outg: Smoother;
  private meter: PeakHold;
  private active: i32 = 0;
  private started: bool = false;
  private kb: f64;
  // smoothed controls, in the units the designs use
  private cLowB: f64 = 0.0; private cLowA: f64 = 0.0; private cHiB: f64 = 0.0; private cBw: f64 = 0.0; private cHiA: f64 = 0.0;
  private cTilt: f64 = 0.0; private cBass: f64 = 0.0; private cMid: f64 = 0.0; private cTreble: f64 = 0.0; private cAge: f64 = 0.0;
  private lfLow: f64 = 0.0; private lfHi: f64 = 0.0; private lfAtt: f64 = 0.0; private lfPivot: f64 = 0.0;

  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    this.chL = new ToneChannel(sampleRate, 0x1234abcd);
    this.chR = new ToneChannel(sampleRate, 0x7e57c0de);
    this.sel = new InputSel(sampleRate);
    this.fade = new Smoother(sampleRate, 0.004);
    this.drv = new Smoother(sampleRate, 0.02);
    this.outg = new Smoother(sampleRate, 0.02);
    this.meter = new PeakHold(sampleRate, 0.3);
    this.kb = 1.0 - Math.exp(-32.0 / (sampleRate * 0.03));
    this.fade.target = 1.0; this.fade.snap();
  }

  reset(): void {
    this.chL.reset(); this.chR.reset(); this.sel.reset(); this.meter.reset();
    this.started = false;
  }

  /// the audio-taper bass pot: about 18 % of the track at the middle of the knob
  private taper(k: f64): f64 {
    const x = min(max(k / 10.0, 0.0), 1.0);
    return (Math.exp(3.0 * x) - 1.0) / (Math.exp(3.0) - 1.0);
  }

  private design(ch: ToneChannel, mode: i32): void {
    const fs = this.sampleRate;
    const age = this.cAge;
    const dr = ch.drift;
    const gs = 1.0 + 0.10 * age * dr.v0;        // gains
    const fsx = 1.0 + 0.04 * age * dr.v1;       // frequencies
    if (mode == 0) {
      lowShelf2(ch.s0, fs, Math.exp(this.lfLow) * fsx, this.cLowB * LOW_BOOST_DB * gs, 0.9);
      lowShelf1(ch.s1, fs, Math.exp(this.lfLow) * fsx * CUT_RATIO, -this.cLowA * LOW_ATTEN_DB * gs);
      const q = 2.0 * Math.pow(0.35 / 2.0, this.cBw / 10.0);
      bell(ch.s2, fs, Math.exp(this.lfHi) * fsx, this.cHiB * HIGH_BOOST_DB * gs, q);
      highShelf1(ch.s3, fs, Math.exp(this.lfAtt) * fsx, -this.cHiA * HIGH_ATTEN_DB * gs);
    } else if (mode == 1) {
      const p = Math.exp(this.lfPivot) * fsx;
      lowShelf1(ch.s0, fs, p / 2.5, -this.cTilt * gs);
      highShelf1(ch.s1, fs, p * 2.5, this.cTilt * gs);
    } else {
      const po = 0.03 * age * dr.v2;
      const l = min(max(this.taper(this.cBass) + po, 0.0005), 1.0);
      const m = min(max(this.cMid / 10.0 + po, 0.001), 0.999);
      const t = min(max(this.cTreble / 10.0 - po, 0.001), 0.999);
      this.solver.solve(l, m, t, 1.0 + 0.05 * age * dr.v1);
      ch.stack.setFrom(this.solver, fs, 1500.0);
    }
  }

  block(): void {
    const first = !this.started;
    const k = first ? 1.0 : this.kb;
    this.cLowB += (<f64>this.lowBoost - this.cLowB) * k;
    this.cLowA += (<f64>this.lowAtten - this.cLowA) * k;
    this.cHiB += (<f64>this.hiBoost - this.cHiB) * k;
    this.cBw += (<f64>this.bandwidth - this.cBw) * k;
    this.cHiA += (<f64>this.hiAtten - this.cHiA) * k;
    this.cTilt += (<f64>this.tilt - this.cTilt) * k;
    this.cBass += (<f64>this.bass - this.cBass) * k;
    this.cMid += (<f64>this.mid - this.cMid) * k;
    this.cTreble += (<f64>this.treble - this.cTreble) * k;
    this.cAge += (<f64>this.age - this.cAge) * k;
    this.lfLow += (Math.log(lowFreq(this.lowFreq)) - this.lfLow) * k;
    this.lfHi += (Math.log(highFreq(this.hiFreq)) - this.lfHi) * k;
    this.lfAtt += (Math.log(attFreq(this.attFreq)) - this.lfAtt) * k;
    this.lfPivot += (Math.log(pivotFreq(this.pivot)) - this.lfPivot) * k;

    // a mode change fades out, switches with cleared state, fades in
    if (first) { this.active = this.mode; this.fade.target = 1.0; this.fade.snap(); }
    else if (this.mode != this.active) {
      this.fade.target = 0.0;
      if (this.fade.value < 0.002) {
        this.active = this.mode;
        this.chL.reset(); this.chR.reset();
        this.fade.target = 1.0;
      }
    } else this.fade.target = 1.0;

    this.chL.drift.step(); this.chR.drift.step();
    this.design(this.chL, this.active);
    this.design(this.chR, this.active);

    this.drv.target = <f32>(0.02 + 0.9 * <f64>this.drive);
    this.outg.target = <f32>Math.pow(10.0, (<f64>this.output + (this.active == 2 ? STACK_MAKEUP_DB : 0.0)) / 20.0);
    if (first) { this.drv.snap(); this.outg.snap(); this.started = true; }
  }

  sample(): void {
    const r = this.sel.right(this.l, this.r, this.input);
    const f = this.fade.next();
    const k = this.drv.next();
    const g = this.outg.next() * f;
    const m = this.active;
    const yl = this.chL.valve(<f32>this.chL.filter(<f64>this.l, m), k) * g;
    const yr = this.chR.valve(<f32>this.chR.filter(<f64>r, m), k) * g;
    this.outL = yl;
    this.outR = yr;
    this.level = this.meter.next(max(abs(yl), abs(yr)));
  }
}
