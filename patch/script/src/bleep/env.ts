// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// bleep/env — envelopes and control signals: Adsr, Ad, Ar, EnvFollower, Slew, Lfo, Line, Ramp, Trigger, Schmitt, Clock.
// Times are in seconds. A set*/set method may call exp/log: call it in block() when a setting changed, not every sample. next() runs per sample.

import { Xorshift } from "./random";
import { fastSin } from "./osc";

const TWO_PI: f64 = 2.0 * Math.PI;

/// The stages of an Adsr (read with `stage`).
export const ENV_IDLE: i32 = 0;
export const ENV_ATTACK: i32 = 1;
export const ENV_DECAY: i32 = 2;
export const ENV_SUSTAIN: i32 = 3;
export const ENV_RELEASE: i32 = 4;

const ATTACK_OVERSHOOT: f64 = 0.3;   // the attack aims for 1.3 and stops at 1
const TAIL: f64 = 0.0001;            // decay and release aim this fraction of their travel past the end

function rateCoefficient(samples: f64, targetRatio: f64): f64 {
  return samples <= 0.0 ? 0.0 : Math.exp(-Math.log((1.0 + targetRatio) / targetRatio) / samples);
}

/// An ADSR envelope driven by a gate: `next(gate)` per sample (the gate is on from 0.5). Rises to 1 in `attack` seconds, falls to `sustain` in
/// `decay`, holds while the gate is on, and falls to 0 in `release` after it goes off. The curves are exponential (like an analogue RC envelope)
/// unless `exponential` is false, then straight lines. A gate that rises while the envelope is still sounding restarts the attack from the
/// current level (no click); set `hardRetrigger` to start from 0 instead. Call `set(...)` in block() whenever a time or the sustain changes.
export class Adsr {
  exponential: bool = true;
  hardRetrigger: bool = false;
  /// The level now (0 to 1).
  value: f32 = 0;
  private stage: i32 = 0;
  private level: f64 = 0;
  private gateOn: bool = false;
  private sampleRate: f64;
  private sustain: f64 = 0.7;
  private attackSamples: f64 = 1; private decaySamples: f64 = 1; private releaseSamples: f64 = 1;
  private attackCoef: f64 = 0; private attackBase: f64 = 0;
  private decayCoef: f64 = 0; private decayBase: f64 = 0;
  private releaseCoef: f64 = 0; private releaseBase: f64 = 0;
  private releaseStep: f64 = 0;
  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    this.set(0.01, 0.1, 0.7, 0.3);
  }
  get active(): bool { return this.stage != ENV_IDLE; }
  get currentStage(): i32 { return this.stage; }
  reset(): void { this.stage = ENV_IDLE; this.level = 0.0; this.value = 0.0; this.gateOn = false; }
  set(attack: f64, decay: f64, sustain: f64, release: f64): void {
    const sr = this.sampleRate;
    this.sustain = min(max(sustain, 0.0), 1.0);
    this.attackSamples = max(attack, 0.0) * sr;
    this.decaySamples = max(decay, 0.0) * sr;
    this.releaseSamples = max(release, 0.0) * sr;
    // exponential segments aim a little past their target, so that they arrive in exactly the time given
    this.attackCoef = rateCoefficient(this.attackSamples, ATTACK_OVERSHOOT);
    this.attackBase = (1.0 + ATTACK_OVERSHOOT) * (1.0 - this.attackCoef);
    this.decayCoef = rateCoefficient(this.decaySamples, TAIL);
    this.decayBase = (this.sustain - TAIL * (1.0 - this.sustain)) * (1.0 - this.decayCoef);
    this.releaseCoef = rateCoefficient(this.releaseSamples, TAIL);
  }
  next(gate: f32): f32 {
    const on = gate >= 0.5;
    if (on && !this.gateOn) {
      if (this.hardRetrigger) this.level = 0.0;
      this.stage = ENV_ATTACK;
    } else if (!on && this.gateOn && this.stage != ENV_IDLE) {
      this.stage = ENV_RELEASE;
      this.releaseStep = this.releaseSamples > 0.0 ? this.level / this.releaseSamples : 1.0;
      this.releaseBase = -TAIL * this.level * (1.0 - this.releaseCoef);
    }
    this.gateOn = on;
    const stage = this.stage;
    if (stage == ENV_ATTACK) {
      if (this.exponential) this.level = this.attackBase + this.level * this.attackCoef;
      else this.level += this.attackSamples > 0.0 ? 1.0 / this.attackSamples : 1.0;
      if (this.level >= 1.0 || this.attackSamples <= 0.0) { this.level = 1.0; this.stage = ENV_DECAY; }
    } else if (stage == ENV_DECAY) {
      if (this.exponential) this.level = this.decayBase + this.level * this.decayCoef;
      else this.level -= this.decaySamples > 0.0 ? (1.0 - this.sustain) / this.decaySamples : 1.0;
      if (this.level <= this.sustain || this.decaySamples <= 0.0) { this.level = this.sustain; this.stage = ENV_SUSTAIN; }
    } else if (stage == ENV_SUSTAIN) {
      this.level = this.sustain;
    } else if (stage == ENV_RELEASE) {
      if (this.exponential) this.level = this.releaseBase + this.level * this.releaseCoef;
      else this.level -= this.releaseStep;
      if (this.level <= 0.0 || this.releaseSamples <= 0.0) { this.level = 0.0; this.stage = ENV_IDLE; }
    }
    this.value = <f32>this.level;
    return this.value;
  }
}

