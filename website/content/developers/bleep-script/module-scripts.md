---
title: Module scripts
description: Reference for module scripts: the class, decorators, signal types, parameters, probes, buttons, settings and counted jacks.
order: 30
---

# Module scripts

A module script is an [AssemblyScript](https://www.assemblyscript.org/) file with one or more classes marked `@module`. AssemblyScript is a strict subset of TypeScript that compiles to WebAssembly, so ordinary TypeScript syntax works, with these differences that matter here: numbers are typed (`f32`, `f64`, `i32`, `bool`), there are no closures or exceptions in real-time code, and `Math.sin` takes an `f64`.

```ts
import { Smoother, dbToLin } from "./bleep/dsp";      // the library, see Library

@module({ name: "Gain", category: "Utility/Script" })
export class Gain {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Level", min: -60, max: 6, init: 0, unit: "dB", decimals: 1 }) level: f32 = 0;

  private g: Smoother;
  constructor(sampleRate: f64) { this.g = new Smoother(sampleRate, 0.01); }

  block(): void { this.g.target = dbToLin(this.level); }
  sample(): void { this.out = this.x * this.g.next(); }
}
```

## The class

| Member | Runs | Use |
|---|---|---|
| `constructor(sampleRate: f64)` | Once, when the module is created | Allocate objects, set up state. The only place that may allocate |
| `block(): void` | Once per 32 samples | Slow work: read dials, set smoother targets, compute coefficients |
| `sample(): void` | Once per sample | Per-sample DSP |
| `reset(): void` | When the engine resets the module | Clear state |
| `@on(...)` methods | Once per event | [Events and routing](events.md) |
| `@transport` method | Once per block, before `block()` | The tempo and position, see [Transport](#transport) |
| `@button` methods | When a button is pressed | See below |

All of them are optional. A module with only `@on` handlers is a router; one with only `sample()` is an effect. When each part runs, and what to put where, is the subject of [Rates and timing](rates.md). Several `@module` classes in one file make several modules (the Code node shows the first).

### How fields are filled

The compiler generates the glue between the engine's buffers and your fields, so you never touch buffers:

| Field | Holds | Set |
|---|---|---|
| `@param` | The value **in its own units** (dB, an integer, a choice index, a boolean) | Once per block, before `block()` |
| `@input` | The signal | In `block()`, its first sample of the block; in `sample()`, the current sample |
| `@output` | What you wrote | Read back after each `sample()` (and after `block()` for a block-rate output such as a flag) |
| `@probe` | A value for the meter | Polled by the view about ten times a second |

## `@module`

```ts
@module({ name: "Mixer", type: "mixer", category: "Utility/Script", colour: "#60a5fa",
          description: "…", settings: [{ id: "CHANNELS", name: "Channels", min: 1, max: 16, init: 4 }] })
```

| Option | Meaning | Default |
|---|---|---|
| `name` | Name in the Add menu and on the node | The class name |
| `type` | The module's type id | The name, in kebab case |
| `category` | Group in the Add menu, `"Group/Subgroup"` | `"Utility/Script"` |
| `colour` | The module's accent colour | `"#94a3b8"` |
| `description` | The text under the knobs | The class's `/** */` comment |
| `settings` | See [Settings](#settings-and-counted-jacks) | none |

`@module("Name")` is short for `@module({ name: "Name" })`.

## Signal types

| Type | Meaning | Field type |
|---|---|---|
| `audio` | An audio signal | `f32` |
| `control` | A control signal | `f32` |
| `pitch` | Pitch in volts: 1.0 is one octave, 0 is C4 | `f32` |
| `gate` | High (0.5 or more) while a key is held | `f32` |
| `trigger` | A short pulse | `f32` |
| `notes` | A stream of note events | `NoteStream` (see [Events](events.md)) |

Cables follow the board's rules: anything connects to anything except `notes`, which connects only to `notes`.

## `@input` and `@output`

```ts
@input({ name: "In", type: "audio" }) x: f32 = 0;
@output({ name: "Gate", type: "gate" }) gate: f32 = 0;
```

| Option | Meaning | Default |
|---|---|---|
| `name` | Jack label | The field name, in words |
| `type` | A signal type from the table | `"audio"` |
| `bipolar` | Whether the signal goes below zero (for meters) | `true`, except `gate`, `trigger` and `notes` |
| `count` | Make numbered jacks, see below | one jack |
| `names` | Labels for numbered jacks: `["Kick", "Snare"]` | `"In 1"`, `"In 2"` … |
| `description` | Help text | The field's `/** */` comment |

The jack's **id** is the field name, and it is what cables are saved against. Rename a field and its cables are lost.

## `@param`

A knob (or a toggle or a dropdown). It is modulatable by cables unless you say otherwise.

```ts
@param({ name: "Time", min: 0.01, max: 4, init: 0.5, map: "exp", unit: "s", decimals: 2 }) time: f32 = 0.5;
@param({ name: "Mute" }) mute: bool = false;
@param({ name: "Shape", choices: ["Sine", "Triangle"] }) shape: i32 = 0;
@param({ name: "Steps", min: 1, max: 8 }) steps: i32 = 4;
```

| Field type | Kind | Needs |
|---|---|---|
| `f32` | A continuous knob | `min`, `max` |
| `i32` with `min` and `max` | A stepped integer knob | `min`, `max` |
| `i32` with `choices` | A dropdown; the field holds the index | `choices` (two or more names) |
| `bool` | A toggle | nothing |

| Option | Meaning | Default |
|---|---|---|
| `name` | Knob label | The field name, in words |
| `min`, `max` | The range in units (`max` above `min`) | required for numbers |
| `init` | The default value in units | The field's initial value, or `min` |
| `unit` | A suffix shown with the value, such as `"dB"` or `"Hz"` | none |
| `decimals` | Digits shown | 2 |
| `map` | `"linear"`, `"exp"` or `"skew"`: how the knob's travel maps to the range | `"linear"` |
| `centre` | For `"skew"`: the value in the middle of the knob (between `min` and `max`) | required with `skew` |
| `minText` | Text shown at `min`, such as `"-inf"` | none |
| `group` | A card the knob sits in, such as `"Ch {n}"` | none |
| `modulatable` | Whether cables can drive it | `true` for numbers, `false` for toggles and choices |
| `count`, `names`, `description` | As for jacks | |

`exp` needs `min` above zero and suits frequencies and times; `skew` puts a chosen value in the middle of the knob. They follow the engine's own mappings, so a script's knob feels like a built-in module's.

**Defaults.** `init` and the field's initial value are the same thing; if you give both and they differ, the compiler reports an error. A value outside the range is an error too.

## `@probe`

```ts
@probe level: f32 = 0;
```

A value the view polls and shows as a meter. It does not appear as a jack. `name`, `count` and `description` work as above. Your code writes the field as often as it likes; the view reads it about ten times a second.

## `@button`

```ts
@button({ name: "Reset" }) reset(): void { this.count = 0; }
```

A button in the view. Its method runs when the button is pressed, between blocks. The method name is the button's id and must be a plain identifier.

## `@transport`

```ts
@transport tempo(bpm: f64, ppq: f64, playing: bool): void {
  this.bpm = bpm;
  if (playing) this.beat = ppq;
}
```

One method can be the transport handler. The engine calls it **once per block, before `block()`**, with the tempo in beats per minute, the position at the start of the block in quarter notes (`ppq`) and whether the transport is playing. Use it for anything that follows the tempo: a tempo-synced LFO or delay, a step sequencer. It is block rate (see [Rates and timing](rates.md)): advance the position yourself per sample and take the host's value again at the next block, as the [step sequencer](tutorials/step-sequencer.md) does. When `playing` goes from false to true the transport has started. The method takes exactly these three arguments.

## Settings and counted jacks

A **setting** is a whole number the user chooses, such as the number of channels. It is a constant of the module: changing it recompiles, and it can decide how many jacks, knobs and meters there are.

```ts
@module({
  name: "Mixer",
  settings: [{ id: "CHANNELS", name: "Channels", min: 1, max: 16, init: 4 }],
})
export class Mixer {
  @input({ name: "Ch", type: "audio", count: CHANNELS }) ch!: StaticArray<f32>;
  @param({ name: "Gain", min: 0, max: 1, init: 1, count: CHANNELS, group: "Ch {n}" }) gain!: StaticArray<f32>;
  @param({ name: "Mute", count: CHANNELS, group: "Ch {n}" }) mute!: StaticArray<bool>;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @probe({ name: "Level", count: CHANNELS }) level!: StaticArray<f32>;
  constructor(sampleRate: f64) {}

  sample(): void {
    let sum: f32 = 0;
    for (let i = 0; i < CHANNELS; i++) {
      const y = this.mute[i] ? <f32>0 : this.ch[i] * this.gain[i];
      this.level[i] = abs(y);
      sum += y;
    }
    this.out = sum;
  }
}
```

- A setting has an `id` in capitals, `min`, `max`, `init` (whole numbers) and a `name`. In your code, the id is a constant: `CHANNELS`.
- `count` (a number or a setting) makes **numbered** jacks, params or probes: `ch1`, `ch2` … with labels `Ch 1`, `Ch 2` …. The field is a `StaticArray` of the element type, which the compiler allocates for you (use `!` so TypeScript does not ask for an initialiser).
- `group: "Ch {n}"` puts the numbered knobs of one channel in one card.
- The count is at most 64. A setting's value is held to its range.
- The Code node shows a number field per setting; the choice is saved with the patch.

The *Mixer (configurable)* example adds a three-band EQ, low-pass, fader, mute and solo per channel using these features.

## Doc comments

A `/** … */` comment right before a class, field or button becomes its description in the module's interface (and so in tooltips and the API reference). Joined lines become one paragraph; blank lines separate paragraphs.

## Several modules in one file, and errors

Every error carries the file, line and column. Declaration mistakes (a field of the wrong type, a missing `min`, an unknown option, two decorators on one field) are reported by the Bleep transform, and type errors by the compiler, in the same problem list.
