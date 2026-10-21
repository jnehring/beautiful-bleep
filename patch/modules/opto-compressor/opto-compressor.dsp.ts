// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Opto Compressor: a leveling amplifier. A light-emitting panel and a photocell form the gain-control element: the photocell has a program
// dependent attack and a two-stage release (a fast stage and a slow stage that remembers how long and how hard it was driven), so it levels
// sustained material gently and lets go quickly after a short peak. A valve and transformer style make-up stage adds a little level-dependent colour.
// Written in Bleep Script.

import { Smoother, DcBlocker, PeakHold } from "./bleep/dsp";

const PI: f64 = 3.141592653589793;

// ---- helpers ---------------------------------------------------------------------------------------------------------------------------------

/// A first-order section (transposed direct form II, f64) designed from an analog prototype in sn = s / w0 by the bilinear transform.
class Bq1 {
  private b0: f64 = 1.0; private b1: f64 = 0.0; private a1: f64 = 0.0;
  private z: f64 = 0.0;
  reset(): void { this.z = 0.0; }
  /// A high shelf: 0 dB below, `gainDb` above, midpoint at f: G (sn + 1/sqrt(G)) / (sn + sqrt(G)).
  highShelf(fs: f64, f: f64, gainDb: f64): void {
    const rg = Math.pow(10.0, gainDb / 40.0);
    const kn = 1.0 / Math.tan(PI * min(f, 0.45 * fs) / fs);
    const nb1 = rg * rg, nb0 = rg, na1 = 1.0, na0 = rg;
    const inv = 1.0 / (na1 * kn + na0);
    this.b0 = (nb1 * kn + nb0) * inv;
    this.b1 = (nb0 - nb1 * kn) * inv;
    this.a1 = (na0 - na1 * kn) * inv;
  }
  next(x: f64): f64 {
    const y = this.b0 * x + this.z;
    this.z = this.b1 * x - this.a1 * y;
    return y;
  }
}

/// The input choice: 0 Auto, 1 Stereo, 2 Mono. Auto treats the right input as unpatched while it has been exactly 0 for 2048 samples and the left is not silent.
class InputSel {
  private zeros: i32 = 0;
  private mono: f32 = 0.0;
  private auto: bool = false;
  private coef: f32;
  constructor(sampleRate: f64) { this.coef = <f32>(1.0 - Math.exp(-1.0 / (sampleRate * 0.005))); }
  reset(): void { this.zeros = 0; this.mono = 0.0; this.auto = false; }
  right(l: f32, r: f32, mode: i32): f32 {
    if (r == 0.0) { if (this.zeros < 1000000) this.zeros++; } else { this.zeros = 0; this.auto = false; }
    if (this.zeros >= 2048 && l != 0.0) this.auto = true;
    const target: f32 = mode == 2 ? 1.0 : mode == 1 ? 0.0 : this.auto ? 1.0 : 0.0;
    this.mono += (target - this.mono) * this.coef;
    return r + (l - r) * this.mono;
  }
}

/// The photocell. Its state is the gain reduction in dB, in two parts that both chase the wanted reduction:
///  - the fast part attacks in milliseconds (faster for a bigger step) and lets go in about 60 ms;
///  - the slow part attacks in a second or so and, once it holds a lot of reduction, lets go over several seconds (its release time grows with
///    how much it has charged, which in turn depends on how long and how hard the signal was compressed).
/// The applied reduction is the mean of the two, so a short peak recovers quickly and a long stretch of compression leaves a long, gentle tail.
class Photocell {
  fast: f64 = 0.0;
  slow: f64 = 0.0;
  reset(): void { this.fast = 0.0; this.slow = 0.0; }
  /// target: the reduction the detector asks for (dB); dt: seconds per block; speed: 1 normally, 2 for a faster attack
  step(target: f64, dt: f64, speed: f64): void {
    if (target > this.fast) {
      const tau = max(0.0015, 0.012 / speed / (1.0 + (target - this.fast) / 6.0));
      this.fast += (target - this.fast) * (1.0 - Math.exp(-dt / tau));
    } else {
      const tau = 0.06 * (1.0 + this.fast / 24.0);
      this.fast += (target - this.fast) * (1.0 - Math.exp(-dt / tau));
    }
    if (target > this.slow) {
      const tau = 2.0 / speed / (1.0 + target / 8.0);
      this.slow += (target - this.slow) * (1.0 - Math.exp(-dt / tau));
    } else {
      const tau = 1.0 + 4.5 * min(1.0, this.slow / 12.0);
      this.slow += (target - this.slow) * (1.0 - Math.exp(-dt / tau));
    }
  }
  reduction(): f64 { return 0.5 * (this.fast + this.slow); }
}

