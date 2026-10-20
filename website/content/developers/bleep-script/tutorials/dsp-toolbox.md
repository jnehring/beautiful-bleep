---
title: The DSP toolbox
description: The typical building blocks of audio code and how to write them in a module script: oscillators, noise, delays, crossfades, filters, counters and tempo sync.
order: 60
---

# The DSP toolbox

The usual pieces of audio code, each as a small complete module. Copy one into a Code node and compile it. Most use something from [`bleep/dsp`](../library.md) for the parts that are easy to get wrong.

Common rules, from [Rates and timing](../rates.md): derive things from knobs in `block()`, run the signal in `sample()`, allocate only in the constructor, and smooth anything a knob can step.

## Oscillators and phase

Every oscillator is a **phase** that runs from 0 to 1 and a function of it. `Phasor` is the phase. A naive saw (`2 * phase - 1`) **aliases** (see [the drive tutorial](drive.md)); **PolyBLEP** corrects the jump where the saw wraps, which removes most of it. The [sine oscillator](sine-oscillator.md) and the [advanced oscillator](advanced-oscillator.md) tutorials go further; this is the short version:

```ts compile
import { Phasor, pitchToHz } from "./bleep/dsp";

/// The PolyBLEP correction: nonzero only within one phase step of the wrap.
function polyBlep(t: f64, dt: f64): f64 {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1.0; }
  if (t > 1.0 - dt) { const x = (t - 1.0) / dt; return x * x + x + x + 1.0; }
  return 0.0;
}

@module({ name: "Saw Osc", category: "Sources/Script", description: "A band-limited saw (PolyBLEP) and a sine." })
export class SawOsc {
  @input({ name: "Pitch", type: "pitch" }) pitch: f32 = 0;
  @output({ name: "Saw", type: "audio" }) saw: f32 = 0;
  @output({ name: "Sine", type: "audio" }) sine: f32 = 0;
  @param({ name: "Octave", min: -3, max: 3, init: 0 }) octave: i32 = 0;

  private osc: Phasor;
  private step: f64 = 0;
  private sampleRate: f64;
  constructor(sampleRate: f64) { this.sampleRate = sampleRate; this.osc = new Phasor(sampleRate); }

  block(): void {
    this.osc.frequency = pitchToHz(<f64>this.pitch + <f64>this.octave);     // the pitch at the start of the block
    this.step = this.osc.frequency / this.sampleRate;
  }

  sample(): void {
    const t = <f64>this.osc.next();
    this.saw = <f32>(2.0 * t - 1.0 - polyBlep(t, this.step));
    this.sine = <f32>Math.sin(2.0 * Math.PI * t);
  }
}
```

The pitch is read at **block rate** here, which is fine for a held note. For vibrato or a fast pitch envelope, read `this.pitch` in `sample()` and set `this.osc.frequency` there (it costs a `pow` per sample, so keep that to oscillators that need it).

## Noise

A white noise source is a pseudo-random number generator. A linear congruential generator is a few integer operations and has no state but one number:

```ts compile
@module({ name: "Noise", category: "Sources/Script" })
export class Noise {
  @output({ name: "White", type: "audio" }) white: f32 = 0;
  @output({ name: "Pink", type: "audio" }) pink: f32 = 0;
  @param({ name: "Level", min: 0, max: 1, init: 0.5 }) level: f32 = 0.5;

  private state: u32 = 22222;
  private b0: f32 = 0; private b1: f32 = 0; private b2: f32 = 0;
  constructor(sampleRate: f64) {}

  sample(): void {
    this.state = this.state * 1664525 + 1013904223;
    const w = <f32>(<i32>this.state) / 2147483648.0;                    // -1 to 1
    this.white = w * this.level;
    // a cheap pink noise: three one-pole filters of white noise, added up with the white
    this.b0 = 0.99765 * this.b0 + w * 0.0990460;
    this.b1 = 0.96300 * this.b1 + w * 0.2965164;
    this.b2 = 0.57000 * this.b2 + w * 1.0526913;
    this.pink = (this.b0 + this.b1 + this.b2 + w * 0.1848) * 0.25 * this.level;
  }
}
```

There is no `Math.random()` here: it is not available in real-time code, and a fixed seed makes the module repeatable.

## Delay lines

A delay is a buffer written at one position and read at another. Allocate it in the **constructor** (the only place that may) at the size of the longest delay:

```ts compile
import { Smoother } from "./bleep/dsp";

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
```

**Why `reset()` does not clear the buffer.** A loop in real-time code is limited to 4096 iterations (see [Limits](../implementation/limits.md)), and a second of audio is 48,000 samples. So the module remembers **how much has been written since the reset** (`filled`) and reads zero for anything older. This is the usual way to "clear" a long buffer in a module script.

## Crossfading and panning

Mixing two signals with a 0 to 1 control: use a **linear** crossfade for related signals (a dry and its wet copy) and an **equal-power** one for unrelated signals, so the level does not dip in the middle. The same law pans a mono signal:

