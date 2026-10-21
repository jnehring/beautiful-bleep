// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Vinyl: colours any signal with a record chain. The cutter makes the bass mono and applies the RIAA record pre-emphasis (time constants
// 3180, 318 and 75 microseconds), the groove is where the stylus is pushed beyond what it can track (level- and frequency-dependent
// distortion, worse near the centre), noise is picked up (surface hiss, rumble), the channels leak into each other, and the playback
// de-emphasis (the exact inverse of the cut) takes the pre-emphasis off again and, with it, most of the hiss. Dust, pops and scratches
// that repeat once per revolution are added after the cartridge; the record's eccentricity bends the pitch once per revolution.

import { Biquad, Smoother, PeakHold, dbToLin } from "./bleep/dsp";
import { OnePole, Allpass1 } from "./bleep/filters";
import { Oversampler2x } from "./bleep/dynamics";
import { DelayLine } from "./bleep/delay";
import { Xorshift } from "./bleep/random";
import { fastTanh } from "./bleep/util";

const PI: f64 = 3.141592653589793;
const TWO_PI: f64 = 6.283185307179586;
const BASE_SECONDS: f64 = 0.004;           // the fixed delay the eccentricity rides on; the dry path is delayed by the same amount
const WOW_SECONDS: f64 = 0.0035;           // the most the delay moves, per side
const RIAA_BASS: f64 = 0.00318;            // seconds: the three RIAA time constants (3180, 318 and 75 microseconds)
const RIAA_MID: f64 = 0.000318;
const RIAA_TREBLE: f64 = 0.000075;

/// Decides whether the right input is patched. It is taken as unpatched when it has been exactly 0 for 2048 samples while the left input is not.
class InputSense {
  amount: f32 = 1;
  private target: f32 = 1;
  private zeroR: i32 = 0;
  private coefficient: f32;
  constructor(sampleRate: f64) { this.coefficient = <f32>(1.0 - Math.exp(-1.0 / (sampleRate * 0.005))); }
  reset(): void { this.amount = 1.0; this.target = 1.0; this.zeroR = 0; }
  next(l: f32, r: f32, mode: i32): f32 {
    if (mode == 1) this.target = 1.0;
    else if (mode == 2) this.target = 0.0;
    else if (r != 0.0) { this.zeroR = 0; this.target = 1.0; }
    else {
      if (this.zeroR < 1000000) this.zeroR++;
      if (this.zeroR >= 2048 && l != 0.0) this.target = 0.0;
    }
    this.amount += (this.target - this.amount) * this.coefficient;
    return l + (r - l) * this.amount;
  }
}

/// A second-order section with its coefficients set directly (transposed direct form II).
class Section {
  b0: f64 = 1; b1: f64 = 0; b2: f64 = 0; a1: f64 = 0; a2: f64 = 0;
  private z1: f64 = 0; private z2: f64 = 0;
  reset(): void { this.z1 = 0; this.z2 = 0; }
  next(x: f32): f32 {
    const xi = <f64>x;
    const y = this.b0 * xi + this.z1;
    this.z1 = this.b1 * xi - this.a1 * y + this.z2;
    this.z2 = this.b2 * xi - this.a2 * y;
    return <f32>y;
  }
  /// The magnitude of the response at the angular frequency `w` (radians per sample).
  magnitude(w: f64): f64 {
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2.0 * w), s2 = Math.sin(2.0 * w);
    const nr = this.b0 + this.b1 * c1 + this.b2 * c2, ni = -(this.b1 * s1 + this.b2 * s2);
    const dr = 1.0 + this.a1 * c1 + this.a2 * c2, di = -(this.a1 * s1 + this.a2 * s2);
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  }
}

