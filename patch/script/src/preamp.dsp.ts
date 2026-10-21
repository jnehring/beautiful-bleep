// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Preamp: a transformer-coupled preamp channel (input transformer, gain stage, output transformer), written in Bleep Script.
// The colour lives in the two transformer cores: a magnetising branch whose flux integrates the voltage, so low frequencies reach saturation
// at much lower levels than high ones, with a little hysteresis memory, and a leakage-inductance / winding-capacitance roll-off.

import { Smoother, Biquad } from "./bleep/dsp";
import { NoiseLfo } from "./bleep/random";

const TWO_PI: f64 = 6.283185307179586;

/// Decides whether the right input is unpatched: it has been exactly 0.0 for 2048 samples while the left input is alive.
class InputSense {
  private rZero: i32 = 0;
  private lZero: i32 = 0;
  reset(): void { this.rZero = 0; this.lZero = 0; }
  next(l: f32, r: f32): bool {
    if (r != 0.0) this.rZero = 0; else if (this.rZero < 1000000) this.rZero++;
    if (l != 0.0) this.lZero = 0; else if (this.lZero < 1000000) this.lZero++;
    return this.rZero >= 2048 && this.lZero < 2048;
  }
}

/// A short delay for the dry path, so it lines up with the oversampled wet path. The delay is fractional (linear interpolation).
class DryDelay {
  private buf: StaticArray<f32> = new StaticArray<f32>(64);
  private pos: i32 = 0;
  reset(): void { for (let i = 0; i < 64; i++) this.buf[i] = 0.0; }
  tick(x: f32, w: i32, f: f32): f32 {
    const p = this.pos;
    this.buf[p] = x;
    this.pos = (p + 1) & 63;
    const a = this.buf[(p - w) & 63];
    return a + (this.buf[(p - w - 1) & 63] - a) * f;
  }
}

/// A value that moves in a straight line to its target over one block of 32 samples (set at block rate, next() per sample). Cheaper than a one-pole smoother.
class Ramp {
  value: f32 = 0;
  step: f32 = 0;
  aim(target: f32): void { this.step = (target - this.value) * (1.0 / 32.0); }
  jump(target: f32): void { this.value = target; this.step = 0.0; }
  tick(): f32 { this.value += this.step; return this.value; }
}

/// A polyphase all-pass half-band filter pair for 2x oversampling, H(z) = (A0(z^2) + z^-1 A1(z^2)) / 2, with three first-order all-pass sections
/// y = a x + s; s = x - a y in each branch (an equiripple design: the stop band, from 0.28 of the high rate, is about 70 dB down). Far cheaper
/// than a linear-phase FIR, at the price of a phase shift; `delay` is the delay at low frequencies in samples of the lower rate (it aligns the dry path).
class HalfBandSteep {
  a: f32 = 0;
  b: f32 = 0;
  delay: f64 = 0;
  private ua0: f64 = 0; private ua1: f64 = 0; private ua2: f64 = 0; private ub0: f64 = 0; private ub1: f64 = 0; private ub2: f64 = 0;
  private da0: f64 = 0; private da1: f64 = 0; private da2: f64 = 0; private db0: f64 = 0; private db1: f64 = 0; private db2: f64 = 0;
  private prev: f64 = 0;
  private static readonly A0: f64 = 0.049853775401837316;
  private static readonly A1: f64 = 0.3289015891226593;
  private static readonly A2: f64 = 0.7108501827557759;
  private static readonly B0: f64 = 0.17042901131998955;
  private static readonly B1: f64 = 0.5157755217489096;
  private static readonly B2: f64 = 0.9010178910007769;
  constructor() {
    this.delay = 0.5 + (1.0 - HalfBandSteep.A0) / (1.0 + HalfBandSteep.A0) + (1.0 - HalfBandSteep.A1) / (1.0 + HalfBandSteep.A1) + (1.0 - HalfBandSteep.A2) / (1.0 + HalfBandSteep.A2)
      + (1.0 - HalfBandSteep.B0) / (1.0 + HalfBandSteep.B0) + (1.0 - HalfBandSteep.B1) / (1.0 + HalfBandSteep.B1) + (1.0 - HalfBandSteep.B2) / (1.0 + HalfBandSteep.B2);
  }
  reset(): void {
    this.ua0 = 0.0; this.ua1 = 0.0; this.ua2 = 0.0; this.ub0 = 0.0; this.ub1 = 0.0; this.ub2 = 0.0;
    this.da0 = 0.0; this.da1 = 0.0; this.da2 = 0.0; this.db0 = 0.0; this.db1 = 0.0; this.db2 = 0.0;
    this.prev = 0.0;
  }
  /// One input sample in, two samples at twice the rate out (a first, then b).
  upS(x: f32): void {
    const xi = <f64>x;
    const a0 = HalfBandSteep.A0, a1 = HalfBandSteep.A1, a2 = HalfBandSteep.A2, b0 = HalfBandSteep.B0, b1 = HalfBandSteep.B1, b2 = HalfBandSteep.B2;
    let y = a0 * xi + this.ua0; this.ua0 = xi - a0 * y;
    let z = a1 * y + this.ua1; this.ua1 = y - a1 * z;
    y = a2 * z + this.ua2; this.ua2 = z - a2 * y;
    this.a = <f32>y;
    y = b0 * xi + this.ub0; this.ub0 = xi - b0 * y;
    z = b1 * y + this.ub1; this.ub1 = y - b1 * z;
    y = b2 * z + this.ub2; this.ub2 = z - b2 * y;
    this.b = <f32>y;
  }
  /// Two samples at the high rate in, one out.
  downS(a: f32, b: f32): f32 {
    const ai = <f64>a, bi = <f64>b;
    const a0 = HalfBandSteep.A0, a1 = HalfBandSteep.A1, a2 = HalfBandSteep.A2, b0 = HalfBandSteep.B0, b1 = HalfBandSteep.B1, b2 = HalfBandSteep.B2;
    let y = a0 * ai + this.da0; this.da0 = ai - a0 * y;
    let z = a1 * y + this.da1; this.da1 = y - a1 * z;
    y = a2 * z + this.da2; this.da2 = z - a2 * y;
    let w = b0 * bi + this.db0; this.db0 = bi - b0 * w;
    z = b1 * w + this.db1; this.db1 = w - b1 * z;
    w = b2 * z + this.db2; this.db2 = z - b2 * w;
    const out = 0.5 * (y + this.prev);
    this.prev = w;
    return <f32>out;
  }
}

