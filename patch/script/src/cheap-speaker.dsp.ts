// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Cheap Speaker: the sound of a small, poor playback device. Six devices (telephone, AM radio, car speaker, cassette player, tiny speaker,
// megaphone), each a fixed designed curve: two fourth-order Butterworth sections for the low and high corners (so the corners are the real
// -3 dB points), two resonances, a device-specific non-linearity (carbon-microphone asymmetry, envelope detector, cone excursion limit, hard horn
// clipping) running at twice the sample rate with first-order anti-derivative anti-aliasing, and a noise bed that is shaped by the same curve.

import { Biquad, AdaaTanh, Smoother, PeakHold, dbToLin } from "./bleep/dsp";
import { OnePole } from "./bleep/filters";
import { Oversampler2x } from "./bleep/dynamics";
import { DelayLine } from "./bleep/delay";
import { Xorshift, BrownNoise, NoiseLfo } from "./bleep/random";
import { fastTanh } from "./bleep/util";

const TWO_PI: f64 = 6.283185307179586;
const WOW_MAX_SECONDS: f64 = 0.003;      // the most the delay is modulated, per side
const BASE_SECONDS: f64 = 0.0032;        // the fixed delay the wow rides on; the dry path is delayed by the same amount

/// Decides whether the right input is patched. It is taken as unpatched when it has been exactly 0 for 2048 samples while the left input is not.
class InputSense {
  amount: f32 = 1;
  private target: f32 = 1;
  private zeroR: i32 = 0;
  private coefficient: f32;
  constructor(sampleRate: f64) { this.coefficient = <f32>(1.0 - Math.exp(-1.0 / (sampleRate * 0.005))); }
  reset(): void { this.amount = 1.0; this.target = 1.0; this.zeroR = 0; }
  /// The right sample to use: the real one, or the left one when R is not patched (mode 0 auto, 1 stereo, 2 mono).
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

/// Everything the device choice and the knobs decide, computed once per block and read by both channels.
class Spec {
  hp: f64 = 300; lp: f64 = 3400;
  p1f: f64 = 1000; p1q: f64 = 1; p1g: f64 = 0;
  p2f: f64 = 2000; p2q: f64 = 1; p2g: f64 = 0;
  gain: f32 = 1; bias: f32 = 0; hard: f32 = 0;
  off: f32 = 0; invSlope: f32 = 1;
  excLimit: f32 = 0; rattle: f32 = 0;
  wowSamples: f32 = 0; cabin: f32 = 0;
  makeup: f32 = 1;
  nWhite: f32 = 0; nBright: f32 = 0; nBrown: f32 = 0; nHum: f32 = 0; nCrackle: f32 = 0; nWhistle: f32 = 0;
  crackleP: f64 = 0; crackleDecay: f32 = 0.9;
  humCos: f64 = 1; humSin: f64 = 0; whistleCos: f64 = 1; whistleSin: f64 = 0;
  baseSamples: i32 = 154;
  latency: i32 = 0;

