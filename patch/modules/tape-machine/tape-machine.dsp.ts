// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Tape Machine: a reel-to-reel recorder. Chain per channel: transport (wow and flutter on a fractional delay) -> tape compression -> input
// level -> record pre-emphasis -> magnetic hysteresis (oversampled) -> hiss, modulation noise and dropouts -> playback de-emphasis (the exact
// inverse of the pre-emphasis) -> head bump -> gap and spacing loss -> level-compensated output.
//
// The magnetic model is a reduced Jiles-Atherton form. The anhysteretic curve is M_an = tanh(H). The irreversible magnetisation M_irr
// relaxes towards it only while the field moves in the direction that pulls M_irr to M_an (dM/dH = (M_an - M_irr) / k, which is the JA
// equation without the pinning feedback term), by the fraction x / (1 + x) of the gap with x = |dH| / k, so it never overshoots. The
// output is c M_an + (1 - c) M_irr with c the reversible share. For small signals the loop is nearly closed and the response is the smooth
// saturation of M_an; with a wide loop (under-bias) small signals do not move M_irr at all, which gives low-level crossover distortion
// and a gain that rises with level. M_irr is always between M_irr's start and M_an, so the model is bounded (|M| <= 1) and finite for any input.

import { Biquad, Smoother, PeakHold, dbToLin } from "./bleep/dsp";
import { OnePole } from "./bleep/filters";
import { Oversampler2x, Oversampler4x } from "./bleep/dynamics";
import { DelayLine } from "./bleep/delay";
import { Xorshift, NoiseLfo } from "./bleep/random";
import { fastTanh } from "./bleep/util";

const PI: f64 = 3.141592653589793;
const TWO_PI: f64 = 6.283185307179586;
const BASE_SECONDS: f64 = 0.006;        // the fixed delay that wow and flutter swing around; the dry path is delayed by the same amount

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

/// A first-order shelf (1 + s / wz) / (1 + s / wp), mapped with the bilinear transform pre-warped to both corners. Swapping the two
/// corners gives its exact inverse.
class Shelf {
  private b0: f64 = 1; private b1: f64 = 0; private a1: f64 = 0;
  private x1: f64 = 0; private y1: f64 = 0;
  reset(): void { this.x1 = 0; this.y1 = 0; }
  set(sampleRate: f64, zeroHz: f64, poleHz: f64): void {
    const cz = 1.0 / Math.tan(PI * zeroHz / sampleRate), cp = 1.0 / Math.tan(PI * poleHz / sampleRate);
    this.b0 = (1.0 + cz) / (1.0 + cp); this.b1 = (1.0 - cz) / (1.0 + cp); this.a1 = (1.0 - cp) / (1.0 + cp);
  }
  next(x: f32): f32 {
    const xi = <f64>x;
    const y = this.b0 * xi + this.b1 * this.x1 - this.a1 * this.y1;
    this.x1 = xi; this.y1 = y;
    return <f32>y;
  }
}

/// The magnetic medium: see the header. The field `h` is in units of the saturation field.
class Hysteresis {
  /// Share of the anhysteretic (reversible) part in the output.
  reversible: f32 = 0.9;
  /// The loop width in units of the saturation field: the field travel over which M_irr catches up.
  width: f32 = 0.06;
  private offset: f32 = 0;
  private rest: f32 = 0;
  private previous: f32 = 0;
  private irreversible: f32 = 0;
  magnetisation: f32 = 0;
  reset(): void { this.previous = this.offset; this.irreversible = this.rest; this.magnetisation = 0.0; }
  /// A small DC offset in the field (a slightly asymmetric tape): even harmonics.
  setOffset(offset: f32): void {
    if (offset != this.offset) { this.offset = offset; this.rest = fastTanh(offset); this.previous = offset; this.irreversible = this.rest; }
  }
  next(h: f32): f32 {
    const field = h + this.offset;
    const anhysteretic = fastTanh(field);
    const dh = field - this.previous;
    const gap = anhysteretic - this.irreversible;
    if (dh * gap > 0.0) {
      const x = abs(dh) / this.width;
      this.irreversible += gap * (x / (1.0 + x));
    }
    this.previous = field;
    this.magnetisation = anhysteretic;
    return this.reversible * anhysteretic + (1.0 - this.reversible) * this.irreversible - this.rest;
  }
}

