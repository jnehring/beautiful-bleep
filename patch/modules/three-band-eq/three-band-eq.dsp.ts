// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// 3-Band EQ: a low shelf, a mid bell and a high shelf in a row, per channel. Written in Bleep Script.

import { Biquad, Smoother, PeakHold } from "./bleep/dsp";

/**
 * A plain three-band equaliser: a low shelf, a mid bell and a high shelf, each with its own gain (up to 15 dB either way) and frequency.
 * The mid band also has a width control. Stereo; both channels share the same settings.
 */
@module({
  name: "3-Band EQ",
  category: "Effects/Dynamics & EQ",
  colour: "#22c55e",
  description: "A simple stereo equaliser: low shelf, mid bell and high shelf, each with its own gain and frequency.",
  layout: [
    { row: [
      { title: "Low", column: ["lowGain", "lowFreq"] },
      { title: "Mid", column: ["midGain", "midFreq", "midQ"] },
      { title: "High", column: ["highGain", "highFreq"] },
    ] },
    { row: ["output"] },
  ],
})
export class ThreeBandEq {
  /** Left input. */
  @input({ name: "In L", type: "audio" }) l: f32 = 0;
  /** Right input. */
  @input({ name: "In R", type: "audio" }) r: f32 = 0;
  @output({ name: "Out L", type: "audio" }) outL: f32 = 0;
  @output({ name: "Out R", type: "audio" }) outR: f32 = 0;

  /** Low shelf gain: boosts or cuts everything below the low frequency. */
  @param({ name: "Low", min: -15, max: 15, init: 0, unit: "dB", decimals: 1, group: "Low" }) lowGain: f32 = 0;
  /** Where the low shelf turns over. */
  @param({ name: "Low Freq", min: 40, max: 400, init: 200, unit: "Hz", map: "exp", decimals: 0, group: "Low" }) lowFreq: f32 = 200;
  /** Mid bell gain: boosts or cuts a band around the mid frequency. */
  @param({ name: "Mid", min: -15, max: 15, init: 0, unit: "dB", decimals: 1, group: "Mid" }) midGain: f32 = 0;
  /** The centre of the mid bell. */
  @param({ name: "Mid Freq", min: 200, max: 5000, init: 1000, unit: "Hz", map: "exp", decimals: 0, group: "Mid" }) midFreq: f32 = 1000;
  /** Width of the mid bell: low is broad, high is narrow. */
  @param({ name: "Mid Q", min: 0.3, max: 4, init: 0.7, map: "exp", decimals: 2, group: "Mid" }) midQ: f32 = 0.7;
  /** High shelf gain: boosts or cuts everything above the high frequency. */
  @param({ name: "High", min: -15, max: 15, init: 0, unit: "dB", decimals: 1, group: "High" }) highGain: f32 = 0;
  /** Where the high shelf turns over. */
  @param({ name: "High Freq", min: 1000, max: 12000, init: 4000, unit: "Hz", map: "exp", decimals: 0, group: "High" }) highFreq: f32 = 4000;
  /** Output level after the three bands. */
  @param({ name: "Output", min: -12, max: 12, init: 0, unit: "dB", decimals: 1, group: "Output" }) output: f32 = 0;

  /** The output level. */
  @probe level: f32 = 0;

  private sampleRate: f64;
  private lowL: Biquad = new Biquad(); private midL: Biquad = new Biquad(); private highL: Biquad = new Biquad();
  private lowR: Biquad = new Biquad(); private midR: Biquad = new Biquad(); private highR: Biquad = new Biquad();
  private outg: Smoother;
  private meter: PeakHold;
  private started: bool = false;
  private kb: f64;
  // the controls as the filters see them, smoothed once per block (the frequencies in the log domain)
  private cLow: f64 = 0.0; private cMid: f64 = 0.0; private cHigh: f64 = 0.0;
  private lfLow: f64 = 0.0; private lfMid: f64 = 0.0; private lfHigh: f64 = 0.0; private lq: f64 = 0.0;

  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    this.outg = new Smoother(sampleRate, 0.02);
    this.meter = new PeakHold(sampleRate, 0.3);
    this.kb = 1.0 - Math.exp(-32.0 / (sampleRate * 0.03));
  }

  reset(): void {
    this.lowL.reset(); this.midL.reset(); this.highL.reset();
    this.lowR.reset(); this.midR.reset(); this.highR.reset();
    this.meter.reset();
    this.started = false;
  }

  block(): void {
    const k = this.started ? this.kb : 1.0;
    this.cLow += (<f64>this.lowGain - this.cLow) * k;
    this.cMid += (<f64>this.midGain - this.cMid) * k;
    this.cHigh += (<f64>this.highGain - this.cHigh) * k;
    this.lfLow += (Math.log(<f64>this.lowFreq) - this.lfLow) * k;
    this.lfMid += (Math.log(<f64>this.midFreq) - this.lfMid) * k;
    this.lfHigh += (Math.log(<f64>this.highFreq) - this.lfHigh) * k;
    this.lq += (Math.log(<f64>this.midQ) - this.lq) * k;

    const fs = this.sampleRate, top = 0.45 * fs;
    const fl = min(Math.exp(this.lfLow), top), fm = min(Math.exp(this.lfMid), top), fh = min(Math.exp(this.lfHigh), top), q = Math.exp(this.lq);
    this.lowL.setLowShelf(fs, fl, this.cLow); this.lowR.setLowShelf(fs, fl, this.cLow);
    this.midL.setPeaking(fs, fm, q, this.cMid); this.midR.setPeaking(fs, fm, q, this.cMid);
    this.highL.setHighShelf(fs, fh, this.cHigh); this.highR.setHighShelf(fs, fh, this.cHigh);

    this.outg.target = <f32>Math.pow(10.0, <f64>this.output / 20.0);
    if (!this.started) { this.outg.snap(); this.started = true; }
  }

  sample(): void {
    const g = this.outg.next();
    const yl = this.highL.next(this.midL.next(this.lowL.next(this.l))) * g;
    const yr = this.highR.next(this.midR.next(this.lowR.next(this.r))) * g;
    this.outL = yl;
    this.outR = yr;
    this.level = this.meter.next(max(abs(yl), abs(yr)));
  }
}
