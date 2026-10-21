// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Valve Stage: one to three cascaded tube gain stages (12AX7, 12AU7, or an EL34 pentode power stage), written in Bleep Script.
// Each stage is a small circuit: Miller-capacitance roll-off, a coupling capacitor that grid current charges (blocking), a plate current
// of the form u^1.5 with a soft cutoff, a plate load line that bottoms out, a cathode with a bypass capacitor, and a shared supply that sags.

import { Smoother } from "./bleep/dsp";
import { Xorshift } from "./bleep/random";

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
  private step: f32 = 0;
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

/// One tube stage, in "bias volts": the grid voltage is measured so that the quiescent point is 0 and cutoff is at -1. The plate current is
/// u^1.5 of the soft-rectified grid-to-cathode voltage u; the plate sits on a load line that bottoms out at the supply (a soft or a hard knee).
class Tube {
  vm: f64 = 0;            // the Miller low-pass
  vc: f64 = 0;            // the charge on the coupling capacitor
  cd: f64 = 0;            // the cathode voltage's departure from its quiescent value (its bypass capacitor)
  am: f64 = 0.3;          // Miller low-pass coefficient
  ahp: f64 = 0.001;       // coupling capacitor leak coefficient (the high-pass corner)
  kq: f64 = 0.02;         // how fast grid current charges the coupling capacitor
  ak: f64 = 0.01;         // cathode bypass coefficient
  kap: f64 = 0.0;         // cathode feedback depth
  bb: f64 = 0.0;          // bias offset (plus the plate starvation shift)
  bj: f64 = 0.0;          // random bias flicker (starved plate)
  e: f64 = 0.12;          // softness of the cutoff
  e2: f64 = 0.0144;       // its square
  ns: f64 = 37.0;         // norm * s (halved for the push-pull pentode)
  lam: f64 = 1.0;         // load line: quiescent drop over the supply
  lamS: f64 = 1.0;        // lam over the supply scale
  s: f64 = 1.0;           // supply scale (plate voltage available, sag included)
  sBase: f64 = 1.0;       // the supply scale without the sag
  norm: f64 = 74.0;       // so that the small-signal gain is the tube's
  d0: f64 = 0.5;          // quiescent drop
  i0: f64 = 1.0;          // quiescent current
  gon: f64 = 0.9;         // where the grid starts to conduct
  b1: f64 = 1.0;          // 1 + bb
  att: f64 = 0.1;         // what the stage hands on to the next one
  pent: bool = false;     // push-pull pentode
  grid: f32 = 0;          // grid current activity, for the meter
  reset(): void { this.vm = 0.0; this.vc = 0.0; this.cd = 0.0; this.grid = 0.0; }

  /// Applies the sag factor to the supply.
  sag(f: f64): void {
    this.s = this.sBase * f; this.lamS = this.lam / this.s;
    this.quiescent();
  }

  /// Copies the coefficients (not the state) of another stage.
  copy(o: Tube): void {
    this.am = o.am; this.ahp = o.ahp; this.kq = o.kq; this.ak = o.ak; this.kap = o.kap; this.bb = o.bb; this.e = o.e; this.e2 = o.e2; this.lam = o.lam; this.lamS = o.lamS;
    this.s = o.s; this.sBase = o.sBase; this.norm = o.norm; this.ns = o.ns; this.d0 = o.d0; this.i0 = o.i0; this.gon = o.gon; this.b1 = o.b1; this.att = o.att; this.pent = o.pent;
  }