/// The same with one section per branch, for the second doubling of 4x oversampling, where the transition band is wide (stop band from 0.4, 70 dB down).
class HalfBandMild {
  a: f32 = 0;
  b: f32 = 0;
  delay: f64 = 0;
  private ua: f64 = 0; private ub: f64 = 0; private da: f64 = 0; private db: f64 = 0; private prev: f64 = 0;
  private static readonly A: f64 = 0.12474455688199691;
  private static readonly B: f64 = 0.5625850480988297;
  constructor() { this.delay = 0.5 + (1.0 - HalfBandMild.A) / (1.0 + HalfBandMild.A) + (1.0 - HalfBandMild.B) / (1.0 + HalfBandMild.B); }
  reset(): void { this.ua = 0.0; this.ub = 0.0; this.da = 0.0; this.db = 0.0; this.prev = 0.0; }
  upS(x: f32): void {
    const xi = <f64>x, a = HalfBandMild.A, b = HalfBandMild.B;
    const y = a * xi + this.ua; this.ua = xi - a * y;
    const z = b * xi + this.ub; this.ub = xi - b * z;
    this.a = <f32>y; this.b = <f32>z;
  }
  downS(p: f32, q: f32): f32 {
    const pi = <f64>p, qi = <f64>q, a = HalfBandMild.A, b = HalfBandMild.B;
    const y = a * pi + this.da; this.da = pi - a * y;
    const w = b * qi + this.db; this.db = qi - b * w;
    const out = 0.5 * (y + this.prev);
    this.prev = w;
    return <f32>out;
  }
}

/// 2x or 4x oversampling around a shaper: up(x) then shape a, b (and c, d), then down.
class Oversampler {
  a: f32 = 0; b: f32 = 0; c: f32 = 0; d: f32 = 0;
  private h1: HalfBandSteep = new HalfBandSteep();
  private h2: HalfBandMild = new HalfBandMild();
  reset(): void { this.h1.reset(); this.h2.reset(); }
  /// Delay at low frequencies in input samples.
  delay(ovs: i32): f32 { return <f32>(ovs == 4 ? this.h1.delay + 0.5 * this.h2.delay : (ovs == 2 ? this.h1.delay : 0.0)); }
  up2(x: f32): void { this.h1.upS(x); this.a = this.h1.a; this.b = this.h1.b; }
  down2(a: f32, b: f32): f32 { return this.h1.downS(a, b); }
  up4(x: f32): void {
    this.h1.upS(x);
    const p = this.h1.a, q = this.h1.b;
    this.h2.upS(p); this.a = this.h2.a; this.b = this.h2.b;
    this.h2.upS(q); this.c = this.h2.a; this.d = this.h2.b;
  }
  down4(a: f32, b: f32, c: f32, d: f32): f32 {
    const p = this.h2.downS(a, b), q = this.h2.downS(c, d);
    return this.h1.downS(p, q);
  }
}