/// The make-up stage curve: g(u) = (s(b + u) - s(b)) / s'(b) with the algebraic sigmoid s(x) = x / sqrt(1 + x^2), bias b: unity small-signal gain, a
/// 2nd harmonic that grows with level, bounded. The part beyond the straight line is evaluated with first-order antiderivative anti-aliasing.
const BIAS: f64 = 0.4;

class Makeup {
  private sb: f64 = BIAS / Math.sqrt(1.0 + BIAS * BIAS);
  private isl: f64 = Math.pow(1.0 + BIAS * BIAS, 1.5);
  private u1: f64 = 0.0;
  private f1: f64 = Math.pow(1.0 + BIAS * BIAS, 1.5) * Math.sqrt(1.0 + BIAS * BIAS);
  private dc: DcBlocker;
  private lp: f64 = 0.0;
  private lpk: f64;
  constructor(sampleRate: f64) {
    this.dc = new DcBlocker(sampleRate, 4.0);
    this.lpk = 1.0 - Math.exp(-2.0 * PI * 140.0 / sampleRate);
  }
  reset(): void {
    this.dc.reset(); this.lp = 0.0; this.u1 = 0.0;
    this.f1 = this.isl * Math.sqrt(1.0 + BIAS * BIAS);
  }
  /// k: the drive of the stage (small); returns x with the valve curve and the transformer's low-frequency saturation
  next(x: f32, k: f32): f32 {
    const kd = <f64>k;
    const u = kd * <f64>x;
    const w = BIAS + u;
    const f = this.isl * (Math.sqrt(1.0 + w * w) - this.sb * u) - 0.5 * u * u;
    const du = u - this.u1;
    const um = 0.5 * (u + this.u1);
    const wm = BIAS + um;
    const h = abs(du) < 0.0001 ? this.isl * (wm / Math.sqrt(1.0 + wm * wm) - this.sb) - um : (f - this.f1) / du;
    this.u1 = u; this.f1 = f;
    const v = this.dc.next(<f32>((u + h) / kd));
    // the core saturates on large low-frequency swings: an odd-order term that only the bass below ~140 Hz feels
    const xv = <f64>v;
    this.lp += (xv - this.lp) * this.lpk;
    const l2 = this.lp * this.lp * 0.35;
    return <f32>(xv - this.lp * l2 / (1.0 + l2));
  }
}

/// One channel of the leveler.
class OptoChannel {
  shelf: Bq1 = new Bq1();
  cell: Photocell = new Photocell();
  makeup: Makeup;
  env: f64 = 0.0;
  private ka: f64;
  private kr: f64;
  constructor(sampleRate: f64) {
    this.makeup = new Makeup(sampleRate);
    this.ka = 1.0 - Math.exp(-1.0 / (sampleRate * 0.001));
    this.kr = 1.0 - Math.exp(-1.0 / (sampleRate * 0.03));
  }
  reset(): void { this.shelf.reset(); this.cell.reset(); this.makeup.reset(); this.env = 0.0; }
  /// the electro-luminescent panel follows the (emphasised) sidechain level: quick to light, slower to fade
  detect(s: f32): void {
    const a = abs(this.shelf.next(<f64>s + 1.0e-18));
    this.env += (a - this.env) * (a > this.env ? this.ka : this.kr);
  }
}

/// The reduction a level asks for: a soft knee of width `knee` around 0 dB (all in dB), slope 1 - 1/ratio above.
function wanted(over: f64, knee: f64, ratio: f64): f64 {
  let e = 0.0;
  if (over >= 0.5 * knee) e = over;
  else if (over > -0.5 * knee) e = (over + 0.5 * knee) * (over + 0.5 * knee) / (2.0 * knee);
  return min(40.0, e * (1.0 - 1.0 / ratio));
}