  /// The quiescent values for the current settings (block rate).
  quiescent(): void {
    this.e2 = this.e * this.e;
    this.b1 = 1.0 + this.bb;
    this.ns = (this.pent ? 0.5 : 1.0) * this.norm * this.s;
    const x = 1.0 + this.bb;
    const u = 0.5 * (x + sqrt<f64>(x * x + this.e * this.e));
    this.i0 = u * sqrt<f64>(u);
    this.d0 = this.drop(this.lamS * this.i0);
  }
  /// The load line: the fraction of the supply dropped across the plate load for a current-scaled value z.
  drop(z: f64): f64 {
    if (this.pent) { const q = z * z; return z / sqrt<f64>(sqrt<f64>(1.0 + q * q)); }
    return z / (1.0 + z);
  }
  /// The static transfer (no dynamics, no cathode feedback, grid clamp as the dynamic one): used at block rate to level-compensate the output.
  curve(v: f64): f64 {
    const ex = v - this.gon;
    const vg = ex > 0.0 ? v - 0.92 * ex * ex / (ex + 0.25) : v;
    const x = vg + 1.0 + this.bb;
    const u = 0.5 * (x + sqrt<f64>(x * x + this.e * this.e));
    const dd = this.drop(this.lamS * u * sqrt<f64>(u));
    if (!this.pent) return this.norm * this.s * (dd - this.d0);
    const x2 = -vg + 1.0 + this.bb;
    const u2 = 0.5 * (x2 + sqrt<f64>(x2 * x2 + this.e * this.e));
    return 0.5 * this.norm * this.s * (dd - this.drop(this.lamS * u2 * sqrt<f64>(u2)));
  }

  /// One (oversampled) sample through the stage.
  run(x: f64): f64 {
    // Miller capacitance: the input node is a low-pass whose corner falls with the stage gain
    const vm = this.vm + this.am * (x - this.vm);
    this.vm = vm;
    // coupling capacitor and grid: the capacitor leaks to the signal's mean (the high-pass); grid current past `gon` charges it (blocking)
    const vc = this.vc;
    const v0 = vm - vc;
    const ex = v0 - this.gon;
    const ig = ex > 0.0 ? ex * ex / (ex + 0.25) : 0.0;
    this.vc = vc + this.ahp * (vm - vc) + this.kq * ig;
    const vg = v0 - 0.92 * ig;
    // cathode: its voltage follows the current through the bypass capacitor; the part the capacitor cannot hold is negative feedback
    const cd = this.cd;
    const xa = vg - this.kap * cd + this.bj + this.b1;
    const ua = 0.5 * (xa + sqrt<f64>(xa * xa + this.e2));
    const ia = ua * sqrt<f64>(ua);
    const za = this.lamS * ia;
    if (!this.pent) {
      this.cd = cd + this.ak * (ia - this.i0 - cd);
      return this.ns * (za / (1.0 + za) - this.d0);
    }
    // push-pull: the other half sees the opposite grid voltage; the plate voltages subtract, so even harmonics cancel
    const xb = -vg - this.kap * cd + this.bj + this.b1;
    const ub = 0.5 * (xb + sqrt<f64>(xb * xb + this.e2));
    const ib = ub * sqrt<f64>(ub);
    const zb = this.lamS * ib;
    const qa = za * za, qb = zb * zb;
    this.cd = cd + this.ak * (0.5 * (ia + ib) - this.i0 - cd);
    return this.ns * (za / sqrt<f64>(sqrt<f64>(1.0 + qa * qa)) - zb / sqrt<f64>(sqrt<f64>(1.0 + qb * qb)));
  }
}

/// One channel: the oversampled cascade and the housekeeping around it.
class ValveChan {
  os: Oversampler = new Oversampler();
  t0: Tube = new Tube();
  t1: Tube = new Tube();
  t2: Tube = new Tube();
  dcX: f64 = 0; dcY: f64 = 0; dcR: f64 = 0.999;
  rng: Xorshift;
  dry: DryDelay = new DryDelay();
  dn: f32 = 1.0e-18;   // a tiny alternating offset keeps the filter states away from denormal numbers
  gIn: f32 = 1; gInStep: f32 = 0; wet: f32 = 1; wetStep: f32 = 0; mix: f32 = 1; mixStep: f32 = 0;
  scratch: StaticArray<f64> = new StaticArray<f64>(16);
  norms: StaticArray<f64> = new StaticArray<f64>(4);
  fs: f64;
  ovs: i32 = 2;
  nst: i32 = 2;
  env: f32 = 0;
  envUp: f32 = 0.002;
  envDown: f32 = 0.0001;
  sagDepth: f32 = 0;
  sagNow: f32 = 0;
  inScale: f64 = 1.0;
  gainDb: f64 = 0;
  delayW: i32 = 0; delayF: f32 = 0;
  fAmp: f32 = 0;
  compNow: f32 = 1;
  gT: f32 = 1; wT: f32 = 1; mT: f32 = 1;
  peak: f32 = 0;