/// One transformer core. The state is the flux (normalised so that 1.0 is where the core starts to saturate). The flux integrates the voltage across
/// the magnetising branch, so for a given level it is proportional to 1 / frequency: bass saturates first. The magnetising current rises steeply
/// beyond saturation and is subtracted from the signal (the source impedance), so the output is a high-pass that turns into a soft, level-dependent
/// bass compressor with odd harmonics. A lagged sign of the flux rate shifts the curve a little (the hysteresis loop): the core remembers.
class Core {
  u: f64 = 0;            // flux, 1.0 = start of saturation
  h: f64 = 0;            // hysteresis memory, -1..1
  util: f32 = 0;         // the largest flux seen lately, for the meter
  dta: f64 = 0.01;       // dt * 2 pi Fsat: flux units per volt per sample
  w0dt: f64 = 0.002;     // 2 pi corner * dt
  k: f64 = 0.1;          // corner frequency over Fsat
  hc: f64 = 0.0;         // hysteresis width
  hk: f64 = 0.01;        // hysteresis memory coefficient
  decay: f32 = 0.9999;
  reset(): void { this.u = 0.0; this.h = 0.0; this.util = 0.0; }
  setRate(fs: f64): void {
    this.hk = 1.0 - Math.exp(-6.283185307179586 * 700.0 / fs);
    this.decay = <f32>Math.exp(-1.0 / (fs * 0.25));
  }
  tick(vin: f64): f64 {
    const u = this.u, h = this.h;
    const u2 = u * u;
    const e = u - this.hc * h * u2 / (1.0 + u2);
    const e2 = e * e, e4 = e2 * e2;
    const drop = this.k * e * (1.0 + e4);
    // backward Euler with the nonlinearity linearised: stable however hard the core is driven
    let un = u + this.dta * (vin - drop) / (1.0 + this.w0dt * (1.0 + 5.0 * e4));
    if (un < 1.0e-25 && un > -1.0e-25) un = 0.0;
    const d = un - u;
    this.h = h + this.hk * (d / (abs(d) + this.dta * 0.02 + 1.0e-30) - h);
    this.u = un;
    const m = <f32>abs(un);
    this.util = max(m, this.util * this.decay);
    return vin - drop;
  }
}

/// One channel of the preamp. Everything runs at the base rate except the gain stage, which is oversampled: the cores only act on the bass,
/// whose harmonics stay far below the Nyquist frequency, while the stage makes harmonics all over the spectrum.
class PreChan {
  os: Oversampler = new Oversampler();
  ovs: i32 = 4;
  fs: f64;
  bell: Biquad = new Biquad();
  lpOut: Biquad = new Biquad();
  coreIn: Core = new Core();
  coreOut: Core = new Core();
  dry: DryDelay = new DryDelay();
  lfo: NoiseLfo;
  drift: f32 = 0;
  trim: Ramp = new Ramp(); drv: Ramp = new Ramp(); fin: Ramp = new Ramp(); fout: Ramp = new Ramp(); wet: Ramp = new Ramp(); mixS: Ramp = new Ramp();
  dcX: f64 = 0; dcY: f64 = 0; dcR: f64 = 0.99;
  bias: f32 = 0.3;
  biasOut: f32 = 0.28;
  cls: i32 = 0;
  sx: f64 = 0; sf: f64 = 1; k0: f64 = 1; yb: f64 = 0;
  delayW: i32 = 0; delayF: f32 = 0;
  dn: f32 = 1.0e-18;   // a tiny alternating offset keeps the filter states away from denormal numbers
  w0In: f64 = 100; w0Out: f64 = 70;
  dtTwoPi: f64;

  constructor(sampleRate: f64, salt: u32) {
    this.fs = sampleRate;
    this.lfo = new NoiseLfo(sampleRate, salt);
    this.coreIn.setRate(sampleRate); this.coreOut.setRate(sampleRate);
    this.dcR = 1.0 - TWO_PI * 8.0 / sampleRate;
    this.dtTwoPi = TWO_PI / sampleRate;
  }

