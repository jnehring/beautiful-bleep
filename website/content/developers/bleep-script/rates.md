---
title: Rates and timing
description: When each part of a module script runs: once, per block, per sample, per event, per chunk of transport, and for the view. Which rate to use for what.
order: 35
---

# Rates and timing

A module script does not have one clock. Different parts of it run at different rates, and choosing the right place for each calculation is most of what makes a script fast, click-free and sample-accurate. Bleep Script makes the choice by **which method you write the code in**.

## The rates

| Rate | Where you write it | How often | At 48 kHz |
|---|---|---|---|
| **Once** | `constructor(sampleRate)` | When the module is created | once |
| **Audio rate** | `sample()` | Every sample | 48,000 per second |
| **Block rate** (control rate) | `block()` | Once per block of 32 samples | 1,500 per second |
| **Event rate** | `@on(...)` handlers | Once per event, at the sample it happens | as often as events come |
| **Transport rate** | `@transport` method | Once per block, before `block()` | 1,500 per second |
| **Button rate** | `@button` methods | When the button is pressed, between blocks | rarely |
| **View rate** | `@probe` fields | The view reads them about ten times a second | 10 per second |

The engine processes audio in **blocks of 32 samples**. A block is about 0.67 ms at 48 kHz. Everything is organised around it:

```text
for every block of 32 samples
    @transport method          the tempo and position are told
    knobs are read             @param fields are filled, in their own units
    block()                    slow work: once per block
    for every sample 0 … 31
        inputs are read        @input fields hold this sample
        @on handlers run       notes and edges at this sample
        sample()               fast work: per sample
        outputs are written
    outputs of block() are written (flags)
```

## What arrives at which rate

| Thing | Rate |
|---|---|
| `@param` | **Block rate.** One value per block, in its own units. A knob that is modulated by a cable still changes only once per block |
| `@input` | **Sample rate** in `sample()` (the current sample), but block rate in `block()` (its first sample of the block) |
| `@output` | Whatever you write in `sample()` is sent at audio rate; whatever you write in `block()` holds for the whole block |
| Note events | Event rate, with the exact sample in `offset` |
| Edges (`rising`, `falling`) | Event rate: the handler runs on the sample where the signal crosses the level |
| Transport (`bpm`, `ppq`, `playing`) | Block rate |
| `@probe` | You write it at any rate; the view samples it at view rate |

## Choosing the rate

Put each calculation at the **slowest rate that is still correct**.

- **Once** (constructor): allocations, tables, constants that depend on the sample rate (`1 / sampleRate`).
- **Block rate** (`block()`): anything derived from a knob. Converting a gain from dB, computing filter coefficients, choosing a lookup. A knob only changes once per block, so doing this per sample is wasted work. This is the main reason `block()` exists. It also decides cost: the [cost estimate](limits.md#cost-bound) counts `block()` once and `sample()` 32 times per block.
- **Audio rate** (`sample()`): the signal itself: filters, oscillators, waveshapers, envelopes. It is the most expensive place, so keep trig, `pow` and `exp` calls out of it when a block-rate value will do.
- **Event rate** (`@on`): things that happen at a moment: a note, a gate rising. This is **sample-accurate**: the handler sees the event at the exact sample, so timing is not rounded to a block (about 0.67 ms).

### Rounding to the block

Block rate is also a limit. A value set in `block()` is constant for 32 samples, so if it jumps, it jumps in a step, and a step in a gain is a click. Smooth it per sample: [Preventing pops and clicks](tutorials/smoothing.md). Because only the block's first sample of an input is visible in `block()`, a fast control signal read there is **sampled at 1,500 Hz** and anything faster is lost (and can alias). Read it in `sample()` instead when its details matter.

## Examples

A tremolo: the rate of the LFO is a knob, so its increment is computed once per block; the LFO itself runs per sample.

```ts compile
@module({ name: "Tremolo", category: "Utility/Script" })
export class Tremolo {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Rate", min: 0.1, max: 20, init: 4, unit: "Hz" }) rate: f32 = 4;
  @param({ name: "Depth", min: 0, max: 1, init: 0.5 }) depth: f32 = 0.5;

  private phase: f64 = 0;
  private increment: f64 = 0;
  private sampleRate: f64;
  constructor(sampleRate: f64) { this.sampleRate = sampleRate; }          // once

  block(): void { this.increment = <f64>this.rate / this.sampleRate; }     // per block: one division

  sample(): void {                                                        // per sample: the cheap part
    this.phase += this.increment;
    this.phase -= Math.floor(this.phase);
    const lfo = <f32>(0.5 + 0.5 * Math.sin(2.0 * Math.PI * this.phase));
    this.out = this.x * (1 - this.depth * (1 - lfo));
  }
}
```

A gate that must start on the exact sample is an event, not a block-rate value:

```ts
@on("gate", { rising: 0.5 }) start(): void { this.env = 0; this.stage = 1; }   // at the sample the gate rises
```

## What there is not

- **No oversampling** or sub-block rates are built in: you can run your own faster loop inside `sample()` (a bounded `for`, see [Limits](limits.md)), as [the drive tutorial](tutorials/drive.md) discusses.
- The **sample rate** is given to the constructor and does not change while the module lives (a different rate creates a new module). It is typically 44.1 or 48 kHz: use it, never assume it.
- Time is always **samples and transport**: a module has no clock of its own, so a script cannot read the wall time.
