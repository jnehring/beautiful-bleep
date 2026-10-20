---
title: A simple sine oscillator
description: Write an oscillator from scratch: the phase accumulator, a pitch input in volts, tuning, a click-free level, and a lookup table version.
order: 5
---

# A simple sine oscillator

Every oscillator, from a sine to a supersaw, is built on one idea: a number called the **phase** that goes from 0 up to 1 over and over, and a function that turns the phase into a sample. This tutorial writes the simplest one, a sine, in three steps. The [advanced oscillator](advanced-oscillator.md) builds on it.

## The idea: a phase accumulator

A sine at 440 Hz completes 440 cycles per second. At 48,000 samples per second that is `440 / 48000` of a cycle per sample. So:

1. keep a **phase** between 0 and 1;
2. for every sample, output `sin(2π · phase)`;
3. then add `frequency / sampleRate` to the phase, and wrap it back below 1.

The wrap is `phase -= floor(phase)`: it subtracts the whole part and keeps the fraction.

## Step 1: a fixed frequency

```ts compile
@module({ name: "Sine", category: "Sources/Script", description: "The simplest oscillator." })
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
```

Compile it, cable *Out* into a Speakers node and you hear a sine. Notes on the choices:

- **The increment is computed in `block()`.** The knob only changes once per block, so the division is paid once per block, not per sample ([Rates and timing](../rates.md)). `sample()` only adds, wraps and calls `sin`.
- **The phase is an `f64`.** An `f32` has about seven digits. A phase near 1.0 with a tiny increment, added a million times, would drift and wobble in pitch. Keep phases and phase increments in `f64`, and convert to `f32` only for the output.
- **The phase stays in 0 to 1**, not in radians. The wrap is simple, it never grows large, and every waveform you add later (a saw, a triangle) is a function of the same number.
- **The knob is `exp`**, because pitch is logarithmic: the same turn of the knob should give the same musical interval, not the same number of hertz ([Module scripts](../module-scripts.md#param)).

## Step 2: a pitch input, tuning and a level

A real oscillator is played from a keyboard or a sequencer, so it takes a **pitch** input. Pitch signals are in **volts per octave**: 0 is C4 (261.63 Hz) and each 1.0 is one octave up, so a frequency is `261.63 · 2^volts`. `pitchToHz` in [`bleep/dsp`](../library.md) does this conversion.

```ts compile
import { Smoother, pitchToHz } from "./bleep/dsp";

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
```

What changed:

- **All tuning is addition in volts.** An octave is `+1`, a semitone `+1/12`, a cent `+1/1200`. Convert to hertz once, at the end.
- **The pitch is read in `block()`**, so it is sampled 1,500 times a second (once per 32 samples). That is plenty for a held note, a slow glide or a vibrato; a pitch that moves faster than that, such as audio-rate FM, belongs on its own input, read per sample. The [advanced oscillator](advanced-oscillator.md) does exactly that.
- **The level is smoothed**, so turning it does not click ([Preventing pops and clicks](smoothing.md)).
- **`reset()` restarts the phase.** Every note then starts the sine at the same point, which makes an attack repeatable. Without it the oscillator is "free running" and each note starts wherever the phase happens to be.

Try a pitch from a **Keyboard** into *Pitch*, an **ADSR** into a VCA after it, and you have a voice.

## Step 3: a table instead of `sin`

`Math.sin` is accurate and, in WebAssembly, not free. If thousands of sines are running, a **lookup table** with interpolation is cheaper: the table is filled once in the constructor (the only place that may allocate) and each sample reads two entries and blends them.

```ts compile
import { lerp } from "./bleep/dsp";

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
```

The `for` loop in the constructor has a constant bound (2048), which the checker accepts. With 2048 entries and linear interpolation the error is below 0.00001, about −100 dB: inaudible. The cost per sample is a multiply, a floor and a `lerp` instead of a trigonometric call. For a single oscillator `Math.sin` is the simpler and better choice; use a table when you need many.

## Where to go from here

- Other waveforms are other functions of the same phase: `2 * phase - 1` is a saw, `abs(...)` a triangle. They alias, so they need extra work: the [advanced oscillator](advanced-oscillator.md).
- A **second phase** at another rate gives unison and detune; a **phase offset** gives a stereo pair.
- A **sync input**, **FM** and several waveforms: [the advanced oscillator](advanced-oscillator.md).
