// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Gains: volume, mute and solo for one mixer channel (doc/specs/bleep-script.md, section 5.2), written in Bleep Script.
// The decorators declare the interface; the transform (transform/bleep.mjs) generates the spec JSON and the bleep_* exports.

import { PeakHold, Smoother, dbToLin } from "./bleep/dsp";

@module({
  name: "Gains",
  category: "Utility/Mixing",
  colour: "#94a3b8",
  description: "Volume, mute and solo for one channel, with smoothing. Written in Bleep Script.",
})
export class Gains {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @input({ name: "Others Solo", type: "gate" }) othersSolo: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @output({ name: "Solo Out", type: "gate" }) soloOut: f32 = 0;

  @param({ name: "Volume", min: -60, max: 6, init: 0, unit: "dB", decimals: 1, minText: "-inf" }) vol: f32 = 0;
  @param({ name: "Mute" }) mute: bool = false;
  @param({ name: "Solo" }) solo: bool = false;

  /** The output level, for the channel's meter. */
  @probe level: f32 = 0;

  private gain: Smoother;
  private on: Smoother;
  private meter: PeakHold;
  private started: bool = false;

  constructor(sampleRate: f64) {
    this.gain = new Smoother(sampleRate, 0.010);
    this.on = new Smoother(sampleRate, 0.005);
    this.meter = new PeakHold(sampleRate, 0.3);
  }

  reset(): void { this.started = false; this.meter.reset(); }

  // block rate: once per chunk; inputs hold their first sample of the chunk
  block(): void {
    this.gain.target = this.vol <= -59.95 ? 0 : dbToLin(this.vol);
    this.on.target = this.mute || (this.othersSolo >= 0.5 && !this.solo) ? 0 : 1;
    this.soloOut = this.solo ? 1 : 0;
    if (!this.started) { this.gain.snap(); this.on.snap(); this.started = true; }
  }

  // sample rate
  sample(): void {
    this.out = this.x * this.gain.next() * this.on.next();
    this.level = this.meter.next(this.out);
  }
}