  constructor(sampleRate: f64, salt: u32) {
    this.fs = sampleRate;
    this.dcR = 1.0 - TWO_PI * 6.0 / sampleRate;
    this.rng = new Xorshift(salt);
    this.envUp = <f32>(1.0 - Math.exp(-1.0 / (sampleRate * 0.012)));
    this.envDown = <f32>(1.0 - Math.exp(-1.0 / (sampleRate * 0.18)));
    for (let k = 0; k < 3; k++) this.norms[k] = this.nominalNorm(k);
  }

  /// The gain normalisation of a tube kind, from its nominal circuit.
  private nominalNorm(kind: i32): f64 {
    const t = new Tube();
    let g: f64 = 28.0, lam: f64 = 1.0, e: f64 = 0.12, gon: f64 = 0.9;
    if (kind == 1) { g = 9.0; lam = 0.8; e = 0.22; gon = 1.5; }
    else if (kind == 2) { g = 14.0; lam = 1.2; e = 0.08; gon = 1.3; }
    t.pent = kind == 2; t.lam = lam; t.lamS = lam; t.e = e; t.gon = gon; t.norm = 1.0; t.s = 1.0;
    t.quiescent();
    return g / ((t.curve(0.005) - t.curve(-0.005)) / 0.01);
  }

  reset(): void {
    this.os.reset(); this.t0.reset(); this.t1.reset(); this.t2.reset(); this.dcX = 0.0; this.dcY = 0.0; this.dry.reset();
    this.env = 0.0; this.peak = 0.0;
  }

  /// Configures stage k for the tube type: kind 0 = 12AX7, 1 = 12AU7, 2 = EL34 (push-pull pentode). `rho` is the gain handed on to the next stage.
  private cfg(t: Tube, kind: i32, first: bool, last: bool, bias: f64, starve: f64, bright: f64, supply: f64, rate: f64): void {
    let g: f64, lam: f64, e: f64, gon: f64, rho: f64, miller: f64, kapMax: f64, hp: f64;
    if (kind == 0) { g = 28.0; lam = 1.0; e = 0.12; gon = 0.9; rho = 2.5; miller = 0.12; kapMax = 1.0; hp = 7.0; }
    else if (kind == 1) { g = 9.0; lam = 0.8; e = 0.22; gon = 1.5; rho = 3.0; miller = 0.05; kapMax = 0.8; hp = 6.0; }
    else { g = 14.0; lam = 1.2; e = 0.08; gon = 1.3; rho = 1.0; miller = 0.04; kapMax = 0.5; hp = 10.0; }
    if (first) hp = 2.5;
    // the gain normalisation uses the nominal circuit, so that starving the plate or moving the bias really changes the gain
    t.pent = kind == 2; t.lam = lam; t.lamS = lam; t.e = e; t.bb = 0.0; t.bj = 0.0; t.s = 1.0; t.norm = 1.0; t.gon = gon;
    t.norm = this.norms[kind];
    // now the real settings
    t.bb = 0.8 * bias - 0.95 * starve * sqrt<f64>(starve);
    t.e = e * (1.0 - 0.5 * starve);
    t.s = supply; t.sBase = supply; t.lamS = lam / supply;
    t.quiescent();
    t.att = last ? 0.5 / g : rho / g;
    // the roll-off of the input node falls with the stage gain (the Miller effect); sag lowers the gain and opens it up a little
    const a = g * supply;
    const src = first ? 90000.0 : 60000.0;
    t.am = 1.0 - Math.exp(-TWO_PI * (src / (1.0 + 4.0 * miller * a)) / rate);
    t.ahp = 1.0 - Math.exp(-TWO_PI * hp / rate);
    t.kq = 1.0 - Math.exp(-1.0 / (rate * 0.0004));
    t.ak = 1.0 - Math.exp(-TWO_PI * (12.0 * Math.pow(100.0, bright)) / rate);
    t.kap = kapMax * (0.15 + 0.85 * bright);
  }