/// An attack-release envelope on a gate: rises to 1 in `attack` while the gate is on, falls in `release` after. (An Adsr with the sustain at 1.)
export class Ar {
  private env: Adsr;
  constructor(sampleRate: f64) { this.env = new Adsr(sampleRate); this.env.set(0.01, 0.0, 1.0, 0.3); }
  set exponential(on: bool) { this.env.exponential = on; }
  reset(): void { this.env.reset(); }
  get value(): f32 { return this.env.value; }
  set(attack: f64, release: f64): void { this.env.set(attack, 0.0, 1.0, release); }
  next(gate: f32): f32 { return this.env.next(gate); }
}

/// A one-shot attack-decay envelope: a trigger (rising through 0.5) starts it; it rises to 1 in `attack`, falls to 0 in `decay`, whatever the
/// trigger does after. Good for percussion, plucks and blips.
export class Ad {
  private env: Adsr;
  private wasHigh: bool = false;
  private open: bool = false;
  constructor(sampleRate: f64) { this.env = new Adsr(sampleRate); this.env.set(0.001, 0.0, 1.0, 0.2); }
  set exponential(on: bool) { this.env.exponential = on; }
  reset(): void { this.env.reset(); this.wasHigh = false; this.open = false; }
  get value(): f32 { return this.env.value; }
  set(attack: f64, decay: f64): void { this.env.set(attack, 0.0, 1.0, decay); }
  next(trigger: f32): f32 {
    const high = trigger >= 0.5;
    if (high && !this.wasHigh) this.open = true;
    this.wasHigh = high;
    const y = this.env.next(this.open ? 1.0 : 0.0);
    if (this.open && this.env.currentStage != ENV_ATTACK) this.open = false;   // the attack is done: let go, the release is the decay
    return y;
  }
}

/// A level follower: follows |x| up with the attack time and down with the release time (seconds to cover about 63 % of a step).
export class EnvFollower {
  value: f32 = 0;
  private attack: f64 = 0.1;
  private release: f64 = 0.1;
  private sampleRate: f64;
  constructor(sampleRate: f64, attackSeconds: f64 = 0.005, releaseSeconds: f64 = 0.1) {
    this.sampleRate = sampleRate;
    this.setTimes(attackSeconds, releaseSeconds);
  }
  reset(): void { this.value = 0; }
  setTimes(attackSeconds: f64, releaseSeconds: f64): void {
    this.attack = attackSeconds <= 0.0 ? 1.0 : 1.0 - Math.exp(-1.0 / (this.sampleRate * attackSeconds));
    this.release = releaseSeconds <= 0.0 ? 1.0 : 1.0 - Math.exp(-1.0 / (this.sampleRate * releaseSeconds));
  }
  next(x: f32): f32 {
    const a = abs(x);
    const v = <f64>this.value;
    this.value = <f32>(v + (<f64>a - v) * (a > this.value ? this.attack : this.release));
    return this.value;
  }
}