  /// Sets everything for one device. `dist`, `noise`, `wobble`, `res` run from 0 to 1, `bw` is the corner scale (1 = as designed).
  configure(sampleRate: f64, device: i32, bw: f64, res: f64, dist: f64, noise: f64, wobble: f64, drift: f64, tune: f64, osLatency: i32): void {
    let hp: f64 = 300, lp: f64 = 3400;
    let p1f: f64 = 1200, p1q: f64 = 1.4, p1g: f64 = 6, p2f: f64 = 2400, p2q: f64 = 2.0, p2g: f64 = 2.5;
    let g: f64 = 6, bias: f64 = 0.3, hard: f64 = 0, exc: f64 = 0, rattle: f64 = 0, wow: f64 = 0, cabin: f64 = 0, mk: f64 = 5;
    let nWhite: f64 = 0, nBright: f64 = 0, nBrown: f64 = 0, nHum: f64 = 0, nCrk: f64 = 0, nWhi: f64 = 0, crk: f64 = 0;
    if (device == 0) {          // telephone: 300 Hz - 3.4 kHz, nasal mid peak, carbon-microphone asymmetry, line hiss and hum
      hp = 300; lp = 3400; p1f = 1200; p1q = 1.4; p1g = 6; p2f = 2400; p2q = 2.0; p2g = 2.5;
      g = 1.0 + 7.0 * dist; bias = 0.3; hard = 0.0; mk = 1.5;
      nWhite = 0.7; nHum = 0.6; nCrk = 0.25; crk = 3.0;
    } else if (device == 1) {   // AM radio: 120 Hz - 4.5 kHz, envelope-detector asymmetry, static, hiss, heterodyne whistle
      hp = 120; lp = 4500; p1f = 1800; p1q = 1.0; p1g = 2.5; p2f = 300; p2q = 1.2; p2g = 2.5;
      g = 1.0 + 5.0 * dist; bias = 0.55; hard = 0.0; wow = 0.12; mk = 1.0;
      nWhite = 0.5; nCrk = 1.0; crk = 14.0; nWhi = 0.45;
    } else if (device == 2) {   // car speaker: bass roll-off 80 Hz, boxy cavity, cone breakup, cabin reflection
      hp = 80; lp = 7500; p1f = 300; p1q = 1.6; p1g = 4; p2f = 5500; p2q = 3.0; p2g = 4;
      g = 1.0 + 3.0 * dist; bias = 0.05; hard = 0.2; exc = 0.9; cabin = 0.2; mk = 1.5;
      nWhite = 0.12; nBrown = 0.9;
    } else if (device == 3) {   // cassette player: HF loss, head bump, wow, tape hiss
      hp = 50; lp = 9000; p1f = 100; p1q = 0.8; p1g = 2.5; p2f = 6500; p2q = 0.9; p2g = -3;
      g = 1.0 + 3.0 * dist; bias = 0.0; hard = 0.0; wow = 1.0; mk = 0.5;
      nWhite = 0.15; nBright = 0.9; nHum = 0.12;
    } else if (device == 4) {   // tiny speaker: steep LF cut at 300 Hz, sharp resonance, excursion limit, rattle
      hp = 300; lp = 9500; p1f = 2200; p1q = 5.0; p1g = 9; p2f = 900; p2q = 1.0; p2g = 3;
      g = 1.0 + 5.0 * dist; bias = 0.12; hard = 0.5; exc = 0.5; rattle = 1.0; mk = 2.5;
      nWhite = 0.25; nHum = 0.3; nCrk = 0.12; crk = 2.0;
    } else {                    // megaphone: 500 Hz - 4 kHz, horn resonance, hard clipping
      hp = 500; lp = 4000; p1f = 1500; p1q = 2.5; p1g = 8; p2f = 2700; p2q = 3.0; p2g = 4;
      g = 1.0 + 13.0 * dist; bias = 0.0; hard = 0.9; mk = 2.0;
      nWhite = 0.5; nCrk = 0.2; crk = 5.0; nWhi = 0.0; nHum = 0.0;
    }
    const nyq = sampleRate * 0.45;
    // slow drift moves the low-pass corner a little (tuning drift, supply sag)
    const d = 1.0 + 0.12 * wobble * drift;
    this.hp = min(max(hp / bw, 10.0), nyq);
    this.lp = min(max(lp * bw * d, 100.0), nyq);
    const rs = res * 2.0;     // knob at 50 % is the designed resonance
    this.p1f = min(p1f, nyq); this.p1q = p1q; this.p1g = p1g * rs;
    this.p2f = min(p2f, nyq); this.p2q = p2q; this.p2g = p2g * rs;
    this.gain = <f32>g; this.bias = <f32>bias; this.hard = <f32>hard;
    // the shaper is normalised: its output at the bias point is removed and its slope there is 1, so small signals pass at unit gain
    const f0 = curve(bias, hard);
    const slope = max(curveSlope(bias, hard), 0.05);
    this.off = <f32>f0;
    this.invSlope = <f32>(1.0 / (slope * g));
    // half of the level compensation, in dB: what the shaper does to a -12 dB signal is partly given back
    const shaped = (curve(0.25 * g + bias, hard) - f0) / (slope * g);
    const comp = shaped > 0.01 ? Math.sqrt(0.25 / shaped) : 1.0;
    this.makeup = <f32>(comp * dbToLin(mk));
    this.excLimit = exc > 0.0 ? <f32>max(exc * (1.0 - 0.85 * dist), 0.04) : 0.0;
    this.rattle = <f32>(rattle * 0.5 * dist);
    this.wowSamples = <f32>(wow * wobble * WOW_MAX_SECONDS * sampleRate * 0.5);
    this.cabin = <f32>(cabin * rs);
    const ng = noise * noise * 0.1;
    this.nWhite = <f32>(nWhite * ng); this.nBright = <f32>(nBright * ng); this.nBrown = <f32>(nBrown * ng * 0.5);
    this.nHum = <f32>(nHum * ng * 0.7); this.nCrackle = <f32>(nCrk * ng * 2.5); this.nWhistle = <f32>(nWhi * noise * 0.06);
    this.crackleP = crk * (0.4 + noise) / sampleRate;
    this.crackleDecay = <f32>Math.exp(-1.0 / (sampleRate * 0.0004));
    const hw = TWO_PI * 50.0 / sampleRate, ww = TWO_PI * (2500.0 + 350.0 * tune * (wobble * 0.7 + 0.3)) / sampleRate;
    this.humCos = Math.cos(hw); this.humSin = Math.sin(hw); this.whistleCos = Math.cos(ww); this.whistleSin = Math.sin(ww);
    this.baseSamples = <i32>Math.round(BASE_SECONDS * sampleRate);
    this.latency = this.baseSamples + osLatency;
  }
}

/// The curve: a cubic soft limiter (levels off at 2/3) blended with a hard clipper (levels off at 1) by `hard`; both have slope 1 at 0.
function curve(u: f64, hard: f64): f64 {
  const a = abs(u);
  const soft = a < 1.0 ? u - u * u * u / 3.0 : (u < 0.0 ? -0.6666667 : 0.6666667);
  const clip = a < 1.0 ? u : (u < 0.0 ? -1.0 : 1.0);
  return soft + (clip - soft) * hard;
}
/// The slope of the curve.
function curveSlope(u: f64, hard: f64): f64 {
  return abs(u) < 1.0 ? (1.0 - u * u) * (1.0 - hard) + hard : 0.0;
}

/// The curve with first-order anti-derivative anti-aliasing: the average of the curve between the last and the current sample, from its
/// antiderivative (a polynomial, so there is no transcendental function in the sample loop).
class Shaper {
  private x1: f64 = 0;
  private f1: f64 = 0;
  reset(): void { this.x1 = 0; this.f1 = 0; }
  /// Starts from rest at the working point `x` (the bias), so that the first samples are not a step.
  prime(x: f64, h: f64): void {
    const a = abs(x), q = x * x;
    const fs = a < 1.0 ? 0.5 * q - q * q / 12.0 : 0.6666667 * a - 0.25;
    const fc = a < 1.0 ? 0.5 * q : a - 0.5;
    this.x1 = x; this.f1 = fs + (fc - fs) * h;
  }
  next(x: f32, hard: f32): f32 {
    const xi = <f64>x, h = <f64>hard;
    const a = abs(xi), q = xi * xi;
    const fs = a < 1.0 ? 0.5 * q - q * q / 12.0 : 0.6666667 * a - 0.25;
    const fc = a < 1.0 ? 0.5 * q : a - 0.5;
    const f = fs + (fc - fs) * h;
    const dx = xi - this.x1;
    let y: f64;
    if (abs(dx) < 0.00001) y = curve(0.5 * (xi + this.x1), h);
    else y = (f - this.f1) / dx;
    this.x1 = xi; this.f1 = f;
    return <f32>y;
  }
}

/// The noise generators of one channel. `pre` is added before the device curve (so it is shaped by it), `post` after it.
class NoiseBed {
  pre: f32 = 0;
  post: f32 = 0;
  private white: Xorshift;
  private brown: BrownNoise;
  private envelope: f32 = 0;
  private previous: f32 = 0;
  private hs: f64 = 0; private hc: f64 = 1;       // hum oscillator (quadrature state)
  private ws: f64 = 0; private wc: f64 = 1;       // whistle oscillator
  reset(): void { this.envelope = 0.0; this.pre = 0.0; this.post = 0.0; this.hs = 0.0; this.hc = 1.0; this.ws = 0.0; this.wc = 1.0; }
  constructor(salt: u32) {
    this.white = new Xorshift(salt);
    this.brown = new BrownNoise(salt + 31);
  }
  next(s: Spec): void {
    const u = this.white.nextU32();
    const w = <f32>(u >> 8) * (1.0 / 8388608.0) - 1.0;
    if (<f64>(u & 0xFFFF) < s.crackleP * 65536.0) this.envelope = w * 4.0;
    this.envelope *= s.crackleDecay;
    // rotate the two oscillators; (3 - r^2) / 2 keeps the amplitude at 1
    const hs = this.hs * s.humCos + this.hc * s.humSin, hc = this.hc * s.humCos - this.hs * s.humSin;
    const hn = 1.5 - 0.5 * (hs * hs + hc * hc);
    this.hs = hs * hn; this.hc = hc * hn;
    const ws = this.ws * s.whistleCos + this.wc * s.whistleSin, wc = this.wc * s.whistleCos - this.ws * s.whistleSin;
    const wn = 1.5 - 0.5 * (ws * ws + wc * wc);
    this.ws = ws * wn; this.wc = wc * wn;
    const hum = <f32>(this.hs + 0.5 * (2.0 * this.hs * this.hc) + 0.25 * (3.0 * this.hs - 4.0 * this.hs * this.hs * this.hs));
    this.pre = w * s.nWhite + (w - this.previous) * s.nBright + this.envelope * s.nCrackle + <f32>this.ws * s.nWhistle;
    this.previous = w;
    this.post = this.brown.next() * s.nBrown + hum * s.nHum;
  }
}

/// One channel of the speaker.
class SpeakerChannel {
  readonly hp1: Biquad = new Biquad();
  readonly hp2: Biquad = new Biquad();
  readonly lp1: Biquad = new Biquad();
  readonly lp2: Biquad = new Biquad();
  readonly pk1: Biquad = new Biquad();
  readonly pk2: Biquad = new Biquad();
  readonly rattleFilter: Biquad = new Biquad();
  readonly low: OnePole = new OnePole();
  readonly cabinLow: OnePole = new OnePole();
  readonly wow: Smoother;
  readonly gainSmooth: Smoother;
  private os: Oversampler2x = new Oversampler2x();
  private shaper: Shaper = new Shaper();
  private line: DelayLine;
  private cabinLine: DelayLine;
  private noise: NoiseBed;
  private rattleRng: Xorshift;
  cone: f32 = 0;
  private primed: bool = false;
  private cabin1: i32 = 0;
  private cabin2: i32 = 0;