  reset(): void {
    this.os.reset(); this.bell.reset(); this.lpOut.reset();
    this.coreIn.reset(); this.coreOut.reset(); this.dry.reset(); this.dcX = 0.0; this.dcY = 0.0; this.sx = 0.0; this.sf = this.cls == 0 ? Math.sqrt(1.0 + <f64>this.bias * <f64>this.bias) : 1.0;
  }

  /// Block rate. iron, imp, air, age, drive and mix are 0..1; the others are in dB.
  setup(first: bool, trimDb: f64, drive: f64, iron: f64, imp: f64, air: f64, age: f64, outDb: f64, mix: f64, cls: i32, ovs: i32): void {
    const fs = this.fs;
    this.drift = this.lfo.next(0.07 * 32.0);
    const d = <f64>this.drift * age;
    this.ovs = ovs;
    const changed = first || cls != this.cls;
    this.cls = cls;
    const bias = 0.3 * (1.0 + 0.3 * d);
    this.bias = <f32>bias;
    this.biasOut = <f32>(bias / Math.sqrt(1.0 + bias * bias));
    this.yb = bias / Math.sqrt(1.0 + bias * bias);
    this.k0 = 1.0 / ((1.0 + bias * bias) * Math.sqrt(1.0 + bias * bias));
    if (changed) { this.sx = 0.0; this.sf = cls == 0 ? Math.sqrt(1.0 + bias * bias) : 1.0; }
    const g = Math.pow(10.0, 36.0 * drive / 20.0);
    const t = Math.pow(10.0, (trimDb + 0.5 * d) / 20.0);
    // level compensation: a -12 dBFS sine comes out at about -12 dBFS whatever the drive
    const ref = 0.25 * g * t;
    const wet = 0.25 / (ref / Math.sqrt(1.0 + ref * ref)) * Math.pow(10.0, outDb / 20.0);
    // Fsat: the frequency below which a full-scale sine saturates the core; the corner: the source / magnetising-inductance high-pass
    const fsat = (6.0 + 120.0 * Math.pow(iron, 1.3)) * (1.0 + 0.08 * d);
    const corner = 10.0 + 22.0 * imp;
    this.w0In = TWO_PI * corner; this.w0Out = TWO_PI * corner * 0.7;
    this.coreIn.w0dt = this.w0In / fs; this.coreOut.w0dt = this.w0Out / fs;
    this.coreIn.hc = 0.25 * iron; this.coreOut.hc = 0.25 * iron;
    if (first) {
      this.trim.jump(<f32>t); this.drv.jump(<f32>g); this.wet.jump(<f32>wet); this.mixS.jump(<f32>mix);
      this.fin.jump(<f32>(TWO_PI * fsat)); this.fout.jump(<f32>(TWO_PI * fsat * 0.85));
    } else {
      this.trim.aim(<f32>t); this.drv.aim(<f32>g); this.wet.aim(<f32>wet); this.mixS.aim(<f32>mix);
      this.fin.aim(<f32>(TWO_PI * fsat)); this.fout.aim(<f32>(TWO_PI * fsat * 0.85));
    }
    // bass weight: a bump where the magnetising inductance meets the source, ahead of the core so that the core sees it
    this.bell.setPeaking(fs, 62.0, 0.9, 8.0 * imp * (0.5 + 0.5 * iron));
    // leakage inductance and winding capacitance: a roll-off with a gentle resonance
    const fc = min(4000.0 * Math.pow(6.0, air) * (1.0 - 0.04 * d), fs * 0.45);
    this.lpOut.setLowpass(fs, fc, 0.6 + 0.45 * imp);
    const dl = <f64>this.os.delay(ovs);
    this.delayW = <i32>dl;
    this.delayF = <f32>(dl - <f64>this.delayW);
  }