/// A slew limiter: the output follows the input but no faster than `rise` units per second upwards and `fall` downwards (a portamento, a
/// click-free control). 1e9 means no limit.
export class Slew {
  rise: f32 = 1.0e9;
  fall: f32 = 1.0e9;
  value: f32 = 0;
  private invSampleRate: f32;
  constructor(sampleRate: f64) { this.invSampleRate = <f32>(1.0 / sampleRate); }
  reset(): void { this.value = 0; }
  /// Jumps to `x` without gliding.
  snap(x: f32): void { this.value = x; }
  next(x: f32): f32 {
    const d = x - this.value;
    const up = this.rise * this.invSampleRate, down = this.fall * this.invSampleRate;
    this.value += d > up ? up : (d < -down ? -down : d);
    return this.value;
  }
}

export const LFO_SINE: i32 = 0;
export const LFO_TRIANGLE: i32 = 1;
export const LFO_SAW: i32 = 2;       // rising
export const LFO_SQUARE: i32 = 3;
export const LFO_SAMPLE_HOLD: i32 = 4;
export const LFO_SAW_DOWN: i32 = 5;

/// A low-frequency oscillator, -1 to 1. `shape` is one of LFO_SINE, LFO_TRIANGLE, LFO_SAW (rising), LFO_SQUARE (with `width`), LFO_SAMPLE_HOLD (a new
/// random value each cycle) and LFO_SAW_DOWN. Shapes start at their zero crossing going up (the saw and sample-and-hold at their start), at `phaseOffset`
/// cycles. `sync()` restarts the cycle (call it on a note on, or pass a gate to nextSync). `uni` turns the last output into 0 to 1.
export class Lfo {
  shape: i32 = LFO_SINE;
  width: f32 = 0.5;
  phaseOffset: f32 = 0.0;
  /// The last output, -1 to 1.
  value: f32 = 0;
  private phase: f64 = 0;
  private held: f32 = 0;
  private invSampleRate: f64;
  private rng: Xorshift;
  private wasHigh: bool = false;
  constructor(sampleRate: f64, seed: u32 = 1) {
    this.invSampleRate = 1.0 / sampleRate;
    this.rng = new Xorshift(seed);
    this.held = this.rng.nextBipolar();
  }
  reset(): void { this.phase = 0.0; this.wasHigh = false; }
  sync(): void { this.phase = 0.0; this.held = this.rng.nextBipolar(); }
  get uni(): f32 { return 0.5 + 0.5 * this.value; }
  /// One sample at `frequency` Hz.
  next(frequency: f64): f32 {
    this.phase += frequency * this.invSampleRate;
    if (this.phase >= 1.0) { this.phase -= floor(this.phase); if (this.shape == LFO_SAMPLE_HOLD) this.held = this.rng.nextBipolar(); }
    else if (this.phase < 0.0) this.phase -= floor(this.phase);
    let p = this.phase + <f64>this.phaseOffset;
    p -= floor(p);
    const s = this.shape;
    let y: f32 = 0;
    if (s == LFO_SINE) y = fastSin(p);
    else if (s == LFO_TRIANGLE) y = <f32>(p < 0.25 ? 4.0 * p : (p < 0.75 ? 2.0 - 4.0 * p : 4.0 * p - 4.0));
    else if (s == LFO_SAW) y = <f32>(2.0 * p - 1.0);
    else if (s == LFO_SAW_DOWN) y = <f32>(1.0 - 2.0 * p);
    else if (s == LFO_SQUARE) y = p < <f64>this.width ? 1.0 : -1.0;
    else y = this.held;
    this.value = y;
    return y;
  }
  /// Like next(), restarting the cycle when `gate` rises through 0.5.
  nextSync(frequency: f64, gate: f32): f32 {
    const high = gate >= 0.5;
    if (high && !this.wasHigh) this.sync();
    this.wasHigh = high;
    return this.next(frequency);
  }
}

