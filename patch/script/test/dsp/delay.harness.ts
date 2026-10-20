import { OUT, IN, Unit } from "./common";
import { DelayLine, TapeDelay, KarplusStrong, interpLinear, interpCubic, interpLagrange } from "../../src/bleep/delay";
export { outPtr, inPtr } from "./common";

// ids: 0 DelayLine linear, 1 cubic, 2 allpass (a = delay in samples), 3 TapeDelay (a time s, b feedback, c tone Hz; the time follows IN[0]... see below), 4 Karplus (a Hz, b damping, c decay)
class U extends Unit {
  id: i32; a: f32;
  line: DelayLine = new DelayLine(4000);
  tape: TapeDelay = new TapeDelay(48000.0, 1.0, 0.05);
  string: KarplusStrong = new KarplusStrong(48000.0, 40.0);
  n: i32 = 0;
  constructor(id: i32, a: f64, b: f64, c: f64) {
    super();
    this.id = id; this.a = <f32>a;
    if (id == 3) { this.tape.time = <f32>a; this.tape.feedback = <f32>b; this.tape.setTone(c > 0 ? c : 20000.0); this.tape.snap(); }
    if (id == 4) { this.string.damping = <f32>b; this.string.decay = <f32>c; this.string.pluck(a); }
  }
  tick(x: f32): f32 {
    const id = this.id;
    if (id == 3) return this.tape.next(x);
    if (id == 4) return this.string.next();
    this.line.write(x);
    if (id == 0) return this.line.read(this.a);
    if (id == 1) return this.line.readCubic(this.a);
    return this.line.readAllpass(this.a);
  }
}
let u: U = new U(0, 1, 0, 0);
export function setup(id: i32, a: f64, b: f64, c: f64, d: f64, e: f64, f: f64): void { u = new U(id, a, b, c); }
export function process(n: i32): void { for (let i = 0; i < n; i++) OUT[i] = u.tick(IN[i]); }
export function setTime(t: f32): void { u.tape.time = t; }
export function setTapeInput(): void {}
export function pluck(f: f64): void { u.string.pluck(f); }
export function tapePhaseDepth(d: f32): void { u.tape.wowDepth = d; }

const table = new StaticArray<f32>(64);
export function fillTable(kind: i32): void {
  for (let i = 0; i < 64; i++) {
    const x = <f64>i;
    table[i] = kind == 0 ? <f32>Math.sin(2.0 * Math.PI * x / 64.0) : kind == 1 ? <f32>x : <f32>(x * x * x * 0.001);
  }
}
export function interp(kind: i32, pos: f64): f32 {
  if (kind == 0) return interpLinear(table, pos);
  if (kind == 1) return interpCubic(table, pos);
  return interpLagrange(table, pos);
}
