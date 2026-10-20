// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
import { OUT, IN, Unit } from "./common";
import { Compressor, Limiter, Gate, softClip, hardClip, foldback, asymSat, chebyshev, Bitcrush, Decimate, Oversampler2x, Oversampler4x } from "../../src/bleep/dynamics";
export { outPtr, inPtr } from "./common";

// ids: 0 Compressor (a threshold, b ratio, c knee, d makeup; times 5 ms / 50 ms), 1 Compressor keyed (the key is IN[i] * 0 + a constant ... see keyed), 2 Limiter (a ceiling), 3 Gate (a open dB, b close dB, c range dB),
// 4 softClip, 5 hardClip(a), 6 foldback(a), 7 asymSat(a), 8 chebyshev(a order), 9 Bitcrush(a bits), 10 Decimate(a ratio), 11 Oversampler2x identity, 12 Oversampler4x identity,
// 13 hardClip inside Oversampler2x (a limit), 14 hardClip inside 4x, 15 Compressor with fast times (a threshold, b ratio, c knee, d attack)
const SR: f64 = 48000.0;
class U extends Unit {
  id: i32; a: f32;
  comp: Compressor = new Compressor(SR, 0.005, 0.05); lim: Limiter = new Limiter(SR, 0.002, 0.08); gate: Gate = new Gate(SR, 0.001, 0.05);
  crush: Bitcrush = new Bitcrush(8.0); dec: Decimate = new Decimate(); os2: Oversampler2x = new Oversampler2x(); os4: Oversampler4x = new Oversampler4x();
  constructor(id: i32, a: f64, b: f64, c: f64, d: f64) {
    super();
    this.id = id; this.a = <f32>a;
    if (id == 0 || id == 1 || id == 15) { this.comp.thresholdDb = <f32>a; this.comp.ratio = <f32>b; this.comp.kneeDb = <f32>c; if (id == 15) this.comp.setTimes(d, d * 4.0); else this.comp.makeupDb = <f32>d; }
    else if (id == 2) this.lim.ceiling = <f32>a;
    else if (id == 3) { this.gate.openDb = <f32>a; this.gate.closeDb = <f32>b; this.gate.rangeDb = <f32>c; }
    else if (id == 9) this.crush.setBits(<f32>a);
    else if (id == 10) this.dec.ratio = <f32>a;
  }
  tick(x: f32): f32 {
    const id = this.id;
    if (id == 0 || id == 15) return this.comp.next(x);
    if (id == 1) return this.comp.nextKeyed(1.0, x);
    if (id == 2) return this.lim.next(x);
    if (id == 3) return this.gate.next(x);
    if (id == 4) return softClip(x);
    if (id == 5) return hardClip(x, this.a);
    if (id == 6) return foldback(x, this.a);
    if (id == 7) return asymSat(x, this.a);
    if (id == 8) return chebyshev(x, <i32>this.a);
    if (id == 9) return this.crush.next(x);
    if (id == 10) return this.dec.next(x);
    if (id == 11) { this.os2.up(x); return this.os2.down(this.os2.a, this.os2.b); }
    if (id == 12) { this.os4.up(x); return this.os4.down(this.os4.a, this.os4.b, this.os4.c, this.os4.d); }
    if (id == 13) { this.os2.up(x); return this.os2.down(hardClip(this.os2.a, this.a), hardClip(this.os2.b, this.a)); }
    this.os4.up(x);
    return this.os4.down(hardClip(this.os4.a, this.a), hardClip(this.os4.b, this.a), hardClip(this.os4.c, this.a), hardClip(this.os4.d, this.a));
  }
}
let u: U = new U(4, 0, 0, 0, 0);
export function setup(id: i32, a: f64, b: f64, c: f64, d: f64, e: f64, f: f64): void { u = new U(id, a, b, c, d); }
export function process(n: i32): void { for (let i = 0; i < n; i++) OUT[i] = u.tick(IN[i]); }
export function reduction(): f32 { return u.comp.gainReductionDb; }
export function limiterLatency(): i32 { return u.lim.latency; }
export function os2Latency(): i32 { return u.os2.latency; }
export function os4Latency(): i32 { return u.os4.latency; }
export function gateOpen(): bool { return u.gate.isOpen; }
export function curve(level: f32): f32 { return u.comp.curve(level); }
