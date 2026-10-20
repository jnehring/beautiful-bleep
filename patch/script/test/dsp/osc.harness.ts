// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
import { OUT, IN, Unit } from "./common";
import { polyBlep, sawBlep, squareBlep, triangle, fastSin, SineTable, Wavetable, Supersaw, FmOp } from "../../src/bleep/osc";
export { outPtr, inPtr } from "./common";

// ids: 0 naive saw, 1 sawBlep, 2 squareBlep(width), 3 triangle, 4 fastSin, 5 SineTable, 6 Wavetable saw, 7 Supersaw, 8 FmOp, 9 Wavetable square, 10 Wavetable tri
// params: a = frequency, b = width / detune / mod index
class Osc extends Unit {
  phase: f64 = 0; dt: f64; b: f64; id: i32;
  table: Wavetable = new Wavetable(2048, 10);
  sine: SineTable = new SineTable(4096);
  stack: Supersaw;
  fm: FmOp;
  constructor(id: i32, freq: f64, b: f64) {
    super();
    this.id = id; this.dt = freq / 48000.0; this.b = b;
    this.stack = new Supersaw(48000.0, 7, b);
    this.fm = new FmOp(48000.0);
    if (id == 6) this.table.setSaw();
    else if (id == 9) this.table.setSquare();
    else if (id == 10) this.table.setTriangle();
    this.freq = freq;
  }
  freq: f64;
  tick(x: f32): f32 {
    const p = this.phase, dt = this.dt, id = this.id;
    this.phase += dt; if (this.phase >= 1.0) this.phase -= 1.0;
    if (id == 0) return <f32>(2.0 * p - 1.0);
    if (id == 1) return sawBlep(p, dt);
    if (id == 2) return squareBlep(p, dt, this.b);
    if (id == 3) return triangle(p, dt);
    if (id == 4) return fastSin(p);
    if (id == 5) return this.sine.read(p);
    if (id == 7) return this.stack.next(this.freq);
    if (id == 8) return this.fm.next(this.freq, x, <f32>this.b);
    return this.table.read(p, dt);
  }
}
let u: Osc = new Osc(0, 100, 0);
export function setup(id: i32, a: f64, b: f64, c: f64, d: f64, e: f64, f: f64): void { u = new Osc(id, a, b); }
export function process(n: i32): void { for (let i = 0; i < n; i++) OUT[i] = u.tick(IN[i]); }
export function blep(t: f64, dt: f64): f64 { return polyBlep(t, dt); }