  /// Block rate: the circuit for the settings. Returns nothing; call `calibrate` afterwards.
  setup(tube: i32, nst: i32, gain: f64, plate: f64, bias: f64, bright: f64, sag: f64, ovs: i32, envShared: f32): void {
    const rate = this.fs * <f64>ovs;
    this.ovs = ovs;
    this.nst = nst;
    this.sagDepth = <f32>sag;
    const e = envShared * 2.5;
    this.sagNow = (e > 1.0 ? <f32>1.0 : e) * <f32>sag * 0.5;
    const starve = 1.0 - plate;
    const supply = 0.35 + 0.65 * plate;
    this.cfg(this.t0, tube == 2 && nst > 1 ? 0 : tube, true, nst == 1, bias, starve, bright, supply, rate);
    this.cfg(this.t1, tube == 2 && nst > 2 ? 0 : tube, false, nst == 2, bias, starve, bright, supply, rate);
    this.cfg(this.t2, tube, false, true, bias, starve, bright, supply, rate);
    this.inScale = tube == 1 ? 0.55 : (tube == 2 && nst == 1 ? 0.45 : 1.0);
    this.gainDb = -12.0 + 32.0 * gain;
    this.fAmp = <f32>(0.012 * starve * starve * starve);
    this.flicker();
    const dl = <f64>this.os.delay(ovs);
    this.delayW = <i32>dl;
    this.delayF = <f32>(dl - <f64>this.delayW);
  }

  /// Starved-plate crackle: a new random bias offset once per block (about 1.5 kHz).
  private flicker(): void {
    const f = <f64>(this.rng.nextBipolar() * this.fAmp);
    this.t0.bj = f; this.t1.bj = f * 0.8; this.t2.bj = -f * 0.6;
  }

  /// Block rate, after the calibration: the sag lowers the supply (the level compensation is done without it, so that the sag can be heard).
  applySag(): void {
    const f = 1.0 - <f64>this.sagNow;
    this.t0.sag(f); this.t1.sag(f); this.t2.sag(f);
  }

  /// The right channel shares the circuit of the left (the same supply, the same settings): copy its stages' coefficients.
  mirror(o: ValveChan, first: bool): void {
    this.gT = o.gT; this.wT = o.wT; this.mT = o.mT; this.compNow = o.compNow;
    this.ramps(first);
    this.ovs = o.ovs; this.nst = o.nst; this.inScale = o.inScale; this.gainDb = o.gainDb; this.fAmp = o.fAmp; this.sagNow = o.sagNow;
    this.delayW = o.delayW; this.delayF = o.delayF;
    this.t0.copy(o.t0); this.t1.copy(o.t1); this.t2.copy(o.t2);
    this.flicker();
  }

  /// The static response of the cascade to a -12 dBFS sine (the dynamics left out): the gain that brings its level back to the input's.
  calibrate(): f64 {
    const gin = this.inScale * Math.pow(10.0, this.gainDb / 20.0);
    const sc = this.scratch;
    for (let k = 0; k < 7; k++) sc[k] = gin * 0.25 * Math.sin(TWO_PI * <f64>k / 7.0);
    let mean: f64 = 0.0;
    for (let k = 0; k < 7; k++) { sc[k] = this.t0.curve(sc[k]); mean += sc[k]; }
    for (let k = 0; k < 7; k++) sc[k] = (sc[k] - mean / 7.0) * this.t0.att;
    if (this.nst > 1) {
      mean = 0.0;
      for (let k = 0; k < 7; k++) { sc[k] = this.t1.curve(sc[k]); mean += sc[k]; }
      for (let k = 0; k < 7; k++) sc[k] = (sc[k] - mean / 7.0) * this.t1.att;
    }
    if (this.nst > 2) {
      mean = 0.0;
      for (let k = 0; k < 7; k++) { sc[k] = this.t2.curve(sc[k]); mean += sc[k]; }
      for (let k = 0; k < 7; k++) sc[k] = (sc[k] - mean / 7.0) * this.t2.att;
    }
    let ss: f64 = 0.0;
    for (let k = 0; k < 7; k++) ss += sc[k] * sc[k];
    const out = sqrt<f64>(ss / 7.0 + 1.0e-20);
    return min(max(0.25 * 0.70710678 / out, 0.003), 100.0);
  }

  /// Block rate: the gains (call on the left channel; the right takes them over with `mirror`).
  levels(first: bool, comp: f64, outDb: f64, mix: f64): void {
    this.gT = <f32>(this.inScale * Math.pow(10.0, this.gainDb / 20.0));
    this.compNow = <f32>comp;
    this.wT = <f32>(comp * Math.pow(10.0, outDb / 20.0));
    this.mT = <f32>mix;
    this.ramps(first);
  }

