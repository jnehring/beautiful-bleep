---
title: Library
description: The bleep/ libraries a module script can import: oscillators, filters, delays, envelopes, dynamics, noise, effects, an FFT, helpers and note events.
order: 60
---

# Library

Module scripts can import only from `bleep/`. These libraries are plain AssemblyScript that is inlined into your module, so using them costs nothing extra. For how to use the pieces together, see the [tutorials](tutorials/overview.md) and the [synth voice tutorial](tutorials/synth-voice.md). Three rules hold for all of them:

- **Allocate in the constructor, never in `block()` or `sample()`.** Every class that needs memory (a delay line, a table, a reverb) takes its size in its constructor and allocates then. Nothing in the library allocates afterwards.
- **`set*` and `update` methods may call `sin`, `tan`, `exp` or `pow`.** Call them in `block()`, and only when a setting changed, not in `sample()`. The `next()` methods are made for `sample()`.
- **Audio is `f32`, `Math` takes `f64`.** Phases and frequencies are `f64` where precision matters (a phase accumulator in `f32` goes wrong after a few seconds); audio samples and levels are `f32`. Frequencies are in Hz, times in seconds, levels in dB when a name says so (`thresholdDb`) and linear otherwise.

Each library section ends with **Examples**: one for every function and class. An example shows the members of a module class, the part you would write inside `export class ... { }`. They assume the class has the audio input `x`, the audio output `out` and the field `sampleRate` (set in the constructor), as in the module at the top of this page; any other jack they need is declared in the example. Every example is compiled by the documentation test.

