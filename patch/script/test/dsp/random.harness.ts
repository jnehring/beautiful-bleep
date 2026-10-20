import { OUT, IN, Unit } from "./common";
import { Xorshift, Lcg, whiteNoise, WhiteNoise, PinkNoise, BrownNoise, SampleAndHold, NoiseLfo } from "../../src/bleep/random";
export { outPtr, inPtr } from "./common";

// ids: 0 Xorshift.next, 1 Xorshift.nextBipolar, 2 Lcg.next, 3 Lcg.nextBipolar, 4 whiteNoise, 5 WhiteNoise, 6 Pink, 7 Brown, 8 SampleAndHold (IN = x, gate from a counter: a = period), 9 NoiseLfo (a rate Hz, b smooth)
// the seed is `seed`
class U extends Unit {
  id: i32; n: i32 = 0; period: i32;
  xs: Xorshift; lcg: Lcg; wn: WhiteNoise; pink: PinkNoise; brown: BrownNoise; sh: SampleAndHold = new SampleAndHold(); lfo: NoiseLfo; rate: f64;
  constructor(id: i32, seed: u32, a: f64, b: f64) {
    super();
    this.id = id; this.xs = new Xorshift(seed); this.lcg = new Lcg(seed); this.wn = new WhiteNoise(seed); this.pink = new PinkNoise(seed); this.brown = new BrownNoise(seed);
    this.lfo = new NoiseLfo(48000.0, seed); this.lfo.smooth = <f32>b; this.rate = a; this.period = <i32>a;
  }
  tick(x: f32): f32 {
    const id = this.id;
    if (id == 0) return this.xs.next();
    if (id == 1) return this.xs.nextBipolar();
    if (id == 2) return this.lcg.next();
    if (id == 3) return this.lcg.nextBipolar();
    if (id == 4) return whiteNoise(this.xs);
    if (id == 5) return this.wn.next();
    if (id == 6) return this.pink.next();
    if (id == 7) return this.brown.next();
    if (id == 8) { this.n++; return this.sh.next(x, (this.n % this.period) < this.period / 2 ? 1.0 : 0.0); }
    return this.lfo.next(this.rate);
  }
}
let u: U = new U(0, 1, 0, 0);
export function setup(id: i32, a: f64, b: f64, c: f64, d: f64, e: f64, f: f64): void { u = new U(id, <u32>c, a, b); }
export function process(n: i32): void { for (let i = 0; i < n; i++) OUT[i] = u.tick(IN[i]); }
export function firstU32(seed: u32): u32 { return new Xorshift(seed).nextU32(); }
export function firstLcg(seed: u32): u32 { return new Lcg(seed).nextU32(); }
