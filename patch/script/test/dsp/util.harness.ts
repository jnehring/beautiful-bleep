// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
import { OUT, IN, Unit } from "./common";
import { fastTanh, fastExp2, fastLog2, fastPow2, Rms, Pan, MidSide } from "../../src/bleep/util";
export { outPtr, inPtr } from "./common";
export * from "../../src/bleep/util";

// ids: 0 fastTanh, 1 fastExp2, 2 fastLog2, 3 Rms(a seconds), 4 fastPow2(x, 1.7)
class U extends Unit {
  id: i32; a: f64; rms: Rms = new Rms(48000.0, 0.05);
  constructor(id: i32, a: f64) { super(); this.id = id; this.a = a; this.rms = new Rms(48000.0, a > 0 ? a : 0.05); }
  tick(x: f32): f32 {
    if (this.id == 0) return fastTanh(x);
    if (this.id == 1) return fastExp2(x);
    if (this.id == 2) return fastLog2(x);
    if (this.id == 3) return this.rms.next(x);
    return fastPow2(x, 1.7);
  }
}
let u: U = new U(0, 0);
export function setup(id: i32, a: f64, b: f64, c: f64, d: f64, e: f64, f: f64): void { u = new U(id, a); }
export function process(n: i32): void { for (let i = 0; i < n; i++) OUT[i] = u.tick(IN[i]); }
const pan = new Pan(); const ms = new MidSide();
export function panEq(p: f32): f32 { pan.equalPower(p); return pan.left * 10 + pan.right; }
export function panLeft(): f32 { return pan.left; }
export function panRight(): f32 { return pan.right; }
export function panLin(p: f32): void { pan.linear(p); }
export function encodeMid(l: f32, r: f32): f32 { ms.encode(l, r); return ms.mid; }
export function encodeSide(): f32 { return ms.side; }
export function decodeLeft(m: f32, s: f32): f32 { ms.decode(m, s); return ms.left; }
export function decodeRight(): f32 { return ms.right; }