/// (1 + s/w1)(1 + s/w2) / ((1 + s/w3)(1 + s/w4)) as a digital section: every factor is mapped with the bilinear transform pre-warped to its own
/// corner, so each corner frequency is exact. `gain` multiplies the numerator.
function setFactors(into: Section, sampleRate: f64, z1: f64, z2: f64, p1: f64, p2: f64, gain: f64): void {
  const cz1 = 1.0 / Math.tan(PI * z1 / sampleRate), cz2 = 1.0 / Math.tan(PI * z2 / sampleRate);
  const cp1 = 1.0 / Math.tan(PI * p1 / sampleRate), cp2 = 1.0 / Math.tan(PI * p2 / sampleRate);
  const n0 = (1.0 + cz1) * (1.0 + cz2), n1 = (1.0 + cz1) * (1.0 - cz2) + (1.0 - cz1) * (1.0 + cz2), n2 = (1.0 - cz1) * (1.0 - cz2);
  const d0 = (1.0 + cp1) * (1.0 + cp2), d1 = (1.0 + cp1) * (1.0 - cp2) + (1.0 - cp1) * (1.0 + cp2), d2 = (1.0 - cp1) * (1.0 - cp2);
  into.b0 = gain * n0 / d0; into.b1 = gain * n1 / d0; into.b2 = gain * n2 / d0;
  into.a1 = d1 / d0; into.a2 = d2 / d0;
}

/// A pulse into a damped resonator: `hit(amplitude)` starts a ring at `frequency` that dies away with time constant `tau`.
class Ring {
  private a: f64 = 0;
  private b: f64 = 0;
  private r: f64;
  private c: f64;
  private s: f64;
  constructor(sampleRate: f64, frequency: f64, tau: f64) {
    this.r = Math.exp(-1.0 / (sampleRate * tau));
    this.c = Math.cos(TWO_PI * frequency / sampleRate);
    this.s = Math.sin(TWO_PI * frequency / sampleRate);
  }
  reset(): void { this.a = 0.0; this.b = 0.0; }
  hit(amplitude: f64): void { this.a += amplitude; }
  next(): f32 {
    const a = this.r * (this.a * this.c - this.b * this.s);
    const b = this.r * (this.a * this.s + this.b * this.c);
    this.a = abs(a) < 1.0e-20 ? 0.0 : a;
    this.b = abs(b) < 1.0e-20 ? 0.0 : b;
    return <f32>this.a;
  }
}

/// The dust on the record, shared by both channels: a bed of tiny crackle, ticks and pops at random (seeded) times, and scratches at fixed
/// places on the revolution, so a scratch comes round again every turn. `left` and `right` hold the sample.
class Dust {
  left: f32 = 0;
  right: f32 = 0;
  bedRate: f64 = 0; tickRate: f64 = 0; popRate: f64 = 0;
  scratches: i32 = 0;
  scratchGain: f64 = 0;
  level: f64 = 1;
  private rng: Xorshift = new Xorshift(0x6D2B79F5);
  private hiL: Ring; private hiR: Ring; private thumpL: Ring; private thumpR: Ring;
  private position: StaticArray<f64> = new StaticArray<f64>(3);
  private strength: StaticArray<f64> = new StaticArray<f64>(3);
  private spread: StaticArray<f64> = new StaticArray<f64>(3);
  private sizzle: u32 = 1;
  private sizzleEnv: f64 = 0;
  private sizzleDecay: f64;
  private sizzleAmp: f64 = 0;
  private inverse: f64;

  constructor(sampleRate: f64) {
    this.hiL = new Ring(sampleRate, 3300.0, 0.00028); this.hiR = new Ring(sampleRate, 3300.0, 0.00028);
    this.thumpL = new Ring(sampleRate, 70.0, 0.006); this.thumpR = new Ring(sampleRate, 70.0, 0.006);
    this.position[0] = 0.137; this.position[1] = 0.512; this.position[2] = 0.861;
    this.strength[0] = 0.9; this.strength[1] = -0.55; this.strength[2] = 0.7;
    this.spread[0] = 0.85; this.spread[1] = 0.4; this.spread[2] = -0.6;
    this.sizzleDecay = Math.exp(-1.0 / (sampleRate * 0.003));
    this.inverse = 1.0 / sampleRate;
  }

  reset(): void {
    this.hiL.reset(); this.hiR.reset(); this.thumpL.reset(); this.thumpR.reset();
    this.sizzleEnv = 0.0; this.left = 0.0; this.right = 0.0;
  }