/**
 * A leveling amplifier built around a light panel and a photocell. Peak Reduction sets how hard the detector is driven; the photocell
 * reacts quickly to a new loud passage, then keeps creeping down, and lets go in two stages: quickly after a short peak, over seconds
 * after long compression. Gain makes up the level through a valve and transformer style stage with a little saturation.
 */
@module({
  name: "Opto Compressor",
  category: "Effects/Dynamics & EQ",
  colour: "#0ea5e9",
  description: "Optical leveling amplifier: program-dependent attack, two-stage photocell release with memory, HF emphasis, valve/transformer make-up, stereo link and an external sidechain.",
  layout: [
    { row: [{ select: "mode" }, { select: "sidechain" }, { select: "input" }] },
    { row: [
      { title: "Level", row: ["peakReduction", "gain"] },
      { title: "Detector", row: ["emphasis", "link"] },
      { title: "Output", row: ["mix"] },
    ] },
  ],
})
export class OptoCompressor {
  /** Left input. */
  @input({ name: "In L", type: "audio" }) l: f32 = 0;
  /** Right input; in Auto mode the left signal is used when nothing is patched here. */
  @input({ name: "In R", type: "audio" }) r: f32 = 0;
  /** External sidechain: when Sidechain is set to External the detector listens to this input instead of the signal. */
  @input({ name: "Sidechain", type: "audio" }) key: f32 = 0;
  @output({ name: "Out L", type: "audio" }) outL: f32 = 0;
  @output({ name: "Out R", type: "audio" }) outR: f32 = 0;
  /** The gain reduction as a control signal, 0 (none) to 1 (24 dB or more). */
  @output({ name: "Reduction", type: "control", bipolar: false }) reduction: f32 = 0;

  /** How hard the detector is driven, 0 to 100: the compression amount. Higher settings start compressing at lower levels. */
  @param({ name: "Peak Reduction", min: 0, max: 100, init: 40, decimals: 1, group: "Level" }) peakReduction: f32 = 40;
  /** Make-up gain after the photocell, through the valve and transformer style stage. More gain brings more colour. */
  @param({ name: "Gain", min: -12, max: 30, init: 3, unit: "dB", decimals: 1, group: "Level" }) gain: f32 = 3;
  /** Compress: ratio about 3:1 with a wide soft knee, gentle. Limit: ratio about 10:1, a tighter knee and a faster attack. */
  @param({ name: "Mode", choices: ["Compress", "Limit"], group: "Level" }) mode: i32 = 0;
  /** A high shelf in the detector only: more emphasis makes bright sounds compress harder (the audio path is not filtered). 0 to 12 dB. */
  @param({ name: "HF Emphasis", min: 0, max: 12, init: 0, unit: "dB", decimals: 1, group: "Detector" }) emphasis: f32 = 0;
  /** Blend of dry and compressed signal (parallel compression). */
  @param({ name: "Mix", min: 0, max: 100, init: 100, unit: "%", decimals: 0, group: "Output" }) mix: f32 = 100;
  /** How much the two channels follow the louder one: 100 % is fully linked (the stereo image stays put), 0 % independent. */
  @param({ name: "Link", min: 0, max: 100, init: 100, unit: "%", decimals: 0, group: "Detector" }) link: f32 = 100;
  /** Internal: the detector listens to the signal. External: it listens to the Sidechain input. */
  @param({ name: "Sidechain", choices: ["Internal", "External"], group: "Setup" }) sidechain: i32 = 0;
  /** Auto uses the left input for both channels while nothing is patched to the right one; Stereo uses both; Mono feeds the left signal to both. */
  @param({ name: "Input", choices: ["Auto", "Stereo", "Mono"], group: "Setup" }) input: i32 = 0;

  /** The gain reduction in dB (the larger of the two channels). */
  @probe({ name: "Gain Reduction" }) gr: f32 = 0;
  /** The charge of the slow photocell stage in dB: how much long compression will linger in the release. */
  @probe({ name: "Charge" }) charge: f32 = 0;
  /** The fast photocell stage in dB: the quick part of the reduction (the slow part is the Charge). */
  @probe({ name: "Fast Stage" }) fast: f32 = 0;