/// The transport's two modulations for one channel (or for the part both channels share): wow, a slow pitch wander of 0.5 to 2 Hz (a sine
/// whose frequency itself wanders, plus a random walk), and flutter, a faster one of 6 to 15 Hz (two tones that jitter, plus some noise).
/// Evaluated once per block; returns the extra delay in samples.
class Modulation {
  private wowPhase: f64 = 0;
  private flutterA: f64 = 0;
  private flutterB: f64 = 0;
  private wowFrequency: NoiseLfo;
  private wowWalk: NoiseLfo;
  private jitterA: NoiseLfo;
  private jitterB: NoiseLfo;
  private flutterNoise: NoiseLfo;
  constructor(blockRate: f64, salt: u32) {
    this.wowFrequency = new NoiseLfo(blockRate, salt);
    this.wowWalk = new NoiseLfo(blockRate, salt + 1);
    this.jitterA = new NoiseLfo(blockRate, salt + 2);
    this.jitterB = new NoiseLfo(blockRate, salt + 3);
    this.flutterNoise = new NoiseLfo(blockRate, salt + 4);
    this.wowPhase = <f64>(salt & 255) / 256.0;
    this.flutterA = <f64>((salt >> 4) & 255) / 256.0;
    this.flutterB = <f64>((salt >> 9) & 255) / 256.0;
  }
  next(dt: f64, wowSamples: f64, flutterSamples: f64): f64 {
    const wf = Math.pow(2.0, 0.9 * <f64>this.wowFrequency.next(0.35));
    this.wowPhase += wf * dt; this.wowPhase -= Math.floor(this.wowPhase);
    const wow = 0.7 * Math.sin(TWO_PI * this.wowPhase) + 0.45 * <f64>this.wowWalk.next(0.7);
    this.flutterA += 7.3 * (1.0 + 0.15 * <f64>this.jitterA.next(1.3)) * dt; this.flutterA -= Math.floor(this.flutterA);
    this.flutterB += 12.1 * (1.0 + 0.1 * <f64>this.jitterB.next(1.9)) * dt; this.flutterB -= Math.floor(this.flutterB);
    const flutter = 0.6 * Math.sin(TWO_PI * this.flutterA) + 0.4 * Math.sin(TWO_PI * this.flutterB) + 0.3 * <f64>this.flutterNoise.next(9.0);
    return wowSamples * wow + flutterSamples * flutter;
  }
}

/// Occasional short dips in the signal level, at random (seeded) times: a worn or badly coated tape. It runs once per block (32 samples), which
/// is plenty for dips that last 5 to 60 ms; the channel then moves the gain linearly from block to block.
class Dropouts {
  gain: f32 = 1;
  rate: f64 = 0;
  private rng: Xorshift;
  private length: i32 = 0;
  private position: i32 = 0;
  private depth: f32 = 0;
  private blocksPerSecond: f64;
  constructor(sampleRate: f64, salt: u32) { this.rng = new Xorshift(salt); this.blocksPerSecond = sampleRate / 32.0; }
  reset(): void { this.length = 0; this.position = 0; this.gain = 1.0; }
  next(): void {
    if (this.length > 0) {
      const t = <f32>this.position / <f32>this.length;
      const tri = 1.0 - abs(2.0 * t - 1.0);
      const w = tri * tri * (3.0 - 2.0 * tri);
      this.gain = <f32>(1.0 - (1.0 - this.depth) * w);
      this.position++;
      if (this.position >= this.length) { this.length = 0; this.gain = 1.0; }
    } else if (<f64>this.rng.nextU32() < this.rate / this.blocksPerSecond * 4294967296.0) {
      // 5 to 60 ms long, 4 to 22 dB deep
      this.length = <i32>((0.005 + 0.055 * <f64>this.rng.next()) * this.blocksPerSecond);
      this.position = 0;
      this.depth = dbToLin(-4.0 - 18.0 * <f64>this.rng.next());
    }
  }
}

/// What the knobs and the speed and tape choices decide, computed once per block and read by both channels.
class Spec {
  drive: f32 = 2;
  invField: f32 = 1;
  fieldScale: f32 = 1;
  outGain: f32 = 1;
  compression: f32 = 0;
  makeup: f32 = 1;
  hiss: f32 = 0;
  grain: f32 = 0;
  latency: i32 = 0;
  base: i32 = 288;
  wowSamples: f64 = 0;
  flutterSamples: f64 = 0;
}