  /// `rev` is the position on the revolution before this sample (0 to 1), `step` how far it moves in one sample.
  next(rev: f64, step: f64): void {
    const cur = rev + step;
    for (let k = 0; k < 3; k++) {
      if (k >= this.scratches) continue;
      const p = this.position[k];
      if ((p > rev && p <= cur) || (p + 1.0 > rev && p + 1.0 <= cur)) {
        const a = this.scratchGain * this.strength[k];
        this.hiL.hit(a); this.hiR.hit(a * this.spread[k]);
        this.thumpL.hit(a * 0.5); this.thumpR.hit(a * 0.5 * this.spread[k]);
        this.sizzle = 0x2F6B1A93 + <u32>k * 977;
        this.sizzleEnv = 1.0;
        this.sizzleAmp = a * 0.35;
      }
    }
    // random events: one draw per kind per sample, a second one only when something happens
    const bed = this.rng.nextU32(), tick = this.rng.nextU32(), pop = this.rng.nextU32();
    const scale = 4294967296.0 * this.inverse;
    if (<f64>bed < this.bedRate * scale) {
      const q = this.rng.next();
      const a = (this.rng.nextU32() & 1) == 0 ? 1.0 : -1.0;
      const amp = a * (0.003 + 0.02 * <f64>(q * q)) * this.level;
      const rho = 0.3 + 0.7 * <f64>this.rng.next();
      this.hiL.hit(amp); this.hiR.hit(amp * rho);
    }
    if (<f64>tick < this.tickRate * scale) {
      const q = this.rng.next();
      const a = (this.rng.nextU32() & 1) == 0 ? 1.0 : -1.0;
      const amp = a * (0.02 + 0.1 * <f64>(q * q));
      const rho = 0.2 + 0.8 * <f64>this.rng.next();
      this.hiL.hit(amp); this.hiR.hit(amp * rho);
    }
    if (<f64>pop < this.popRate * scale) {
      const q = this.rng.next();
      const a = (this.rng.nextU32() & 1) == 0 ? 1.0 : -1.0;
      const amp = a * (0.2 + 0.45 * <f64>q);
      const rho = -0.5 + 1.5 * <f64>this.rng.next();
      this.hiL.hit(amp); this.hiR.hit(amp * rho);
      this.thumpL.hit(amp * 0.5); this.thumpR.hit(amp * 0.5 * rho);
    }
    let z: f32 = 0;
    if (this.sizzleEnv > 1.0e-6) {
      this.sizzle = this.sizzle * 1664525 + 1013904223;
      z = <f32>(this.sizzleAmp * this.sizzleEnv) * (<f32>(this.sizzle >> 8) * (1.0 / 8388608.0) - 1.0);
      this.sizzleEnv *= this.sizzleDecay;
    }
    this.left = this.hiL.next() + this.thumpL.next() + z;
    this.right = this.hiR.next() + this.thumpR.next() + z * 0.8;
  }
}

/// Turntable rumble: low-frequency noise between about 5 and 40 Hz. The part that is the same in both channels is the horizontal motion, the
/// part that is opposite is the vertical one.
class Rumble {
  left: f32 = 0;
  right: f32 = 0;
  private a: Xorshift = new Xorshift(0x1F123BB5);
  private b: Xorshift = new Xorshift(0x159A55E5);
  private hpA: Biquad = new Biquad(); private lpA: Biquad = new Biquad();
  private hpB: Biquad = new Biquad(); private lpB: Biquad = new Biquad();
  constructor(sampleRate: f64) {
    this.hpA.setHighpass(sampleRate, 5.0, 0.7071); this.lpA.setLowpass(sampleRate, 40.0, 0.7071);
    this.hpB.setHighpass(sampleRate, 5.0, 0.7071); this.lpB.setLowpass(sampleRate, 40.0, 0.7071);
  }
  reset(): void { this.hpA.reset(); this.lpA.reset(); this.hpB.reset(); this.lpB.reset(); }
  next(gain: f32): void {
    const h = this.lpA.next(this.hpA.next(this.a.nextBipolar())) * gain;
    const v = this.lpB.next(this.hpB.next(this.b.nextBipolar())) * gain * 0.7;
    this.left = h + v; this.right = h - v;
  }
}

/// One channel of the record chain.
class RecordChannel {
  readonly rec: Section = new Section();
  readonly play: Section = new Section();
  readonly cartPeak: Biquad = new Biquad();
  readonly cartLow: Biquad = new Biquad();
  readonly inner: OnePole = new OnePole();
  readonly subsonic: OnePole = new OnePole();
  readonly leak: Allpass1 = new Allpass1();
  raw: f32 = 0;
  threshold: f32 = 3;
  bias: f32 = 0;
  offset: f32 = 0;
  invSlope: f32 = 1;
  private line: DelayLine;
  private dryLine: DelayLine;
  private os: Oversampler2x = new Oversampler2x();
  private hiss: Xorshift;
  private previous: f32 = 0;