  private sampleRate: f64;
  private chL: OptoChannel;
  private chR: OptoChannel;
  private sel: InputSel;
  private gL: Smoother;
  private gR: Smoother;
  private mk: Smoother;
  private mx: Smoother;
  private kd: Smoother;
  private grOut: Smoother;
  private meter: PeakHold;
  private started: bool = false;
  private lastEmphasis: f64 = -1.0;

  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    this.chL = new OptoChannel(sampleRate);
    this.chR = new OptoChannel(sampleRate);
    this.sel = new InputSel(sampleRate);
    this.gL = new Smoother(sampleRate, 0.0004);
    this.gR = new Smoother(sampleRate, 0.0004);
    this.mk = new Smoother(sampleRate, 0.02);
    this.mx = new Smoother(sampleRate, 0.02);
    this.kd = new Smoother(sampleRate, 0.02);
    this.grOut = new Smoother(sampleRate, 0.002);
    this.meter = new PeakHold(sampleRate, 0.3);
    this.gL.target = 1.0; this.gL.snap(); this.gR.target = 1.0; this.gR.snap();
  }

  reset(): void {
    this.chL.reset(); this.chR.reset(); this.sel.reset(); this.meter.reset();
    this.started = false; this.lastEmphasis = -1.0;
  }

  block(): void {
    const first = !this.started;
    const dt = 32.0 / this.sampleRate;
    if (<f64>this.emphasis != this.lastEmphasis) {
      this.lastEmphasis = <f64>this.emphasis;
      this.chL.shelf.highShelf(this.sampleRate, 1800.0, this.lastEmphasis);
      this.chR.shelf.highShelf(this.sampleRate, 1800.0, this.lastEmphasis);
    }
    // detector levels in dB, the stereo link and the drive of the detector
    const eL = this.chL.env, eR = this.chR.env;
    const lk = <f64>this.link * 0.01;
    const em = max(eL, eR);
    const lvL = (1.0 - lk) * eL + lk * em, lvR = (1.0 - lk) * eR + lk * em;
    const drive = 0.4 * <f64>this.peakReduction;                       // dB the detector is turned up: 0 to 40
    const limit = this.mode == 1;
    const knee = limit ? 6.0 : 14.0, ratio = limit ? 10.0 : 3.0, speed = limit ? 2.0 : 1.0;
    const dbL = 20.0 * Math.log10(max(lvL, 1.0e-6)) + drive;
    const dbR = 20.0 * Math.log10(max(lvR, 1.0e-6)) + drive;
    this.chL.cell.step(wanted(dbL, knee, ratio), dt, speed);
    this.chR.cell.step(wanted(dbR, knee, ratio), dt, speed);
    const redL = this.chL.cell.reduction(), redR = this.chR.cell.reduction();
    this.gL.target = <f32>Math.pow(10.0, -redL / 20.0);
    this.gR.target = <f32>Math.pow(10.0, -redR / 20.0);
    const worst = max(redL, redR);
    this.grOut.target = <f32>min(worst / 24.0, 1.0);
    this.gr = <f32>worst;
    this.charge = <f32>max(this.chL.cell.slow, this.chR.cell.slow);
    this.fast = <f32>max(this.chL.cell.fast, this.chR.cell.fast);

    const gdb = <f64>this.gain;
    this.mk.target = <f32>Math.pow(10.0, gdb / 20.0);
    this.kd.target = <f32>(0.12 + 0.012 * max(gdb, 0.0));            // the make-up stage works harder the more gain it makes up
    this.mx.target = <f32>(<f64>this.mix * 0.01);
    if (first) {
      this.gL.snap(); this.gR.snap(); this.mk.snap(); this.kd.snap(); this.mx.snap(); this.grOut.snap();
      this.started = true;
    }
  }

  sample(): void {
    const l = this.l;
    const r = this.sel.right(l, this.r, this.input);
    const ext = this.sidechain == 1;
    this.chL.detect(ext ? this.key : l);
    this.chR.detect(ext ? this.key : r);
    const mk = this.mk.next(), k = this.kd.next(), mx = this.mx.next();
    const wl = this.chL.makeup.next(l * this.gL.next() * mk, k);
    const wr = this.chR.makeup.next(r * this.gR.next() * mk, k);
    this.outL = l + (wl - l) * mx;
    this.outR = r + (wr - r) * mx;
    this.reduction = this.grOut.next();
    this.meter.next(max(abs(this.outL), abs(this.outR)));
  }
}