  private ramps(first: bool): void {
    if (first) { this.gIn = this.gT; this.wet = this.wT; this.mix = this.mT; this.gInStep = 0.0; this.wetStep = 0.0; this.mixStep = 0.0; }
    else {
      this.gInStep = (this.gT - this.gIn) * (1.0 / 32.0); this.wetStep = (this.wT - this.wet) * (1.0 / 32.0); this.mixStep = (this.mT - this.mix) * (1.0 / 32.0);
    }
  }

  private cascade(v: f32): f32 {
    let y = this.t0.run(<f64>v) * this.t0.att;
    if (this.nst > 1) {
      y = this.t1.run(y) * this.t1.att;
      if (this.nst > 2) y = this.t2.run(y) * this.t2.att;
    }
    return <f32>y;
  }

  process(x: f32): f32 {
    this.gIn += this.gInStep;
    this.dn = -this.dn;
    const w = x * this.gIn + this.dn;
    let y: f32;
    if (this.ovs == 2) {
      this.os.up2(w);
      y = this.os.down2(this.cascade(this.os.a), this.cascade(this.os.b));
    } else {
      y = this.cascade(w);
    }
    // the supply: the louder the output, the further it sags (fast in, slow out)
    const m = abs(y) * this.compNow;
    this.env += (m > this.env ? this.envUp : this.envDown) * (m - this.env);
    const yd = <f64>y;
    const hp = yd - this.dcX + this.dcR * this.dcY;
    this.dcX = yd; this.dcY = hp;
    this.wet += this.wetStep; this.mix += this.mixStep;
    const o = <f32>hp * this.wet;
    const dr = this.dry.tick(x, this.delayW, this.delayF);
    return dr + (o - dr) * this.mix;
  }
}


@module({
  name: "Valve Stage",
  category: "Effects/Distortion",
  colour: "#ea580c",
  description: "One to three cascaded tube stages: plate load, grid-current clipping, Miller roll-off, coupling-capacitor blocking, cathode bypass and a sagging supply. 12AX7, 12AU7 or an EL34 power stage.",
  layout: [
    { row: [
      { title: "Tube", column: ["tube", "stages"] },
      { title: "Drive", column: ["gain", "bias"] },
      { title: "Plate", column: ["plate", "sag"] },
      { title: "Voicing", column: ["bright"] },
      { title: "Output", column: ["output", "mix"] },
    ] },
    { row: [{ title: "Supply", column: [{ meter: "supply" }] }, { title: "Grid", column: [{ meter: "grid" }] }, { title: "Level", column: [{ meter: "level" }] }] },
    { title: "Setup", row: ["input", "quality"] },
  ],
})
export class ValveStage {
  @input({ name: "In L", type: "audio" }) l: f32 = 0;
  @input({ name: "In R", type: "audio" }) r: f32 = 0;
  @output({ name: "Out L", type: "audio" }) outL: f32 = 0;
  @output({ name: "Out R", type: "audio" }) outR: f32 = 0;

