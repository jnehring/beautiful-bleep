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
  { id: "router", name: "Note router", source: `import { NoteEvent, NoteStream } from "./bleep/notes";

@module({
  name: "Router",
  category: "Utility/Script",
  colour: "#a78bfa",
  description: "Sends notes below middle C to Low, and the rest to High an octave up. A control above 0.5 opens the Gate.",
})
export class Router {
  @input({ name: "Notes", type: "notes" }) notes!: NoteStream;
  @input({ name: "CC", type: "control" }) cc1: f32 = 0;
  @output({ name: "Low", type: "notes" }) low!: NoteStream;
  @output({ name: "High", type: "notes" }) high!: NoteStream;
  @output({ name: "Gate", type: "gate" }) gate: f32 = 0;

  /** How many notes have come in since the last reset, for the view. */
  @probe count: f32 = 0;

  constructor(sampleRate: f64) {}

  // event rate: once per note event, at its sample
  @on("notes") route(n: NoteEvent): void {
    this.count += 1;
    if (n.pitch < 0) {
      this.low.push(n);
    } else {
      n.transpose(12);
      this.high.push(n);
    }
  }

  // edges of a control input
  @on("cc1", { rising: 0.5 }) open(): void { this.gate = 1; }
  @on("cc1", { falling: 0.5 }) close(): void { this.gate = 0; }
}
` },
  { id: "mixer", name: "Mixer (configurable)", source: `import { Biquad, PeakHold, Smoother, dbToLin } from "./bleep/dsp";

@module({
  name: "Mixer",
  category: "Utility/Script",
  colour: "#60a5fa",
  description: "A mixer with as many channels as you set: a three band EQ, a low-pass, a fader, mute and solo on each.",
  settings: [{ id: "CHANNELS", name: "Channels", min: 1, max: 16, init: 4 }],
})
export class Mixer {
  @input({ name: "Ch", type: "audio", count: CHANNELS }) ch!: StaticArray<f32>;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;

  @param({ name: "High", min: -15, max: 15, init: 0, unit: "dB", count: CHANNELS, group: "Ch {n}" }) high!: StaticArray<f32>;
  @param({ name: "Mid", min: -15, max: 15, init: 0, unit: "dB", count: CHANNELS, group: "Ch {n}" }) mid!: StaticArray<f32>;
  @param({ name: "Low", min: -15, max: 15, init: 0, unit: "dB", count: CHANNELS, group: "Ch {n}" }) low!: StaticArray<f32>;
  @param({ name: "LP", count: CHANNELS, group: "Ch {n}" }) lp!: StaticArray<bool>;
  @param({ name: "Volume", min: -60, max: 6, init: 0, unit: "dB", decimals: 1, minText: "-inf", count: CHANNELS, group: "Ch {n}" }) vol!: StaticArray<f32>;
  @param({ name: "Mute", count: CHANNELS, group: "Ch {n}" }) mute!: StaticArray<bool>;
  @param({ name: "Solo", count: CHANNELS, group: "Ch {n}" }) solo!: StaticArray<bool>;
  @param({ name: "Master", min: -60, max: 6, init: 0, unit: "dB", decimals: 1, minText: "-inf" }) master: f32 = 0;

  /** The level of each channel after its fader, for its meter. */
  @probe({ name: "Level", count: CHANNELS }) level!: StaticArray<f32>;
  @probe({ name: "Master level" }) masterLevel: f32 = 0;

  private sampleRate: f64;
  private lows: StaticArray<Biquad>;
  private mids: StaticArray<Biquad>;
  private highs: StaticArray<Biquad>;
  private lps: StaticArray<Biquad>;
  private gains: StaticArray<Smoother>;
  private audible: StaticArray<Smoother>;
  private meters: StaticArray<PeakHold>;
  private masterGain: Smoother;
  private masterMeter: PeakHold;
  private started: bool = false;

  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    this.masterGain = new Smoother(sampleRate, 0.01);
    this.masterMeter = new PeakHold(sampleRate, 0.3);
    this.lows = new StaticArray<Biquad>(CHANNELS);
    this.mids = new StaticArray<Biquad>(CHANNELS);
    this.highs = new StaticArray<Biquad>(CHANNELS);
    this.lps = new StaticArray<Biquad>(CHANNELS);
    this.gains = new StaticArray<Smoother>(CHANNELS);
    this.audible = new StaticArray<Smoother>(CHANNELS);
    this.meters = new StaticArray<PeakHold>(CHANNELS);
    for (let i = 0; i < CHANNELS; i++) {
      this.lows[i] = new Biquad(); this.mids[i] = new Biquad(); this.highs[i] = new Biquad(); this.lps[i] = new Biquad();
      this.gains[i] = new Smoother(sampleRate, 0.01);
      this.audible[i] = new Smoother(sampleRate, 0.005);
      this.meters[i] = new PeakHold(sampleRate, 0.3);
    }
  }

  reset(): void { this.started = false; }

  // block rate: filter settings, fader targets, mute and solo
  block(): void {
    let anySolo = false;
    for (let i = 0; i < CHANNELS; i++) if (this.solo[i]) anySolo = true;
    for (let i = 0; i < CHANNELS; i++) {
      this.lows[i].setLowShelf(this.sampleRate, 100.0, <f64>this.low[i]);
      this.mids[i].setPeaking(this.sampleRate, 1000.0, 0.7, <f64>this.mid[i]);
      this.highs[i].setHighShelf(this.sampleRate, 8000.0, <f64>this.high[i]);
      this.lps[i].setLowpass(this.sampleRate, 12000.0, 0.707);
      this.gains[i].target = this.vol[i] <= -59.95 ? 0 : dbToLin(this.vol[i]);
      this.audible[i].target = this.mute[i] || (anySolo && !this.solo[i]) ? 0 : 1;
    }
    this.masterGain.target = this.master <= -59.95 ? 0 : dbToLin(this.master);
    if (!this.started) {
      for (let i = 0; i < CHANNELS; i++) { this.gains[i].snap(); this.audible[i].snap(); }
      this.masterGain.snap();
      this.started = true;
    }
  }

  // sample rate
  sample(): void {
    let sum: f32 = 0;
    for (let i = 0; i < CHANNELS; i++) {
      let s = this.lows[i].next(this.ch[i]);
      s = this.mids[i].next(s);
      s = this.highs[i].next(s);
      if (this.lp[i]) s = this.lps[i].next(s);
      const y = s * this.gains[i].next() * this.audible[i].next();
      this.level[i] = this.meters[i].next(y);
      sum += y;
    }
    this.out = sum * this.masterGain.next();
    this.masterLevel = this.masterMeter.next(this.out);
  }
}
` },
  { id: "supersaw", kind: "patch", name: "SuperSaw: 100 oscillators (patch script)", source: `import { cell } from "bleep/patch";

// A patch script runs once and builds a cell of modules and cables on the board. Loops and arithmetic are plain JavaScript;
// the module and knob names are the ones in the Add menu and on the module views, with values in their own units.
export default cell("SuperSaw", {
  description: "Many detuned saw oscillators into one filter.",
  settings: [
    { id: "VOICES", name: "Oscillators", min: 1, max: 200, init: 100 },
    { id: "SPREAD", name: "Spread (cents)", min: 0, max: 100, init: 30 },
  ],
}, (c, s) => {
  c.input("pitch", "Pitch", "pitch");
  c.stereoOut();

  const filter = c.add("filter", { cutoff: 4000, resonance: 0.2 });
  for (let i = 0; i < s.VOICES; i++) {
    const detune = s.VOICES > 1 ? (i / (s.VOICES - 1) - 0.5) * 2 * s.SPREAD : 0;
    const osc = c.add("oscillator", { fine: detune }, { name: "Saw " + (i + 1) });
    c.cable(c.cin, "pitch", osc, "pitch");
    c.cable(osc, "saw", filter, "l", 1 / Math.sqrt(s.VOICES));   // inputs add up what is cabled to them
  }
  c.stereo(filter, c.cout);
});
` },
];

/// The real Gains module, as built in src/ (a mixer channel).
export async function loadExamples() {
  const gains = await (await fetch("/script/src/gains.dsp.ts")).text();
  return [{ id: "gains", name: "Gains (mixer channel)", source: gains }, ...EXAMPLES].filter((e) => e.kind !== "patch");   // the playground compiles modules only
}