  constructor(sampleRate: f64, salt: u32) {
    const base = <i32>Math.ceil(BASE_SECONDS * sampleRate);
    const wow = <i32>Math.ceil(WOW_SECONDS * sampleRate);
    this.line = new DelayLine(base + wow + 40);
    this.dryLine = new DelayLine(base + 40);
    this.hiss = new Xorshift(salt);
  }

  reset(): void {
    this.rec.reset(); this.play.reset(); this.cartPeak.reset(); this.cartLow.reset(); this.inner.reset(); this.subsonic.reset(); this.leak.reset();
    this.line.reset(); this.dryLine.reset(); this.os.reset(); this.previous = 0.0;
  }

  /// The signal as it lies in the groove: delayed by the eccentricity, pre-emphasised, and limited by what the stylus can follow.
  groove(x: f32, original: f32, delay: f32): f32 {
    this.dryLine.write(original);
    this.line.write(x);
    const v = this.rec.next(this.line.readCubic(delay));
    this.raw = v;
    // the stylus limit runs at twice the sample rate; the working point is taken off before the down-sampler, so rest stays at rest
    this.os.up(v);
    const k = this.invSlope * this.threshold;
    const a = (fastTanh(this.os.a / this.threshold + this.bias) - this.offset) * k;
    const b = (fastTanh(this.os.b / this.threshold + this.bias) - this.offset) * k;
    return this.os.down(a, b);
  }

  /// Picks the groove up: adds the hiss and rumble, rolls off the top (inner grooves), de-emphasises, and applies the cartridge's response.
  pickup(v: f32, hissGain: f32, rumble: f32): f32 {
    const w = <f32>this.hiss.nextBipolar();
    // surface hiss is the roughness of the groove: white noise tilted towards the treble, then de-emphasised with the signal
    const noise = (w - 0.6 * this.previous) * hissGain;
    this.previous = w;
    let s = v + noise + rumble;
    s = this.inner.next(s);
    s = this.subsonic.next(s);
    s = this.play.next(s + 1.0e-20);
    return this.cartPeak.next(this.cartLow.next(s));
  }

  dry(latency: i32): f32 { return this.dryLine.tap(latency); }
}

@module({
  name: "Vinyl",
  category: "Effects/Distortion",
  colour: "#92400e",
  description: "Puts any signal through a record: cut and playback curve, mono bass, tracking distortion that grows towards the centre, rumble, hiss, dust, pops and scratches that come round once per turn, channel crosstalk and the wobble of an off-centre disc.",
  layout: [
    { row: [
      { title: "Record", column: ["speed", "cartridge", "inner"] },
      { title: "Surface", column: ["dust", "noise", "rumble"] },
      { title: "Turntable", column: ["warp", "crosstalk", "bassMono"] },
      { title: "Output", column: ["outputDb", "mix"] },
    ] },
    { row: [{ title: "Groove", column: [{ meter: "groove" }] }, { title: "Level", column: [{ meter: "level" }] }] },
    { title: "Setup", row: ["input"] },
  ],
})
export class Vinyl {
  @input({ name: "In L", type: "audio" }) l: f32 = 0;
  @input({ name: "In R", type: "audio" }) r: f32 = 0;
  @output({ name: "Out L", type: "audio" }) outL: f32 = 0;
  @output({ name: "Out R", type: "audio" }) outR: f32 = 0;