/// One channel of the machine.
class TapeChannel {
  readonly pre: Shelf = new Shelf();
  readonly de: Shelf = new Shelf();
  readonly hysteresis: Hysteresis = new Hysteresis();
  readonly hp: Biquad = new Biquad();
  readonly bump: Biquad = new Biquad();
  readonly gap: Biquad = new Biquad();
  readonly grainFilter: OnePole = new OnePole();
  readonly dropouts: Dropouts;
  delay: f32 = 0;
  delayStep: f32 = 0;
  dropGain: f32 = 1;
  dropStep: f32 = 0;
  saturation: f32 = 0;
  private os2: Oversampler2x = new Oversampler2x();
  private os4: Oversampler4x = new Oversampler4x();
  private line: DelayLine;
  private noise: Xorshift;
  private envelope: f32 = 0;
  private attack: f32;
  private release: f32;

  constructor(sampleRate: f64, salt: u32) {
    const base = <i32>Math.ceil(BASE_SECONDS * sampleRate);
    this.line = new DelayLine(2 * base + 80);
    this.noise = new Xorshift(salt);
    this.dropouts = new Dropouts(sampleRate, salt + 7);
    this.attack = <f32>(1.0 - Math.exp(-1.0 / (sampleRate * 0.002)));
    this.release = <f32>(1.0 - Math.exp(-1.0 / (sampleRate * 0.12)));
    this.grainFilter.setLowpass(sampleRate, 800.0);
  }

  reset(): void {
    this.pre.reset(); this.de.reset(); this.hysteresis.reset(); this.hp.reset(); this.bump.reset(); this.gap.reset(); this.grainFilter.reset();
    this.dropouts.reset(); this.os2.reset(); this.os4.reset(); this.line.reset(); this.envelope = 0.0;
  }

  next(x: f32, s: Spec, quality: i32): f32 {
    this.line.write(x);
    this.delay += this.delayStep;
    const w = this.line.readCubic(this.delay);
    // tape compression: a slow, soft gain reduction that follows the level
    const a = abs(w);
    this.envelope += (a - this.envelope) * (a > this.envelope ? this.attack : this.release);
    const squeeze: f32 = 1.0 / (1.0 + s.compression * this.envelope * this.envelope);
    // into the tape: drive, then the pre-emphasis that makes the treble saturate earlier
    const u = this.pre.next(w * squeeze * s.makeup * s.drive);
    let m: f32;
    if (quality == 0) {
      this.os2.up(u);
      const p = this.hysteresis.next(this.os2.a * s.invField), q = this.hysteresis.next(this.os2.b * s.invField);
      this.saturation = abs(this.hysteresis.magnetisation);
      m = this.os2.down(p, q);
    } else {
      this.os4.up(u);
      const p = this.hysteresis.next(this.os4.a * s.invField), q = this.hysteresis.next(this.os4.b * s.invField);
      const r = this.hysteresis.next(this.os4.c * s.invField), t = this.hysteresis.next(this.os4.d * s.invField);
      this.saturation = abs(this.hysteresis.magnetisation);
      m = this.os4.down(p, q, r, t);
    }
    m *= s.fieldScale;
    // the tape's own noise: modulation noise (the signal wobbles a little in level) and hiss, then dropouts
    const white = <f32>this.noise.nextBipolar();
    m *= 1.0 + s.grain * 4.0 * this.grainFilter.next(white);
    m += white * s.hiss;
    this.dropGain += this.dropStep;
    m *= this.dropGain;
    // playback: de-emphasis, head bump, gap and spacing loss
    m = this.de.next(m);
    m = this.gap.next(this.bump.next(this.hp.next(m + 1.0e-20)));
    const out = m * s.outGain;
    return out > 16.0 ? 16.0 : (out < -16.0 ? -16.0 : out);
  }

  dry(latency: i32): f32 { return this.line.tap(latency); }
}

@module({
  name: "Tape Machine",
  category: "Effects/Distortion",
  colour: "#b45309",
  description: "A reel-to-reel tape recorder: pre-emphasis, magnetic hysteresis with bias, head bump, gap loss, wow and flutter, hiss, dropouts and tape compression.",
  layout: [
    { row: [
      { title: "Tape", row: ["drive", "bias", "compress"] },
      { title: "Wobble", row: ["wow", "flutter", "drift"] },
      { title: "Wear", row: ["hiss", "dropouts"] },
      { title: "Output", row: ["outputDb", "mix"] },
    ] },
    { row: [
      { title: "Transport", row: ["speed", "tapeType"] },
      { title: "Setup", row: ["input", "quality"] },
    ] },
  ],
})
export class TapeMachine {
  @input({ name: "In L", type: "audio" }) l: f32 = 0;
  @input({ name: "In R", type: "audio" }) r: f32 = 0;
  @output({ name: "Out L", type: "audio" }) outL: f32 = 0;
  @output({ name: "Out R", type: "audio" }) outR: f32 = 0;