/// A straight line from one value to another over a time. `set(from, to, seconds)` starts it (in block() or a handler); `next()` per sample;
/// it holds the last value after, and `done` says so.
export class Line {
  value: f32 = 0;
  done: bool = true;
  private target: f32 = 0;
  private step: f32 = 0;
  private sampleRate: f64;
  constructor(sampleRate: f64) { this.sampleRate = sampleRate; }
  set(from: f32, to: f32, seconds: f64): void {
    this.value = from;
    this.target = to;
    const n = seconds * this.sampleRate;
    if (n < 1.0) { this.value = to; this.step = 0; this.done = true; }
    else { this.step = <f32>(<f64>(to - from) / n); this.done = false; }
  }
  next(): f32 {
    if (!this.done) {
      this.value += this.step;
      if ((this.step >= 0.0 && this.value >= this.target) || (this.step < 0.0 && this.value <= this.target)) { this.value = this.target; this.done = true; }
    }
    return this.value;
  }
}

/// A ramp from 0 to 1 over `seconds` each time it is started; holds at 1 after. `start()` (or `next(trigger)` with a rising trigger) begins it.
export class Ramp {
  private line: Line;
  private seconds: f64 = 1.0;
  private wasHigh: bool = false;
  constructor(sampleRate: f64) { this.line = new Line(sampleRate); this.line.value = 1.0; }
  get value(): f32 { return this.line.value; }
  get done(): bool { return this.line.done; }
  setTime(seconds: f64): void { this.seconds = seconds; }
  start(): void { this.line.set(0.0, 1.0, this.seconds); }
  next(trigger: f32): f32 {
    const high = trigger >= 0.5;
    if (high && !this.wasHigh) this.start();
    this.wasHigh = high;
    return this.line.next();
  }
}

/// Edge detection: `next(x)` is 1 for the one sample in which x rises through `threshold`, else 0.
export class Trigger {
  threshold: f32 = 0.5;
  private wasHigh: bool = false;
  reset(): void { this.wasHigh = false; }
  next(x: f32): f32 {
    const high = x >= this.threshold;
    const edge = high && !this.wasHigh;
    this.wasHigh = high;
    return edge ? 1.0 : 0.0;
  }
}

/// A Schmitt trigger: the output (0 or 1) goes high when x rises above `high` and low when it falls below `low`, so a noisy or slow signal
/// does not chatter. `rose` and `fell` are true for the sample in which it changed.
export class Schmitt {
  state: bool = false;
  rose: bool = false;
  fell: bool = false;
  low: f32; high: f32;
  constructor(low: f32 = 0.3, high: f32 = 0.7) { this.low = low; this.high = high; }
  reset(): void { this.state = false; this.rose = false; this.fell = false; }
  next(x: f32): f32 {
    const was = this.state;
    if (!was && x >= this.high) this.state = true;
    else if (was && x <= this.low) this.state = false;
    this.rose = this.state && !was;
    this.fell = !this.state && was;
    return this.state ? 1.0 : 0.0;
  }
}

/// A tempo clock: a phasor that runs once through 0 to 1 per `1 / ratio` beats at `bpm`. ratio 1 is a quarter note, 2 an eighth, 4 a sixteenth, 0.25 a
/// bar of 4/4, 1.5 a dotted pattern. `next()` returns the phase; `ticked` is true in the sample where it wrapped (the start of each cycle), `count` the
/// number of cycles since `reset()`. To follow a host transport, call `setBeat(beats)` with the beat position (in quarter notes) once per block.
export class Clock {
  bpm: f64 = 120.0;
  ratio: f64 = 1.0;
  ticked: bool = false;
  count: i32 = 0;
  private phase: f64 = 0;
  private invSampleRate: f64;
  constructor(sampleRate: f64) { this.invSampleRate = 1.0 / sampleRate; }
  reset(): void { this.phase = 0.0; this.count = 0; this.ticked = false; }
  /// Aligns the phase with a beat position in quarter notes (so cycles start on multiples of 1 / ratio beats).
  setBeat(beats: f64): void {
    const p = beats * this.ratio;
    this.phase = p - floor(p);
  }
  next(): f64 {
    this.phase += this.bpm / 60.0 * this.ratio * this.invSampleRate;
    this.ticked = false;
    if (this.phase >= 1.0) { this.phase -= floor(this.phase); this.ticked = true; this.count++; }
    return this.phase;
  }
}
