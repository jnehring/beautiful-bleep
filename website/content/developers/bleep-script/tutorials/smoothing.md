---
title: Preventing pops and clicks
description: Why a knob can make a click, and how to smooth it: one-pole smoothing, linear ramps, muting, and the reset.
order: 20
---

# Preventing pops and clicks

A knob arrives once per block of 32 samples ([Rates and timing](../rates.md)). If you multiply a signal by it directly, the gain changes in a **step** every time the knob moves. A step in a signal is a click, and a fast sweep of a knob sounds like a buzz ("zipper noise"). The fix is always the same: do not use the knob's value directly, **glide** to it.

## The problem

```ts compile
@module({ name: "Gain Naive", category: "Utility/Script" })
export class GainNaive {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Level", min: 0, max: 1, init: 1 }) level: f32 = 1;
  constructor(sampleRate: f64) {}
  sample(): void { this.out = this.x * this.level; }
}
```

Play a steady tone through it and drag the knob: every block the multiplier jumps, and you hear it.

## The fix: a smoother

`Smoother` from [`bleep/dsp`](../library.md) moves a value towards a target by a fixed fraction of the remaining distance each sample (a one-pole filter). You set the **target once per block** and read the **smoothed value once per sample**:

```ts compile
import { Smoother } from "./bleep/dsp";

@module({ name: "Gain", category: "Utility/Script" })
export class Gain {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Level", min: 0, max: 1, init: 1 }) level: f32 = 1;

  private g: Smoother;
  constructor(sampleRate: f64) { this.g = new Smoother(sampleRate, 0.01); }   // a 10 ms glide

  block(): void { this.g.target = this.level; }
  sample(): void { this.out = this.x * this.g.next(); }
}
```

Three things to notice:

- **The smoother is made in the constructor.** Objects are allocated once; `block()` and `sample()` never allocate.
- **The time is the time constant.** After 10 ms the value is about 63 % of the way, after 50 ms about 99 %. 5 to 20 ms suits gains and mutes. Longer glides sound like a lag; shorter ones can still click on a big jump.
- **The target is set in `block()`**: it only changes once per block, so there is no reason to set it per sample.

## Gains in decibels

Smooth the **linear** gain, not the dB value: the ear hears dB, but the multiplication is linear, and a glide in linear gain has no overshoot or sign problem near silence.

```ts compile
import { Smoother, dbToLin } from "./bleep/dsp";

@module({ name: "Gain dB", category: "Utility/Script" })
export class GainDb {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Level", min: -60, max: 6, init: 0, unit: "dB", decimals: 1, minText: "-inf" }) level: f32 = 0;

  private g: Smoother;
  constructor(sampleRate: f64) { this.g = new Smoother(sampleRate, 0.01); }

  block(): void { this.g.target = this.level <= -59.9 ? 0 : dbToLin(this.level); }   // the bottom of the knob is silence
  sample(): void { this.out = this.x * this.g.next(); }
}
```

## Mutes, bypasses and switches

A toggle is the worst click: it jumps from 1 to 0. Smooth it the same way, by giving the smoother a target of 0 or 1:

```ts
@param({ name: "Mute" }) mute: bool = false;
block(): void { this.g.target = this.mute ? 0 : 1; }
```

The same goes for any switch that changes what you hear: a bypass, a solo, a filter type. Crossfade between the two signals with a smoothed 0 to 1 value (see the [toolbox](dsp-toolbox.md)).

## Starting up and resetting

A smoother starts at 0. If a module is created with a knob already at 1, the first few milliseconds fade in, which is usually what you want for a new module. After `reset()` (a transport jump, the engine clearing the module) you may want the value to **jump**, since there is no signal to protect. `snap()` does that:

```ts
reset(): void { this.g.snap(); }
```

Call `snap()` in `block()` on the first block, or in the constructor after setting `target`, when the module must be audible at once.

## Smoothing other things

| What changes | What to do |
|---|---|
| A gain, pan, send level | A `Smoother` per value, as above |
| A filter's cutoff or Q | Smooth the **frequency**, not the coefficients, and recompute the coefficients each block (see below) |
| A delay time | Smooth it with a longer time constant (50 to 200 ms), or the pitch jumps. A fast change on purpose is a different effect |
| A choice (wave shape, filter type) | Crossfade the two outputs |
| A control signal arriving as an input | Already per sample. Smooth it only to round its corners |

A filter whose coefficients change in a block-sized step is a classic source of zipper noise on a cutoff sweep. Smooth the cutoff in Hz at block rate and update the filter from it once per block:

```ts compile
import { Smoother, Biquad } from "./bleep/dsp";

@module({ name: "Low-pass", category: "Utility/Script" })
export class LowPass {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Cutoff", min: 40, max: 16000, init: 1000, map: "exp", unit: "Hz", decimals: 0 }) cutoff: f32 = 1000;
  @param({ name: "Q", min: 0.3, max: 10, init: 0.7, map: "exp" }) q: f32 = 0.7;

  private freq: Smoother;
  private filter: Biquad = new Biquad();
  private sampleRate: f64;
  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    this.freq = new Smoother(sampleRate, 0.02);
    this.freq.target = 1000;
    this.freq.snap();                     // start at the knob's default, not at 0 Hz
  }

  block(): void {
    this.freq.target = this.cutoff;
    // the coefficients follow the smoothed frequency, once per block: a step of 0.67 ms in the filter is inaudible
    this.filter.setLowpass(this.sampleRate, this.freq.value, this.q);
  }
  sample(): void {
    this.freq.next();                      // the glide itself runs per sample, so its time (20 ms) is exact
    this.out = this.filter.next(this.x);
  }
}
```

The glide runs per sample (cheap), and the expensive part, the trigonometry in `setLowpass`, runs once per block. That split, a smoothed value at audio rate and the costly derivation at block rate, is the usual shape of a module with a filter.

## Summary

- Never feed a knob straight into the signal path. Set a **target in `block()`**, read a **smoothed value in `sample()`**.
- Smooth the quantity the ear hears as a smooth thing (linear gain, frequency), and recompute derived values from it.
- Toggles and choices are knobs too.
- `snap()` when there is nothing to protect.