  /** The speed of the record. It sets how fast the eccentricity wobbles (0.56, 0.75 or 1.3 revolutions a second), how often a scratch comes round (once per revolution: 1.8, 1.33 or 0.77 seconds) and how busy the surface is. */
  @param({ name: "Speed", choices: ["33 1/3 rpm", "45 rpm", "78 rpm"], group: "Record" }) speed: i32 = 0;
  /** The pick-up. Hi-Fi tracks well and is flat; Standard has a small rise at the top and a little bass loss; Cheap has a pronounced rise, loses more bass and gives up tracking sooner. */
  @param({ name: "Cartridge", choices: ["Hi-Fi", "Standard", "Cheap"], init: 1, group: "Record" }) cartridge: i32 = 1;
  /** How close to the label the stylus is. Towards 100 % the groove is tighter: the stylus loses track of loud and bright signals sooner (distortion), the top end rolls off and the asymmetry adds even harmonics. */
  @param({ name: "Inner Groove", min: 0, max: 100, init: 20, unit: "%", decimals: 0, group: "Record" }) inner: f32 = 20;
  /** The condition of the record. 0 is mint. More dust gives more crackle, more ticks and pops, and from 40 % on scratches that come back every revolution (up to three). */
  @param({ name: "Dust", min: 0, max: 100, init: 30, unit: "%", decimals: 0, group: "Surface" }) dust: f32 = 30;
  /** The level of the surface noise: the hiss of the stylus in the groove (which the playback curve darkens), and the bed of fine crackle. */
  @param({ name: "Noise", min: 0, max: 100, init: 40, unit: "%", decimals: 0, group: "Surface" }) noise: f32 = 40;
  /** The turntable's rumble: noise between about 5 and 40 Hz. */
  @param({ name: "Rumble", min: 0, max: 100, init: 25, unit: "%", decimals: 0, group: "Surface" }) rumble: f32 = 25;
  /** The off-centre disc and the warp: a slow pitch wobble once per revolution (and half as much twice per revolution). 100 % is about plus and minus 14 cents. */
  @param({ name: "Warp", min: 0, max: 100, init: 25, unit: "%", decimals: 0, group: "Turntable" }) warp: f32 = 25;
  /** How much each channel leaks into the other (with a small phase shift): 0 is perfect separation, 100 % is a leak at 12 dB below. */
  @param({ name: "Crosstalk", min: 0, max: 100, init: 30, unit: "%", decimals: 0, group: "Turntable" }) crosstalk: f32 = 30;
  /** The corner below which the stereo difference is removed, as a cutting lathe does: the bass becomes mono. 0 turns it off. */
  @param({ name: "Bass Mono", min: 0, max: 400, init: 120, map: "skew", centre: 100, unit: "Hz", decimals: 0, group: "Turntable" }) bassMono: f32 = 120;
  /** The output level. */
  @param({ name: "Output", min: -24, max: 12, init: 0, unit: "dB", decimals: 1, group: "Output" }) outputDb: f32 = 0;
  /** Dry against processed. The dry signal is delayed by the same fixed delay as the processed one. */
  @param({ name: "Mix", min: 0, max: 100, init: 100, unit: "%", decimals: 0, group: "Output" }) mix: f32 = 100;
  /** Where the right input comes from. Auto uses the left input for both channels when nothing is patched into In R. */
  @param({ name: "Input", choices: ["Auto", "Stereo", "Mono"], group: "Setup" }) input: i32 = 0;

  /** The peak signal in the groove, after the cut curve and before the stylus limits it (1.0 is a 1 kHz tone at full scale). Bright, loud passages push it up. */
  @probe groove: f32 = 0;
  /** The output level. */
  @probe level: f32 = 0;
  /** Where the stylus is on the current turn of the record: 0 to 1. */
  @probe turn: f32 = 0;
  /** The loudness of the dust, pops and scratches right now (peak, decaying), for flashes. */
  @probe click: f32 = 0;

