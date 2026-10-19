---
title: Library
description: The bleep/ libraries a module script can import: dsp helpers (smoothing, peak hold, filters) and note events.
order: 60
---

# Library

Module scripts can import only from `bleep/`. These libraries are plain AssemblyScript that is inlined into your module, so using them costs nothing extra. Allocate in the constructor, never in `block()` or `sample()`.

## bleep/dsp

```ts
import { dbToLin, Smoother, PeakHold, Biquad } from "bleep/dsp";
```

| Name | What it does |
| --- | --- |
| `dbToLin(db)` | Decibels to a linear gain. |
| `Smoother(sampleRate, seconds)` | One-pole smoothing towards `target`. Set `target` in `block()`, call `next()` once per sample. `snap()` jumps to the target (use it after a reset). |
| `PeakHold(sampleRate, seconds)` | A peak meter: rises at once, falls with `seconds` as time constant. `next(x)` per sample, `value` for the probe, `reset()`. |
| `Biquad` | A second-order filter section. Set it up with `setLowShelf(sr, f, gainDb)`, `setHighShelf(sr, f, gainDb)`, `setPeaking(sr, f, q, gainDb)` or `setLowpass(sr, f, q)`, then call `next(x)` per sample. |

Each `set*` method takes a few trigonometric calls, so call it in `block()` and only when a setting changed, not in `sample()`.

## bleep/notes

```ts
import { NoteEvent, NoteStream, NOTE_ON, NOTE_OFF } from "bleep/notes";
```

`NoteEvent` has `type`, `channel`, `offset` (the sample inside the chunk), `note` (MIDI number), `pitch` (virtual volts, 1.0 is one octave, 0 is C4) and `value` (velocity, pressure, a control change divided by 127, or a bend from -1 to 1). It also has `isOn`, `isOff`, `isCc` and `transpose(semitones)`.

`NoteStream` is the events of a notes input for this chunk, or the events a notes output sends: `length`, `read(i, into)`, `push(event)`, `clear()`. At most 64 events fit in a chunk; further ones are dropped.

The event types are `NOTE_ON`, `NOTE_OFF`, `NOTE_PRESSURE`, `NOTE_CC`, `NOTE_PROGRAM`, `NOTE_BEND`, `NOTE_CHANNEL_PRESSURE` and `NOTE_SYSTEM`. See [Events and routing](events.md) for how to use them in `@on` handlers.