  constructor(sampleRate: f64, salt: u32) {
    const base = <i32>Math.ceil(BASE_SECONDS * sampleRate);
    const wow = <i32>Math.ceil(WOW_MAX_SECONDS * sampleRate);
    this.line = new DelayLine(base + wow + 40);
    this.cabinLine = new DelayLine(<i32>Math.ceil(0.008 * sampleRate) + 8);
    this.noise = new NoiseBed(salt);
    this.rattleRng = new Xorshift(salt + 99);
    this.wow = new Smoother(sampleRate, 0.01);
    this.gainSmooth = new Smoother(sampleRate, 0.02);
    this.gainSmooth.target = 1.0; this.gainSmooth.snap();
    this.wow.target = 0.0; this.wow.snap();
    this.cabin1 = <i32>Math.round(0.0029 * sampleRate);
    this.cabin2 = <i32>Math.round(0.0051 * sampleRate);
  }

  reset(): void {
    this.hp1.reset(); this.hp2.reset(); this.lp1.reset(); this.lp2.reset(); this.pk1.reset(); this.pk2.reset(); this.rattleFilter.reset();
    this.low.reset(); this.cabinLow.reset(); this.os.reset(); this.shaper.reset(); this.primed = false; this.line.reset(); this.cabinLine.reset(); this.noise.reset();
  }

