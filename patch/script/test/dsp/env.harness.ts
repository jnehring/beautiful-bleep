// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
import { OUT, IN, Unit } from "./common";
import { Adsr, Ad, Ar, EnvFollower, Slew, Lfo, Line, Ramp, Trigger, Schmitt, Clock, LFO_SQUARE } from "../../src/bleep/env";
export { outPtr, inPtr } from "./common";

// ids: 0 Adsr, 1 Ad, 2 Ar, 3 EnvFollower, 4 Slew, 5 Lfo, 6 Line, 7 Ramp, 8 Trigger, 9 Schmitt, 10 Clock, 11 Adsr linear, 12 Adsr hard retrigger
// the six numbers: Adsr a d s r; Ad/Ar a b; EnvFollower attack release; Slew rise fall; Lfo freq shape width; Line from to seconds (started now); Ramp seconds; Clock bpm ratio
const SR: f64 = 48000.0;
class U extends Unit {
  id: i32; p0: f64; p1: f64; p2: f64;
  adsr: Adsr = new Adsr(SR); ad: Ad = new Ad(SR); ar: Ar = new Ar(SR); fol: EnvFollower = new EnvFollower(SR); slew: Slew = new Slew(SR);
  lfo: Lfo = new Lfo(SR, 5); line: Line = new Line(SR); ramp: Ramp = new Ramp(SR); trig: Trigger = new Trigger(); sch: Schmitt = new Schmitt(0.3, 0.7); clock: Clock = new Clock(SR);
  constructor(id: i32, a: f64, b: f64, c: f64, d: f64) {
    super();
    this.id = id; this.p0 = a; this.p1 = b; this.p2 = c;
    if (id == 0 || id == 11 || id == 12) { this.adsr.set(a, b, c, d); this.adsr.exponential = id != 11; this.adsr.hardRetrigger = id == 12; }
    else if (id == 1) this.ad.set(a, b);
    else if (id == 2) this.ar.set(a, b);
    else if (id == 3) this.fol.setTimes(a, b);
    else if (id == 4) { this.slew.rise = <f32>a; this.slew.fall = <f32>b; }
    else if (id == 5) { this.lfo.shape = <i32>b; this.lfo.width = <f32>c; }
    else if (id == 6) this.line.set(<f32>a, <f32>b, c);
    else if (id == 7) { this.ramp.setTime(a); }
    else if (id == 10) { this.clock.bpm = a; this.clock.ratio = b; }
  }
  tick(x: f32): f32 {
    const id = this.id;
    if (id == 0 || id == 11 || id == 12) return this.adsr.next(x);
    if (id == 1) return this.ad.next(x);
    if (id == 2) return this.ar.next(x);
    if (id == 3) return this.fol.next(x);
    if (id == 4) return this.slew.next(x);
    if (id == 5) return this.lfo.next(this.p0);
    if (id == 6) return this.line.next();
    if (id == 7) return this.ramp.next(x);
    if (id == 8) return this.trig.next(x);
    if (id == 9) return this.sch.next(x);
    return <f32>this.clock.next() + (this.clock.ticked ? 10.0 : 0.0);
  }
}
let u: U = new U(0, 0.1, 0.1, 0.5, 0.1);
export function setup(id: i32, a: f64, b: f64, c: f64, d: f64, e: f64, f: f64): void { u = new U(id, a, b, c, d); }
export function process(n: i32): void { for (let i = 0; i < n; i++) OUT[i] = u.tick(IN[i]); }
export function stage(): i32 { return u.adsr.currentStage; }
export function lfoSync(): void { u.lfo.sync(); }
export function clockBeat(b: f64): void { u.clock.setBeat(b); }
export function clockCount(): i32 { return u.clock.count; }
export function schRose(): bool { return u.sch.rose; }