| Import | What is in it |
| --- | --- |
| [`./bleep/osc`](#bleeposc) | Band-limited saw, pulse and triangle, fast sine, wavetables, supersaw, FM operator |
| [`./bleep/filters`](#bleepfilters) | One-pole, state-variable and ladder filters, resonator, formants, all-passes, comb |
| [`./bleep/delay`](#bleepdelay) | Delay line, table interpolation, tape delay, plucked string |
| [`./bleep/random`](#bleeprandom) | Seeded random numbers, white, pink and brown noise, sample and hold, random LFO |
| [`./bleep/env`](#bleepenv) | ADSR and friends, followers, slew, LFO, ramps, triggers, tempo clock |
| [`./bleep/dynamics`](#bleepdynamics) | Compressor, limiter, gate, wave shapers, bitcrusher, oversampling |
| [`./bleep/fx`](#bleepfx) | Reverb, phaser, chorus, pitch shifter |
| [`./bleep/fft`](#bleepfft) | A fixed-size FFT |
| [`./bleep/util`](#bleeputil) | Ranges, pitch conversion, fast math, pan and mid/side, RMS |
| [`./bleep/dsp`](#bleepdsp) | Smoothing, meters, biquad filter, dB conversion |
| [`./bleep/notes`](#bleepnotes) | Note events |

A short example, a saw voice with a filter that follows an envelope (see also the [synth voice tutorial](tutorials/synth-voice.md)):

```ts
import { sawBlep } from "./bleep/osc";
import { Svf } from "./bleep/filters";
import { Adsr } from "./bleep/env";

@module({ name: "Pluck", category: "Utility/Script" })
export class Pluck {
  @input({ name: "Gate", type: "gate" }) gate: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Pitch", min: 40, max: 2000, init: 110, unit: "Hz" }) pitch: f32 = 110;

  private phase: f64 = 0;
  private filter: Svf = new Svf();
  private env: Adsr;
  private sampleRate: f64;

  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    this.env = new Adsr(sampleRate);
    this.env.set(0.002, 0.25, 0.0, 0.2);
  }

  sample(): void {
    const e = this.env.next(this.gate);
    const dt = <f64>this.pitch / this.sampleRate;
    this.phase += dt; if (this.phase >= 1.0) this.phase -= 1.0;
    this.filter.set(this.sampleRate, 200.0 + 4000.0 * <f64>e, 2.0);
    this.filter.tick(sawBlep(this.phase, dt));
    this.out = this.filter.low * e;
  }
}
```

The `set` call inside `sample()` there costs a `tan` per sample: fine for a single voice, but when the sweep does not need sample accuracy set the filter from `block()` (once per 32 samples), as the [synth voice](tutorials/synth-voice.md) does.

## bleep/osc

```ts
import { sawBlep, squareBlep, triangle, Wavetable, Supersaw } from "./bleep/osc";
```

Phases run from 0 to 1 over one cycle and `dt` is the phase step of one sample (`frequency / sampleRate`). A naive saw or square aliases: harmonics above half the sample rate fold back as inharmonic whistles. The `*Blep` and `triangle` functions remove most of that by correcting the waveform near its jumps and corners (polyBLEP and polyBLAMP). Keep phase accumulators in `f64`.

| Name | What it does |
| --- | --- |
| `polyBlep(t, dt)` | The polyBLEP residual of a unit step at phase 0. Add `height * polyBlep(phase, dt)` to a naive waveform at each jump to make your own band-limited shape. |
| `polyBlamp(t, dt)` | The same for a corner (a change of slope). It is already multiplied by `dt`; multiply by the slope change per unit of phase. |
| `sawBlep(phase, dt)` | A band-limited sawtooth rising from -1 to 1. |
| `squareBlep(phase, dt, width)` | A band-limited pulse wave, +1 for the first `width` (0 to 1) of the cycle and -1 for the rest. `width` 0.5 is a square. |
| `triangle(phase, dt)` | A band-limited triangle, starting at 0 and rising. Stateless (polyBLAMP on the naive triangle), so it has no drift or leak. |
| `fastSin(phase)` | A sine from a polynomial, error below 4e-6. `phase` in cycles, any value. |
| `SineTable(size = 4096)` | A sine from a lookup table with linear interpolation. `read(phase)`. |
| `Wavetable(size = 2048, levels = 10)` | A mip-mapped wavetable: each level has half the harmonics of the one before, and `read(phase, dt)` picks the level that does not alias at the pitch it is played. Fill it in the constructor with `setSaw()`, `setSquare()`, `setTriangle()` or `setHarmonics(amps, count)` (the amplitude of harmonic k + 1 is `amps[k]`): building takes `size` times the number of harmonics operations. |
| `Supersaw(sampleRate, voices = 7, detuneCents = 20)` | A stack of detuned band-limited saws. `setDetune(cents)` is the total spread; `next(frequency)` per sample. The mix is scaled by 1 / sqrt(voices). The start phases are fixed, so it sounds the same on every run. |
| `FmOp(sampleRate)` | One FM / phase-modulation operator. `next(frequency, modulation, feedback)`: `modulation` is in cycles (another operator's output times an index), `feedback` times the operator's own last output is added to the phase. `reset()`. |

### Examples

#### `polyBlep`

```ts example
import { polyBlep } from "./bleep/osc";

private phase: f64 = 0;

sample(): void {
  const dt = 220.0 / this.sampleRate;
  this.phase += dt;
  this.phase -= Math.floor(this.phase);
  // a naive saw, minus the smoothed step where it wraps
  this.out = <f32>(2.0 * this.phase - 1.0 - polyBlep(this.phase, dt));
}
```

#### `polyBlamp`

```ts example
import { polyBlamp } from "./bleep/osc";

private phase: f64 = 0;

sample(): void {
  const dt = 220.0 / this.sampleRate;
  this.phase += dt;
  this.phase -= Math.floor(this.phase);
  // a naive triangle with the corner at the valley smoothed (the library's triangle() does both corners)
  let q = this.phase + 0.25;
  if (q >= 1.0) q -= 1.0;
  this.out = <f32>(1.0 - abs(4.0 * q - 2.0) + 8.0 * polyBlamp(q, dt));
}
```

#### `sawBlep`

```ts example
import { sawBlep } from "./bleep/osc";

private phase: f64 = 0;

sample(): void {
  const dt = 110.0 / this.sampleRate;
  this.phase += dt;
  this.phase -= Math.floor(this.phase);
  this.out = sawBlep(this.phase, dt) * 0.5;
}
```

#### `squareBlep`

```ts example
import { squareBlep } from "./bleep/osc";

private phase: f64 = 0;

sample(): void {
  const dt = 110.0 / this.sampleRate;
  this.phase += dt;
  this.phase -= Math.floor(this.phase);
  this.out = squareBlep(this.phase, dt, 0.25) * 0.5;      // a pulse, high for a quarter of the cycle
}
```

#### `triangle`

```ts example
import { triangle } from "./bleep/osc";

private phase: f64 = 0;

sample(): void {
  const dt = 110.0 / this.sampleRate;
  this.phase += dt;
  this.phase -= Math.floor(this.phase);
  this.out = triangle(this.phase, dt) * 0.5;
}
```

#### `fastSin`

```ts example
import { fastSin } from "./bleep/osc";

private phase: f64 = 0;

sample(): void {
  this.phase += 440.0 / this.sampleRate;
  this.phase -= Math.floor(this.phase);
  this.out = fastSin(this.phase) * 0.5;       // no Math.sin call
}
```

#### `SineTable`

```ts example
import { SineTable } from "./bleep/osc";

private table: SineTable = new SineTable(2048);
private phase: f64 = 0;

sample(): void {
  this.phase += 440.0 / this.sampleRate;
  this.phase -= Math.floor(this.phase);
  this.out = this.table.read(this.phase) * 0.5;
}
```

#### `Wavetable`

```ts example
import { Wavetable } from "./bleep/osc";

private table: Wavetable = new Wavetable();
private phase: f64 = 0;

constructor(sampleRate: f64) {
  this.table.setSaw();              // or setSquare(), setTriangle()
}

sample(): void {
  const dt = 330.0 / this.sampleRate;
  this.phase += dt;
  this.phase -= Math.floor(this.phase);
  this.out = this.table.read(this.phase, dt) * 0.5;      // dt picks the mip level that does not alias
}
```

#### `Wavetable.setHarmonics`

```ts example
import { Wavetable } from "./bleep/osc";

private table: Wavetable = new Wavetable();
private phase: f64 = 0;

constructor(sampleRate: f64) {
  const amps = new StaticArray<f32>(4);        // an organ: harmonics 1 to 4
  amps[0] = 1.0; amps[1] = 0.5; amps[2] = 0.0; amps[3] = 0.25;
  this.table.setHarmonics(amps, 4);
}

sample(): void {
  const dt = 220.0 / this.sampleRate;
  this.phase += dt;
  this.phase -= Math.floor(this.phase);
  this.out = this.table.read(this.phase, dt) * 0.5;
}
```

#### `Supersaw`

```ts example
import { Supersaw } from "./bleep/osc";

private saw: Supersaw;

constructor(sampleRate: f64) {
  this.saw = new Supersaw(sampleRate, 7, 25.0);      // seven saws, 25 cents apart in all
}

block(): void { this.saw.setDetune(30.0); }

sample(): void { this.out = this.saw.next(110.0) * 0.5; }
```

#### `FmOp`

```ts example
import { FmOp } from "./bleep/osc";

private modulator: FmOp;
private carrier: FmOp;

constructor(sampleRate: f64) {
  this.modulator = new FmOp(sampleRate);
  this.carrier = new FmOp(sampleRate);
}

sample(): void {
  const m = this.modulator.next(440.0, 0.0, 0.2);      // frequency, modulation (cycles), feedback
  this.out = this.carrier.next(220.0, m * 1.5) * 0.5;  // the modulator times an index drives the carrier's phase
}
```

## bleep/filters

```ts
import { OnePole, Svf, LadderFilter, Resonz, Formant, Allpass1, Allpass2, CombFilter } from "./bleep/filters";
```

Frequencies are clamped below Nyquist, so a modulated cutoff cannot make a filter unstable. All filters have `reset()`. For a plain low-pass, high-pass, band-pass, notch, all-pass or shelf at a fixed setting, [`Biquad`](#bleepdsp) is the cheapest.

| Name | What it does |
| --- | --- |
| `OnePole` | A 6 dB per octave filter. `setLowpass(sr, f)` or `setHighpass(sr, f)` (exactly -3 dB at `f`), then `next(x)`. |
| `Svf` | A state-variable filter (Cytomic / Simper), stable under fast cutoff modulation. `set(sr, f, q)` (`q` from 0.5; 0.7071 is flat), then `tick(x)` and read `low`, `high`, `band` (peak gain `q`), `bandUnity` (peak gain 1), `notch`, `peak` or `all`. |
| `LadderFilter` | A Moog-style 24 dB per octave low-pass with tanh saturation in each stage. `set(sr, f, resonance, drive = 1)`, `next(x)`. Resonance 0 to 1 (it self-oscillates near 1); the passband level drops as it rises, like the real thing. |
| `Resonz` | A resonator with peak gain 1 (SuperCollider's Resonz). `set(sr, f, bandwidthHz)`, `next(x)`. |
| `Formant` | Three resonators tuned to the formants of a vowel. `setVowel(sr, position, shift = 1)` morphs through a, e, i, o, u (0 to 4); `shift` scales the formants (1.15 is a smaller voice). Feed it a saw or noise. |
| `Allpass1` | A first-order all-pass (unit gain, phase turns a quarter cycle at `f`). `set(sr, f)`, `next(x)`. Chain a few for a phaser. |
| `Allpass2` | A second-order all-pass (phase turns half a cycle at `f`). `set(sr, f, q)`, `next(x)`. |
| `CombFilter(maxDelay)` | `y = x + feedforward * x[n - D] + feedback * y[n - D]`. Set the public `feedforward` and `feedback`, `setDelay(samples)` (fractions allowed), `next(x)`. Feedforward only is a notch comb (flanger); feedback only rings at multiples of sampleRate / D. |

### Examples

#### `OnePole`

```ts example
import { OnePole } from "./bleep/filters";

private low: OnePole = new OnePole();
private high: OnePole = new OnePole();

block(): void {
  this.low.setLowpass(this.sampleRate, 4000.0);
  this.high.setHighpass(this.sampleRate, 200.0);
}

sample(): void { this.out = this.high.next(this.low.next(this.x)); }      // a gentle band
```

#### `Svf`

```ts example
import { Svf } from "./bleep/filters";

private filter: Svf = new Svf();

block(): void { this.filter.set(this.sampleRate, 1200.0, 4.0); }      // frequency, q

sample(): void {
  this.filter.tick(this.x);
  this.out = this.filter.band;          // also low, high, bandUnity, notch, peak and all
}
```

#### `LadderFilter`

```ts example
import { LadderFilter } from "./bleep/filters";

private ladder: LadderFilter = new LadderFilter();

block(): void { this.ladder.set(this.sampleRate, 800.0, 0.6, 1.5); }      // frequency, resonance, drive

sample(): void { this.out = this.ladder.next(this.x); }
```

#### `Resonz`

```ts example
import { Resonz } from "./bleep/filters";

private res: Resonz = new Resonz();

block(): void { this.res.set(this.sampleRate, 880.0, 60.0); }      // frequency, bandwidth in Hz

sample(): void { this.out = this.res.next(this.x); }
```

#### `Formant`

```ts example
import { Formant } from "./bleep/filters";

private vowel: Formant = new Formant();

block(): void { this.vowel.setVowel(this.sampleRate, 1.5); }      // between e (1) and i (2)

sample(): void { this.out = this.vowel.next(this.x) * 0.5; }      // feed it a saw or noise
```

#### `Allpass1`

```ts example
import { Allpass1 } from "./bleep/filters";

private a: Allpass1 = new Allpass1();
private b: Allpass1 = new Allpass1();

block(): void {
  this.a.set(this.sampleRate, 600.0);
  this.b.set(this.sampleRate, 1800.0);
}

sample(): void {
  const shifted = this.b.next(this.a.next(this.x));
  this.out = (this.x + shifted) * 0.5;       // two stages and the dry signal: one notch of a phaser
}
```

#### `Allpass2`

```ts example
import { Allpass2 } from "./bleep/filters";

private ap: Allpass2 = new Allpass2();

block(): void { this.ap.set(this.sampleRate, 1000.0, 0.7); }      // frequency, q

sample(): void { this.out = (this.x + this.ap.next(this.x)) * 0.5; }
```

#### `CombFilter`

```ts example
import { CombFilter } from "./bleep/filters";

private comb: CombFilter;

constructor(sampleRate: f64) {
  this.comb = new CombFilter(2048);
  this.comb.feedback = 0.8;                                  // ringing at multiples of sampleRate / delay
  this.comb.setDelay(<f32>(sampleRate / 220.0));              // tuned to 220 Hz
}

sample(): void { this.out = this.comb.next(this.x) * 0.3; }
```

## bleep/delay

```ts
import { DelayLine, TapeDelay, KarplusStrong, interpLinear, interpCubic, interpLagrange } from "./bleep/delay";
```

| Name | What it does |
| --- | --- |
| `DelayLine(maxSamples)` | A delay line. `write(x)` once per sample, then read: `read(d)` (linear), `readCubic(d)` (Catmull-Rom, better highs, `d` from 1), `readAllpass(d)` (flat response, best for a steady `d`, one tap, `d` from 1.5); `tap(age)` reads a whole number of samples. `read(0)` is the sample just written. `reset()` clears it. |
| `interpLinear(table, pos)` | Linear interpolation in a `StaticArray<f32>`, wrapping at the ends; `pos` is an index with a fraction. |
| `interpCubic(table, pos)` | The same with Catmull-Rom cubic interpolation. |
| `interpLagrange(table, pos)` | The same with third-order Lagrange interpolation, exact for cubic polynomials. |
| `TapeDelay(sampleRate, maxSeconds, glideSeconds = 0.15)` | A tape-style echo: the delay time glides (changing it bends the pitch of the repeats, limited by `maxBend`), the repeats get darker (`setTone(hz)`) and saturated (`saturation`), and `wowDepth` / `wowRate` add drift. Set `time` and `feedback`; `next(x)` returns the wet signal; `snap()` jumps to `time`. |
| `KarplusStrong(sampleRate, lowestHz = 40)` | A plucked string. `pluck(frequency, amplitude, brightness)` starts a note (it fills the line with noise: call it from a note handler); `next()` returns the string. `damping` (0 to 0.5) is how fast the highs die, `decay` (just under 1) the length of the note. `setFrequency(f)` bends it. |

### Examples

#### `DelayLine`

```ts example
import { DelayLine } from "./bleep/delay";

private line: DelayLine;

constructor(sampleRate: f64) {
  this.line = new DelayLine(<i32>(sampleRate * 0.5) + 2);      // room for half a second
}

reset(): void { this.line.reset(); }

sample(): void {
  this.line.write(this.x);
  const echo = this.line.read(<f32>(this.sampleRate * 0.25));    // a quarter of a second ago
  this.out = this.x + echo * 0.5;
}
```

#### `DelayLine.readCubic`

```ts example
import { DelayLine } from "./bleep/delay";
import { fastSin } from "./bleep/osc";

private line: DelayLine;
private phase: f64 = 0;

constructor(sampleRate: f64) {
  this.line = new DelayLine(<i32>(sampleRate * 0.02) + 4);
}

sample(): void {
  this.phase += 0.5 / this.sampleRate;
  this.phase -= Math.floor(this.phase);
  this.line.write(this.x);
  // a delay that moves: cubic interpolation keeps the highs
  const d = <f32>(this.sampleRate * (0.005 + 0.003 * <f64>fastSin(this.phase)));
  this.out = (this.x + this.line.readCubic(d)) * 0.5;
}
```

#### `DelayLine.readAllpass`

```ts example
import { DelayLine } from "./bleep/delay";

private line: DelayLine;

constructor(sampleRate: f64) {
  this.line = new DelayLine(<i32>(sampleRate * 0.01) + 4);
}

sample(): void {
  this.line.write(this.x);
  // a steady, fractional delay with a flat frequency response
  this.out = this.line.readAllpass(<f32>(this.sampleRate * 0.0031));
}
```

#### `DelayLine.tap`

```ts example
import { DelayLine } from "./bleep/delay";

private line: DelayLine = new DelayLine(512);

sample(): void {
  this.line.write(this.x);
  // taps at whole numbers of samples: a crude multi-tap
  this.out = (this.x + this.line.tap(113) + this.line.tap(251) + this.line.tap(401)) * 0.25;
}
```

#### `interpLinear`

```ts example
import { interpLinear } from "./bleep/delay";

private table: StaticArray<f32> = new StaticArray<f32>(8);
private pos: f64 = 0;

constructor(sampleRate: f64) {
  for (let i = 0; i < 8; i++) this.table[i] = <f32>Math.sin(<f64>i * 0.7853981633974483);
}

sample(): void {
  this.pos += 0.05;
  if (this.pos >= 8.0) this.pos -= 8.0;
  this.out = interpLinear(this.table, this.pos);       // between two entries, wrapping at the end
}
```

#### `interpCubic`

```ts example
import { interpCubic } from "./bleep/delay";

private table: StaticArray<f32> = new StaticArray<f32>(8);
private pos: f64 = 0;

constructor(sampleRate: f64) {
  for (let i = 0; i < 8; i++) this.table[i] = <f32>Math.sin(<f64>i * 0.7853981633974483);
}

sample(): void {
  this.pos += 0.05;
  if (this.pos >= 8.0) this.pos -= 8.0;
  this.out = interpCubic(this.table, this.pos);        // a smoother curve through the same points
}
```

#### `interpLagrange`

```ts example
import { interpLagrange } from "./bleep/delay";

private table: StaticArray<f32> = new StaticArray<f32>(8);
private pos: f64 = 0;

constructor(sampleRate: f64) {
  for (let i = 0; i < 8; i++) this.table[i] = <f32>Math.sin(<f64>i * 0.7853981633974483);
}

sample(): void {
  this.pos += 0.05;
  if (this.pos >= 8.0) this.pos -= 8.0;
  this.out = interpLagrange(this.table, this.pos);
}
```

#### `TapeDelay`

```ts example
import { TapeDelay } from "./bleep/delay";

private tape: TapeDelay;

constructor(sampleRate: f64) {
  this.tape = new TapeDelay(sampleRate, 2.0);          // up to two seconds
  this.tape.time = 0.35;
  this.tape.feedback = 0.55;
  this.tape.saturation = 1.5;
  this.tape.wowDepth = 0.0004;
  this.tape.setTone(3000.0);                           // each repeat gets darker
  this.tape.snap();                                    // start at 0.35 s, no glide
}

sample(): void { this.out = this.x + this.tape.next(this.x) * 0.5; }
```

#### `KarplusStrong`

```ts example
import { KarplusStrong } from "./bleep/delay";
import { NoteEvent, NoteStream } from "./bleep/notes";
import { pitchToHz } from "./bleep/dsp";

@input({ name: "Notes", type: "notes" }) notes!: NoteStream;

private string: KarplusStrong;

constructor(sampleRate: f64) {
  this.string = new KarplusStrong(sampleRate, 55.0);      // the lowest note it can play
  this.string.damping = 0.25;
  this.string.decay = 0.999;
}

@on("notes") onNote(n: NoteEvent): void {
  if (n.isOn) this.string.pluck(pitchToHz(<f64>n.pitch), n.value, 0.8);      // frequency, amplitude, brightness
}

sample(): void { this.out = this.string.next(); }
```

## bleep/random

```ts
import { Xorshift, PinkNoise, SampleAndHold, NoiseLfo } from "./bleep/random";
```

Every generator takes a seed and gives the same sequence on every run, so an offline render sounds like the live patch.

| Name | What it does |
| --- | --- |
| `Xorshift(seed)` | A fast random generator. `next()` is a float in [0, 1), `nextBipolar()` in [-1, 1), `nextU32()` the raw bits, `setSeed(s)`. |
| `Lcg(seed)` | A cheaper generator with the same methods (its low bits are weak; the floats use the high ones). |
| `whiteNoise(rng)` | White noise (-1 to 1) from an `Xorshift` you own. |
| `WhiteNoise(seed)` | White noise with its own generator. `next()`. |
| `PinkNoise(seed)` | Pink noise, -3 dB per octave (Kellet's filter bank). `next()`. |
| `BrownNoise(seed)` | Brown noise, -6 dB per octave above about 150 Hz, kept within -1 to 1. `next()`. |
| `SampleAndHold` | `next(x, gate)` takes a new sample of `x` each time the gate rises through 0.5 and holds it. |
| `NoiseLfo(sampleRate, seed)` | A random LFO (-1 to 1): `next(rate)` picks `rate` new values a second; `smooth` 0 steps, 1 glides. |

### Examples

#### `Xorshift`

```ts example
import { Xorshift } from "./bleep/random";

private rng: Xorshift = new Xorshift(12345);

reset(): void { this.rng.setSeed(12345); }       // the same sequence after every reset

sample(): void {
  const noise = this.rng.nextBipolar();          // -1 to 1; next() is 0 to 1, nextU32() the raw bits
  this.out = noise * 0.1;
}
```

#### `Lcg`

```ts example
import { Lcg } from "./bleep/random";

private rng: Lcg = new Lcg(1);

sample(): void { this.out = this.rng.nextBipolar() * 0.1; }
```

#### `whiteNoise`

```ts example
import { Xorshift, whiteNoise } from "./bleep/random";

private rng: Xorshift = new Xorshift(99);

sample(): void { this.out = whiteNoise(this.rng) * 0.1; }
```

#### `WhiteNoise`

```ts example
import { WhiteNoise } from "./bleep/random";

private noise: WhiteNoise = new WhiteNoise(7);

sample(): void { this.out = this.noise.next() * 0.1; }
```

#### `PinkNoise`

```ts example
import { PinkNoise } from "./bleep/random";

private noise: PinkNoise = new PinkNoise(7);

sample(): void { this.out = this.noise.next() * 0.2; }
```

#### `BrownNoise`

```ts example
import { BrownNoise } from "./bleep/random";

private noise: BrownNoise = new BrownNoise(7);

sample(): void { this.out = this.noise.next() * 0.3; }
```

#### `SampleAndHold`

```ts example
import { SampleAndHold } from "./bleep/random";
import { WhiteNoise } from "./bleep/random";

@input({ name: "Clock", type: "gate" }) clock: f32 = 0;

private hold: SampleAndHold = new SampleAndHold();
private noise: WhiteNoise = new WhiteNoise(5);

sample(): void {
  this.out = this.hold.next(this.noise.next(), this.clock);      // a new random value on every rising edge of the clock
}
```

#### `NoiseLfo`

```ts example
import { NoiseLfo } from "./bleep/random";

private lfo: NoiseLfo;

constructor(sampleRate: f64) {
  this.lfo = new NoiseLfo(sampleRate, 3);
  this.lfo.smooth = 1.0;                      // 0 steps from value to value, 1 glides
}

sample(): void {
  this.out = this.x * (0.75 + 0.25 * this.lfo.next(4.0));      // four new values a second, as a tremolo
}
```

## bleep/env

```ts
import { Adsr, Lfo, LFO_TRIANGLE, Clock } from "./bleep/env";
```

| Name | What it does |
| --- | --- |
| `Adsr(sampleRate)` | An ADSR envelope. `set(attack, decay, sustain, release)` in seconds, `next(gate)` per sample (the gate is on from 0.5). Exponential curves (like an analogue RC envelope) unless `exponential = false`. A retrigger during the release attacks from the current level; `hardRetrigger = true` restarts from 0. `value`, `active`, `currentStage` (`ENV_IDLE`, `ENV_ATTACK`, `ENV_DECAY`, `ENV_SUSTAIN`, `ENV_RELEASE`), `reset()`. |
| `Ar(sampleRate)` | An attack-release envelope on a gate. `set(attack, release)`, `next(gate)`. |
| `Ad(sampleRate)` | A one-shot attack-decay envelope started by a trigger (a rising edge): it plays out whatever the trigger does. `set(attack, decay)`, `next(trigger)`. |
| `EnvFollower(sampleRate, attack, release)` | Follows the level of a signal: `next(x)` returns the smoothed `abs(x)`. `setTimes(attack, release)`. |
| `Slew(sampleRate)` | A slew limiter (portamento, click-free controls). `rise` and `fall` are the fastest the output may move, in units per second. `next(x)`, `snap(x)`. |
| `Lfo(sampleRate, seed)` | A low-frequency oscillator from -1 to 1. Set `shape` to `LFO_SINE`, `LFO_TRIANGLE`, `LFO_SAW`, `LFO_SAW_DOWN`, `LFO_SQUARE` (with `width`) or `LFO_SAMPLE_HOLD`; `next(frequency)` per sample; `sync()` restarts the cycle and `nextSync(frequency, gate)` does it on a rising gate; `phaseOffset` in cycles; `uni` is the last output as 0 to 1. |
| `Line(sampleRate)` | A straight line between two values. `set(from, to, seconds)`, `next()`; `done` says it arrived. |
| `Ramp(sampleRate)` | A 0 to 1 ramp started by a trigger. `setTime(seconds)`, `next(trigger)`, `start()`. |
| `Trigger` | `next(x)` is 1 for the one sample in which `x` rises through `threshold` (0.5), else 0. |
| `Schmitt(low, high)` | A Schmitt trigger: the output (0 or 1) goes high above `high` and low below `low`, so a slow or noisy signal does not chatter. `rose` and `fell` flag the change. |
| `Clock(sampleRate)` | A tempo-synced phasor. `bpm` and `ratio` (1 = a quarter note per cycle, 4 = sixteenths, 0.25 = a bar of 4/4); `next()` returns the phase 0 to 1, `ticked` is true in the sample where a cycle starts, `count` counts them; `setBeat(beats)` aligns it with a host beat position. |

### Examples

#### `Adsr`

```ts example
import { Adsr, ENV_RELEASE } from "./bleep/env";

@input({ name: "Gate", type: "gate" }) gate: f32 = 0;
@probe releasing: f32 = 0;

private env: Adsr;

constructor(sampleRate: f64) {
  this.env = new Adsr(sampleRate);
  this.env.set(0.01, 0.2, 0.6, 0.4);        // attack, decay, sustain level, release
}

sample(): void {
  this.out = this.x * this.env.next(this.gate);
  this.releasing = this.env.currentStage == ENV_RELEASE ? 1.0 : 0.0;
}
```

#### `Ar`

```ts example
import { Ar } from "./bleep/env";

@input({ name: "Gate", type: "gate" }) gate: f32 = 0;

private env: Ar;

constructor(sampleRate: f64) {
  this.env = new Ar(sampleRate);
  this.env.set(0.005, 0.5);          // attack, release
}

sample(): void { this.out = this.x * this.env.next(this.gate); }
```

#### `Ad`

```ts example
import { Ad } from "./bleep/env";

@input({ name: "Trigger", type: "trigger" }) trigger: f32 = 0;

private env: Ad;

constructor(sampleRate: f64) {
  this.env = new Ad(sampleRate);
  this.env.set(0.001, 0.3);          // attack, decay: it plays out whatever the trigger does
}

sample(): void { this.out = this.x * this.env.next(this.trigger); }
```

#### `EnvFollower`

```ts example
import { EnvFollower } from "./bleep/env";

private follower: EnvFollower;

constructor(sampleRate: f64) {
  this.follower = new EnvFollower(sampleRate, 0.005, 0.12);      // attack and release in seconds
}

sample(): void {
  const level = this.follower.next(this.x);
  this.out = level;                          // the loudness of the input as a control signal
}
```

#### `Slew`

```ts example
import { Slew } from "./bleep/env";

@input({ name: "Pitch", type: "control" }) target: f32 = 0;

private glide: Slew;

constructor(sampleRate: f64) {
  this.glide = new Slew(sampleRate);
  this.glide.rise = 2.0;          // at most 2 units a second up ...
  this.glide.fall = 4.0;          // ... and 4 down
}

sample(): void { this.out = this.glide.next(this.target); }
```

#### `Lfo`

```ts example
import { Lfo, LFO_TRIANGLE } from "./bleep/env";

private lfo: Lfo;

constructor(sampleRate: f64) {
  this.lfo = new Lfo(sampleRate);
  this.lfo.shape = LFO_TRIANGLE;          // LFO_SINE, LFO_SAW, LFO_SAW_DOWN, LFO_SQUARE (with width) or LFO_SAMPLE_HOLD
}

sample(): void { this.out = this.x * (0.6 + 0.4 * this.lfo.next(5.0)); }      // a 5 Hz tremolo
```

#### `Lfo.nextSync`

```ts example
import { Lfo } from "./bleep/env";

@input({ name: "Sync", type: "gate" }) sync: f32 = 0;

private lfo: Lfo;

constructor(sampleRate: f64) { this.lfo = new Lfo(sampleRate); }

sample(): void { this.out = this.lfo.nextSync(2.0, this.sync); }      // restarts its cycle on every rising edge
```

#### `Line`

```ts example
import { Line } from "./bleep/env";

private fade: Line;

constructor(sampleRate: f64) {
  this.fade = new Line(sampleRate);
  this.fade.set(1.0, 1.0, 0.0);
}

@button({ name: "Fade out" }) fadeOut(): void { this.fade.set(1.0, 0.0, 2.0); }      // from, to, seconds

sample(): void { this.out = this.x * this.fade.next(); }
```

#### `Ramp`

```ts example
import { Ramp } from "./bleep/env";

@input({ name: "Trigger", type: "trigger" }) trigger: f32 = 0;

private ramp: Ramp;

constructor(sampleRate: f64) {
  this.ramp = new Ramp(sampleRate);
  this.ramp.setTime(1.5);
}

sample(): void { this.out = this.x * this.ramp.next(this.trigger); }      // fades in over 1.5 s after each trigger
```

#### `Trigger`

```ts example
import { Trigger } from "./bleep/env";

private edge: Trigger = new Trigger();
private count: i32 = 0;

sample(): void {
  if (this.edge.next(this.x) > 0.0) this.count++;      // 1 for the one sample in which the input crosses 0.5
  this.out = <f32>(this.count % 4) * 0.25;
}
```

#### `Schmitt`

```ts example
import { Schmitt } from "./bleep/env";

private schmitt: Schmitt = new Schmitt(0.3, 0.7);      // goes high above 0.7, low below 0.3

sample(): void { this.out = this.schmitt.next(this.x); }      // a noisy input does not chatter
```

#### `Clock`

```ts example
import { Clock } from "./bleep/env";

private clock: Clock;

constructor(sampleRate: f64) {
  this.clock = new Clock(sampleRate);
  this.clock.bpm = 120.0;
  this.clock.ratio = 4.0;               // four cycles a quarter note: sixteenth notes
}

@transport tempo(bpm: f64, ppq: f64, playing: bool): void {
  this.clock.bpm = bpm;
  if (playing) this.clock.setBeat(ppq);
}

sample(): void {
  this.clock.next();
  this.out = this.clock.ticked ? 1.0 : 0.0;      // a one-sample pulse on every sixteenth
}
```

## bleep/dynamics

```ts
import { Compressor, Limiter, Gate, softClip, Oversampler2x } from "./bleep/dynamics";
```

| Name | What it does |
| --- | --- |
| `Compressor(sampleRate, attack, release)` | A feed-forward compressor with a soft knee. Set `thresholdDb`, `ratio`, `kneeDb`, `makeupDb` and `setTimes(attack, release)`. `next(x)` detects on `x`, `nextKeyed(x, key)` on another signal (ducking, de-essing). `gainReductionDb` is for a meter. |
| `Limiter(sampleRate, lookahead = 0.002, release = 0.08)` | A look-ahead brick-wall limiter: nothing leaves above `ceiling`. The output is `latency` samples late. `next(x)`, `gainReductionDb`. |
| `Gate(sampleRate, attack, release)` | A noise gate with hysteresis: opens above `openDb`, closes below `closeDb` after `holdSeconds`, down to `rangeDb`. `next(x)`, `nextKeyed(x, key)`, `isOpen`. |
| `softClip(x)` | Soft saturation (a tanh). |
| `hardClip(x, limit = 1)` | Clips at +-limit. |
| `foldback(x, threshold = 1)` | Folds the signal back from +-threshold (a wavefolder). |
| `asymSat(x, amount)` | Asymmetric saturation: adds even harmonics, no DC, small-signal gain 1. `amount` 0 to 1. |
| `chebyshev(x, order)` | The Chebyshev polynomial of that order: a sine of amplitude 1 comes out at `order` times the frequency. Mix a few for a harmonic exciter. |
| `Bitcrush(bits = 8)` | Bit-depth reduction. `setBits(bits)` (fractions allowed), `next(x)`. |
| `Decimate` | Sample-rate reduction: `ratio` 1 passes the signal, 0.25 keeps every fourth sample. `next(x)`. |
| `Oversampler2x`, `Oversampler4x` | Oversampling around a non-linear step, with half-band filters (flat to 0.375 of the sample rate). `up(x)` sets `a`, `b` (and `c`, `d` for 4x); shape each; `down(a, b)` (`down(a, b, c, d)`) returns the sample. `latency` is the delay in samples. |
| `HalfBandUp`, `HalfBandDown` | The two filters inside the oversamplers, for a different ratio or a custom chain. |

The shapers have hard corners that alias when the input is loud or bright. Run them between `up` and `down`:

```ts
this.os.up(x);
const y = this.os.down(hardClip(this.os.a * drive), hardClip(this.os.b * drive));
```

### Examples

#### `Compressor`

```ts example
import { Compressor } from "./bleep/dynamics";

@probe reduction: f32 = 0;

private comp: Compressor;

constructor(sampleRate: f64) {
  this.comp = new Compressor(sampleRate, 0.005, 0.12);      // attack, release
  this.comp.thresholdDb = -20.0;
  this.comp.ratio = 4.0;
  this.comp.kneeDb = 6.0;
  this.comp.makeupDb = 5.0;
}

sample(): void {
  this.out = this.comp.next(this.x);
  this.reduction = this.comp.gainReductionDb;
}
```

#### `Compressor.nextKeyed`

```ts example
import { Compressor } from "./bleep/dynamics";

@input({ name: "Key", type: "audio" }) key: f32 = 0;

private duck: Compressor;

constructor(sampleRate: f64) {
  this.duck = new Compressor(sampleRate, 0.002, 0.2);
  this.duck.thresholdDb = -30.0;
  this.duck.ratio = 10.0;
}

sample(): void { this.out = this.duck.nextKeyed(this.x, this.key); }      // the key signal pushes the input down
```

#### `Limiter`

```ts example
import { Limiter } from "./bleep/dynamics";

private limiter: Limiter;

constructor(sampleRate: f64) {
  this.limiter = new Limiter(sampleRate, 0.002, 0.08);      // look-ahead, release
  this.limiter.ceiling = 0.9;
}

sample(): void { this.out = this.limiter.next(this.x); }      // arrives limiter.latency samples late
```

#### `Gate`

```ts example
import { Gate } from "./bleep/dynamics";

private gate: Gate;

constructor(sampleRate: f64) {
  this.gate = new Gate(sampleRate, 0.001, 0.1);
  this.gate.openDb = -40.0;
  this.gate.closeDb = -46.0;
  this.gate.holdSeconds = 0.05;
}

sample(): void { this.out = this.gate.next(this.x); }
```

#### `softClip`

```ts example
import { softClip } from "./bleep/dynamics";

sample(): void { this.out = softClip(this.x * 3.0) * 0.5; }
```

#### `hardClip`

```ts example
import { hardClip } from "./bleep/dynamics";

sample(): void { this.out = hardClip(this.x * 3.0, 0.5); }      // clips at +-0.5
```

#### `foldback`

```ts example
import { foldback } from "./bleep/dynamics";

sample(): void { this.out = foldback(this.x * 4.0, 1.0); }      // the peaks fold back instead of clipping
```

#### `asymSat`

```ts example
import { asymSat } from "./bleep/dynamics";

sample(): void { this.out = asymSat(this.x, 0.6); }      // even harmonics, like a tube
```

#### `chebyshev`

```ts example
import { chebyshev } from "./bleep/dynamics";

sample(): void {
  // an exciter: the signal plus its second and third harmonics
  this.out = this.x * 0.7 + chebyshev(this.x, 2) * 0.2 + chebyshev(this.x, 3) * 0.1;
}
```

#### `Bitcrush`

```ts example
import { Bitcrush } from "./bleep/dynamics";

private crush: Bitcrush = new Bitcrush(8.0);

block(): void { this.crush.setBits(6.5); }      // fractions are fine

sample(): void { this.out = this.crush.next(this.x); }
```

#### `Decimate`

```ts example
import { Decimate } from "./bleep/dynamics";

private decimate: Decimate = new Decimate();

block(): void { this.decimate.ratio = 0.25; }      // keeps every fourth sample

sample(): void { this.out = this.decimate.next(this.x); }
```

#### HalfBandUp and HalfBandDown

```ts example
import { HalfBandUp, HalfBandDown, hardClip } from "./bleep/dynamics";

private up: HalfBandUp = new HalfBandUp();
private down: HalfBandDown = new HalfBandDown();

sample(): void {
  this.up.up(this.x);                                   // one sample in, two out: a and b
  const a = hardClip(this.up.a * 4.0);
  const b = hardClip(this.up.b * 4.0);
  this.out = this.down.down(a, b) * 0.5;                // two samples in, one out
}
```

#### `Oversampler2x`

```ts example
import { Oversampler2x, hardClip } from "./bleep/dynamics";

private os: Oversampler2x = new Oversampler2x();

sample(): void {
  this.os.up(this.x);
  const y = this.os.down(hardClip(this.os.a * 4.0), hardClip(this.os.b * 4.0));
  this.out = y * 0.5;           // this.os.latency says how many samples late it is
}
```

#### `Oversampler4x`

```ts example
import { Oversampler4x, foldback } from "./bleep/dynamics";

private os: Oversampler4x = new Oversampler4x();

sample(): void {
  this.os.up(this.x);
  const y = this.os.down(
    foldback(this.os.a * 3.0), foldback(this.os.b * 3.0),
    foldback(this.os.c * 3.0), foldback(this.os.d * 3.0));
  this.out = y * 0.5;
}
```

## bleep/fx

```ts
import { Reverb, Phaser, Chorus, PitchShift } from "./bleep/fx";
```

| Name | What it does |
| --- | --- |
| `Reverb(sampleRate)` | A Freeverb reverb: mono in, stereo out. Set `roomSize`, `damping`, `width` and call `update()`; `next(x)` sets `left` and `right`. The output is the reverb only: mix it with the dry signal. It allocates about 1 MB. |
| `Phaser(sampleRate, stages = 4)` | A phaser with 2 to 12 all-pass stages swept between `minHz` and `maxHz` at `rate`. `feedback`, `mix`, `centre` (the sweep position when `rate` is 0). `next(x)`. |
| `Chorus(sampleRate, voices = 2)` | Up to 4 modulated delay voices spread across left and right. `rate`, `delayMs`, `depthMs`, `mix`. `next(x)` sets `left` and `right` and returns their mean. |
| `PitchShift(sampleRate, windowSeconds = 0.06)` | A two-tap delay-line pitch shifter. `ratio` is the frequency ratio (2 is an octave up). Good on single notes, grainy on chords. |

### Examples

#### `Reverb`

```ts example
import { Reverb } from "./bleep/fx";

@output({ name: "Out R", type: "audio" }) outR: f32 = 0;

private verb: Reverb;

constructor(sampleRate: f64) {
  this.verb = new Reverb(sampleRate);
  this.verb.roomSize = 0.8;
  this.verb.damping = 0.4;
  this.verb.width = 1.0;
  this.verb.update();                 // after changing the settings
}

sample(): void {
  this.verb.next(this.x);             // mono in, left and right out: the reverb only
  this.out = this.x * 0.7 + this.verb.left * 0.3;
  this.outR = this.x * 0.7 + this.verb.right * 0.3;
}
```

#### `Phaser`

```ts example
import { Phaser } from "./bleep/fx";

private phaser: Phaser;

constructor(sampleRate: f64) {
  this.phaser = new Phaser(sampleRate, 6);       // six all-pass stages
  this.phaser.rate = 0.3;
  this.phaser.minHz = 400.0;
  this.phaser.maxHz = 3500.0;
  this.phaser.feedback = 0.5;
  this.phaser.mix = 0.5;
}

sample(): void { this.out = this.phaser.next(this.x); }
```

#### `Chorus`

```ts example
import { Chorus } from "./bleep/fx";

@output({ name: "Out R", type: "audio" }) outR: f32 = 0;

private chorus: Chorus;

constructor(sampleRate: f64) {
  this.chorus = new Chorus(sampleRate, 3);
  this.chorus.rate = 0.6;
  this.chorus.delayMs = 18.0;
  this.chorus.depthMs = 4.0;
  this.chorus.mix = 0.5;
}

sample(): void {
  this.chorus.next(this.x);
  this.out = this.chorus.left;
  this.outR = this.chorus.right;
}
```

#### `PitchShift`

```ts example
import { PitchShift } from "./bleep/fx";
import { semitones } from "./bleep/util";

private shifter: PitchShift;

constructor(sampleRate: f64) {
  this.shifter = new PitchShift(sampleRate, 0.06);
  this.shifter.ratio = <f32>semitones(7.0);          // a fifth up
}

sample(): void { this.out = this.shifter.next(this.x); }
```

## bleep/fft

```ts
import { Fft } from "./bleep/fft";
```

| Name | What it does |
| --- | --- |
| `Fft(size)` | A complex FFT of `size` points (a power of two) in place on the public arrays `re` and `im`. `forward()`, `inverse()` (divides by `size`), `clearImag()`, `applyHann()`, `magnitude(k)`, `phase(k)`. A transform costs about 5 size log2(size) operations: do it once per hop in `block()`, not per sample. Bin k is at `k * sampleRate / size` Hz. |

### Examples

#### `Fft`

```ts example
import { Fft } from "./bleep/fft";

@probe peakHz: f32 = 0;

private fft: Fft;
private filled: i32 = 0;

constructor(sampleRate: f64) {
  this.fft = new Fft(256);
}

sample(): void {
  if (this.filled < 256) { this.fft.re[this.filled] = this.x; this.filled++; }      // collect 256 samples
  this.out = this.x;
}

block(): void {
  if (this.filled < 256) return;
  this.fft.clearImag();
  this.fft.applyHann();
  this.fft.forward();
  let best = 1;
  let peak: f32 = 0;
  for (let k = 1; k < 128; k++) {
    const m = this.fft.magnitude(k);                      // phase(k) is the angle
    if (m > peak) { peak = m; best = k; }
  }
  this.peakHz = <f32>(<f64>best * this.sampleRate / 256.0);      // bin k is at k * sampleRate / size
  this.filled = 0;
}
```

#### `Fft.inverse`

```ts example
import { Fft } from "./bleep/fft";

private fft: Fft;
private filled: i32 = 0;
private at: i32 = 0;
private frame: StaticArray<f32> = new StaticArray<f32>(256);

constructor(sampleRate: f64) {
  this.fft = new Fft(256);
}

sample(): void {
  if (this.filled < 256) { this.fft.re[this.filled] = this.x; this.filled++; }
  this.out = this.frame[this.at];                          // plays the previous, processed frame
  this.at = this.at + 1 >= 256 ? 0 : this.at + 1;
}

block(): void {
  if (this.filled < 256) return;
  this.fft.clearImag();
  this.fft.forward();
  for (let k = 32; k < 225; k++) { this.fft.re[k] = 0.0; this.fft.im[k] = 0.0; }      // a brick-wall low-pass, bins 0 to 31
  this.fft.inverse();
  for (let i = 0; i < 256; i++) this.frame[i] = this.fft.re[i];
  this.filled = 0;
}
```

## bleep/util

```ts
import { midiToHz, clamp, fastTanh, Pan } from "./bleep/util";
```

| Name | What it does |
| --- | --- |
| `midiToHz(note)` | MIDI note number (fractions allowed) to Hz; 69 is 440 Hz. |
| `hzToMidi(hz)` | Hz to a MIDI note number. |
| `hzToPitch(hz)` | Hz to Bleep's pitch in virtual volts (1.0 is an octave, 0 is C4). |
| `semitones(n)` | The frequency ratio of `n` semitones: `semitones(12)` is 2. |
| `clamp(x, lo, hi)` | Limits `x` to a range. |
| `wrap(x, lo, hi)` | Wraps `x` into [lo, hi) like a phase. |
| `fold(x, lo, hi)` | Mirrors `x` back and forth between `lo` and `hi`. |
| `mix(a, b, t)` | `a` at `t` = 0, `b` at `t` = 1. |
| `mapRange(x, inLo, inHi, outLo, outHi)` | Linear mapping of ranges. |
| `expMap(x, lo, hi)` | Maps 0 to 1 exponentially onto [lo, hi]: right for frequencies. |
| `fastTanh(x)` | tanh without libm, error below 1.1e-4. |
| `fastExp2(x)` | 2 to the power x, relative error below 2e-7. |
| `fastLog2(x)` | log2, absolute error below 1e-6. |
| `fastPow2(base, exponent)` | `base ^ exponent` from the two above, about 5 digits. |
| `Pan` | Pan gains: `equalPower(pan)` or `linear(pan)` (pan -1 to 1) set `left` and `right`. |
| `Crossfade` | Crossfade gains: `equalPower(t)` or `linear(t)` (t 0 to 1) set `a` and `b`. |
| `MidSide` | `encode(l, r)` sets `mid` and `side`; `decode(mid, side)` sets `left` and `right`. |
| `Rms(sampleRate, seconds)` | A running RMS level. `next(x)`, `value`, `reset()`. |

### Examples

#### `midiToHz`

```ts example
import { midiToHz } from "./bleep/util";

@probe hz: f32 = 0;

block(): void { this.hz = <f32>midiToHz(69.0); }      // 440
```

#### `hzToMidi`

```ts example
import { hzToMidi } from "./bleep/util";

@probe note: f32 = 0;

block(): void { this.note = <f32>hzToMidi(261.63); }      // about 60
```

#### `hzToPitch`

```ts example
import { hzToPitch } from "./bleep/util";

@probe volts: f32 = 0;

block(): void { this.volts = <f32>hzToPitch(523.25); }      // about 1.0: an octave above C4
```

#### `semitones`

```ts example
import { semitones } from "./bleep/util";

private ratio: f64 = 1.0;

block(): void { this.ratio = semitones(-5.0); }      // a fourth down: about 0.749
```

#### `clamp`

```ts example
import { clamp } from "./bleep/util";

sample(): void { this.out = clamp(this.x * 2.0, -0.8, 0.8); }
```

#### `wrap`

```ts example
import { wrap } from "./bleep/util";

private phase: f64 = 0.9;

sample(): void {
  this.phase = wrap(this.phase + 0.001, 0.0, 1.0);      // like a phase: 1.0 comes back as 0
  this.out = <f32>this.phase;
}
```

#### `fold`

```ts example
import { fold } from "./bleep/util";

sample(): void { this.out = <f32>fold(<f64>this.x * 3.0, -1.0, 1.0); }      // mirrors back and forth between the limits
```

#### `mix`

```ts example
import { mix } from "./bleep/util";

@input({ name: "B", type: "audio" }) b: f32 = 0;

sample(): void { this.out = mix(this.x, this.b, 0.3); }      // 30 % of B
```

#### `mapRange`

```ts example
import { mapRange } from "./bleep/util";

@probe cents: f32 = 0;

sample(): void { this.cents = <f32>mapRange(<f64>this.x, -1.0, 1.0, -50.0, 50.0); }
```

#### `expMap`

```ts example
import { expMap } from "./bleep/util";

@param({ name: "Freq", min: 0, max: 1, init: 0.5 }) freq: f32 = 0.5;
@probe hz: f32 = 0;

block(): void { this.hz = <f32>expMap(<f64>this.freq, 20.0, 20000.0); }      // the middle of the knob is 632 Hz
```

#### `fastTanh`

```ts example
import { fastTanh } from "./bleep/util";

sample(): void { this.out = fastTanh(this.x * 3.0) * 0.5; }
```

#### `fastExp2`

```ts example
import { fastExp2 } from "./bleep/util";

sample(): void { this.out = this.x * fastExp2(-0.5); }      // 2 to the power of -0.5, without Math.pow
```

#### `fastLog2`

```ts example
import { fastLog2 } from "./bleep/util";

sample(): void { this.out = fastLog2(1.0 + abs(this.x)); }
```

#### `fastPow2`

```ts example
import { fastPow2 } from "./bleep/util";

sample(): void { this.out = this.x * fastPow2(10.0, -0.1); }      // 10 to the power of -0.1: -2 dB
```

#### `Pan`

```ts example
import { Pan } from "./bleep/util";

@output({ name: "Right", type: "audio" }) right: f32 = 0;

private pan: Pan = new Pan();

block(): void { this.pan.equalPower(-0.4); }      // -1 left to 1 right; linear() is the other law

sample(): void {
  this.out = this.x * this.pan.left;
  this.right = this.x * this.pan.right;
}
```

#### `Crossfade`

```ts example
import { Crossfade } from "./bleep/util";

@input({ name: "B", type: "audio" }) b: f32 = 0;

private fade: Crossfade = new Crossfade();

block(): void { this.fade.equalPower(0.5); }      // 0 is all A, 1 all B; linear() is the other law

sample(): void { this.out = this.x * this.fade.a + this.b * this.fade.b; }
```

#### `MidSide`

```ts example
import { MidSide } from "./bleep/util";

@input({ name: "Right", type: "audio" }) inRight: f32 = 0;
@output({ name: "Right out", type: "audio" }) right: f32 = 0;

private ms: MidSide = new MidSide();

sample(): void {
  this.ms.encode(this.x, this.inRight);
  this.ms.decode(this.ms.mid, this.ms.side * 1.5);      // widen the stereo image
  this.out = this.ms.left;
  this.right = this.ms.right;
}
```

#### `Rms`

```ts example
import { Rms } from "./bleep/util";

@probe level: f32 = 0;

private rms: Rms;

constructor(sampleRate: f64) {
  this.rms = new Rms(sampleRate, 0.3);       // averaged over about 300 ms
}

sample(): void {
  this.level = this.rms.next(this.x);
  this.out = this.x;
}
```

## bleep/dsp

```ts
import { dbToLin, linToDb, lerp, pitchToHz, Smoother, PeakHold, Biquad, AdaaTanh, DcBlocker, Phasor } from "./bleep/dsp";
```

### Functions

| Name | What it does |
|---|---|
| `dbToLin(db)` | Decibels to a linear gain. |
| `linToDb(gain)` | A linear gain to decibels, −144 for silence. |
| `lerp(a, b, t)` | `a` at 0 and `b` at 1, linearly in between. |
| `pitchToHz(volts)` | A pitch in volts (1.0 is an octave, 0 is C4) to a frequency in Hz. Uses `pow`: call it per block when you can. |

### Classes

| Class | Constructor | Use |
|---|---|---|
| `Smoother` | `(sampleRate, seconds)` | One-pole smoothing towards `target`. Set `target` in `block()`, call `next()` once per sample. `value` is the current value, `snap()` jumps to the target (after a reset, or the first block). See [smoothing](tutorials/smoothing.md). |
| `PeakHold` | `(sampleRate, seconds)` | A peak meter: rises at once, falls with `seconds` as time constant. `next(x)` per sample, `value` for the probe or an output, `reset()`. |
| `Biquad` | none | A second-order filter section (RBJ cookbook), transposed direct form II. Set it up with `setLowShelf(sr, f, gainDb)`, `setHighShelf(sr, f, gainDb)`, `setPeaking(sr, f, q, gainDb)`, `setLowpass(sr, f, q)`, `setHighpass(sr, f, q)`, `setBandpass(sr, f, q)` (0 dB at the peak), `setNotch(sr, f, q)` or `setAllpass(sr, f, q)`, then call `next(x)` per sample. `reset()` clears it. Each `set*` call takes a few trigonometric calls, so call it in `block()` and only when a setting changed. |
| `AdaaTanh` | none | `tanh` as a soft clipper with first-order antiderivative anti-aliasing. `next(x)` per sample, `reset()`. See [drive](tutorials/drive.md). |
| `DcBlocker` | `(sampleRate, hz)` | A one-pole high-pass that removes a constant offset, 20 Hz is a good value. `next(x)` per sample, `reset()`. |
| `Phasor` | `(sampleRate)` | A phase from 0 to 1 that wraps. Set `frequency` in Hz (in `block()`), `next()` per sample returns the phase before this sample's step. `reset()`. The core of an oscillator or an LFO. |

### Examples

#### `dbToLin`

```ts example
import { dbToLin } from "./bleep/dsp";

private gain: f32 = 1;

block(): void { this.gain = dbToLin(-6.0); }       // about 0.5

sample(): void { this.out = this.x * this.gain; }
```

#### `linToDb`

```ts example
import { linToDb } from "./bleep/dsp";

@probe db: f32 = 0;

sample(): void { this.db = linToDb(abs(this.x)); }      // -144 for silence
```

#### `lerp`

```ts example
import { lerp } from "./bleep/dsp";

sample(): void { this.out = lerp(this.x, -this.x, 0.25); }      // a quarter of the way from x to -x
```

#### `pitchToHz`

```ts example
import { pitchToHz } from "./bleep/dsp";

@input({ name: "Pitch", type: "pitch" }) pitch: f32 = 0;

private hz: f64 = 261.63;

block(): void { this.hz = pitchToHz(<f64>this.pitch); }      // 0 volts is C4, 1.0 volts one octave up
```

#### `Smoother`

```ts example
import { Smoother, dbToLin } from "./bleep/dsp";

@param({ name: "Level", min: -60, max: 6, init: 0, unit: "dB" }) level: f32 = 0;

private gain: Smoother;

constructor(sampleRate: f64) {
  this.gain = new Smoother(sampleRate, 0.01);      // a 10 ms glide
  this.gain.target = 1.0;
  this.gain.snap();                                // start there, no fade-in
}

block(): void { this.gain.target = dbToLin(<f64>this.level); }

sample(): void { this.out = this.x * this.gain.next(); }
```

#### `PeakHold`

```ts example
import { PeakHold } from "./bleep/dsp";

@probe peak: f32 = 0;

private meter: PeakHold;

constructor(sampleRate: f64) {
  this.meter = new PeakHold(sampleRate, 0.5);      // falls with a time constant of half a second
}

sample(): void {
  this.peak = this.meter.next(this.x);
  this.out = this.x;
}
```

#### `Biquad`

```ts example
import { Biquad } from "./bleep/dsp";

private lowpass: Biquad = new Biquad();
private bell: Biquad = new Biquad();

block(): void {
  this.lowpass.setLowpass(this.sampleRate, 5000.0, 0.7071);      // also setHighpass, setBandpass, setNotch, setAllpass
  this.bell.setPeaking(this.sampleRate, 1000.0, 1.0, 6.0);       // +6 dB around 1 kHz; also setLowShelf, setHighShelf
}

sample(): void { this.out = this.bell.next(this.lowpass.next(this.x)); }
```

#### `AdaaTanh`

```ts example
import { AdaaTanh } from "./bleep/dsp";

private shaper: AdaaTanh = new AdaaTanh();

reset(): void { this.shaper.reset(); }

sample(): void { this.out = this.shaper.next(this.x * 5.0) * 0.5; }      // soft clipping with much less aliasing than Math.tanh
```

#### `DcBlocker`

```ts example
import { DcBlocker } from "./bleep/dsp";

private dc: DcBlocker;

constructor(sampleRate: f64) {
  this.dc = new DcBlocker(sampleRate, 20.0);
}

sample(): void { this.out = this.dc.next(this.x + 0.2); }      // the 0.2 offset is removed
```

#### `Phasor`

```ts example
import { Phasor } from "./bleep/dsp";

private osc: Phasor;

constructor(sampleRate: f64) {
  this.osc = new Phasor(sampleRate);
}

block(): void { this.osc.frequency = 220.0; }

sample(): void {
  const phase = this.osc.next();                  // 0 to 1, then wraps
  this.out = <f32>(2.0 * <f64>phase - 1.0) * 0.5;   // a naive saw
}
```

## bleep/notes

```ts
import { NoteEvent, NoteStream, NOTE_ON, NOTE_OFF } from "./bleep/notes";
```

`NoteEvent` has `type`, `channel`, `offset` (the sample inside the block), `note` (MIDI number), `pitch` (virtual volts, 1.0 is one octave, 0 is C4) and `value` (velocity, pressure, a control change divided by 127, or a bend from −1 to 1). It also has `isOn`, `isOff`, `isCc` and `transpose(semitones)`.

`NoteStream` is the events of a notes input for this block, or the events a notes output sends: `length`, `offsetAt(i)`, `read(i, into)`, `push(event)`, `clear()`. At most 64 events fit in a block; further ones are dropped.

The event types are the constants `NOTE_ON`, `NOTE_OFF`, `NOTE_PRESSURE`, `NOTE_CC`, `NOTE_PROGRAM`, `NOTE_BEND`, `NOTE_CHANNEL_PRESSURE` and `NOTE_SYSTEM`. See [Events and routing](events.md) for how to use them in `@on` handlers.

### Examples

#### `NoteEvent`

```ts example
import { NoteEvent, NoteStream } from "./bleep/notes";

@input({ name: "Notes", type: "notes" }) notes!: NoteStream;
@output({ name: "Out", type: "notes" }) played!: NoteStream;

@on("notes") onNote(n: NoteEvent): void {
  if (n.isOn && n.value > 0.5) {         // only hard hits
    n.transpose(12);                     // up an octave
    this.played.push(n);
  }
}
```

#### `NoteStream`

```ts example
import { NoteEvent, NoteStream } from "./bleep/notes";

@input({ name: "Notes", type: "notes" }) notes!: NoteStream;
@output({ name: "Out", type: "notes" }) played!: NoteStream;
@probe waiting: f32 = 0;

@on("notes") onNote(n: NoteEvent): void {
  this.waiting = <f32>this.notes.length;       // events on the jack in this block
  this.played.push(n);                         // forwarded at the same sample
}
```

#### NOTE_ON, NOTE_OFF and the other event types

```ts example
import { NoteEvent, NoteStream, NOTE_CC, NOTE_BEND } from "./bleep/notes";

@input({ name: "Notes", type: "notes" }) notes!: NoteStream;
@probe cc1: f32 = 0;
@probe bend: f32 = 0;

@on("notes") onNote(n: NoteEvent): void {
  if (n.type == NOTE_CC && n.note == 1) this.cc1 = n.value;      // the mod wheel, 0 to 1
  if (n.type == NOTE_BEND) this.bend = n.value;                  // -1 to 1
}
```

## What is not exported

`bleep/abi` (the glue between the engine's buffers and your fields) and `bleep/format` (number text for knob values) are used by the generated code. A script has no reason to import them.

## From AssemblyScript

These come with the language and the checker allows them in real-time code:

- **Math:** `Math.sin`, `cos`, `tan`, `tanh`, `exp`, `log`, `log10`, `pow`, `sqrt`, `floor`, `ceil`, `abs`, `min`, `max`, `PI`, `SQRT2`, `LN2` and the rest of `Math`. Mind that `Math` takes `f64`: convert with `<f64>x` and back with `<f32>y`.
- **Built-in functions:** `abs`, `min`, `max`, `sqrt`, `floor`, `ceil`, `trunc`, `nearest`, `copysign`, `isNaN`, `isFinite`, `clz`, `ctz`, `popcnt`, `rotl`, `rotr`.
- **Arrays:** `StaticArray<T>` allocated in the constructor. Growing `Array`s, strings built at run time, `Map` and `Set` allocate and are refused in real-time code. See [Limits](limits.md).

Not available at all: the wall clock, files and the network.

## What the library does not have (yet)

- **minBLEP and BLIT oscillators.** The saw, pulse and triangle use polyBLEP / polyBLAMP, which is good below a few kHz and loses ground near Nyquist. A minBLEP table for hard sync and the highest notes is not there; use `Wavetable` or [`Oversampler2x`](#bleepdynamics) if that matters.
- **Convolution** (impulse responses, cabinets) and a **vocoder**.
- **Granular** engines, time stretching, and an FFT-based phase vocoder pitch shifter (`PitchShift` is a delay-line shifter; `Fft` gives you the building block).
- **A feedback delay network reverb.** `Reverb` is Freeverb; for denser, less metallic tails build an FDN from `DelayLine` and `Allpass1`.
- **Sample buffers.** A module has no access to audio files; `Wavetable`, `DelayLine` and plain `StaticArray`s are the memory it can have.
- **Oversampled filters.** The ladder and the state-variable filter are not oversampled; for heavy resonance with drive, wrap them in an [`Oversampler2x`](#bleepdynamics).
- **Multiband and lookahead-compressor variants.** `Compressor` is feed-forward with a peak detector; `Limiter` has look-ahead.
- **A transport and tempo map.** `Clock` follows a bpm you give it or a beat position you pass to `setBeat()`; reading the host transport depends on the module's inputs.