  setup(sampleRate: f64, s: Spec): void {
    if (!this.primed) { this.primed = true; this.shaper.prime(<f64>s.bias, <f64>s.hard); }
    // 4th-order Butterworth = two sections with these Q values: the corner is exactly the -3 dB point
    this.hp1.setHighpass(sampleRate, s.hp, 0.5411961);
    this.hp2.setHighpass(sampleRate, s.hp, 1.3065630);
    this.lp1.setLowpass(sampleRate, s.lp, 0.5411961);
    this.lp2.setLowpass(sampleRate, s.lp, 1.3065630);
    this.pk1.setPeaking(sampleRate, s.p1f, s.p1q, s.p1g);
    this.pk2.setPeaking(sampleRate, s.p2f, s.p2q, s.p2g);
    this.low.setLowpass(sampleRate, 450.0);
    this.cabinLow.setLowpass(sampleRate, 3500.0);
    this.rattleFilter.setBandpass(sampleRate, 1800.0, 1.5);
  }

  next(x: f32, s: Spec, wowShift: f32): f32 {
    this.line.write(x);
    const wet = this.line.readCubic(<f32>s.baseSamples + wowShift * this.wow.next());
    // cone excursion: the bass part saturates early, which loses bass at high level; what it cannot follow rattles
    let y = wet;
    let rat: f32 = 0;
    if (s.excLimit > 0.0) {
      const lw = this.low.next(wet);
      const lc = s.excLimit * fastTanh(lw / s.excLimit);
      y = wet - lw + lc;
      rat = lw - lc;
      this.cone = abs(lc) / s.excLimit;
    } else this.cone = 0.0;
    // the main non-linearity, at twice the sample rate
    this.os.up(y);
    const a = (this.shaper.next(this.os.a * s.gain + s.bias, s.hard) - s.off) * s.invSlope;
    const b = (this.shaper.next(this.os.b * s.gain + s.bias, s.hard) - s.off) * s.invSlope;
    let z = this.os.down(a, b);
    this.noise.next(s);
    z += this.noise.pre + this.rattleFilter.next(rat * this.rattleRng.nextBipolar()) * s.rattle;
    z += 1.0e-20;
    z = this.hp2.next(this.hp1.next(z));
    z = this.pk2.next(this.pk1.next(z));
    z = this.lp2.next(this.lp1.next(z));
    if (s.cabin > 0.0) {
      this.cabinLine.write(z);
      z += s.cabin * (0.7 * this.cabinLow.next(this.cabinLine.tap(this.cabin1)) + 0.4 * this.cabinLine.tap(this.cabin2));
    }
    z += this.noise.post;
    const out = z * s.makeup * this.gainSmooth.next();
    return out > 16.0 ? 16.0 : (out < -16.0 ? -16.0 : out);
  }

