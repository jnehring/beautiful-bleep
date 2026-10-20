// SPDX-License-Identifier: GPL-3.0-or-later
// Examples for the playground. "Gains" is the real module in src/; the others are written here.

const FOLD_SOURCE = `import { Smoother, PeakHold } from "./bleep/dsp";

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
`;

const FOLD_VIEW = String.raw`// The UI of this module, in plain JavaScript. It runs in a sandbox: it can compute and draw, read the module's knobs and meters, and set the
// knobs, and nothing else. The object bleep is all it is given.
const c = bleep.canvas(190);                       // a canvas as wide as the view
const drive = bleep.param("drive"), mix = bleep.param("mix");
const t = bleep.theme;
let level = 0, dragging = false;

// drag in the picture: left and right is Drive, up and down is Mix
c.el.style.cursor = "crosshair";
c.el.addEventListener("pointerdown", (e) => { dragging = true; c.el.setPointerCapture(e.pointerId); move(e); });
c.el.addEventListener("pointermove", (e) => { if (dragging) move(e); });
c.el.addEventListener("pointerup", () => { dragging = false; });
function move(e) {
  const r = c.el.getBoundingClientRect();
  drive.setNormalised((e.clientX - r.left) / r.width);
  mix.setNormalised(1 - (e.clientY - r.top) / r.height);
}

bleep.onFrame(() => {
  const g = c.g, w = c.width, h = c.height;
  g.clearRect(0, 0, w, h);
  g.fillStyle = t.bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = t.line; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();

  // the transfer curve: what the module does to a signal from -1 to +1
  g.strokeStyle = t.accent; g.lineWidth = 2.5; g.beginPath();
  for (let px = 0; px <= w; px++) {
    const x = (px / w) * 2 - 1;
    const y = x + (Math.sin(x * drive.value) - x) * mix.value;
    const py = h / 2 - (y * (h / 2 - 8));
    px === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
  }
  g.stroke();

  // the level, as a dot sliding up the curve
  level += (bleep.probe("level") - level) * 0.25;
  const x = Math.min(1, level), y = x + (Math.sin(x * drive.value) - x) * mix.value;
  g.fillStyle = t.text;
  g.beginPath(); g.arc(w / 2 + x * (w / 2 - 6), h / 2 - y * (h / 2 - 8), 4, 0, Math.PI * 2); g.fill();

  g.fillStyle = t.muted; g.font = "11px system-ui";
  g.fillText("Drive " + drive.value.toFixed(1) + "   Mix " + mix.value.toFixed(2) + "   (drag to change)", 8, 14);
});
`;

