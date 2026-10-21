// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Channel Strip: a console channel in one module, written in Bleep Script. A high-pass filter, an input transformer (core saturation), a four-band
// equaliser with switchable centre frequencies and proportional Q, and a drive stage with three characters (warm iron, punchy op-amp, clean).
// The equaliser and the drive stage can swap places: boosts that run into the saturator drive it harder, so the colour follows the equaliser.

import { Smoother } from "./bleep/dsp";

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

/// 2x oversampling around a shaper: up(x), shape a and b, down.
class Oversampler {
  a: f32 = 0; b: f32 = 0;
  private h1: HalfBandSteep = new HalfBandSteep();
  reset(): void { this.h1.reset(); }
  up2(x: f32): void { this.h1.upS(x); this.a = this.h1.a; this.b = this.h1.b; }
  down2(a: f32, b: f32): f32 { return this.h1.downS(a, b); }
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

const LF_HZ: StaticArray<f64> = [35.0, 60.0, 100.0, 200.0];
const LM_HZ: StaticArray<f64> = [250.0, 500.0, 1000.0, 2000.0];
const HM_HZ: StaticArray<f64> = [1500.0, 3000.0, 5000.0, 8000.0];
const HF_HZ: StaticArray<f64> = [5000.0, 8000.0, 10000.0, 12000.0];
const HPF_HZ: StaticArray<f64> = [0.0, 30.0, 50.0, 80.0, 120.0];

/// Biquad coefficients (normalised, transposed direct form II), computed once per block and handed to both channels.
class Coef {
  b0: f64 = 1; b1: f64 = 0; b2: f64 = 0; a1: f64 = 0; a2: f64 = 0;
  ident(): void { this.b0 = 1.0; this.b1 = 0.0; this.b2 = 0.0; this.a1 = 0.0; this.a2 = 0.0; }
  private put(b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64): void {
    const r = 1.0 / a0;
    this.b0 = b0 * r; this.b1 = b1 * r; this.b2 = b2 * r; this.a1 = a1 * r; this.a2 = a2 * r;
  }
  /// A bell (RBJ), \`q\` wide.
  peak(fs: f64, f: f64, q: f64, gdb: f64): void {
    const A = Math.pow(10.0, gdb / 40.0), w = TWO_PI * min(f, fs * 0.45) / fs, cs = Math.cos(w), al = Math.sin(w) / (2.0 * q);
    this.put(1.0 + al * A, -2.0 * cs, 1.0 - al * A, 1.0 + al / A, -2.0 * cs, 1.0 - al / A);
  }
  /// A low shelf with a Q (RBJ): the shelf overshoots more as Q rises.
  lowShelf(fs: f64, f: f64, q: f64, gdb: f64): void {
    const A = Math.pow(10.0, gdb / 40.0), w = TWO_PI * min(f, fs * 0.45) / fs, cs = Math.cos(w), r = 2.0 * Math.sqrt(A) * Math.sin(w) / (2.0 * q);
    this.put(A * ((A + 1.0) - (A - 1.0) * cs + r), 2.0 * A * ((A - 1.0) - (A + 1.0) * cs), A * ((A + 1.0) - (A - 1.0) * cs - r),
      (A + 1.0) + (A - 1.0) * cs + r, -2.0 * ((A - 1.0) + (A + 1.0) * cs), (A + 1.0) + (A - 1.0) * cs - r);
  }
  highShelf(fs: f64, f: f64, q: f64, gdb: f64): void {
    const A = Math.pow(10.0, gdb / 40.0), w = TWO_PI * min(f, fs * 0.45) / fs, cs = Math.cos(w), r = 2.0 * Math.sqrt(A) * Math.sin(w) / (2.0 * q);
    this.put(A * ((A + 1.0) + (A - 1.0) * cs + r), -2.0 * A * ((A - 1.0) + (A + 1.0) * cs), A * ((A + 1.0) + (A - 1.0) * cs - r),
      (A + 1.0) - (A - 1.0) * cs + r, 2.0 * ((A - 1.0) - (A + 1.0) * cs), (A + 1.0) - (A - 1.0) * cs - r);
  }
  /// A second-order high-pass.
  hp2(fs: f64, f: f64, q: f64): void {
    const w = TWO_PI * min(f, fs * 0.45) / fs, cs = Math.cos(w), al = Math.sin(w) / (2.0 * q);
    this.put((1.0 + cs) * 0.5, -(1.0 + cs), (1.0 + cs) * 0.5, 1.0 + al, -2.0 * cs, 1.0 - al);
  }
  /// A first-order high-pass (bilinear).
  hp1(fs: f64, f: f64): void {
    const t = Math.tan(Math.PI * min(f, fs * 0.45) / fs);
    this.put(1.0, -1.0, 0.0, 1.0 + t, t - 1.0, 0.0);
  }
}

/// A biquad section with its own state.
class Bq {
  private b0: f64 = 1; private b1: f64 = 0; private b2: f64 = 0; private a1: f64 = 0; private a2: f64 = 0;
  private z1: f64 = 0; private z2: f64 = 0;
  reset(): void { this.z1 = 0.0; this.z2 = 0.0; }
  take(c: Coef): void { this.b0 = c.b0; this.b1 = c.b1; this.b2 = c.b2; this.a1 = c.a1; this.a2 = c.a2; }
  run(x: f64): f64 {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/// One channel of the strip.
class StripChan {
  hp1: Bq = new Bq(); hp2: Bq = new Bq();
  eq0: Bq = new Bq(); eq1: Bq = new Bq(); eq2: Bq = new Bq(); eq3: Bq = new Bq();
  core: Core = new Core();
  os: Oversampler = new Oversampler();
  fs: f64;
  // ADAA state of the drive stage, DC blocker, punch envelopes, denormal guard
  sx: f64 = 0; sf: f64 = 1; cc: f64 = 1; k0: f64 = 1; yb: f64 = 0;
  dcX: f64 = 0; dcY: f64 = 0; dcR: f64 = 0.999;
  envF: f32 = 0; envS: f32 = 0; aF: f32 = 0.05; aS: f32 = 0.001;
  dn: f64 = 1.0e-18;
  // settings (block rate)
  order: i32 = 0; chr: i32 = 0; ovs: i32 = 2; punch: f32 = 0; bias: f64 = 0;
  gX: f32 = 1; gXStep: f32 = 0; gD: f32 = 1; gDStep: f32 = 0; gO: f32 = 1; gOStep: f32 = 0;
  w0: f64 = 100; dtTwoPi: f64 = 0.0001;
  fin: f32 = 0; finStep: f32 = 0;
  satNow: f32 = 0;
  inPeak: f32 = 0; outPeak: f32 = 0;

  constructor(sampleRate: f64) {
    this.fs = sampleRate;
    this.dtTwoPi = TWO_PI / sampleRate;
    this.core.setRate(sampleRate);
    this.dcR = 1.0 - TWO_PI * 5.0 / sampleRate;
    this.aF = <f32>(1.0 - Math.exp(-1.0 / (sampleRate * 0.0004)));
    this.aS = <f32>(1.0 - Math.exp(-1.0 / (sampleRate * 0.025)));
  }

  reset(): void {
    this.hp1.reset(); this.hp2.reset(); this.eq0.reset(); this.eq1.reset(); this.eq2.reset(); this.eq3.reset();
    this.core.reset(); this.os.reset();
    this.sx = 0.0; this.sf = this.cc * this.cc * Math.sqrt(1.0 + this.bias * this.bias / (this.cc * this.cc));
    this.dcX = 0.0; this.dcY = 0.0; this.envF = 0.0; this.envS = 0.0; this.inPeak = 0.0; this.outPeak = 0.0;
  }

  /// The drive stage's curve for one (oversampled) sample. Warm and Clean are sigmoids y = s / sqrt(1 + (s / c)^2) (c = 1 with a bias for Warm, c = 3
  /// for Clean). Anti-aliasing: first-order antiderivative anti-aliasing (ADAA) on the part of the curve that is not linear, y - k0 z, so that the
  /// small-signal response stays flat (ADAA of the whole curve averages two samples and rolls the top off). Punchy is a tighter, symmetric knee
  /// z / (1 + z^4)^(1/4), which relies on the oversampling.
  private shape(z: f32): f32 {
    if (this.chr == 1) {
      const q = z * z;
      return z / sqrt<f32>(sqrt<f32>(1.0 + q * q));
    }
    const zd = <f64>z, c2 = this.cc * this.cc;
    const s = zd + this.bias;
    // F is the integral of the non-linear remainder r(z) = y(z) - k0 z
    const f = c2 * sqrt<f64>(1.0 + s * s / c2) - this.yb * zd - 0.5 * this.k0 * zd * zd;
    const dx = zd - this.sx;
    let r: f64;
    if (abs(dx) > 0.0001) r = (f - this.sf) / dx;
    else { const m = 0.5 * (zd + this.sx), sm = m + this.bias; r = sm / sqrt<f64>(1.0 + sm * sm / c2) - this.yb - this.k0 * m; }
    this.sx = zd; this.sf = f;
    return <f32>(this.k0 * zd + r);
  }

  process(x: f32): f32 {
    this.dn = -this.dn;
    // high-pass
    let v = this.hp2.run(this.hp1.run(<f64>x + this.dn));
    // input transformer: the core sees the signal raised by gX and the result is brought back
    this.gX += this.gXStep;
    const gx = <f64>this.gX;
    this.fin += this.finStep;
    const fin = <f64>this.fin;
    this.core.dta = this.dtTwoPi * fin; this.core.k = this.w0 / (TWO_PI * fin);
    v = this.core.tick(v * gx) / gx;
    // equaliser and drive stage in the chosen order
    if (this.order == 0) {
      v = this.eq3.run(this.eq2.run(this.eq1.run(this.eq0.run(v))));
      v = this.drive(v);
    } else {
      v = this.drive(v);
      v = this.eq3.run(this.eq2.run(this.eq1.run(this.eq0.run(v))));
    }
    this.gO += this.gOStep;
    return <f32>v * this.gO;
  }

  private drive(v: f64): f64 {
    const vf = <f32>v;
    const a = abs(vf);
    let boost: f32 = 1.0;
    if (this.chr == 1) {
      // punch: a fast envelope against a slow one lifts the attack of a hit, after the knee
      this.envF += this.aF * (a - this.envF);
      this.envS += this.aS * (a - this.envS);
      const e = this.envF / (this.envS + 0.0001) - 1.0;
      boost = 1.0 + this.punch * (e < 0.0 ? <f32>0.0 : (e > 2.0 ? <f32>2.0 : e));
    }
    this.gD += this.gDStep;
    const z = vf * this.gD;
    let y: f32;
    if (this.ovs == 2) {
      this.os.up2(z);
      y = this.os.down2(this.shape(this.os.a), this.shape(this.os.b));
    } else {
      y = this.shape(z);
    }
    y = y * boost;
    if (a > this.inPeak) this.inPeak = a;
    const ay = abs(y);
    if (ay > this.outPeak) this.outPeak = ay;
    // the DC an asymmetric curve leaves behind
    const yd = <f64>y;
    const o = yd - this.dcX + this.dcR * this.dcY;
    this.dcX = yd; this.dcY = o;
    return o;
  }
}

@module({
  name: "Channel Strip",
  category: "Effects/Dynamics & EQ",
  colour: "#0284c7",
  description: "A console channel in one module: high-pass filter, input transformer, four-band equaliser with switchable frequencies and proportional Q, and a drive stage that can be warm, punchy or clean. The equaliser can sit before or after the saturation, so the colour follows the equaliser.",
  layout: [
    { row: ["iron", "drive", "lfGain", "lmGain", "hmGain", "hfGain", "output"] },
    { row: ["hpf", "hpfSlope", "character", "order", "eqOn"] },
    { row: ["lfFreq", "lmFreq", "hmFreq", "hfFreq", "input", "quality"] },
  ],
})
export class ChannelStrip {
  @input({ name: "In L", type: "audio" }) l: f32 = 0;
  @input({ name: "In R", type: "audio" }) r: f32 = 0;
  @output({ name: "Out L", type: "audio" }) outL: f32 = 0;
  @output({ name: "Out R", type: "audio" }) outR: f32 = 0;

  /** The corner of the high-pass filter. Off passes everything down to DC. */
  @param({ name: "HPF", choices: ["Off", "30 Hz", "50 Hz", "80 Hz", "120 Hz"], group: "Filter" }) hpf: i32 = 0;
  /** The slope of the high-pass filter. */
  @param({ name: "HPF Slope", choices: ["12 dB/oct", "18 dB/oct"], group: "Filter" }) hpfSlope: i32 = 0;
  /** The input transformer. The more of it, the lower the level at which the bass starts to saturate (with a little hysteresis). */
  @param({ name: "Transformer", min: 0, max: 100, init: 35, unit: "%", decimals: 0, group: "Transformer" }) iron: f32 = 35;
  /** How hard the drive stage is pushed (up to 24 dB). The output is level-compensated, so more drive means more colour, not more volume. */
  @param({ name: "Drive", min: 0, max: 100, init: 25, unit: "%", decimals: 0, group: "Drive" }) drive: f32 = 25;
  /** The kind of saturation. Warm is round and rich in even harmonics (iron); Punchy is tighter, odd, and lifts the attack of hits before the knee (op-amp); Clean is tight and subtle. */
  @param({ name: "Character", choices: ["Warm", "Punchy", "Clean"], group: "Drive" }) character: i32 = 0;
  /** Whether the equaliser comes before or after the drive stage. Before: a boost runs into the saturator and drives it harder, so the colour follows the equaliser. */
  @param({ name: "Stage Order", choices: ["EQ, then Drive", "Drive, then EQ"], group: "Drive" }) order: i32 = 0;
  /** Switches the four equaliser bands on or off together. */
  @param({ name: "EQ On", group: "EQ" }) eqOn: bool = true;
  /** The low shelf. The shelf overshoots a little more as the gain grows, as on an analogue console. */
  @param({ name: "LF Gain", min: -15, max: 15, init: 0, unit: "dB", decimals: 1, group: "LF" }) lfGain: f32 = 0;
  /** The corner of the low shelf. */
  @param({ name: "LF Freq", choices: ["35 Hz", "60 Hz", "100 Hz", "200 Hz"], init: 2, group: "LF" }) lfFreq: i32 = 2;
  /** The low-mid bell. It narrows as the gain grows (proportional Q). */
  @param({ name: "LMF Gain", min: -15, max: 15, init: 0, unit: "dB", decimals: 1, group: "LMF" }) lmGain: f32 = 0;
  /** The centre of the low-mid bell. */
  @param({ name: "LMF Freq", choices: ["250 Hz", "500 Hz", "1 kHz", "2 kHz"], init: 1, group: "LMF" }) lmFreq: i32 = 1;
  /** The high-mid bell. It narrows as the gain grows (proportional Q). */
  @param({ name: "HMF Gain", min: -15, max: 15, init: 0, unit: "dB", decimals: 1, group: "HMF" }) hmGain: f32 = 0;
  /** The centre of the high-mid bell. */
  @param({ name: "HMF Freq", choices: ["1.5 kHz", "3 kHz", "5 kHz", "8 kHz"], init: 1, group: "HMF" }) hmFreq: i32 = 1;
  /** The high shelf. */
  @param({ name: "HF Gain", min: -15, max: 15, init: 0, unit: "dB", decimals: 1, group: "HF" }) hfGain: f32 = 0;
  /** The corner of the high shelf. */
  @param({ name: "HF Freq", choices: ["5 kHz", "8 kHz", "10 kHz", "12 kHz"], init: 1, group: "HF" }) hfFreq: i32 = 1;
  /** The output level, after the level compensation of the drive stage. */
  @param({ name: "Output", min: -24, max: 12, init: 0, unit: "dB", decimals: 1, group: "Output" }) output: f32 = 0;
  /** Where the right input comes from. Auto uses the left input for both channels when nothing is patched into In R. */
  @param({ name: "Input", choices: ["Auto", "Stereo", "Mono"], group: "Setup" }) input: i32 = 0;
  /** Eco runs the drive stage at the base rate with anti-aliasing; Normal oversamples it 2 times. */
  @param({ name: "Quality", choices: ["Eco", "Normal"], init: 1, group: "Setup" }) quality: i32 = 1;

  /** How far the drive stage bends the signal: 0 is linear, 1 is fully squashed. */
  @probe saturation: f32 = 0;
  /** The output level. */
  @probe level: f32 = 0;

  private cl: StripChan;
  private cr: StripChan;
  private sense: InputSense = new InputSense();
  private monoS: Smoother;
  private fs: f64;
  private coef: Coef = new Coef();
  private g0: f64 = 0; private g1: f64 = 0; private g2: f64 = 0; private g3: f64 = 0;
  private mode: i32 = 2;
  private started: bool = false;
  private peakOut: f32 = 0;

  constructor(sampleRate: f64) {
    this.fs = sampleRate;
    this.cl = new StripChan(sampleRate);
    this.cr = new StripChan(sampleRate);
    this.monoS = new Smoother(sampleRate, 0.005);
  }

  reset(): void { this.cl.reset(); this.cr.reset(); this.sense.reset(); this.peakOut = 0.0; }

  /// Block rate: the filters, the equaliser (gains eased towards their targets) and the drive stage.
  block(): void {
    const fs = this.fs;
    const first = !this.started;
    if (first) this.monoS.value = this.input == 2 ? 1.0 : 0.0;
    const ovs = this.quality == 0 ? 1 : 2;
    if (ovs != this.mode) { this.mode = ovs; this.cl.reset(); this.cr.reset(); }
    const cl = this.cl, cr = this.cr;
    // high-pass: 12 dB/oct is one biquad, 18 dB/oct a first-order section and a biquad with Q 1
    const c = this.coef;
    if (this.hpf == 0) { c.ident(); cl.hp1.take(c); cr.hp1.take(c); cl.hp2.take(c); cr.hp2.take(c); }
    else {
      const f = HPF_HZ[this.hpf];
      if (this.hpfSlope == 0) { c.ident(); cl.hp1.take(c); cr.hp1.take(c); c.hp2(fs, f, 0.70710678); }
      else { c.hp1(fs, f); cl.hp1.take(c); cr.hp1.take(c); c.hp2(fs, f, 1.0); }
      cl.hp2.take(c); cr.hp2.take(c);
    }
    // equaliser: the gains glide towards their targets (about 10 ms), the Q follows the gain
    const on: f64 = this.eqOn ? 1.0 : 0.0;
    if (first) { this.g0 = <f64>this.lfGain * on; this.g1 = <f64>this.lmGain * on; this.g2 = <f64>this.hmGain * on; this.g3 = <f64>this.hfGain * on; }
    else {
      this.g0 += (<f64>this.lfGain * on - this.g0) * 0.3; this.g1 += (<f64>this.lmGain * on - this.g1) * 0.3;
      this.g2 += (<f64>this.hmGain * on - this.g2) * 0.3; this.g3 += (<f64>this.hfGain * on - this.g3) * 0.3;
    }
    const k = 1.0 / 15.0;
    const a0 = abs(this.g0), a1 = abs(this.g1), a2 = abs(this.g2), a3 = abs(this.g3);
    if (a0 < 0.005) c.ident(); else c.lowShelf(fs, LF_HZ[this.lfFreq], 0.55 + 0.45 * min(a0 * k, 1.0), this.g0);
    cl.eq0.take(c); cr.eq0.take(c);
    if (a1 < 0.005) c.ident(); else c.peak(fs, LM_HZ[this.lmFreq], 0.55 + 1.35 * min(a1 * k, 1.0), this.g1);
    cl.eq1.take(c); cr.eq1.take(c);
    if (a2 < 0.005) c.ident(); else c.peak(fs, HM_HZ[this.hmFreq], 0.55 + 1.35 * min(a2 * k, 1.0), this.g2);
    cl.eq2.take(c); cr.eq2.take(c);
    if (a3 < 0.005) c.ident(); else c.highShelf(fs, HF_HZ[this.hfFreq], 0.55 + 0.45 * min(a3 * k, 1.0), this.g3);
    cl.eq3.take(c); cr.eq3.take(c);
    // transformer and drive stage
    const iron = <f64>this.iron * 0.01, drv = <f64>this.drive * 0.01;
    const gX = <f32>(1.0 + 3.0 * drv);
    const g = Math.pow(10.0, 24.0 * drv / 20.0);
    const fsat = <f32>(8.0 + 90.0 * Math.pow(iron, 1.3));
    const w0 = TWO_PI * (4.0 + 14.0 * iron);
    // level compensation: a -12 dBFS sine through the drive stage keeps its level (peak of the static curve)
    const a = 0.25 * g;
    let shaped: f64;
    if (this.character == 1) shaped = a / sqrt<f64>(sqrt<f64>(1.0 + a * a * a * a));
    else if (this.character == 0) shaped = a / sqrt<f64>(1.0 + a * a);
    else shaped = a / sqrt<f64>(1.0 + a * a / 9.0);
    const gO = <f32>(0.25 / shaped * Math.pow(10.0, <f64>this.output / 20.0));
    const gD = <f32>g;
    const punch = <f32>(0.4);
    this.setChan(cl, first, gX, gD, gO, fsat, w0, iron, punch, ovs);
    this.setChan(cr, first, gX, gD, gO, fsat, w0, iron, punch, ovs);
    this.started = true;
    this.saturation = <f32>(1.0 - min(1.0, cl.outPeak / (cl.inPeak * <f32>g + 0.000001))) * 1.0;
    cl.inPeak = cl.inPeak * 0.9; cl.outPeak = cl.outPeak * 0.9;
  }

  private setChan(ch: StripChan, first: bool, gX: f32, gD: f32, gO: f32, fsat: f32, w0: f64, iron: f64, punch: f32, ovs: i32): void {
    ch.order = this.order; ch.chr = this.character; ch.ovs = ovs; ch.punch = punch;
    if (this.character == 0) { ch.bias = 0.3; ch.cc = 1.0; } else { ch.bias = 0.0; ch.cc = 3.0; }
    ch.yb = ch.bias / sqrt<f64>(1.0 + ch.bias * ch.bias / (ch.cc * ch.cc));
    ch.k0 = 1.0 / ((1.0 + ch.bias * ch.bias / (ch.cc * ch.cc)) * sqrt<f64>(1.0 + ch.bias * ch.bias / (ch.cc * ch.cc)));
    ch.w0 = w0; ch.core.w0dt = w0 / this.fs; ch.core.hc = 0.2 * iron;
    if (first) {
      ch.gX = gX; ch.gXStep = 0.0; ch.gD = gD; ch.gDStep = 0.0; ch.gO = gO; ch.gOStep = 0.0; ch.fin = fsat; ch.finStep = 0.0;
      ch.reset();
    } else {
      ch.gXStep = (gX - ch.gX) * (1.0 / 32.0); ch.gDStep = (gD - ch.gD) * (1.0 / 32.0); ch.gOStep = (gO - ch.gO) * (1.0 / 32.0); ch.finStep = (fsat - ch.fin) * (1.0 / 32.0);
    }
  }

  sample(): void {
    const idle = this.sense.next(this.l, this.r);
    this.monoS.target = this.input == 2 ? 1.0 : (this.input == 1 ? 0.0 : (idle ? 1.0 : 0.0));
    const m = this.monoS.next();
    const r = m > 0.99999 ? this.l : (m < 0.00001 ? this.r : this.r + (this.l - this.r) * m);
    this.outL = this.cl.process(this.l);
    this.outR = this.cr.process(r);
    const pk = max(abs(this.outL), abs(this.outR));
    this.peakOut = pk > this.peakOut ? pk : this.peakOut * 0.99995;
    this.level = this.peakOut;
  }
}