  /// The input delayed by the latency of the wet path, for the dry side of the mix.
  dry(latency: i32): f32 { return this.line.tap(latency); }
}

@module({
  name: "Cheap Speaker",
  category: "Effects/Distortion",
  colour: "#b45309",
  description: "Tonal lo-fi: the bandwidth, resonances, distortion and noise of a telephone, an AM radio, a car speaker, a cassette player, a tiny speaker or a megaphone.",
  layout: [
    { row: [
      { title: "Device", column: ["device", "bandwidth", "resonance"] },
      { title: "Damage", column: ["distortion", "noise", "wobble"] },
      { title: "Output", column: ["outputDb", "mix"] },
      { title: "Level", column: [{ meter: "level" }] },
    ] },
    { title: "Setup", row: ["input"] },
  ],
})
export class CheapSpeaker {
  @input({ name: "In L", type: "audio" }) l: f32 = 0;
  @input({ name: "In R", type: "audio" }) r: f32 = 0;
  @output({ name: "Out L", type: "audio" }) outL: f32 = 0;
  @output({ name: "Out R", type: "audio" }) outR: f32 = 0;

  /** The device: its bandwidth, resonances and the way it distorts. Telephone 300 Hz to 3.4 kHz, AM radio 120 Hz to 4.5 kHz, car speaker with a boxy cavity and a cabin reflection, cassette player with wow and hiss, tiny speaker with a sharp resonance and an excursion limit, megaphone with a horn resonance and hard clipping. */
  @param({ name: "Device", choices: ["Telephone", "AM Radio", "Car Speaker", "Cassette Player", "Tiny Speaker", "Megaphone"], group: "Device" }) device: i32 = 0;
  /** Scales both corners of the device: above 100 % the band is wider, below it is narrower. */
  @param({ name: "Bandwidth", min: 50, max: 200, init: 100, map: "exp", unit: "%", decimals: 0, group: "Device" }) bandwidth: f32 = 100;
  /** The strength of the device's characteristic peaks. 50 % is as designed, 0 % is flat, 100 % is twice as strong (in dB). */
  @param({ name: "Resonance", min: 0, max: 100, init: 50, unit: "%", decimals: 0, group: "Device" }) resonance: f32 = 50;
  /** How hard the device is driven: speaker excursion and clipping. It depends on level, so quiet material stays cleaner. The loudness is partly compensated. */
  @param({ name: "Distortion", min: 0, max: 100, init: 40, unit: "%", decimals: 0, group: "Damage" }) distortion: f32 = 40;
  /** The level of the device's noise: line hiss and hum, static and a whistle, road rumble, tape hiss. Noise passes through the same curve as the signal. */
  @param({ name: "Noise", min: 0, max: 100, init: 30, unit: "%", decimals: 0, group: "Damage" }) noise: f32 = 30;
  /** Slow random drift of level and top end, and for the cassette player and the radio a slow pitch wobble. */
  @param({ name: "Wobble", min: 0, max: 100, init: 20, unit: "%", decimals: 0, group: "Damage" }) wobble: f32 = 20;
  /** The output level, after the device's own make-up gain. */
  @param({ name: "Output", min: -24, max: 12, init: 0, unit: "dB", decimals: 1, group: "Output" }) outputDb: f32 = 0;
  /** Dry against processed. The dry signal is delayed to stay in phase with the processed one. */
  @param({ name: "Mix", min: 0, max: 100, init: 100, unit: "%", decimals: 0, group: "Output" }) mix: f32 = 100;
  /** Where the right input comes from. Auto uses the left input for both channels when nothing is patched into In R. */
  @param({ name: "Input", choices: ["Auto", "Stereo", "Mono"], group: "Setup" }) input: i32 = 0;