export const EXAMPLES = [
  { id: "fold", name: "Wave folder", source: FOLD_SOURCE },
  { id: "fold-ui", name: "Wave folder with its own UI", source: FOLD_SOURCE, view: FOLD_VIEW },
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
  // The widgets the view shows instead of the automatic knobs: one strip per channel, then the master.
  layout: [
    { row: [
      { repeat: CHANNELS, title: "Ch {n}", column: [
        { knob: "high{n}" }, { knob: "mid{n}" }, { knob: "low{n}" }, { toggle: "lp{n}" },
        { fader: "vol{n}", meter: "level{n}" },
        { row: [{ toggle: "solo{n}" }, { toggle: "mute{n}" }] },
      ] },
      { title: "Master", column: [{ fader: "master", meter: "masterLevel" }] },
    ] },
  ],
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
  { id: "seq4x8", name: "Step sequencer (4 lanes, 8 steps)", source: `@module({
  name: "Step Sequencer 4x8",
  category: "Sequencing/Script",
  description: "Eight steps, four lanes, one gate out per lane. Runs from the tempo or from a clock input.",
  layout: [
    { row: [{ select: "source" }, { select: "division" }, { knob: "steps" }, { knob: "pulses" }, { knob: "gateLength" }] },
    { title: "Lane 1", row: [{ repeat: 8, column: ["a{n}"] }] },
    { title: "Lane 2", row: [{ repeat: 8, column: ["b{n}"] }] },
    { title: "Lane 3", row: [{ repeat: 8, column: ["c{n}"] }] },
    { title: "Lane 4", row: [{ repeat: 8, column: ["d{n}"] }] },
    { meter: "position" },
  ],
})
export class StepSequencer {
  @input({ name: "Clock", type: "trigger" }) clock: f32 = 0;
  @input({ name: "Reset", type: "trigger" }) restart: f32 = 0;
  @output({ name: "Gate", type: "gate", count: 4 }) gate!: StaticArray<f32>;

  @param({ name: "Source", choices: ["Tempo", "Clock in"] }) source: i32 = 0;
  @param({ name: "Division", choices: ["1/4", "1/8", "1/16", "1/32"] }) division: i32 = 2;
  @param({ name: "Steps", min: 1, max: 8, init: 8 }) steps: i32 = 8;
  @param({ name: "Pulses per step", min: 1, max: 24, init: 1 }) pulses: i32 = 1;
  @param({ name: "Gate length", min: 0.05, max: 1, init: 0.5, unit: "of a step", decimals: 2 }) gateLength: f32 = 0.5;
  @param({ name: "Step", count: 8, group: "Lane 1" }) a!: StaticArray<bool>;
  @param({ name: "Step", count: 8, group: "Lane 2" }) b!: StaticArray<bool>;
  @param({ name: "Step", count: 8, group: "Lane 3" }) c!: StaticArray<bool>;
  @param({ name: "Step", count: 8, group: "Lane 4" }) d!: StaticArray<bool>;
  @probe position: f32 = 0;

  private sampleRate: f64;
  private bpm: f64 = 120;
  private beat: f64 = 0;            // the position in quarter notes, advanced per sample
  private playing: bool = false;
  private step: i32 = -1;           // the step that is sounding; -1 before the first
  private pulse: i32 = 0;           // clock pulses since the step began
  private stepSamples: f64 = 0;     // how long a step lasts, to time the gates
  private sinceStep: f64 = 0;
  private sinceClock: f64 = 0;
  private open: bool = false;
  private fresh: bool = false;       // a reset happened on this sample

  constructor(sampleRate: f64) { this.sampleRate = sampleRate; this.stepSamples = sampleRate / 8.0; }

  @transport tempo(bpm: f64, ppq: f64, playing: bool): void {
    this.bpm = bpm;
    if (this.source == 0) {
      if (playing && !this.playing) this.step = -1;          // the transport started: begin again
      if (playing) this.beat = ppq;                          // follow the host's position exactly once per block
      if (!playing) this.closeAll();
    }
    this.playing = playing;
  }

  reset(): void { this.step = -1; this.pulse = 0; this.closeAll(); }

  private stepsPerBeat(): f64 {
    return this.division == 0 ? 1.0 : this.division == 1 ? 2.0 : this.division == 2 ? 4.0 : 8.0;
  }

  private closeAll(): void {
    for (let i = 0; i < 4; i++) this.gate[i] = 0;
    this.open = false;
  }

  /// Moves to step \`n\` and opens the gates of the lanes that have it on.
  private begin(n: i32): void {
    this.step = n;
    this.sinceStep = 0;
    this.gate[0] = this.a[n] ? 1 : 0;
    this.gate[1] = this.b[n] ? 1 : 0;
    this.gate[2] = this.c[n] ? 1 : 0;
    this.gate[3] = this.d[n] ? 1 : 0;
    this.open = true;
    this.position = <f32>(n + 1) / <f32>this.steps;
  }

  @on("restart", { rising: 0.5 }) rewind(): void {
    this.pulse = 0;
    this.fresh = true;
    this.begin(0);
  }

  @on("clock", { rising: 0.5 }) tick(): void {
    if (this.source != 1) return;
    if (this.sinceClock < this.sampleRate * 2.0) this.stepSamples = this.sinceClock * <f64>this.pulses;    // a step lasts as long as the clock says
    this.sinceClock = 0;
    if (this.fresh) return;                                   // a reset on the same sample wins: the clock does not move on
    if (this.step >= 0 && this.pulse + 1 < this.pulses) { this.pulse++; return; }
    this.pulse = 0;
    this.begin(this.step < 0 ? 0 : (this.step + 1) % this.steps);
  }

  sample(): void {
    this.fresh = false;
    this.sinceClock += 1;
    this.sinceStep += 1;
    if (this.source == 0) {
      if (!this.playing) return;
      this.stepSamples = this.sampleRate * 60.0 / (this.bpm * this.stepsPerBeat());
      const n = <i32>Math.floor(this.beat * this.stepsPerBeat()) % this.steps;
      if (n != this.step) this.begin(n);
      this.beat += this.bpm / (60.0 * this.sampleRate);      // after the check: the first sample of a block is exactly at ppq
    }
    if (this.open && this.sinceStep >= this.stepSamples * <f64>this.gateLength) this.closeAll();
  }
}
` },
  { id: "drive", name: "Drive with anti-aliasing", source: `import { Smoother, dbToLin } from "./bleep/dsp";

/// ln(cosh(x)): the antiderivative of tanh, written so that it cannot overflow.
function lnCosh(x: f64): f64 {
  const a = abs(x);
  return a + Math.log(1.0 + Math.exp(-2.0 * a)) - Math.LN2;
}

@module({ name: "Drive", category: "Effects/Script", description: "A soft clipper with anti-derivative anti-aliasing." })
export class Drive {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Drive", min: 0, max: 40, init: 12, unit: "dB", decimals: 1 }) drive: f32 = 12;
  @param({ name: "Mix", min: 0, max: 1, init: 1 }) mix: f32 = 1;
  @probe level: f32 = 0;

  private gain: Smoother;
  private wet: Smoother;
  private makeup: f32 = 1;
  private previousX: f64 = 0;          // the input one sample ago
  private previousF: f64 = 0;          // ln(cosh) of it
  constructor(sampleRate: f64) {
    this.gain = new Smoother(sampleRate, 0.01);
    this.wet = new Smoother(sampleRate, 0.01);
  }

  block(): void {
    this.gain.target = dbToLin(this.drive);
    this.wet.target = this.mix;
    // keep the loudness roughly constant as the drive rises
    this.makeup = <f32>(1.0 / Math.sqrt(<f64>dbToLin(this.drive)));
  }

  reset(): void { this.previousX = 0; this.previousF = 0; }

  sample(): void {
    const dry = this.x;
    const driven = <f64>(dry * this.gain.next());

    // ADAA: the average of tanh between the previous and the current sample
    const f = lnCosh(driven);
    const dx = driven - this.previousX;
    const shaped = abs(dx) < 0.00001
      ? Math.tanh(0.5 * (driven + this.previousX))           // two almost equal samples: the limit of the quotient
      : (f - this.previousF) / dx;
    this.previousX = driven;
    this.previousF = f;

    const w = this.wet.next();
    this.out = dry + (<f32>shaped * this.makeup - dry) * w;
    this.level = max(abs(this.out), this.level * 0.9995);
  }
}
` },
  { id: "sample-hold", name: "Sample and hold", source: `@module({ name: "Sample and Hold", category: "Utility/Script", description: "Holds the signal at each trigger." })
export class SampleHold {
  @input({ name: "Signal", type: "control" }) signal: f32 = 0;
  @input({ name: "Trigger", type: "trigger" }) trig: f32 = 0;
  @output({ name: "Out", type: "control" }) out: f32 = 0;

  @param({ name: "Glide", min: 0, max: 0.5, init: 0, unit: "s", decimals: 3 }) glide: f32 = 0;
  @param({ name: "Mode", choices: ["Sample", "Track"] }) mode: i32 = 0;
  @probe held: f32 = 0;

  private value: f32 = 0;          // what the last trigger took
  private smooth: f32 = 0;         // the output, gliding towards it
  private coefficient: f32 = 1;    // 1 means no glide
  private tracking: bool = false;
  private sampleRate: f64;
  constructor(sampleRate: f64) { this.sampleRate = sampleRate; }

  @on("trig", { rising: 0.5 }) take(): void {
    this.value = this.signal;                  // the signal at exactly this sample
    this.tracking = this.mode == 1;
  }
  @on("trig", { falling: 0.5 }) release(): void { this.tracking = false; }

  block(): void {
    // the glide time becomes a per-sample coefficient once per block: one exp() here, none in sample()
    this.coefficient = this.glide < 0.0005 ? <f32>1 : <f32>(1.0 - Math.exp(-1.0 / (this.sampleRate * <f64>this.glide)));
    this.held = this.value;
  }

  sample(): void {
    if (this.tracking) this.value = this.signal;      // Track mode follows the signal while the trigger is high
    this.smooth += (this.value - this.smooth) * this.coefficient;
    this.out = this.smooth;
  }
}
` },
  { id: "sample-hold-ui", name: "Sample and hold with its own UI", source: `@module({ name: "Sample and Hold", category: "Utility/Script", description: "Holds the signal at each trigger." })
export class SampleHold {
  @input({ name: "Signal", type: "control" }) signal: f32 = 0;
  @input({ name: "Trigger", type: "trigger" }) trig: f32 = 0;
  @output({ name: "Out", type: "control" }) out: f32 = 0;

  @param({ name: "Glide", min: 0, max: 0.5, init: 0, unit: "s", decimals: 3 }) glide: f32 = 0;
  @param({ name: "Mode", choices: ["Sample", "Track"] }) mode: i32 = 0;
  @probe held: f32 = 0;

  private value: f32 = 0;          // what the last trigger took
  private smooth: f32 = 0;         // the output, gliding towards it
  private coefficient: f32 = 1;    // 1 means no glide
  private tracking: bool = false;
  private sampleRate: f64;
  constructor(sampleRate: f64) { this.sampleRate = sampleRate; }

  @on("trig", { rising: 0.5 }) take(): void {
    this.value = this.signal;                  // the signal at exactly this sample
    this.tracking = this.mode == 1;
  }
  @on("trig", { falling: 0.5 }) release(): void { this.tracking = false; }

  block(): void {
    // the glide time becomes a per-sample coefficient once per block: one exp() here, none in sample()
    this.coefficient = this.glide < 0.0005 ? <f32>1 : <f32>(1.0 - Math.exp(-1.0 / (this.sampleRate * <f64>this.glide)));
    this.held = this.value;
  }

  sample(): void {
    if (this.tracking) this.value = this.signal;      // Track mode follows the signal while the trigger is high
    this.smooth += (this.value - this.smooth) * this.coefficient;
    this.out = this.smooth;
  }
}
`, view: `const view = bleep.canvas(120);
const history = new Array(240).fill(0);       // the last 240 frames of the held value
let tick = 0;

bleep.onFrame(() => {
  if (++tick % 2) return;                     // a column every second frame
  history.push(bleep.probe("held"));
  history.shift();

  const { g, width, height } = view;
  g.clearRect(0, 0, width, height);
  g.strokeStyle = bleep.theme.line;
  g.beginPath(); g.moveTo(0, height / 2); g.lineTo(width, height / 2); g.stroke();   // the zero line

  g.strokeStyle = bleep.theme.accent;
  g.lineWidth = 2;
  g.beginPath();
  history.forEach((v, i) => {
    const x = (i / (history.length - 1)) * width;
    const y = height / 2 - v * (height / 2 - 6);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  });
  g.stroke();
});

view.el.addEventListener("pointerdown", () => bleep.param("glide").set(0.1));   // a click sets the glide
` },
  { id: "mono-note", name: "Mono note (notes to pitch and gate)", source: `import { NoteEvent, NoteStream } from "./bleep/notes";

@module({ name: "Mono Note", category: "Utility/Script", description: "Notes to pitch, gate and velocity." })
export class MonoNote {
  @input({ name: "Notes", type: "notes" }) notes!: NoteStream;
  @output({ name: "Pitch", type: "pitch" }) pitch: f32 = 0;
  @output({ name: "Gate", type: "gate" }) gate: f32 = 0;
  @output({ name: "Velocity", type: "control", bipolar: false }) velocity: f32 = 0;

  private held: StaticArray<i32> = new StaticArray<i32>(16);    // the notes that are down, in the order they were pressed
  private count: i32 = 0;
  constructor(sampleRate: f64) {}

  @on("notes") handle(n: NoteEvent): void {
    if (n.isOn && n.value > 0) {
      this.remove(n.note);                                       // a repeated note goes to the top
      if (this.count < 16) { this.held[this.count] = n.note; this.count++; }
      this.pitch = n.pitch;
      this.velocity = n.value;
      this.gate = 1;
    } else if (n.isOff || (n.isOn && n.value == 0)) {
      this.remove(n.note);
      if (this.count == 0) this.gate = 0;                        // the last key went up
      else this.pitch = <f32>(this.held[this.count - 1] - 60) / 12.0;   // back to the key still down
    }
  }

  private remove(note: i32): void {
    let to = 0;
    for (let i = 0; i < 16; i++) {
      if (i >= this.count) break;
      if (this.held[i] != note) { this.held[to] = this.held[i]; to++; }
    }
    this.count = to;
  }
}
` },
  { id: "echo", name: "Echo (delay line)", source: `import { Smoother } from "./bleep/dsp";

@module({ name: "Echo", category: "Effects/Script" })
export class Echo {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Time", min: 0.01, max: 1, init: 0.3, map: "exp", unit: "s", decimals: 3 }) time: f32 = 0.3;
  @param({ name: "Feedback", min: 0, max: 0.95, init: 0.4 }) feedback: f32 = 0.4;
  @param({ name: "Mix", min: 0, max: 1, init: 0.4 }) mix: f32 = 0.4;

  private buffer: StaticArray<f32>;
  private size: i32;
  private write: i32 = 0;
  private filled: i32 = 0;           // how much of the buffer has been written since the last reset
  private delay: Smoother;
  private sampleRate: f64;
  constructor(sampleRate: f64) {
    const size = <i32>sampleRate + 2;                           // one second, and two samples for the interpolation
    this.sampleRate = sampleRate;
    this.size = size;
    this.buffer = new StaticArray<f32>(size);
    this.delay = new Smoother(sampleRate, 0.1);                 // a slow glide: a fast change in delay time bends the pitch
    this.delay.target = <f32>(sampleRate * 0.3);
    this.delay.snap();
  }

  reset(): void { this.filled = 0; this.write = 0; }            // forget the old contents without clearing a whole second

  block(): void { this.delay.target = <f32>(this.sampleRate * <f64>this.time); }

  sample(): void {
    const d = this.delay.next();                               // the delay in samples, fractional
    let delayed: f32 = 0;
    if (<i32>d < this.filled) {                                // only read what has been written since the reset
      let read = <f32>this.write - d;
      if (read < 0) read += <f32>this.size;
      const i = <i32>read;
      const frac = read - <f32>i;
      const a = this.buffer[i], b = this.buffer[i + 1 >= this.size ? 0 : i + 1];
      delayed = a + (b - a) * frac;                            // linear interpolation between two samples
    }
    this.buffer[this.write] = this.x + delayed * this.feedback;
    this.write = this.write + 1 >= this.size ? 0 : this.write + 1;
    if (this.filled < this.size) this.filled++;
    this.out = this.x + (delayed - this.x) * this.mix;
  }
}
` },
  { id: "sine", name: "Sine oscillator (simple)", source: `@module({ name: "Sine", category: "Sources/Script", description: "The simplest oscillator." })
export class Sine {
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Frequency", min: 20, max: 2000, init: 440, map: "exp", unit: "Hz", decimals: 1 }) frequency: f32 = 440;

  private phase: f64 = 0;
  private increment: f64 = 0;
  private sampleRate: f64;
  constructor(sampleRate: f64) { this.sampleRate = sampleRate; }

  block(): void { this.increment = <f64>this.frequency / this.sampleRate; }     // cycles per sample

  sample(): void {
    this.out = <f32>Math.sin(2.0 * Math.PI * this.phase);
    this.phase += this.increment;
    this.phase -= Math.floor(this.phase);                                       // wrap into 0 to 1
  }
}
` },
  { id: "sine-osc", name: "Sine oscillator with pitch input", source: `import { Smoother, pitchToHz } from "./bleep/dsp";

@module({ name: "Sine Osc", category: "Sources/Script", description: "A sine with a pitch input, tuning and level." })
export class SineOsc {
  @input({ name: "Pitch", type: "pitch" }) pitch: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Octave", min: -3, max: 3, init: 0 }) octave: i32 = 0;
  @param({ name: "Semitones", min: -12, max: 12, init: 0 }) semitones: i32 = 0;
  @param({ name: "Fine", min: -100, max: 100, init: 0, unit: "cents", decimals: 0 }) fine: f32 = 0;
  @param({ name: "Level", min: 0, max: 1, init: 0.5 }) level: f32 = 0.5;

  private phase: f64 = 0;
  private increment: f64 = 0;
  private gain: Smoother;
  private sampleRate: f64;
  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    this.gain = new Smoother(sampleRate, 0.01);
  }

  reset(): void { this.phase = 0; }

  block(): void {
    // octaves, semitones and cents are all just offsets in volts
    const volts = <f64>this.pitch + <f64>this.octave + <f64>this.semitones / 12.0 + <f64>this.fine / 1200.0;
    this.increment = pitchToHz(volts) / this.sampleRate;
    this.gain.target = this.level;
  }

  sample(): void {
    this.out = <f32>Math.sin(2.0 * Math.PI * this.phase) * this.gain.next();
    this.phase += this.increment;
    this.phase -= Math.floor(this.phase);
  }
}
` },
  { id: "sine-table", name: "Sine from a lookup table", source: `import { lerp } from "./bleep/dsp";

const TABLE_SIZE: i32 = 2048;

@module({ name: "Sine Table", category: "Sources/Script", description: "A sine from a lookup table." })
export class SineTable {
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Frequency", min: 20, max: 2000, init: 440, map: "exp", unit: "Hz", decimals: 1 }) frequency: f32 = 440;

  private table: StaticArray<f32> = new StaticArray<f32>(TABLE_SIZE + 1);   // one extra entry: the end equals the start
  private phase: f64 = 0;
  private increment: f64 = 0;
  private sampleRate: f64;
  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    for (let i = 0; i <= TABLE_SIZE; i++) this.table[i] = <f32>Math.sin(2.0 * Math.PI * <f64>i / <f64>TABLE_SIZE);
  }

  block(): void { this.increment = <f64>this.frequency / this.sampleRate; }

  sample(): void {
    const position = this.phase * <f64>TABLE_SIZE;
    const i = <i32>position;                                    // the entry below
    const fraction = <f32>(position - <f64>i);
    this.out = lerp(this.table[i], this.table[i + 1], fraction);   // blend the two neighbours
    this.phase += this.increment;
    this.phase -= Math.floor(this.phase);
  }
}
` },
  { id: "oscillator", name: "Oscillator (4 waveforms, FM, sync)", source: `import { Smoother, pitchToHz } from "./bleep/dsp";

/// The PolyBLEP residual: a small curve that, added around a jump, replaces the jump by a band-limited step. It is nonzero only within one
/// phase step \`dt\` of the jump. \`t\` is the phase relative to the jump (0 to 1).
function polyBlep(t: f64, dt: f64): f64 {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1.0; }
  if (t > 1.0 - dt) { const x = (t - 1.0) / dt; return x * x + x + x + 1.0; }
  return 0.0;
}

@module({
  name: "Oscillator",
  category: "Sources/Script",
  description: "Sine, triangle, saw and pulse with PolyBLEP, audio-rate FM and hard sync.",
})
export class Oscillator {
  @input({ name: "Pitch", type: "pitch" }) pitch: f32 = 0;
  @input({ name: "FM", type: "audio" }) fm: f32 = 0;
  @input({ name: "Sync", type: "trigger" }) sync: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @output({ name: "Sync out", type: "trigger" }) syncOut: f32 = 0;

  @param({ name: "Waveform", choices: ["Sine", "Triangle", "Saw", "Square"] }) waveform: i32 = 2;
  @param({ name: "Octave", min: -3, max: 3, init: 0 }) octave: i32 = 0;
  @param({ name: "Semitones", min: -12, max: 12, init: 0 }) semitones: i32 = 0;
  @param({ name: "Fine", min: -100, max: 100, init: 0, unit: "cents", decimals: 0 }) fine: f32 = 0;
  @param({ name: "Pulse width", min: 0.05, max: 0.95, init: 0.5 }) width: f32 = 0.5;
  @param({ name: "FM amount", min: 0, max: 5000, init: 0, map: "skew", centre: 300, unit: "Hz", decimals: 0 }) fmAmount: f32 = 0;
  @param({ name: "Level", min: 0, max: 1, init: 0.5 }) level: f32 = 0.5;

  private phase: f64 = 0;
  private base: f64 = 0;               // the frequency of the pitch and tuning, in Hz
  private inverse: f64;                // 1 / sampleRate
  private gain: Smoother;
  private pulseWidth: Smoother;
  private pulse: i32 = 0;              // samples left of the sync output pulse
  constructor(sampleRate: f64) {
    this.inverse = 1.0 / sampleRate;
    this.gain = new Smoother(sampleRate, 0.01);
    this.pulseWidth = new Smoother(sampleRate, 0.01);
    this.pulseWidth.target = 0.5;
    this.pulseWidth.snap();
  }

  reset(): void { this.phase = 0; this.pulse = 0; }

  /// Hard sync: a rising edge on the Sync input restarts the cycle, at the sample where the edge happens.
  @on("sync", { rising: 0.5 }) restart(): void { this.phase = 0; }

  block(): void {
    const volts = <f64>this.pitch + <f64>this.octave + <f64>this.semitones / 12.0 + <f64>this.fine / 1200.0;
    this.base = pitchToHz(volts);                           // the expensive part, once per block
    this.gain.target = this.level;
    this.pulseWidth.target = this.width;
  }

  sample(): void {
    // frequency modulation: the FM input adds Hz to the frequency, every sample. It can go negative: the oscillator then runs backwards.
    const step = (this.base + <f64>this.fm * <f64>this.fmAmount) * this.inverse;   // phase per sample
    const dt = abs(step);                                                          // how far the phase moves, whichever direction
    const direction: f64 = step < 0.0 ? -1.0 : 1.0;
    const t = this.phase;
    const w = <f64>this.pulseWidth.next();

    let v: f64;
    if (this.waveform == 0) {
      v = Math.sin(2.0 * Math.PI * t);
    } else if (this.waveform == 1) {
      v = 1.0 - 4.0 * abs(t - 0.5);                         // -1 at the start, +1 half way
    } else if (this.waveform == 2) {
      v = 2.0 * t - 1.0 - direction * polyBlep(t, dt);      // a saw, with its jump at the wrap smoothed
    } else {
      v = t < w ? 1.0 : -1.0;
      v += direction * polyBlep(t, dt);                     // the rising edge, at the wrap
      let u = t - w;
      if (u < 0.0) u += 1.0;
      v -= direction * polyBlep(u, dt);                     // the falling edge, at the pulse width
    }
    this.out = <f32>v * this.gain.next();

    // advance, and tell the world when the cycle starts again
    this.phase += step;
    if (this.phase >= 1.0 || this.phase < 0.0) {
      this.phase -= Math.floor(this.phase);
      this.pulse = 8;
    }
    this.syncOut = this.pulse > 0 ? 1 : 0;
    if (this.pulse > 0) this.pulse--;
  }
}
` },
];

/// The real Gains module, as built in src/ (a mixer channel).
export async function loadExamples() {
  const gains = await (await fetch("/script/src/gains.dsp.ts")).text();
  const synthVoice = await (await fetch("/script/src/synth-voice.dsp.ts")).text();
  return [{ id: "gains", name: "Gains (mixer channel)", source: gains }, { id: "synth-voice", name: "Synth voice (library tour)", source: synthVoice }, ...EXAMPLES].filter((e) => e.kind !== "patch" && !e.view);   // the playground compiles modules only
}
