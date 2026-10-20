---
title: Library
description: Everything in the bleep/ libraries a module script can import: dsp helpers, note events, and what you get from AssemblyScript itself.
order: 60
---

# Library

Module scripts can import only from `bleep/` (and use the AssemblyScript built-ins). The libraries are plain AssemblyScript that is inlined into your module, so using them costs nothing extra. Allocate in the constructor, never in `block()` or `sample()`.

This page lists **everything** the libraries export. For how to use the pieces together, see the [tutorials](tutorials/overview.md).

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
| `Biquad` | none | A second-order filter section (RBJ cookbook), transposed direct form II. Set it up with `setLowShelf(sr, f, gainDb)`, `setHighShelf(sr, f, gainDb)`, `setPeaking(sr, f, q, gainDb)` or `setLowpass(sr, f, q)`, then call `next(x)` per sample. `reset()` clears it. Each `set*` call takes a few trigonometric calls, so call it in `block()` and only when a setting changed. |
| `AdaaTanh` | none | `tanh` as a soft clipper with first-order antiderivative anti-aliasing. `next(x)` per sample, `reset()`. See [drive](tutorials/drive.md). |
| `DcBlocker` | `(sampleRate, hz)` | A one-pole high-pass that removes a constant offset, 20 Hz is a good value. `next(x)` per sample, `reset()`. |
| `Phasor` | `(sampleRate)` | A phase from 0 to 1 that wraps. Set `frequency` in Hz (in `block()`), `next()` per sample returns the phase before this sample's step. `reset()`. The core of an oscillator or an LFO. |

## bleep/notes

```ts
import { NoteEvent, NoteStream, NOTE_ON, NOTE_OFF } from "./bleep/notes";
```

`NoteEvent` has `type`, `channel`, `offset` (the sample inside the block), `note` (MIDI number), `pitch` (virtual volts, 1.0 is one octave, 0 is C4) and `value` (velocity, pressure, a control change divided by 127, or a bend from −1 to 1). It also has `isOn`, `isOff`, `isCc` and `transpose(semitones)`.

`NoteStream` is the events of a notes input for this block, or the events a notes output sends: `length`, `offsetAt(i)`, `read(i, into)`, `push(event)`, `clear()`. At most 64 events fit in a block; further ones are dropped.

The event types are the constants `NOTE_ON`, `NOTE_OFF`, `NOTE_PRESSURE`, `NOTE_CC`, `NOTE_PROGRAM`, `NOTE_BEND`, `NOTE_CHANNEL_PRESSURE` and `NOTE_SYSTEM`. See [Events and routing](events.md) for how to use them in `@on` handlers.

## What is not exported

`bleep/abi` (the glue between the engine's buffers and your fields) and `bleep/format` (number text for knob values) are used by the generated code. A script has no reason to import them.

## From AssemblyScript

These come with the language and the checker allows them in real-time code:

- **Math:** `Math.sin`, `cos`, `tan`, `tanh`, `exp`, `log`, `log10`, `pow`, `sqrt`, `floor`, `ceil`, `abs`, `min`, `max`, `PI`, `SQRT2`, `LN2` and the rest of `Math`. Mind that `Math` takes `f64`: convert with `<f64>x` and back with `<f32>y`.
- **Built-in functions:** `abs`, `min`, `max`, `sqrt`, `floor`, `ceil`, `trunc`, `nearest`, `copysign`, `isNaN`, `isFinite`, `clz`, `ctz`, `popcnt`, `rotl`, `rotr`.
- **Arrays:** `StaticArray<T>` allocated in the constructor. Growing `Array`s, strings built at run time, `Map` and `Set` allocate and are refused in real-time code. See [Limits](limits.md).

Not available at all: random numbers (write a small generator, see the [toolbox](tutorials/dsp-toolbox.md)), the wall clock, files and the network.

## What the library does not have (yet)

The library is small on purpose. There is no oversampler, no FFT, no envelope generator class, no delay-line class, no high-pass or band-pass `Biquad` method, no table-lookup helper and no tempo-sync helper. The [tutorials](tutorials/overview.md) show how to write most of these in a few lines each (an AD envelope, a delay line with interpolation, a tempo LFO), and they are good candidates to move here when many scripts need them.