  /** The output level. */
  @probe level: f32 = 0;
  /** How far the cone is pushed towards its travel limit (0 to 1); devices without an excursion limit report the level instead. */
  @probe excursion: f32 = 0;

  private cl: SpeakerChannel;
  private cr: SpeakerChannel;
  private spec: Spec = new Spec();
  private sense: InputSense;
  private sampleRate: f64;
  private drift: NoiseLfo;
  private pitch: NoiseLfo;
  private tune: NoiseLfo;
  private mixSmooth: Smoother;
  private meter: PeakHold;
  private coneMeter: PeakHold;
  private oversamplerLatency: i32;
  private started: bool = false;

  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    this.cl = new SpeakerChannel(sampleRate, 0x2545F491);
    this.cr = new SpeakerChannel(sampleRate, 0x1B873593);
    this.sense = new InputSense(sampleRate);
    this.drift = new NoiseLfo(sampleRate / 32.0, 0x1234567);
    this.pitch = new NoiseLfo(sampleRate / 32.0, 0x7654321);
    this.tune = new NoiseLfo(sampleRate / 32.0, 0x0ABCDEF);
    this.mixSmooth = new Smoother(sampleRate, 0.005);
    this.meter = new PeakHold(sampleRate, 0.3);
    this.coneMeter = new PeakHold(sampleRate, 0.12);
    this.oversamplerLatency = new Oversampler2x().latency;
  }

  reset(): void { this.cl.reset(); this.cr.reset(); this.sense.reset(); this.meter.reset(); }

  block(): void {
    const wob = <f64>this.wobble * 0.01;
    const dr = <f64>this.drift.next(0.35);
    const pw = this.pitch.next(1.1);
    const tu = <f64>this.tune.next(0.2);
    this.spec.configure(this.sampleRate, this.device, <f64>this.bandwidth * 0.01, <f64>this.resonance * 0.01, <f64>this.distortion * 0.01,
      <f64>this.noise * 0.01, wob, dr, tu, this.oversamplerLatency);
    this.cl.setup(this.sampleRate, this.spec);
    this.cr.setup(this.sampleRate, this.spec);
    const gl = dbToLin(<f64>this.outputDb + 1.5 * wob * dr);
    this.cl.gainSmooth.target = gl; this.cr.gainSmooth.target = gl;
    // the wow is the same for both channels (one transport)
    const sh = pw;
    this.cl.wow.target = sh; this.cr.wow.target = sh;
    this.mixSmooth.target = <f32>(<f64>this.mix * 0.01);
    if (!this.started) { this.started = true; this.mixSmooth.snap(); this.cl.gainSmooth.snap(); this.cr.gainSmooth.snap(); }
  }

  sample(): void {
    const rr = this.sense.next(this.l, this.r, this.input);
    const m = this.mixSmooth.next();
    const wl = this.cl.next(this.l, this.spec, this.spec.wowSamples);
    const wr = this.cr.next(rr, this.spec, this.spec.wowSamples);
    const dl = this.cl.dry(this.spec.latency);
    const dr = this.cr.dry(this.spec.latency);
    const yl = dl + (wl - dl) * m;
    const yr = dr + (wr - dr) * m;
    this.outL = yl; this.outR = yr;
    this.level = this.meter.next(max(abs(yl), abs(yr)));
    const cone = this.cl.cone;
    this.excursion = this.coneMeter.next(this.spec.excLimit > 0.0 ? cone : min(abs(yl) * 2.0, 1.0));
  }
}
