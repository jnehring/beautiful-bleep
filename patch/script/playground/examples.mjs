// SPDX-License-Identifier: GPL-3.0-or-later
// Examples for the playground. "Gains" is the real module in src/; the others are written here.

export const EXAMPLES = [
  { id: "fold", name: "Wave folder", source: `import { Smoother, PeakHold } from "./bleep/dsp";

@module({
  name: "Fold",
  category: "Utility/Script",
  colour: "#f6c35b",
  description: "A wave folder: pushes the signal into a sine fold and mixes it back.",
})
export class Fold {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;

  @param({ name: "Drive", min: 0, max: 20, init: 2, decimals: 1 }) drive: f32 = 2;
  @param({ name: "Mix", min: 0, max: 1, init: 1, decimals: 2 }) mix: f32 = 1;

  /** The output level, for the meter. */
  @probe level: f32 = 0;

  private k: Smoother;
  private meter: PeakHold;

  constructor(sampleRate: f64) {
    this.k = new Smoother(sampleRate, 0.01);
    this.meter = new PeakHold(sampleRate, 0.3);
  }

  // block rate: once per 32 samples
  block(): void { this.k.target = this.drive; }

  // sample rate
  sample(): void {
    const folded = <f32>Math.sin(<f64>(this.x * this.k.next()));
    this.out = this.x + (folded - this.x) * this.mix;
    this.level = this.meter.next(this.out);
  }
}
` },
  { id: "tremolo", name: "Tremolo", source: `@module({
  name: "Tremolo",
  category: "Utility/Script",
  colour: "#a78bfa",
  description: "Amplitude modulation with a sine or triangle LFO.",
})
export class Tremolo {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;

  @param({ name: "Rate", min: 0.1, max: 20, init: 4, unit: "Hz", decimals: 1 }) rate: f32 = 4;
  @param({ name: "Depth", min: 0, max: 1, init: 0.5, decimals: 2 }) depth: f32 = 0.5;
  @param({ name: "Shape", choices: ["Sine", "Triangle"] }) shape: i32 = 0;

  @probe lfo: f32 = 0;

  private phase: f64 = 0;
  private sampleRate: f64;

  constructor(sampleRate: f64) { this.sampleRate = sampleRate; }

  reset(): void { this.phase = 0; }

  sample(): void {
    this.phase += <f64>this.rate / this.sampleRate;
    this.phase -= Math.floor(this.phase);
    let l: f32;
    if (this.shape == 0) l = <f32>(0.5 + 0.5 * Math.sin(2.0 * Math.PI * this.phase));
    else l = <f32>(this.phase < 0.5 ? 2.0 * this.phase : 2.0 - 2.0 * this.phase);
    this.lfo = l;
    this.out = this.x * (1 - this.depth * (1 - l));
  }
}
` },
];

/// The real Gains module, as built in src/ (a mixer channel).
export async function loadExamples() {
  const gains = await (await fetch("/script/src/gains.dsp.ts")).text();
  return [{ id: "gains", name: "Gains (mixer channel)", source: gains }, ...EXAMPLES];
}
