// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
import { OUT, IN, Unit } from "./common";
import { Biquad } from "../../src/bleep/dsp";
import { OnePole, Svf, LadderFilter, Resonz, Formant, Allpass1, Allpass2, CombFilter } from "../../src/bleep/filters";
export { outPtr, inPtr } from "./common";

// ids: 0..4 Biquad lowpass, highpass, bandpass, notch, allpass (a = Hz, b = q); 5, 6 OnePole low, high (a = Hz)
// 7..13 Svf low, high, band, bandUnity, notch, peak, all (a = Hz, b = q); 20 Ladder (a Hz, b resonance, c drive); 21 Resonz (a Hz, b bandwidth)
// 22 Formant (a vowel, b shift); 23 Allpass1 (a Hz); 24 Allpass2 (a Hz, b q); 25 CombFilter (a delay, b feedforward, c feedback)
const SR: f64 = 48000.0;
class U extends Unit {
  id: i32;
  bq: Biquad = new Biquad(); op: OnePole = new OnePole(); svf: Svf = new Svf(); lad: LadderFilter = new LadderFilter();
  rz: Resonz = new Resonz(); fm: Formant = new Formant(); ap1: Allpass1 = new Allpass1(); ap2: Allpass2 = new Allpass2(); comb: CombFilter = new CombFilter(2048);
  constructor(id: i32, a: f64, b: f64, c: f64) {
    super();
    this.id = id;
    if (id == 0) this.bq.setLowpass(SR, a, b);
    else if (id == 1) this.bq.setHighpass(SR, a, b);
    else if (id == 2) this.bq.setBandpass(SR, a, b);
    else if (id == 3) this.bq.setNotch(SR, a, b);
    else if (id == 4) this.bq.setAllpass(SR, a, b);
    else if (id == 5) this.op.setLowpass(SR, a);
    else if (id == 6) this.op.setHighpass(SR, a);
    else if (id >= 7 && id <= 13) this.svf.set(SR, a, b);
    else if (id == 20) this.lad.set(SR, a, b, c == 0 ? 1.0 : c);
    else if (id == 21) this.rz.set(SR, a, b);
    else if (id == 22) this.fm.setVowel(SR, a, b == 0 ? 1.0 : b);
    else if (id == 23) this.ap1.set(SR, a);
    else if (id == 24) this.ap2.set(SR, a, b);
    else if (id == 25) { this.comb.setDelay(<f32>a); this.comb.feedforward = <f32>b; this.comb.feedback = <f32>c; }
  }
  tick(x: f32): f32 {
    const id = this.id;
    if (id <= 4) return this.bq.next(x);
    if (id <= 6) return this.op.next(x);
    if (id <= 13) {
      this.svf.tick(x);
      if (id == 7) return this.svf.low; if (id == 8) return this.svf.high; if (id == 9) return this.svf.band; if (id == 10) return this.svf.bandUnity;
      if (id == 11) return this.svf.notch; if (id == 12) return this.svf.peak; return this.svf.all;
    }
    if (id == 20) return this.lad.next(x);
    if (id == 21) return this.rz.next(x);
    if (id == 22) return this.fm.next(x);
    if (id == 23) return this.ap1.next(x);
    if (id == 24) return this.ap2.next(x);
    return this.comb.next(x);
  }
}
let u: U = new U(0, 1000, 0.7, 0);
export function setup(id: i32, a: f64, b: f64, c: f64, d: f64, e: f64, f: f64): void { u = new U(id, a, b, c); }
export function process(n: i32): void { for (let i = 0; i < n; i++) OUT[i] = u.tick(IN[i]); }
