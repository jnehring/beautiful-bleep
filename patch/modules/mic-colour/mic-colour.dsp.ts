// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Mic Colour: makes any source sound as if it was recorded through a microphone in a room. Four microphone models (ribbon, dynamic, condenser,
// tube condenser), each a chain of analog-prototype filters (discretised with the bilinear transform) followed by a level-dependent soft
// saturation; distance (proximity effect, air absorption, direct level), off-axis dulling and a comb, a few early reflections and a trace of self-noise.
// Written in Bleep Script.

import { Smoother } from "./bleep/dsp";
import { Xorshift } from "./bleep/random";

const PI: f64 = 3.141592653589793;

// ---- filters ---------------------------------------------------------------------------------------------------------------------------------

/// One biquad section (transposed direct form II, f64) from an analog prototype in sn = s / w0 with sn -> kn (1 - z^-1) / (1 + z^-1),
/// kn = 1 / tan(pi f0 / fs): the analog frequency f0 lands exactly on the digital one.
class Bq {
  b0: f64 = 1.0; b1: f64 = 0.0; b2: f64 = 0.0; a1: f64 = 0.0; a2: f64 = 0.0;
  private z1: f64 = 0.0; private z2: f64 = 0.0;
  reset(): void { this.z1 = 0.0; this.z2 = 0.0; }
  identity(): void { this.b0 = 1.0; this.b1 = 0.0; this.b2 = 0.0; this.a1 = 0.0; this.a2 = 0.0; }
  copyFrom(o: Bq): void { this.b0 = o.b0; this.b1 = o.b1; this.b2 = o.b2; this.a1 = o.a1; this.a2 = o.a2; }
  /// (nb2 sn^2 + nb1 sn + nb0) / (na2 sn^2 + na1 sn + na0)
  analog2(nb2: f64, nb1: f64, nb0: f64, na2: f64, na1: f64, na0: f64, kn: f64): void {
    const k2 = kn * kn;
    const inv = 1.0 / (na2 * k2 + na1 * kn + na0);
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

function warp(fs: f64, f: f64): f64 { return 1.0 / Math.tan(PI * min(max(f, 5.0), 0.45 * fs) / fs); }
function highpass2(q: Bq, fs: f64, f: f64, Q: f64): void { q.analog2(1.0, 0.0, 0.0, 1.0, 1.0 / Q, 1.0, warp(fs, f)); }
function lowpass2(q: Bq, fs: f64, f: f64, Q: f64): void { q.analog2(0.0, 0.0, 1.0, 1.0, 1.0 / Q, 1.0, warp(fs, f)); }
/// A (s^2 + sqrt(A)/Q s + A) / (A s^2 + sqrt(A)/Q s + 1): `gainDb` below the midpoint f, 0 dB above
function lowShelf2(q: Bq, fs: f64, f: f64, gainDb: f64, Q: f64): void {
  const A = Math.pow(10.0, gainDb / 40.0), r = Math.sqrt(A) / Q;
  q.analog2(A, A * r, A * A, A, r, 1.0, warp(fs, f));
}
/// A (A s^2 + sqrt(A)/Q s + 1) / (s^2 + sqrt(A)/Q s + A): 0 dB below, `gainDb` above f
function highShelf2(q: Bq, fs: f64, f: f64, gainDb: f64, Q: f64): void {
  const A = Math.pow(10.0, gainDb / 40.0), r = Math.sqrt(A) / Q;
  q.analog2(A * A, A * r, A, 1.0, r, A, warp(fs, f));
}
/// (s^2 + A/Q s + 1) / (s^2 + 1/(A Q) s + 1)
function bell(q: Bq, fs: f64, f: f64, gainDb: f64, Q: f64): void {
  const A = Math.pow(10.0, gainDb / 40.0);
  q.analog2(1.0, A / Q, 1.0, 1.0, 1.0 / (A * Q), 1.0, warp(fs, f));
}
/// First-order high shelf, 0 dB below, `gainDb` above, midpoint f: G (sn + 1/sqrt(G)) / (sn + sqrt(G))
function highShelf1(q: Bq, fs: f64, f: f64, gainDb: f64): void {
  const rg = Math.pow(10.0, gainDb / 40.0);
  q.analog1(rg * rg, rg, 1.0, rg, warp(fs, f));
}

// ---- the input choice (Auto / Stereo / Mono) ------------------------------------------------------------------------------------------------

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

// ---- the saturating curve ---------------------------------------------------------------------------------------------------------------------

/// y = (s(b + k x) - s(b)) / (k s'(b)) with the algebraic sigmoid s(x) = x / sqrt(1 + x^2): unity small-signal gain, a bias b gives even harmonics (0 gives
/// only odd ones), bounded. The part beyond the straight line is evaluated with first-order antiderivative anti-aliasing, so the response of the
/// straight part stays flat. The offset the asymmetry makes is removed by the microphone's high-pass, which follows it.
class Curve {
  private bias: f64 = 0.0;
  private sb: f64 = 0.0;
  private isl: f64 = 1.0;
  private u1: f64 = 0.0;
  private f1: f64 = 1.0;
  reset(): void { this.u1 = 0.0; this.f1 = this.anti(0.0); }
  private anti(u: f64): f64 { return this.isl * (Math.sqrt(1.0 + (this.bias + u) * (this.bias + u)) - this.sb * u) - 0.5 * u * u; }
  setBias(b: f64): void {
    if (b == this.bias) return;
    this.bias = b;
    this.sb = b / Math.sqrt(1.0 + b * b);
    this.isl = Math.pow(1.0 + b * b, 1.5);
    this.f1 = this.anti(this.u1);
  }
  next(x: f32, k: f32): f32 {
    const kd = <f64>max(k, <f32>0.001);
    const u = kd * <f64>x;
    const w = this.bias + u;
    const r = Math.sqrt(1.0 + w * w);
    const f = this.isl * (r - this.sb * u) - 0.5 * u * u;
    const du = u - this.u1;
    // two nearly equal samples: the difference quotient is the curve itself
    const h = abs(du) < 0.0001 ? this.isl * (w / r - this.sb) - u : (f - this.f1) / du;
    this.u1 = u; this.f1 = f;
    return <f32>((u + h) / kd);
  }
}

// ---- one channel ----------------------------------------------------------------------------------------------------------------------------

const TAPS: i32 = 6;

class MicChannel {
  s0: Bq = new Bq(); s1: Bq = new Bq(); s2: Bq = new Bq(); s3: Bq = new Bq(); s4: Bq = new Bq(); s5: Bq = new Bq();
  curve: Curve = new Curve();
  private buf: StaticArray<f32>;
  private mask: i32;
  private pos: i32 = 0;
  private noise: Xorshift;
  private pink: f32 = 0.0;
  private ages: StaticArray<i32> = new StaticArray<i32>(TAPS);
  private gains: StaticArray<f32> = new StaticArray<f32>(TAPS);
  private combAge: i32;
  private lowband: f64 = 0.0;
  private lowK: f64;
  private ef: f64 = 0.0; private es: f64 = 0.0;
  private efa: f64; private efr: f64; private esa: f64; private esr: f64;
  private combHp: f64 = 0.0; private combK: f64;
  private roomLp: f64 = 0.0; private roomK: f64;
  direct: f32 = 0.0;
  refl: f32 = 0.0;
  constructor(sampleRate: f64, right: bool, initial: u32) {
    let size = 1;
    while (size < <i32>(sampleRate * 0.04) + 8) size = size << 1;
    this.buf = new StaticArray<f32>(size);
    this.mask = size - 1;
    this.noise = new Xorshift(initial);
    const base = right ? 1.07 : 1.0;
    const ms: f64[] = [3.1, 5.7, 8.9, 13.3, 19.7, 27.1];
    const g: f32[] = [0.50, -0.42, 0.34, -0.28, 0.22, -0.16];
    for (let i = 0; i < TAPS; i++) { this.ages[i] = <i32>(ms[i] * base * 0.001 * sampleRate); this.gains[i] = g[i]; }
    this.combAge = <i32>((right ? 0.00042 : 0.00034) * sampleRate);
    this.lowK = 1.0 - Math.exp(-2.0 * PI * 200.0 / sampleRate);
    this.efa = 1.0 - Math.exp(-1.0 / (sampleRate * 0.0001)); this.efr = 1.0 - Math.exp(-1.0 / (sampleRate * 0.004));
    this.esa = 1.0 - Math.exp(-1.0 / (sampleRate * 0.003)); this.esr = 1.0 - Math.exp(-1.0 / (sampleRate * 0.06));
    this.combK = 1.0 - Math.exp(-2.0 * PI * 2000.0 / sampleRate);
    this.roomK = 1.0 - Math.exp(-2.0 * PI * 5000.0 / sampleRate);
  }
  /// the filters and followers (what a model change clears; the short delay line is left to play out)
  clearFilters(): void {
    this.s0.reset(); this.s1.reset(); this.s2.reset(); this.s3.reset(); this.s4.reset(); this.s5.reset();
    this.curve.reset();
    this.lowband = 0.0; this.ef = 0.0; this.es = 0.0; this.combHp = 0.0; this.roomLp = 0.0;
  }
  reset(): void {
    this.clearFilters();
    for (let i = 0; i < 4096; i++) { if (i < this.buf.length) this.buf[i] = 0.0; }
  }
  copyFilters(o: MicChannel): void {
    this.s0.copyFrom(o.s0); this.s1.copyFrom(o.s1); this.s2.copyFrom(o.s2); this.s3.copyFrom(o.s3); this.s4.copyFrom(o.s4); this.s5.copyFrom(o.s5);
  }
  /// The microphone: tone filters, soft saturation, the capsule's high-pass, then the model's dynamic behaviour. `model` 0 ribbon, 1 dynamic, 2 condenser, 3 tube condenser.
  mic(x: f32, model: i32, k: f32, soft: f32): f32 {
    const y = this.s5.next(this.s4.next(this.s3.next(this.s2.next(this.s1.next(<f64>x + 1.0e-18)))));
    let v = <f32>this.s0.next(<f64>this.curve.next(<f32>y, k));
    if (model == 0) {
      // the ribbon's motion softens large bass excursions
      const xv = <f64>v;
      this.lowband += (xv - this.lowband) * this.lowK;
      const sat = Math.tanh(<f64>soft * this.lowband) / <f64>soft;
      v = <f32>(xv + (sat - this.lowband));
    } else if (model == 1) {
      // fast transient softening: the louder a peak is above the recent average, the more it is turned down
      const a = abs(<f64>v);
      this.ef += (a - this.ef) * (a > this.ef ? this.efa : this.efr);
      this.es += (a - this.es) * (a > this.es ? this.esa : this.esr);
      const peaky = min(this.ef / (this.es + 1.0e-5), 8.0);
      v = v / <f32>(1.0 + <f64>soft * max(0.0, peaky - 1.5));
    }
    return v;
  }
  /// The room and the off-axis comb on the microphone signal `v`: sets `direct` (with the comb) and `refl` (the early reflections).
  space(v: f32, comb: f32): void {
    this.pos = (this.pos + 1) & this.mask;
    this.buf[this.pos] = v;
    const d = <f64>this.buf[(this.pos - this.combAge) & this.mask];
    this.combHp += (d - this.combHp) * this.combK;
    this.direct = v + comb * <f32>(d - this.combHp);
    let acc: f32 = 0.0;
    for (let i = 0; i < TAPS; i++) acc += this.gains[i] * this.buf[(this.pos - this.ages[i]) & this.mask];
    this.roomLp += (<f64>acc - this.roomLp) * this.roomK;
    this.refl = <f32>this.roomLp;
  }
  /// white noise tilted by a one-pole low-pass so that it falls towards the top like a capsule's preamp noise; unit rms
  hiss(): f32 { this.pink += (this.noise.nextBipolar() - this.pink) * 0.35; return this.pink * 3.76; }
}

// ---- per model constants --------------------------------------------------------------------------------------------------------------------------

function hpFreq(m: i32): f64 { return m == 0 ? 35.0 : m == 1 ? 90.0 : m == 2 ? 18.0 : 22.0; }
function proxMax(m: i32): f64 { return m == 0 ? 10.0 : m == 1 ? 7.0 : m == 2 ? 4.0 : 5.0; }
function curveBias(m: i32): f64 { return m == 0 ? 0.0 : m == 1 ? 0.0 : m == 2 ? 0.2 : 0.45; }
function curveDrive(m: i32): f64 { return m == 0 ? 0.35 : m == 1 ? 0.3 : m == 2 ? 0.25 : 0.55; }
function clamp01(x: f64): f64 { return min(max(x, 0.0), 1.0); }

/**
 * A microphone and a room for any source. Pick a model, set the distance, and the module adds what a real capsule and a real space do: the
 * proximity bass lift of a close source, the air absorption of a far one, a presence peak or an airy top, off-axis dulling, a few early reflections, soft
 * saturation that grows with level and a very quiet hiss.
 */
@module({
  name: "Mic Colour",
  category: "Effects/Dynamics & EQ",
  colour: "#0284c7",
  description: "Records any source through a microphone model (ribbon, dynamic, condenser, tube condenser) in a room: proximity, distance, presence, off-axis, early reflections, soft saturation and self-noise. Stereo.",
  layout: [
    { row: [{ select: "model" }, { select: "input" }] },
    { row: [
      { title: "Position", row: ["distance", "proximity", "offAxis"] },
      { title: "Capsule", row: ["presence", "colour", "diaphragm"] },
      { title: "Room", row: ["room", "selfNoise"] },
      { title: "Output", row: ["output", "mix"] },
    ] },
  ],
})
export class MicColour {
  /** Left input. */
  @input({ name: "In L", type: "audio" }) l: f32 = 0;
  /** Right input; in Auto mode the left signal is used when nothing is patched here. */
  @input({ name: "In R", type: "audio" }) r: f32 = 0;
  @output({ name: "Out L", type: "audio" }) outL: f32 = 0;
  @output({ name: "Out R", type: "audio" }) outR: f32 = 0;

  /** Ribbon: soft top, figure-8 proximity bloom, a bass resonance, soft on loud bass. Dynamic: presence peak around 4 kHz, no deep lows or extreme highs, softened transients. Condenser: extended, with a presence and air lift. Tube Condenser: the same with warm tube colour. */
  @param({ name: "Model", choices: ["Ribbon", "Dynamic", "Condenser", "Tube Condenser"], group: "Model" }) model: i32 = 2;
  /** How far the source is from the microphone, 3 to 300 cm. Close sources get proximity bass and a drier sound; far ones less bass, a little air absorption and more room. */
  @param({ name: "Distance", min: 3, max: 300, init: 30, map: "exp", unit: "cm", decimals: 0, group: "Position" }) distance: f32 = 30;
  /** How much of the proximity effect (bass lift of a close source) you get. */
  @param({ name: "Proximity", min: 0, max: 100, init: 50, unit: "%", decimals: 0, group: "Position" }) proximity: f32 = 50;
  /** Extra presence lift around the model's presence region (3 to 6 kHz), up to 6 dB. */
  @param({ name: "Presence", min: 0, max: 100, init: 30, unit: "%", decimals: 0, group: "Capsule" }) presence: f32 = 30;
  /** The model's own tone: ribbon bass bloom and top softness, dynamic presence peak, condenser air lift, tube warmth. 50 % is the model's nominal sound. */
  @param({ name: "Colour", min: 0, max: 100, init: 50, unit: "%", decimals: 0, group: "Capsule" }) colour: f32 = 50;
  /** Condenser models: the size of the diaphragm. Large capsules peak lower (about 7.5 kHz), small ones higher (about 13 kHz). */
  @param({ name: "Diaphragm", min: 0, max: 100, init: 50, unit: "%", decimals: 0, group: "Capsule" }) diaphragm: f32 = 50;
  /** Aim the capsule away from the source: dulls the highs and adds a faint comb. */
  @param({ name: "Off-Axis", min: 0, max: 100, init: 0, unit: "%", decimals: 0, group: "Position" }) offAxis: f32 = 0;
  /** The level of the early reflections (a few short delays). More distance brings more of them at the same setting. */
  @param({ name: "Room", min: 0, max: 100, init: 15, unit: "%", decimals: 0, group: "Room" }) room: f32 = 15;
  /** The microphone's own hiss level; the lowest setting switches it off. */
  @param({ name: "Self-Noise", min: -100, max: -50, init: -90, unit: "dB", decimals: 0, minText: "off", group: "Room" }) selfNoise: f32 = -90;
  /** Output level of the microphone signal. */
  @param({ name: "Output", min: -12, max: 12, init: 0, unit: "dB", decimals: 1, group: "Output" }) output: f32 = 0;
  /** Blend of the dry input and the microphone signal. */
  @param({ name: "Mix", min: 0, max: 100, init: 100, unit: "%", decimals: 0, group: "Output" }) mix: f32 = 100;
  /** Auto uses the left input for both channels while nothing is patched to the right one; Stereo uses both; Mono feeds the left signal to both. */
  @param({ name: "Input", choices: ["Auto", "Stereo", "Mono"], group: "Setup" }) input: i32 = 0;

  /** The output level (peak with a slow fall), for the module's own view. */
  @probe level: f32 = 0;

  private sampleRate: f64;
  private chL: MicChannel;
  private chR: MicChannel;
  private sel: InputSel;
  private fade: Smoother;
  private outg: Smoother;
  private mx: Smoother;
  // derived from the (block-rate smoothed) controls once per block
  private dgV: f32 = 1.0; private kV: f32 = 0.0; private caV: f32 = 0.0; private rmV: f32 = 0.0; private nzV: f32 = 0.0;
  private cNz: f64 = 0.0;
  private active: i32 = 2;
  private started: bool = false;
  private kb: f64;
  private cLnD: f64 = 0.0; private cProx: f64 = 0.0; private cPres: f64 = 0.0; private cCol: f64 = 0.0; private cDia: f64 = 0.0;
  private cOff: f64 = 0.0; private cRoom: f64 = 0.0;

  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    this.chL = new MicChannel(sampleRate, false, 0x51a7e001);
    this.chR = new MicChannel(sampleRate, true, 0x2bd0c0de);
    this.sel = new InputSel(sampleRate);
    this.fade = new Smoother(sampleRate, 0.004);
    this.outg = new Smoother(sampleRate, 0.02);
    this.mx = new Smoother(sampleRate, 0.02);
    this.kb = 1.0 - Math.exp(-32.0 / (sampleRate * 0.03));
    this.fade.target = 1.0; this.fade.snap();
  }

  reset(): void {
    this.chL.reset(); this.chR.reset(); this.sel.reset();
    this.started = false;
  }

  /// the filter chain for model m, at the smoothed settings; the same for both channels
  private design(ch: MicChannel, m: i32): void {
    const fs = this.sampleRate;
    const d = Math.exp(this.cLnD);
    const close = clamp01(Math.log(40.0 / d) / Math.log(40.0 / 3.0));
    const far = clamp01(Math.log(d / 100.0) / Math.log(3.0));
    const air = 4.0 * clamp01(Math.log(d / 50.0) / Math.log(6.0));
    const c2 = this.cCol * 2.0;                                  // 1 at the middle of the Colour knob
    highpass2(ch.s0, fs, hpFreq(m), 0.7071);
    lowShelf2(ch.s1, fs, 200.0, this.cProx * close * proxMax(m) - 2.0 * far, 0.6);
    if (m == 0) bell(ch.s2, fs, 140.0, 3.0 * c2, 1.1);
    else if (m == 1) bell(ch.s2, fs, 700.0, 1.5 * c2, 0.6);
    else if (m == 3) bell(ch.s2, fs, 120.0, 1.5 * c2, 0.8);
    else ch.s2.identity();
    const diaF = 7500.0 * Math.pow(13000.0 / 7500.0, 1.0 - this.cDia);
    const pr = this.cPres;
    if (m == 0) bell(ch.s3, fs, 3200.0, 6.0 * pr, 0.8);
    else if (m == 1) bell(ch.s3, fs, 4200.0, 5.0 * c2 + 4.0 * pr, 0.9);
    else if (m == 2) bell(ch.s3, fs, diaF, 1.5 + 3.0 * c2 + 4.0 * pr, 1.0);
    else bell(ch.s3, fs, diaF, 1.0 + 2.0 * c2 + 4.0 * pr, 1.0);
    if (m == 0) lowpass2(ch.s4, fs, 9500.0 / Math.sqrt(max(c2, 0.1)), 0.6);
    else if (m == 1) lowpass2(ch.s4, fs, 15000.0, 0.7071);
    else if (m == 3) lowpass2(ch.s4, fs, 18000.0, 0.6);
    else ch.s4.identity();
    const lift = m == 2 ? 3.0 * c2 : m == 3 ? 1.5 * c2 : 0.0;
    highShelf2(ch.s5, fs, 7000.0, lift - air - this.cOff * 8.0, 0.6);
  }

  block(): void {
    // the view's level: the last output sample of the previous block, with a slow fall (cheap; a picture needs no more)
    this.level = max(max(abs(this.outL), abs(this.outR)), this.level * 0.97);
    const first = !this.started;
    const k = first ? 1.0 : this.kb;
    this.cLnD += (Math.log(<f64>this.distance) - this.cLnD) * k;
    this.cProx += (<f64>this.proximity * 0.01 - this.cProx) * k;
    this.cPres += (<f64>this.presence * 0.01 - this.cPres) * k;
    this.cCol += (<f64>this.colour * 0.01 - this.cCol) * k;
    this.cDia += (<f64>this.diaphragm * 0.01 - this.cDia) * k;
    this.cOff += (<f64>this.offAxis * 0.01 - this.cOff) * k;
    this.cRoom += (<f64>this.room * 0.01 - this.cRoom) * k;

    // a model change fades out, switches with cleared state, fades in
    if (first) { this.active = this.model; this.fade.target = 1.0; this.fade.snap(); }
    else if (this.model != this.active) {
      this.fade.target = 0.0;
      if (this.fade.value < 0.002) {
        this.active = this.model;
        this.chL.clearFilters(); this.chR.clearFilters();
        this.fade.target = 1.0;
      }
    } else this.fade.target = 1.0;

    const m = this.active;
    this.design(this.chL, m);
    this.chR.copyFilters(this.chL);
    this.chL.curve.setBias(curveBias(m));
    this.chR.curve.setBias(curveBias(m));

    const d = Math.exp(this.cLnD);
    const dist01 = clamp01(Math.log(d / 3.0) / Math.log(100.0));
    this.dgV = <f32>Math.pow(10.0, -3.0 * clamp01(Math.log(d / 40.0) / Math.log(7.5)) / 20.0);   // direct level: down to -3 dB at 3 m
    this.rmV = <f32>(this.cRoom * (0.25 + 0.75 * dist01) * 0.6);
    this.kV = <f32>(curveDrive(m) * Math.sqrt(this.cCol * 2.0));
    this.caV = <f32>(this.cOff * 0.25);
    const nz = <f64>this.selfNoise;
    this.cNz += ((nz <= -99.9 ? 0.0 : Math.pow(10.0, nz / 20.0)) - this.cNz) * k;
    this.nzV = <f32>this.cNz;
    this.outg.target = <f32>Math.pow(10.0, <f64>this.output / 20.0);
    this.mx.target = <f32>(<f64>this.mix * 0.01);
    if (first) {
      this.outg.snap(); this.mx.snap();
      this.started = true;
    }
  }

  sample(): void {
    const l = this.l;
    const r = this.sel.right(l, this.r, this.input);
    const f = this.fade.next();
    const dg = this.dgV, rm = this.rmV, k = this.kV, ca = this.caV, nz = this.nzV;
    const og = this.outg.next() * f, mx = this.mx.next();
    const m = this.active;
    const vl = this.chL.mic(l, m, k, <f32>(m == 0 ? 1.4 : 0.15));
    const vr = this.chR.mic(r, m, k, <f32>(m == 0 ? 1.4 : 0.15));
    this.chL.space(vl, -ca);
    this.chR.space(vr, -ca);
    const wl = (this.chL.direct * dg + this.chL.refl * rm + this.chL.hiss() * nz) * og;
    const wr = (this.chR.direct * dg + this.chR.refl * rm + this.chR.hiss() * nz) * og;
    this.outL = l + (wl - l) * mx;
    this.outR = r + (wr - r) * mx;
  }
}