  /** The tape speed. It moves the head bump (about 150 Hz at 7.5 ips, 90 Hz at 15, 50 Hz at 30) and the high-frequency loss, raises the hiss and the wobble at slow speeds and sets how early the treble saturates. */
  @param({ name: "Speed", choices: ["7.5 ips", "15 ips", "30 ips"], init: 1, group: "Transport" }) speed: i32 = 1;
  /** The tape formulation. Modern is clean, with a high saturation level, little hiss and an open top end. Vintage saturates earlier, is warmer, has a stronger head bump and more hiss. Rough is lo-fi: early and uneven saturation, a darker top, modulation noise, hiss and frequent dropouts. */
  @param({ name: "Tape", choices: ["Modern", "Vintage", "Rough"], init: 1, group: "Transport" }) tapeType: i32 = 1;
  /** How different the two channels' wobble is. A real transport moves both channels together: 0 is identical in both, 100 % is completely independent. */
  @param({ name: "Stereo Drift", min: 0, max: 100, init: 20, unit: "%", decimals: 0, group: "Transport" }) drift: f32 = 20;
  /** Slow pitch wander, 0.5 to 2 Hz. 100 % is up to about plus and minus 10 cents at 15 ips. */
  @param({ name: "Wow", min: 0, max: 100, init: 20, unit: "%", decimals: 0, group: "Wobble" }) wow: f32 = 20;
  /** Fast pitch flutter, 6 to 15 Hz. 100 % is up to about plus and minus 4 cents at 15 ips. */
  @param({ name: "Flutter", min: 0, max: 100, init: 15, unit: "%", decimals: 0, group: "Wobble" }) flutter: f32 = 15;
  /** The level driven into the tape. More input means more saturation, more treble compression and more harmonics; the output level is compensated so that a normal signal stays about as loud. */
  @param({ name: "Input Level", min: -12, max: 24, init: 6, unit: "dB", decimals: 1, group: "Tape" }) drive: f32 = 6;
  /** The recording bias. 0 is the optimum. Negative (under-bias) widens the magnetic loop: more low-level distortion and a brighter top. Positive (over-bias) is cleaner at low levels but dull and a little quieter. */
  @param({ name: "Bias", min: -100, max: 100, init: 0, unit: "%", decimals: 0, group: "Tape" }) bias: f32 = 0;
  /** The tape's soft compression of the signal level (slow attack, slow release), before the magnetic saturation. */
  @param({ name: "Compress", min: 0, max: 100, init: 30, unit: "%", decimals: 0, group: "Tape" }) compress: f32 = 30;
  /** The tape hiss. Its level depends on the speed (slower is noisier) and on the tape; it is shaped by the playback curve. */
  @param({ name: "Hiss", min: 0, max: 100, init: 20, unit: "%", decimals: 0, group: "Wear" }) hiss: f32 = 20;
  /** How often the level dips briefly, as on a worn tape: 100 % is about one or two dropouts a second on Vintage tape. */
  @param({ name: "Dropouts", min: 0, max: 100, init: 0, unit: "%", decimals: 0, group: "Wear" }) dropouts: f32 = 0;
  /** The output level. */
  @param({ name: "Output", min: -24, max: 12, init: 0, unit: "dB", decimals: 1, group: "Output" }) outputDb: f32 = 0;
  /** Dry against processed. The dry signal is delayed by the same fixed delay and latency as the processed one. */
  @param({ name: "Mix", min: 0, max: 100, init: 100, unit: "%", decimals: 0, group: "Output" }) mix: f32 = 100;
  /** Where the right input comes from. Auto uses the left input for both channels when nothing is patched into In R. */
  @param({ name: "Input", choices: ["Auto", "Stereo", "Mono"], group: "Setup" }) input: i32 = 0;
  /** The oversampling around the magnetic stage. Eco runs at 2 times, Normal at 4 times (less aliasing on bright, hard-driven signals, more processing). */
  @param({ name: "Quality", choices: ["Eco", "Normal"], init: 1, group: "Setup" }) quality: i32 = 1;

  /** How far into saturation the tape is driven (1 is fully saturated). */
  @probe saturation: f32 = 0;
  /** The output level. */
  @probe level: f32 = 0;
  /** How deep the current dropout is (0 is none, 1 is silence). */
  @probe dropout: f32 = 0;
  /** The pitch deviation of the left channel from wow and flutter right now, in cents. */
  @probe wobble: f32 = 0;