```ts compile
import { Smoother } from "./bleep/dsp";

@module({ name: "Pan", category: "Utility/Script" })
export class Pan {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Left", type: "audio" }) left: f32 = 0;
  @output({ name: "Right", type: "audio" }) right: f32 = 0;
  @param({ name: "Pan", min: -1, max: 1, init: 0 }) pan: f32 = 0;

  private position: Smoother;
  constructor(sampleRate: f64) { this.position = new Smoother(sampleRate, 0.01); }

  block(): void { this.position.target = this.pan; }

  sample(): void {
    const p = (this.position.next() + 1) * 0.5;                        // 0 (left) to 1 (right)
    const angle = <f64>p * 0.5 * Math.PI;
    this.left = this.x * <f32>Math.cos(angle);                         // equal power: left² + right² = 1
    this.right = this.x * <f32>Math.sin(angle);
  }
}
```

## Counting triggers

A clock divider counts triggers and passes every n-th. It is an edge handler and a counter, with nothing per sample:

```ts compile
@module({ name: "Divider", category: "Utility/Script" })
export class Divider {
  @input({ name: "Clock", type: "trigger" }) clock: f32 = 0;
  @input({ name: "Reset", type: "trigger" }) restart: f32 = 0;
  @output({ name: "Out", type: "trigger" }) out: f32 = 0;
  @param({ name: "Divide by", min: 1, max: 32, init: 2 }) divide: i32 = 2;
  @probe count: f32 = 0;

  private counter: i32 = 0;
  private pulse: i32 = 0;
  constructor(sampleRate: f64) {}

  @on("clock", { rising: 0.5 }) tick(): void {
    if (this.counter == 0) this.pulse = 64;                     // the pulse lasts 64 samples
    this.counter = (this.counter + 1) % this.divide;
    this.count = <f32>this.counter;
  }
  @on("restart", { rising: 0.5 }) rewind(): void { this.counter = 0; }

  sample(): void {
    this.out = this.pulse > 0 ? 1 : 0;
    if (this.pulse > 0) this.pulse--;
  }
}
```

## Tempo sync

A module learns the tempo and position through a `@transport` method, called once per block before `block()`. This LFO runs in **musical time**: one cycle every `Beats` quarter notes, locked to the host's position, so it stays in step when the tempo changes or the transport jumps.

```ts compile
@module({ name: "Beat LFO", category: "Modulation/Script" })
export class BeatLfo {
  @output({ name: "Out", type: "control" }) out: f32 = 0;
  @param({ name: "Beats", min: 0.25, max: 16, init: 1, map: "exp", unit: "beats", decimals: 2 }) beats: f32 = 1;

  private beat: f64 = 0;
  private perSample: f64 = 0;
  private sampleRate: f64;
  constructor(sampleRate: f64) { this.sampleRate = sampleRate; }

  @transport tempo(bpm: f64, ppq: f64, playing: bool): void {
    this.perSample = bpm / (60.0 * this.sampleRate);           // quarter notes per sample
    if (playing) this.beat = ppq;                              // the position at the start of this block
  }

  sample(): void {
    this.beat += this.perSample;
    const phase = this.beat / <f64>this.beats;
    this.out = <f32>Math.sin(2.0 * Math.PI * (phase - Math.floor(phase)));
  }
}
```

`bpm` is the tempo, `ppq` the position at the start of the block in quarter notes, `playing` whether the transport runs. Between blocks the module advances the position itself, per sample, and takes the host's value again at the next block: this keeps it exact even when the tempo is automated. When the transport is stopped, `ppq` holds still; the module keeps its own running position or stops, as you decide. The [step sequencer tutorial](step-sequencer.md) uses this and a clock input together.

## Other things you will want

A list of the usual building blocks and where each is in or how to make it:

| Thing | How |
|---|---|
| Gain in dB, linear to dB | `dbToLin`, `linToDb` |
| Interpolation | `lerp`, or a fractional read as in the delay above |
| Smoothing a value | `Smoother`; or a one-pole with your own coefficient (S&H tutorial) |
| Peak meter, level follower | `PeakHold` |
| Shelving, bell, low-pass filters | `Biquad` (high-pass and band-pass are the same cookbook formulas with other coefficients: write them in a `set*` method like the library's) |
| Soft clipping | `AdaaTanh`; `Math.tanh` is fine for gentle drive, see [drive](drive.md) |
| DC offset removal | `DcBlocker` |
| Phase, LFO | `Phasor` |
| A lookup table | A `StaticArray<f32>` filled in the constructor, read with `lerp` |
| A one-sample delay (feedback in a filter) | A `f32` field |
| Random per trigger | The LCG above, advanced in the handler |
| Notes | [Events and routing](../events.md) |
| Oversampling | Not built in, see [drive](drive.md) |
| FFT, convolution, long buffers | Not a good fit: the cost bound is per block (see [Limits](../implementation/limits.md)) |
