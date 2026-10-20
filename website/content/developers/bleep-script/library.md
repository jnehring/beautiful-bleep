---
title: Library
description: The bleep/ libraries a module script can import: oscillators, filters, delays, envelopes, dynamics, noise, effects, an FFT, helpers and note events.
order: 60
---

# Library

Module scripts can import only from `bleep/`. These libraries are plain AssemblyScript that is inlined into your module, so using them costs nothing extra. Three rules hold for all of them:

- **Allocate in the constructor, never in `block()` or `sample()`.** Every class that needs memory (a delay line, a table, a reverb) takes its size in its constructor and allocates then. Nothing in the library allocates afterwards.
- **`set*` and `update` methods may call `sin`, `tan`, `exp` or `pow`.** Call them in `block()`, and only when a setting changed, not in `sample()`. The `next()` methods are made for `sample()`.
- **Audio is `f32`, `Math` takes `f64`.** Phases and frequencies are `f64` where precision matters (a phase accumulator in `f32` goes wrong after a few seconds); audio samples and levels are `f32`. Frequencies are in Hz, times in seconds, levels in dB when a name says so (`thresholdDb`) and linear otherwise.

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

A short example, a saw voice with a filter that follows an envelope (see also the [synth voice tutorial](tutorial-synth-voice.md)):

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

The `set` call inside `sample()` there costs a `tan` per sample: fine for a single voice, but when the sweep does not need sample accuracy set the filter from `block()` (once per 32 samples), as the [synth voice](tutorial-synth-voice.md) does.

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

## bleep/fft

```ts
import { Fft } from "./bleep/fft";
```

| Name | What it does |
| --- | --- |
| `Fft(size)` | A complex FFT of `size` points (a power of two) in place on the public arrays `re` and `im`. `forward()`, `inverse()` (divides by `size`), `clearImag()`, `applyHann()`, `magnitude(k)`, `phase(k)`. A transform costs about 5 size log2(size) operations: do it once per hop in `block()`, not per sample. Bin k is at `k * sampleRate / size` Hz. |

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

## bleep/dsp

```ts
import { dbToLin, Smoother, PeakHold, Biquad } from "./bleep/dsp";
```

| Name | What it does |
| --- | --- |
| `dbToLin(db)` | Decibels to a linear gain. |
| `Smoother(sampleRate, seconds)` | One-pole smoothing towards `target`. Set `target` in `block()`, call `next()` once per sample. `snap()` jumps to the target (use it after a reset). |
| `PeakHold(sampleRate, seconds)` | A peak meter: rises at once, falls with `seconds` as time constant. `next(x)` per sample, `value` for the probe, `reset()`. |
| `Biquad` | A second-order filter section. Set it up with `setLowShelf(sr, f, gainDb)`, `setHighShelf(sr, f, gainDb)`, `setPeaking(sr, f, q, gainDb)`, `setLowpass(sr, f, q)`, `setHighpass(sr, f, q)`, `setBandpass(sr, f, q)` (0 dB at the peak), `setNotch(sr, f, q)` or `setAllpass(sr, f, q)`, then call `next(x)` per sample. |

Each `set*` method takes a few trigonometric calls, so call it in `block()` and only when a setting changed, not in `sample()`.

## bleep/notes

```ts
import { NoteEvent, NoteStream, NOTE_ON, NOTE_OFF } from "./bleep/notes";
```

`NoteEvent` has `type`, `channel`, `offset` (the sample inside the chunk), `note` (MIDI number), `pitch` (virtual volts, 1.0 is one octave, 0 is C4) and `value` (velocity, pressure, a control change divided by 127, or a bend from -1 to 1). It also has `isOn`, `isOff`, `isCc` and `transpose(semitones)`.

`NoteStream` is the events of a notes input for this chunk, or the events a notes output sends: `length`, `read(i, into)`, `push(event)`, `clear()`. At most 64 events fit in a chunk; further ones are dropped.

The event types are `NOTE_ON`, `NOTE_OFF`, `NOTE_PRESSURE`, `NOTE_CC`, `NOTE_PROGRAM`, `NOTE_BEND`, `NOTE_CHANNEL_PRESSURE` and `NOTE_SYSTEM`. See [Events and routing](events.md) for how to use them in `@on` handlers.

## What the library does not have (yet)

- **minBLEP and BLIT oscillators.** The saw, pulse and triangle use polyBLEP / polyBLAMP, which is good below a few kHz and loses ground near Nyquist. A minBLEP table for hard sync and the highest notes is not there; use `Wavetable` or [`Oversampler2x`](#bleepdynamics) if that matters.
- **Convolution** (impulse responses, cabinets) and a **vocoder**.
- **Granular** engines, time stretching, and an FFT-based phase vocoder pitch shifter (`PitchShift` is a delay-line shifter; `Fft` gives you the building block).
- **A feedback delay network reverb.** `Reverb` is Freeverb; for denser, less metallic tails build an FDN from `DelayLine` and `Allpass1`.
- **Sample buffers.** A module has no access to audio files; `Wavetable`, `DelayLine` and plain `StaticArray`s are the memory it can have.
- **Oversampled filters.** The ladder and the state-variable filter are not oversampled; for heavy resonance with drive, wrap them in an [`Oversampler2x`](#bleepdynamics).
- **Multiband and lookahead-compressor variants.** `Compressor` is feed-forward with a peak detector; `Limiter` has look-ahead.
- **A transport and tempo map.** `Clock` follows a bpm you give it or a beat position you pass to `setBeat()`; reading the host transport depends on the module's inputs.