  private cl: TapeChannel;
  private cr: TapeChannel;
  private spec: Spec = new Spec();
  private sense: InputSense;
  private common: Modulation;
  private sideL: Modulation;
  private sideR: Modulation;
  private sampleRate: f64;
  private base: i32;
  private latency2: i32;
  private latency4: i32;
  private mixSmooth: Smoother;
  private satMeter: PeakHold;
  private levelMeter: PeakHold;
  private lastDelayL: f64 = 0;
  private lastDelayR: f64 = 0;
  private lastQuality: i32 = -1;
  private started: bool = false;

  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    this.base = <i32>Math.round(BASE_SECONDS * sampleRate);
    this.cl = new TapeChannel(sampleRate, 0x2F6E2B1);
    this.cr = new TapeChannel(sampleRate, 0x7A31C95);
    this.sense = new InputSense(sampleRate);
    this.common = new Modulation(sampleRate / 32.0, 0x1A2B3C4D);
    this.sideL = new Modulation(sampleRate / 32.0, 0x0F1E2D3C);
    this.sideR = new Modulation(sampleRate / 32.0, 0x5E6F7A8B);
    this.mixSmooth = new Smoother(sampleRate, 0.005);
    this.satMeter = new PeakHold(sampleRate, 0.3);
    this.levelMeter = new PeakHold(sampleRate, 0.3);
    this.latency2 = new Oversampler2x().latency;
    this.latency4 = new Oversampler4x().latency;
  }

  reset(): void {
    this.cl.reset(); this.cr.reset(); this.sense.reset(); this.satMeter.reset(); this.levelMeter.reset();
  }

  block(): void {
    const sr = this.sampleRate;
    const nyq = 0.45 * sr;
    const sp = this.speed, ty = this.tapeType;
    const bias = <f64>this.bias * 0.01;
    const under = max(-bias, 0.0), over = max(bias, 0.0);
    // speed: head bump frequency and size, gap loss corner, pre-emphasis corner, hiss and wobble scale
    const bumpHz = sp == 0 ? 150.0 : (sp == 1 ? 90.0 : 50.0);
    const bumpDb = (sp == 0 ? 3.0 : (sp == 1 ? 3.5 : 4.0)) * (ty == 0 ? 0.8 : (ty == 1 ? 1.2 : 1.0));
    const gapHz = (sp == 0 ? 11000.0 : (sp == 1 ? 17000.0 : 24000.0)) * (ty == 0 ? 1.1 : (ty == 1 ? 0.85 : 0.65)) * (1.0 - 0.3 * over + 0.1 * under);
    const preHz = sp == 0 ? 2300.0 : (sp == 1 ? 4600.0 : 9100.0);
    const hissScale = (sp == 0 ? 2.2 : (sp == 1 ? 1.0 : 0.5)) * (ty == 0 ? 0.5 : (ty == 1 ? 1.0 : 2.0));
    const wobScale = sp == 0 ? 1.6 : (sp == 1 ? 1.0 : 0.6);
    // tape: saturation field, loop width, reversible share, asymmetry
    const field = ty == 0 ? 0.75 : (ty == 1 ? 0.55 : 0.45);
    const width = (ty == 0 ? 0.04 : (ty == 1 ? 0.07 : 0.12)) * (1.0 + 4.0 * under) * (1.0 - 0.5 * over);
    const rev = min(max((ty == 0 ? 0.94 : (ty == 1 ? 0.88 : 0.8)) - 0.45 * under + 0.05 * over, 0.25), 0.99);
    const asym = ty == 0 ? 0.02 : (ty == 1 ? 0.05 : 0.09);
    const g = dbToLin(<f64>this.drive);
    // level compensation: a signal at -18 dBFS comes out about as loud for every drive setting
    const comp = 0.12 / (field * Math.tanh(0.12 * g / field));
    const spec = this.spec;
    spec.drive = <f32>g;
    spec.invField = <f32>(1.0 / field);
    spec.fieldScale = <f32>field;
    spec.outGain = <f32>(comp * dbToLin(<f64>this.outputDb - 1.5 * over));
    const cmp = <f64>this.compress * 0.01;
    spec.compression = <f32>(10.0 * cmp);
    spec.makeup = <f32>(1.0 + 0.12 * cmp);
    const h = <f64>this.hiss * 0.01;
    spec.hiss = <f32>(0.01 * h * h * hissScale);
    spec.grain = <f32>(ty == 0 ? 0.0 : (ty == 1 ? 0.04 : 0.12));
    const q = this.quality == 0 ? 0 : 1;
    spec.latency = q == 0 ? this.latency2 : this.latency4;
    spec.base = this.base;
    // wow and flutter amplitudes (delay in samples): pitch deviation 0.5 % (wow) and 0.25 % (flutter) at 100 %
    const w = <f64>this.wow * 0.01, f = <f64>this.flutter * 0.01;
    spec.wowSamples = w * 0.005 * wobScale * sr / TWO_PI * (ty == 2 ? 1.3 : 1.0);
    spec.flutterSamples = f * 0.0025 * wobScale * sr / (TWO_PI * 10.0) * (ty == 2 ? 1.5 : 1.0);
    if (q != this.lastQuality) { this.lastQuality = q; this.cl.reset(); this.cr.reset(); }
    for (let c = 0; c < 2; c++) {
      const ch = c == 0 ? this.cl : this.cr;
      ch.pre.set(sr, preHz, min(3.0 * preHz, nyq));
      ch.de.set(sr, min(3.0 * preHz, nyq), preHz);
      ch.hysteresis.width = <f32>width; ch.hysteresis.reversible = <f32>rev;
      ch.hysteresis.setOffset(<f32>asym);
      ch.hp.setHighpass(sr, bumpHz / 5.0, 0.6);
      ch.bump.setPeaking(sr, bumpHz, 0.8, bumpDb);
      ch.gap.setLowpass(sr, min(gapHz, nyq), 0.6);
      const d = <f64>this.dropouts * 0.01;
      ch.dropouts.rate = 1.5 * d * d * (ty == 0 ? 0.5 : (ty == 1 ? 1.0 : 2.0));
    }
    // wow and flutter: the part both channels share plus a part of their own
    const dr = <f64>this.drift * 0.01;
    const shared = Math.sqrt(1.0 - dr * dr);
    const dt = 32.0 / sr;
    const cm = this.common.next(dt, spec.wowSamples, spec.flutterSamples);
    const dl = <f64>this.base + shared * cm + dr * this.sideL.next(dt, spec.wowSamples, spec.flutterSamples);
    const drr = <f64>this.base + shared * cm + dr * this.sideR.next(dt, spec.wowSamples, spec.flutterSamples);
    const lo = 3.0, hi = <f64>(2 * this.base + 40);
    const dL = min(max(dl, lo), hi), dR = min(max(drr, lo), hi);
    if (!this.started) { this.lastDelayL = dL; this.lastDelayR = dR; this.cl.delay = <f32>dL; this.cr.delay = <f32>dR; }
    this.cl.delay = <f32>this.lastDelayL; this.cr.delay = <f32>this.lastDelayR;
    this.cl.delayStep = <f32>((dL - this.lastDelayL) / 32.0);
    this.cr.delayStep = <f32>((dR - this.lastDelayR) / 32.0);
    this.lastDelayL = dL; this.lastDelayR = dR;
    // a delay that grows by x samples per sample lowers the pitch by that ratio
    this.wobble = <f32>(-1731.2 * <f64>this.cl.delayStep);
    this.dropout = <f32>(1.0 - min(this.cl.dropouts.gain, this.cr.dropouts.gain));
    for (let c = 0; c < 2; c++) {
      const ch = c == 0 ? this.cl : this.cr;
      const before = ch.dropouts.gain;
      ch.dropouts.next();
      ch.dropGain = before;
      ch.dropStep = (ch.dropouts.gain - before) / 32.0;
    }
    this.mixSmooth.target = <f32>(<f64>this.mix * 0.01);
    if (!this.started) { this.started = true; this.mixSmooth.snap(); }
  }

  sample(): void {
    const rr = this.sense.next(this.l, this.r, this.input);
    const q = this.quality == 0 ? 0 : 1;
    const yl = this.cl.next(this.l, this.spec, q);
    const yr = this.cr.next(rr, this.spec, q);
    const m = this.mixSmooth.next();
    const dl = this.cl.dry(this.base + this.spec.latency), dr = this.cr.dry(this.base + this.spec.latency);
    const ol = dl + (yl - dl) * m, or = dr + (yr - dr) * m;
    this.outL = ol; this.outR = or;
    this.saturation = this.satMeter.next(max(this.cl.saturation, this.cr.saturation));
    this.level = this.levelMeter.next(max(abs(ol), abs(or)));
  }
}