  /// The gain stage: one oversampled sample in, one out. The soft clip s / sqrt(1 + s^2) is anti-aliased with first-order antiderivative
  /// anti-aliasing (the average of the curve between this sample and the last, from its integral sqrt(1 + s^2)), on top of the oversampling.
  /// ADAA is applied to the part of the curve that is not linear (y - k0 u), so that the small-signal response stays flat: ADAA of the whole curve
  /// would average two samples and roll the top off.
  private stage(z: f32): f32 {
    let u: f64, f: f64, r: f64;
    const dxz = 0.0001;
    if (this.cls == 0) {
      // class A: one device, biased off-centre: an asymmetric curve, even harmonics
      u = <f64>z;
      const b = <f64>this.bias, s = u + b;
      f = sqrt<f64>(1.0 + s * s) - this.yb * u - 0.5 * this.k0 * u * u;
      const dx = u - this.sx;
      if (abs(dx) > dxz) r = (f - this.sf) / dx;
      else { const m = 0.5 * (u + this.sx), sm = m + b; r = sm / sqrt<f64>(1.0 + sm * sm) - this.yb - this.k0 * m; }
    } else {
      // class AB: two devices, each conducting only past a threshold: a smooth dead zone around zero, odd harmonics
      const p = <f64>z - 0.06, n = -<f64>z - 0.06;
      u = 1.15 * (0.5 * (p + sqrt<f64>(p * p + 0.0144)) - 0.5 * (n + sqrt<f64>(n * n + 0.0144)));
      f = sqrt<f64>(1.0 + u * u) - 0.5 * u * u;
      const dx = u - this.sx;
      if (abs(dx) > dxz) r = (f - this.sf) / dx;
      else { const m = 0.5 * (u + this.sx); r = m / sqrt<f64>(1.0 + m * m) - m; }
    }
    this.sx = u; this.sf = f;
    return <f32>((this.cls == 0 ? this.k0 : 1.0) * u + r);
  }

  process(x: f32): f32 {
    this.trim.value += this.trim.step; this.fin.value += this.fin.step; this.fout.value += this.fout.step;
    this.drv.value += this.drv.step; this.wet.value += this.wet.step; this.mixS.value += this.mixS.step;
    const tg = this.trim.value;
    const ai = <f64>this.fin.value, ao = <f64>this.fout.value;
    const dtc = 1.0 / this.fs;
    const ci = this.coreIn, co = this.coreOut;
    ci.dta = dtc * ai; ci.k = this.w0In / ai;
    co.dta = dtc * ao; co.k = this.w0Out / ao;
    this.dn = -this.dn;
    const t = this.bell.next(x * tg + this.dn);
    const v = this.coreIn.tick(<f64>t);
    const w = <f32>v * this.drv.value;
    let s: f32;
    if (this.ovs == 4) {
      this.os.up4(w);
      s = this.os.down4(this.stage(this.os.a), this.stage(this.os.b), this.stage(this.os.c), this.stage(this.os.d));
    } else {
      this.os.up2(w);
      s = this.os.down2(this.stage(this.os.a), this.stage(this.os.b));
    }
    // coupling capacitor, then the output transformer and its roll-off
    const sd = <f64>s;
    const y = sd - this.dcX + this.dcR * this.dcY;
    this.dcX = sd; this.dcY = y;
    const o = this.lpOut.next(<f32>this.coreOut.tick(y));
    const dr = this.dry.tick(x, this.delayW, this.delayF);
    return dr + (o * this.wet.value - dr) * this.mixS.value;
  }
}

@module({
  name: "Preamp",
  category: "Effects/Distortion",
  colour: "#d97706",
  description: "A transformer-coupled preamp: input transformer, gain stage, output transformer. The iron thickens and saturates the bass, and the more you push it the more it does.",
  layout: [
    // the custom UI is the hero; these are the same knobs in tidy rows of equal height (no meters: the picture shows them)
    { row: ["trim", "drive", "iron", "impedance", "air", "age", "output", "mix"] },
    { row: ["cls", "input", "quality"] },
  ],
})
export class Preamp {
  @input({ name: "In L", type: "audio" }) l: f32 = 0;
  @input({ name: "In R", type: "audio" }) r: f32 = 0;
  @output({ name: "Out L", type: "audio" }) outL: f32 = 0;
  @output({ name: "Out R", type: "audio" }) outR: f32 = 0;

