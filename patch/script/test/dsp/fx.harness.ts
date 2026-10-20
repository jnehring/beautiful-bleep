import { OUT, IN, Unit } from "./common";
import { Reverb, Phaser, Chorus, PitchShift } from "../../src/bleep/fx";
import { Fft } from "../../src/bleep/fft";
export { outPtr, inPtr } from "./common";

// ids: 0 Reverb left (a room, b damping, c width), 1 Reverb right, 2 Phaser (a stages, b feedback, c centre; rate 0), 3 Phaser sweeping (a stages, b rate), 4 Chorus (a depthMs, b mix), 5 Chorus right, 6 PitchShift (a ratio)
const SR: f64 = 48000.0;
class U extends Unit {
  id: i32;
  rev: Reverb = new Reverb(SR); ph: Phaser; ch: Chorus = new Chorus(SR, 3); ps: PitchShift = new PitchShift(SR);
  constructor(id: i32, a: f64, b: f64, c: f64) {
    super();
    this.id = id;
    this.ph = new Phaser(SR, id == 2 || id == 3 ? <i32>a : 4);
    if (id <= 1) { this.rev.roomSize = <f32>a; this.rev.damping = <f32>b; this.rev.width = <f32>c; this.rev.update(); }
    else if (id == 2) { this.ph.rate = 0.0; this.ph.feedback = <f32>b; this.ph.centre = <f32>c; }
    else if (id == 3) { this.ph.rate = <f32>b; }
    else if (id == 4 || id == 5) { this.ch.depthMs = <f32>a; this.ch.mix = <f32>b; }
    else if (id == 6) this.ps.ratio = <f32>a;
  }
  tick(x: f32): f32 {
    const id = this.id;
    if (id <= 1) { this.rev.next(x); return id == 0 ? this.rev.left : this.rev.right; }
    if (id <= 3) return this.ph.next(x);
    if (id <= 5) { const m = this.ch.next(x); return id == 4 ? this.ch.left : this.ch.right; }
    return this.ps.next(x);
  }
}
let u: U = new U(0, 0.5, 0.5, 1);
export function setup(id: i32, a: f64, b: f64, c: f64, d: f64, e: f64, f: f64): void { u = new U(id, a, b, c); }
export function process(n: i32): void { for (let i = 0; i < n; i++) OUT[i] = u.tick(IN[i]); }

// Fft: transform the first `size` samples of IN (real) into OUT (re) and OUT[size..] (im); inverse does the opposite
let fft: Fft = new Fft(1024);
export function fftSetup(size: i32): void { fft = new Fft(size); }
export function fftForward(): void {
  const n = fft.size;
  for (let i = 0; i < n; i++) { fft.re[i] = IN[i]; fft.im[i] = IN[n + i]; }
  fft.forward();
  for (let i = 0; i < n; i++) { OUT[i] = fft.re[i]; OUT[n + i] = fft.im[i]; }
}
export function fftInverse(): void {
  const n = fft.size;
  for (let i = 0; i < n; i++) { fft.re[i] = IN[i]; fft.im[i] = IN[n + i]; }
  fft.inverse();
  for (let i = 0; i < n; i++) { OUT[i] = fft.re[i]; OUT[n + i] = fft.im[i]; }
}
export function fftMagnitude(k: i32): f32 { return fft.magnitude(k); }
export function fftHann(): void { const n = fft.size; for (let i = 0; i < n; i++) { fft.re[i] = 1.0; fft.im[i] = 0.0; } fft.applyHann(); for (let i = 0; i < n; i++) OUT[i] = fft.re[i]; }