  /** The tube. The 12AX7 has a lot of gain and a soft knee, the 12AU7 is lower in gain and cleaner, the EL34 is a push-pull pentode power stage (odd harmonics, hard knee, a lot of sag). With the EL34 the stages before the last are 12AX7 drivers. */
  @param({ name: "Tube", choices: ["12AX7", "12AU7", "EL34"], group: "Tube" }) tube: i32 = 0;
  /** How many stages are cascaded. Each one overdrives the next. */
  @param({ name: "Stages", min: 1, max: 3, init: 2, group: "Tube" }) stages: i32 = 2;
  /** The level into the first grid, from 12 dB below to 20 dB above the input. The output is level-compensated, so more gain means more colour. */
  @param({ name: "Gain", min: 0, max: 100, init: 40, unit: "%", decimals: 0, group: "Drive" }) gain: f32 = 40;
  /** The bias point. Cold sits near cutoff (the negative half is gated, even harmonics, sputter); hot sits near grid current (the positive half bottoms and clips first). */
  @param({ name: "Bias", min: -100, max: 100, init: 0, unit: "%", decimals: 0, group: "Drive" }) bias: f32 = 0;
  /** The plate voltage. Hot is full supply. Starved lowers the supply and moves the stage towards cutoff: less gain, more compression, and at high gain and low levels a gated, sputtering, crackling sound. */
  @param({ name: "Plate", min: 0, max: 100, init: 85, unit: "%", decimals: 0, group: "Plate" }) plate: f32 = 85;
  /** How far the supply sags under a loud signal. The sag lowers the plate voltage, so the gain and the headroom shrink and the stage compresses, then recovers slowly. */
  @param({ name: "Sag", min: 0, max: 100, init: 30, unit: "%", decimals: 0, group: "Plate" }) sag: f32 = 30;
  /** The cathode bypass. At 0 % the bypass capacitor is large and the gain is flat; higher values shrink it, so the bass loses gain to feedback and the top end stays bright. */
  @param({ name: "Bright", min: 0, max: 100, init: 25, unit: "%", decimals: 0, group: "Voicing" }) bright: f32 = 25;
  /** The output level, after the level compensation. */
  @param({ name: "Output", min: -24, max: 12, init: 0, unit: "dB", decimals: 1, group: "Output" }) output: f32 = 0;
  /** Dry against processed. The dry signal is delayed to stay in phase with the oversampled path. */
  @param({ name: "Mix", min: 0, max: 100, init: 100, unit: "%", decimals: 0, group: "Output" }) mix: f32 = 100;
  /** Where the right input comes from. Auto uses the left input for both channels when nothing is patched into In R. */
  @param({ name: "Input", choices: ["Auto", "Stereo", "Mono"], group: "Setup" }) input: i32 = 0;
  /** Eco and Normal oversample the stages (see the manual for the factors). */
  @param({ name: "Quality", choices: ["Eco", "Normal"], init: 1, group: "Setup" }) quality: i32 = 1;

  /** How much of the supply voltage is left (1 is full). It falls when the stage sags. */
  @probe supply: f32 = 1;
  /** Grid current: how hard the signal drives the grid into conduction. */
  @probe grid: f32 = 0;
  /** The output level (a smoothed rectified average, scaled so that a loud signal reads near 1). */
  @probe level: f32 = 0;

  private cl: ValveChan;
  private cr: ValveChan;
  private sense: InputSense = new InputSense();
  private monoS: Smoother;
  private mode: i32 = 2;
  private started: bool = false;

  constructor(sampleRate: f64) {
    this.cl = new ValveChan(sampleRate, 0x2545F491);
    this.cr = new ValveChan(sampleRate, 0x6C078965);
    this.monoS = new Smoother(sampleRate, 0.005);
  }

  reset(): void { this.cl.reset(); this.cr.reset(); this.sense.reset(); }

  block(): void {
    const q = this.quality == 0 ? 1 : 2;
    if (q != this.mode) { this.mode = q; this.cl.reset(); this.cr.reset(); }
    const first = !this.started;
    if (first) this.monoS.value = this.input == 2 ? 1.0 : 0.0;
    const g = <f64>this.gain * 0.01, p = <f64>this.plate * 0.01, b = <f64>this.bias * 0.01, br = <f64>this.bright * 0.01, sg = <f64>this.sag * 0.01;
    this.cl.setup(this.tube, this.stages, g, p, b, br, sg, q, max(this.cl.env, this.cr.env));
    const comp = this.cl.calibrate();
    const mix = <f64>this.mix * 0.01;
    this.cl.levels(first, comp, <f64>this.output, mix);
    this.cl.applySag();
    this.cr.mirror(this.cl, first);
    if (first) { this.cl.reset(); this.cr.reset(); }
    this.started = true;
    this.supply = 1.0 - this.cl.sagNow;
    const lv: f32 = 3.0 * max(this.cl.env, this.cr.env);
    this.level = lv > 2.0 ? <f32>2.0 : lv;
    this.grid = <f32>min(1.0, 0.5 * max(abs(this.cl.t0.vc), max(abs(this.cl.t1.vc), abs(this.cl.t2.vc))));
  }

  sample(): void {
    const idle = this.sense.next(this.l, this.r);
    this.monoS.target = this.input == 2 ? 1.0 : (this.input == 1 ? 0.0 : (idle ? 1.0 : 0.0));
    const m = this.monoS.next();
    const r = m > 0.99999 ? this.l : (m < 0.00001 ? this.r : this.r + (this.l - this.r) * m);
    this.outL = this.cl.process(this.l);
    this.outR = this.cr.process(r);
  }
}