  /** The level into the first transformer, before anything else. More level means the iron works harder. */
  @param({ name: "Trim", min: -12, max: 12, init: 0, unit: "dB", decimals: 1, group: "Input" }) trim: f32 = 0;
  /** The gain of the middle stage. The output is level-compensated, so more drive means more colour, not more volume. */
  @param({ name: "Drive", min: 0, max: 100, init: 20, unit: "%", decimals: 0, group: "Input" }) drive: f32 = 20;
  /** How much the transformer cores saturate. At 0 they are nearly linear; at 100 % bass below about 100 Hz compresses and thickens at moderate levels. */
  @param({ name: "Iron", min: 0, max: 100, init: 60, unit: "%", decimals: 0, group: "Iron" }) iron: f32 = 60;
  /** The source impedance: the weight of the bass, the low corner, and a gentle resonance in the top. */
  @param({ name: "Impedance", min: 0, max: 100, init: 40, unit: "%", decimals: 0, group: "Iron" }) impedance: f32 = 40;
  /** The kind of gain stage. Class A is biased off-centre and rich in even harmonics; Class AB has a soft dead zone at the crossing and favours odd harmonics. */
  @param({ name: "Class", choices: ["A", "AB"], group: "Stage" }) cls: i32 = 0;
  /** The high roll-off of the transformers' leakage inductance and winding capacitance. Low is dark, high is open. */
  @param({ name: "Air", min: 0, max: 100, init: 60, unit: "%", decimals: 0, group: "Stage" }) air: f32 = 60;
  /** The output level, after the level compensation. */
  @param({ name: "Output", min: -24, max: 12, init: 0, unit: "dB", decimals: 1, group: "Output" }) output: f32 = 0;
  /** Dry against processed. The dry signal is delayed to stay in phase with the oversampled path. */
  @param({ name: "Mix", min: 0, max: 100, init: 100, unit: "%", decimals: 0, group: "Output" }) mix: f32 = 100;
  /** Slow drift of the gain, bias, core threshold and top end, different on the left and the right. */
  @param({ name: "Age", min: 0, max: 100, init: 25, unit: "%", decimals: 0, group: "Character" }) age: f32 = 25;
  /** Where the right input comes from. Auto uses the left input for both channels when nothing is patched into In R. */
  @param({ name: "Input", choices: ["Auto", "Stereo", "Mono"], group: "Setup" }) input: i32 = 0;
  /** Eco oversamples 2 times, Normal 4 times (less aliasing, a little more processing). */
  @param({ name: "Quality", choices: ["Eco", "Normal"], init: 1, group: "Setup" }) quality: i32 = 1;

  /** How close the transformer cores are to saturation (1 is the knee). */
  @probe core: f32 = 0;
  /** The output level. */
  @probe level: f32 = 0;

  private cl: PreChan;
  private cr: PreChan;
  private sense: InputSense = new InputSense();
  private monoS: Smoother;
  private mode: i32 = 4;
  private peakOut: f32 = 0;
  private started: bool = false;

  constructor(sampleRate: f64) {
    this.cl = new PreChan(sampleRate, 0x9E3779B1);
    this.cr = new PreChan(sampleRate, 0x7F4A7C15);
    this.monoS = new Smoother(sampleRate, 0.005);
  }

  reset(): void { this.cl.reset(); this.cr.reset(); this.sense.reset(); this.peakOut = 0.0; }

  block(): void {
    const q = this.quality == 0 ? 2 : 4;
    if (q != this.mode) { this.mode = q; this.cl.reset(); this.cr.reset(); }
    const iron = <f64>this.iron * 0.01, imp = <f64>this.impedance * 0.01, air = <f64>this.air * 0.01, age = <f64>this.age * 0.01;
    const drive = <f64>this.drive * 0.01, mix = <f64>this.mix * 0.01;
    const first = !this.started;
    if (first) this.monoS.value = this.input == 2 ? 1.0 : 0.0;
    this.cl.setup(first, <f64>this.trim, drive, iron, imp, air, age, <f64>this.output, mix, this.cls, q);
    this.cr.setup(first, <f64>this.trim, drive, iron, imp, air, age, <f64>this.output, mix, this.cls, q);
    this.started = true;
  }

  sample(): void {
    const idle = this.sense.next(this.l, this.r);
    this.monoS.target = this.input == 2 ? 1.0 : (this.input == 1 ? 0.0 : (idle ? 1.0 : 0.0));
    const m = this.monoS.next();
    const r = m > 0.99999 ? this.l : (m < 0.00001 ? this.r : this.r + (this.l - this.r) * m);
    const yl = this.cl.process(this.l);
    const yr = this.cr.process(r);
    this.outL = yl; this.outR = yr;
    const pk = max(abs(yl), abs(yr));
    this.peakOut = pk > this.peakOut ? pk : this.peakOut * 0.99995;
    this.level = this.peakOut;
    const u = max(this.cl.coreIn.util, max(this.cl.coreOut.util, max(this.cr.coreIn.util, this.cr.coreOut.util)));
    this.core = u > 1.5 ? 1.5 : u;
  }
}
