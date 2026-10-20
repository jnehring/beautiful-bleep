---
title: Drive with anti-aliasing
description: Build a distortion module and understand aliasing: why a waveshaper makes inharmonic noise, and how anti-derivative anti-aliasing and oversampling reduce it.
order: 30
---

# Drive with anti-aliasing

A drive (a soft clipper, a saturator) pushes the signal through a curve such as `tanh`. It is the simplest nonlinear effect, and the simplest way to meet **aliasing**.

## The naive version

```ts compile
import { Smoother, dbToLin } from "./bleep/dsp";

@module({ name: "Drive Naive", category: "Utility/Script" })
export class DriveNaive {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Drive", min: 0, max: 40, init: 12, unit: "dB", decimals: 1 }) drive: f32 = 12;

  private g: Smoother;
  constructor(sampleRate: f64) { this.g = new Smoother(sampleRate, 0.01); }

  block(): void { this.g.target = dbToLin(this.drive); }
  sample(): void { this.out = <f32>Math.tanh(<f64>(this.x * this.g.next())); }
}
```

It does what it says, and it sounds harsh on a bright sine. The reason is not the curve but the sampling.

## What aliasing is

A clipper adds **harmonics**: a sine at 5 kHz becomes 5, 15, 25, 35 kHz and so on. A digital signal at 48 kHz can only hold frequencies up to 24 kHz (the Nyquist frequency). Harmonics above it do not disappear, they **fold back** below it: 35 kHz comes out as 48 − 35 = 13 kHz, which is not a harmonic of 5 kHz at all. These folded partials are **aliasing**, they sound inharmonic and dirty, and the harder you drive, the more of them there are.

You can avoid aliasing by making the nonlinearity less sharp, by raising the sampling rate (oversampling), or by computing what a band-limited waveshaper would output.

## Anti-derivative anti-aliasing (ADAA)

The cheapest good fix is **ADAA**, and it is short enough to write yourself. Here is the idea in four steps.

**1. The problem is the point sample.** The naive shaper evaluates `tanh` at one instant. A real, continuous signal that passes through `tanh` has harmonics far above Nyquist, and sampling the result folds them back. If the shaper's input had been band-limited **after** the curve, the folded partials would not exist.

**2. Use the average instead of the point.** Between two samples the input moves from `x₁` to `x`. Instead of `tanh(x)`, output the **average of `tanh` over that interval**:

```text
y = 1/(x − x₁) · ∫ tanh(u) du       from x₁ to x
```

Averaging over the interval is a gentle low-pass on the shaped signal, which is just what removes the folding.

**3. The integral has a closed form.** If `F` is an antiderivative of `tanh`, the integral is `F(x) − F(x₁)`, so

```text
y = (F(x) − F(x₁)) / (x − x₁)
```

and for `tanh` the antiderivative is `F(x) = ln(cosh x)`. You only need to remember the previous input and the previous `F`.

**4. Two numerical details.** `cosh` overflows for a large `x`, so use the identity `ln cosh x = |x| + ln(1 + e^(−2|x|)) − ln 2`, which never overflows. And when `x` and `x₁` are almost equal the quotient is 0/0; in the limit it is just `tanh` at the midpoint, so use that when the difference is tiny.

Put together, the shaper is a function and two fields:

```ts compile
import { Smoother, dbToLin } from "./bleep/dsp";

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
```

Compared with the naive module, only the middle of `sample()` changed: `Math.tanh(driven)` became the three lines of ADAA and the two fields that remember the previous sample. Because the shaper now has **state**, `reset()` clears it. The smoothing of drive and mix is the same as in [the smoothing tutorial](smoothing.md).

You do not have to write this every time: [`bleep/dsp`](../library.md) has the same shaper ready-made as `AdaaTanh`, with a `next(x)` method.

## Does it work?

The documentation test of this page measures it: a 5 kHz sine at 48 kHz with 30 dB of drive, through the naive shaper and through the ADAA module above, and looks at everything that is **not a harmonic** of the tone (the folded partials). In total they carry about 7 dB less energy with ADAA, and in the band **below the fundamental**, where folded partials stand out most because nothing masks them, about 27 dB less. It is a large improvement for a few operations; it is not perfect, and a hard-driven bright tone still has some aliasing: that is where oversampling comes in.

Try it on your own patch: sweep the input frequency upward while listening to a hard-driven tone. Aliased partials move *down* while the input goes up, which no real harmonic does.

## Oversampling

ADAA suits a smooth curve like `tanh`. For another curve, repeat the recipe: find its antiderivative `F` and use `(F(x) − F(x₁)) / (x − x₁)`. For a hard clipper the antiderivative is piecewise quadratic. And for very high drive the traditional method is **oversampling**: run the shaper at 2x or 4x the sample rate, low-pass before downsampling, and keep only what is in the audible band.

Bleep Script does not have a built-in oversampler: a module is called once per sample. You can write one yourself with `sample()` computing two shaper steps for each input sample (an interpolated one in between), followed by a half-band filter, but note that:

- the cost doubles per step, and the [cost estimate](../implementation/limits.md#cost-bound) will say so;
- a linear-phase filter adds latency, an IIR one does not but disturbs phase;
- for most drives, ADAA alone is audibly clean up to the moderate settings.

Try ADAA first, and add oversampling only when you can hear a problem.

## Check the output

A drive makes output you did not have: a DC offset (when the shaper is asymmetric) and a louder signal. Put `DcBlocker` after an asymmetric curve, and mind the level:

```ts
import { DcBlocker } from "./bleep/dsp";
private dc: DcBlocker;                                  // in the constructor: new DcBlocker(sampleRate, 20)
this.out = this.dc.next(shaped);
```