  private cl: RecordChannel;
  private cr: RecordChannel;
  private sense: InputSense;
  private dustBed: Dust;
  private rumbleBed: Rumble;
  private bassFilter: Biquad = new Biquad();
  private leakL: Allpass1 = new Allpass1();
  private leakR: Allpass1 = new Allpass1();
  private sampleRate: f64;
  private base: i32;
  private osLatency: i32;
  private rev: f64 = 0;
  private revStep: f64 = 0;
  private delay: f32 = 0;
  private delayStep: f32 = 0;
  private bassOn: bool = false;
  private leakGain: f32 = 0;
  private hissGain: f32 = 0;
  private rumbleGain: f32 = 0;
  private gainSmooth: Smoother;
  private mixSmooth: Smoother;
  private grooveMeter: PeakHold;
  private levelMeter: PeakHold;
  private started: bool = false;

  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    this.base = <i32>Math.round(BASE_SECONDS * sampleRate);
    this.osLatency = new Oversampler2x().latency;
    this.cl = new RecordChannel(sampleRate, 0x3C6EF372);
    this.cr = new RecordChannel(sampleRate, 0xA54FF53A);
    this.sense = new InputSense(sampleRate);
    this.dustBed = new Dust(sampleRate);
    this.rumbleBed = new Rumble(sampleRate);
    this.gainSmooth = new Smoother(sampleRate, 0.02);
    this.mixSmooth = new Smoother(sampleRate, 0.005);
    this.grooveMeter = new PeakHold(sampleRate, 0.3);
    this.levelMeter = new PeakHold(sampleRate, 0.3);
    // the RIAA curves. Playback: (1 + s 318us) / ((1 + s 3180us)(1 + s 75us)), taken to 1 at 1 kHz. The cut is its exact inverse. Both
    // have one more corner far above the audio (a real cutter has to stop somewhere, and the inverse of a curve that falls forever would
    // not be a stable filter): the cut gets a pole there and the playback a matching zero, so cut and playback still cancel exactly.
    const bass = 1.0 / (TWO_PI * RIAA_BASS), mid = 1.0 / (TWO_PI * RIAA_MID), treble = 1.0 / (TWO_PI * RIAA_TREBLE);
    const limit = min(20000.0, 0.4 * sampleRate);
    const unit = new Section();
    setFactors(unit, sampleRate, mid, limit, bass, treble, 1.0);
    const norm = 1.0 / unit.magnitude(TWO_PI * 1000.0 / sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = c == 0 ? this.cl : this.cr;
      setFactors(ch.play, sampleRate, mid, limit, bass, treble, norm);
      setFactors(ch.rec, sampleRate, bass, treble, mid, limit, 1.0 / norm);
      ch.subsonic.setHighpass(sampleRate, 12.0);
    }
    this.leakL.set(sampleRate, 1800.0); this.leakR.set(sampleRate, 1800.0);
  }

  reset(): void {
    this.cl.reset(); this.cr.reset(); this.sense.reset(); this.dustBed.reset(); this.rumbleBed.reset(); this.bassFilter.reset();
    this.leakL.reset(); this.leakR.reset(); this.grooveMeter.reset(); this.levelMeter.reset(); this.rev = 0.0;
  }

  /// The delay (in samples) the eccentricity adds at the position `rev` on the revolution.
  private wowOffset(rev: f64, depth: f64, rotation: f64): f64 {
    const a = TWO_PI * rev;
    return depth * this.sampleRate / (TWO_PI * rotation) * (Math.cos(a) + 0.175 * Math.cos(2.0 * a + 0.8));
  }

  block(): void {
    const sr = this.sampleRate;
    const rpm = this.speed == 0 ? 100.0 / 3.0 : (this.speed == 1 ? 45.0 : 78.0);
    const rotation = rpm / 60.0;
    this.revStep = rotation / sr;
    const inner = <f64>this.inner * 0.01, dust = <f64>this.dust * 0.01, noise = <f64>this.noise * 0.01, rum = <f64>this.rumble * 0.01;
    const nyq = 0.45 * sr;
    // the cartridge
    const cart = this.cartridge;
    const trackScale = cart == 0 ? 1.4 : (cart == 1 ? 1.0 : 0.55);
    const threshold = 3.0 * Math.pow(0.1667, inner) * trackScale;
    const bias = 0.3 * inner * (cart == 2 ? 1.3 : 1.0);
    const slope = 1.0 - Math.tanh(bias) * Math.tanh(bias);
    const innerHz = min(30000.0 * Math.pow(0.16, inner), nyq);
    const peakHz = cart == 0 ? 18000.0 : (cart == 1 ? 11500.0 : 9500.0);
    const peakQ = cart == 2 ? 1.6 : (cart == 1 ? 1.2 : 0.7);
    const peakDb = cart == 0 ? 0.3 : (cart == 1 ? 1.2 : 3.0);
    const lowDb = cart == 0 ? 0.0 : (cart == 1 ? -0.7 : -1.5);
    for (let c = 0; c < 2; c++) {
      const ch = c == 0 ? this.cl : this.cr;
      ch.threshold = <f32>threshold; ch.bias = <f32>bias;
      ch.offset = <f32>Math.tanh(bias); ch.invSlope = <f32>(1.0 / slope);
      ch.inner.setLowpass(sr, innerHz);
      ch.cartPeak.setPeaking(sr, min(peakHz, nyq), peakQ, peakDb);
      ch.cartLow.setLowShelf(sr, cart == 2 ? 120.0 : 80.0, lowDb);
    }
    // bass mono
    this.bassOn = this.bassMono >= 10.0;
    if (this.bassOn) this.bassFilter.setHighpass(sr, <f64>this.bassMono, 0.7071);
    // crosstalk: up to a leak at -12 dB
    this.leakGain = <f32>(0.25 * Math.pow(<f64>this.crosstalk * 0.01, 1.5));
    // noise
    this.hissGain = <f32>(0.12 * Math.pow(noise, 1.5));
    this.rumbleGain = <f32>(0.2 * rum * rum);
    // dust: rates are per second at 33 1/3 rpm, busier on faster records
    const busy = Math.pow(rpm / 33.333, 0.7);
    const d = this.dustBed;
    d.bedRate = (1400.0 * dust) * busy; d.tickRate = (50.0 * dust * dust) * busy; d.popRate = (12.0 * dust * dust) * busy;
    d.scratches = dust >= 0.85 ? 3 : (dust >= 0.65 ? 2 : (dust >= 0.4 ? 1 : 0));
    d.scratchGain = 0.55 * (0.5 + 0.5 * dust);
    d.level = 0.3 + noise;
    // the eccentricity: the delay for this block, moving evenly to where it will be at the next one
    const depth = 0.006 * <f64>this.warp * 0.01;
    const d0 = <f64>this.base + this.wowOffset(this.rev, depth, rotation);
    const d1 = <f64>this.base + this.wowOffset(this.rev + 32.0 * this.revStep, depth, rotation);
    this.delay = <f32>d0;
    this.delayStep = <f32>((d1 - d0) / 32.0);
    this.gainSmooth.target = dbToLin(<f64>this.outputDb);
    this.mixSmooth.target = <f32>(<f64>this.mix * 0.01);
    if (!this.started) { this.started = true; this.gainSmooth.snap(); this.mixSmooth.snap(); }
  }

  sample(): void {
    const rr = this.sense.next(this.l, this.r, this.input);
    // the cutter makes the bass mono
    let ml = this.l, mr = rr;
    if (this.bassOn) {
      const mid = (this.l + rr) * 0.5, side = this.bassFilter.next((this.l - rr) * 0.5);
      ml = mid + side; mr = mid - side;
    }
    const gl = this.cl.groove(ml, this.l, this.delay);
    const gr = this.cr.groove(mr, rr, this.delay);
    this.delay += this.delayStep;
    this.grooveMeter.next(max(abs(this.cl.raw), abs(this.cr.raw)));
    this.groove = this.grooveMeter.value;
    // the stylus picks up some of the other channel
    const xl = gl + this.leakGain * this.leakL.next(gr);
    const xr = gr + this.leakGain * this.leakR.next(gl);
    this.rumbleBed.next(this.rumbleGain);
    let wl = this.cl.pickup(xl, this.hissGain, this.rumbleBed.left);
    let wr = this.cr.pickup(xr, this.hissGain, this.rumbleBed.right);
    this.dustBed.next(this.rev, this.revStep);
    this.rev += this.revStep; if (this.rev >= 1.0) this.rev -= 1.0;
    wl += this.dustBed.left; wr += this.dustBed.right;
    const ck = max(abs(this.dustBed.left), abs(this.dustBed.right));
    this.click = max(ck, this.click * 0.9995);
    this.turn = <f32>this.rev;
    const g = this.gainSmooth.next();
    const m = this.mixSmooth.next();
    wl *= g; wr *= g;
    wl = wl > 16.0 ? 16.0 : (wl < -16.0 ? -16.0 : wl);
    wr = wr > 16.0 ? 16.0 : (wr < -16.0 ? -16.0 : wr);
    const dl = this.cl.dry(this.base + this.osLatency), dr = this.cr.dry(this.base + this.osLatency);
    const yl = dl + (wl - dl) * m, yr = dr + (wr - dr) * m;
    this.outL = yl; this.outR = yr;
    this.level = this.levelMeter.next(max(abs(yl), abs(yr)));
  }
}
