---
title: Built-ins reference
description: Every built-in of a module script, one by one: the lifecycle methods, each decorator, @transport, notes and events, with the signature, what it does and a complete example.
order: 35
---

# Built-ins reference

This page lists every built-in a module script has: the methods the engine calls, the decorators that declare jacks and knobs, the transport handler and the note types. Each entry has the same three parts:

- **What it does**, in a few sentences.
- **API**, the exact signature and options.
- **Example**, a complete module you can paste into a Code node and compile. Every example on this page is compiled by the documentation test.

For the story behind them, see [Module scripts](module-scripts.md), [Events and routing](events.md) and [Rates and timing](rates.md). The `bleep/` functions (oscillators, filters, delays) are on the [Library](library.md) page, and the calls of patch scripts and custom UIs are at the end of this page.

| Group | Entries |
|---|---|
| Methods the engine calls | [`constructor`](#constructor), [`block`](#block), [`sample`](#sample), [`reset`](#reset) |
| Decorators | [`@module`](#module), [`@input`](#input), [`@output`](#output), [`@param`](#param), [`@probe`](#probe), [`@button`](#button), [`@on` for notes](#on-for-notes), [`@on` for edges](#on-for-edges), [`@transport`](#transport) |
| Note types | [`NoteEvent`](#noteevent), [`NoteStream`](#notestream) |
| Other scripts | [The patch builder](#the-patch-builder), [The `bleep` UI object](#the-bleep-ui-object) |

## Methods the engine calls

### `constructor`

**What it does.** Runs once when the module is created. It is the only place that may allocate: create filters, delay lines, tables and smoothers here and keep them in fields. It receives the sample rate, which you need for any frequency or time. The constructor is required, with exactly this argument, even when it does nothing: `constructor(sampleRate: f64) {}`.

**API.**

```ts
constructor(sampleRate: f64)
```

**Example.**

```ts compile
import { Smoother } from "./bleep/dsp";

@module({ name: "Ref constructor", category: "Utility/Script" })
export class RefConstructor {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Level", min: 0, max: 1, init: 1 }) level: f32 = 1;

  private smooth: Smoother;          // allocated once, in the constructor

  constructor(sampleRate: f64) {
    this.smooth = new Smoother(sampleRate, 0.02);   // a 20 ms glide
  }

  block(): void { this.smooth.target = this.level; }
  sample(): void { this.out = this.x * this.smooth.next(); }
}
```

### `block`

**What it does.** Runs once per block of 32 samples, before the samples of that block. Use it for slow work: read the knobs, set smoother targets, compute filter coefficients. Knobs are filled before it runs, and an input holds its first sample of the block. An output you set here (a flag, say) is read back after the block.

**API.**

```ts
block(): void
```

**Example.**

```ts compile
@module({ name: "Ref block", category: "Utility/Script" })
export class RefBlock {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Gain", min: -60, max: 12, init: 0, unit: "dB" }) gain: f32 = 0;

  private lin: f32 = 1;

  // 10^(dB/20) is costly: once per block, not once per sample
  constructor(sampleRate: f64) {}
  block(): void { this.lin = <f32>Math.pow(10.0, <f64>this.gain / 20.0); }
  sample(): void { this.out = this.x * this.lin; }
}
```

### `sample`

**What it does.** Runs once per sample, with the inputs set to the current sample. Write the outputs here. This is where the DSP goes; keep it small, because it runs 48,000 times a second or more. The compiler estimates its cost and rejects what is too much (see [Limits and safety](implementation/limits.md)).

**API.**

```ts
sample(): void
```

**Example.**

```ts compile
@module({ name: "Ref sample", category: "Utility/Script" })
export class RefSample {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Drive", min: 1, max: 20, init: 4 }) drive: f32 = 4;
  constructor(sampleRate: f64) {}

  sample(): void {
    const y = this.x * this.drive;
    this.out = y / (1 + abs(y));        // a soft clipper, per sample
  }
}
```

### `reset`

**What it does.** Runs when the engine resets the module (for example when playback restarts). Clear everything that holds a history: delay lines, filter states, phases, counters. Do not allocate here.

**API.**

```ts
reset(): void
```

**Example.**

```ts compile
@module({ name: "Ref reset", category: "Utility/Script" })
export class RefReset {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;

  private z: f32 = 0;        // one-pole low-pass state
  constructor(sampleRate: f64) {}

  reset(): void { this.z = 0; }
  sample(): void {
    this.z += 0.05 * (this.x - this.z);
    this.out = this.z;
  }
}
```

## Decorators

### `@module`

**What it does.** Marks a class as a module and says how it appears in the Add menu: its name, group, colour and description. It also declares the module's [settings](module-scripts.md#settings-and-counted-jacks) and its [layout](custom-ui.md#layout). Without it a class is an ordinary class. `@module("Name")` is short for `@module({ name: "Name" })`.

**API.**

```ts
@module({
  name?: string,            // default: the class name
  type?: string,            // the type id; default: the name in kebab case
  category?: string,        // "Group/Subgroup"; default "Utility/Script"
  colour?: string,          // "#rrggbb"; default "#94a3b8"
  description?: string,     // default: the class's /** */ comment
  settings?: { id: string, name: string, min: number, max: number, init: number }[],
  layout?: LayoutItem[],    // see Custom UIs and widgets
})
```

**Example.**

```ts compile
/** Doubles the signal. The description is taken from this comment. */
@module({ name: "Ref module", category: "Effects/Script", colour: "#f59e0b" })
export class RefModule {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  constructor(sampleRate: f64) {}
  sample(): void { this.out = this.x * 2; }
}
```

### `@input`

**What it does.** Declares an input jack. The field holds the signal: its first sample of the block in `block()`, the current sample in `sample()`. The jack's id is the field name, and cables are saved against it, so renaming a field drops its cables. With `count` it makes numbered jacks and the field is a `StaticArray`.

**API.**

```ts
@input({
  name?: string,            // jack label; default: the field name in words
  type?: "audio" | "control" | "pitch" | "gate" | "trigger" | "notes",   // default "audio"
  bipolar?: boolean,        // goes below zero (for meters); default true, except gate, trigger, notes
  count?: number,           // a number or a setting: numbered jacks
  names?: string[],         // labels for numbered jacks
  description?: string,
}) field: f32           // f32; StaticArray<f32> with count; NoteStream for notes
```

**Example.**

```ts compile
@module({ name: "Ref input", category: "Utility/Script" })
export class RefInput {
  @input({ name: "Audio", type: "audio" }) x: f32 = 0;
  @input({ name: "CV", type: "control", description: "Scales the audio, 0 to 1" }) cv: f32 = 1;
  @input({ name: "Gate", type: "gate" }) gate: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  constructor(sampleRate: f64) {}

  sample(): void {
    this.out = this.gate >= 0.5 ? this.x * this.cv : 0;     // a gate is high at 0.5 or more
  }
}
```

### `@output`

**What it does.** Declares an output jack. Whatever the field holds after `sample()` is sent out (after `block()` too, for a block-rate output). A notes output is a `NoteStream`: you `push` events into it.

**API.**

```ts
@output({
  name?: string,
  type?: "audio" | "control" | "pitch" | "gate" | "trigger" | "notes",   // default "audio"
  bipolar?: boolean,
  count?: number,
  names?: string[],
  description?: string,
}) field: f32           // f32; StaticArray<f32> with count; NoteStream for notes
```

**Example.**

```ts compile
@module({ name: "Ref output", category: "Utility/Script" })
export class RefOutput {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @output({ name: "Level", type: "control", bipolar: false }) level: f32 = 0;   // a second output, from the same input
  constructor(sampleRate: f64) {}

  sample(): void {
    this.out = this.x;
    this.level = abs(this.x);
  }
}
```

### `@param`

**What it does.** Declares a knob, a toggle or a dropdown, depending on the field's type. The field always holds the value **in its own units** (dB, Hz, an integer, a choice index, a boolean), filled once per block before `block()`. Cables can modulate a numeric knob unless you set `modulatable: false`.

**API.**

```ts
@param({
  name?: string,
  min?: number, max?: number,     // required for f32 and for a stepped i32
  init?: number,                  // default: the field's initial value, or min
  unit?: string,                  // "dB", "Hz", "s" ...
  decimals?: number,              // digits shown; default 2
  map?: "linear" | "exp" | "skew",   // default "linear"; exp needs min > 0
  centre?: number,                // for skew: the value in the middle of the knob
  minText?: string,               // text at min, such as "-inf"
  choices?: string[],             // i32 only: a dropdown; the field holds the index
  group?: string,                 // a card: "Ch {n}"
  modulatable?: boolean,
  count?: number, names?: string[], description?: string,
}) field: f32 | i32 | bool
```

| Field type | You get |
|---|---|
| `f32` with `min`, `max` | A continuous knob |
| `i32` with `min`, `max` | A stepped integer knob |
| `i32` with `choices` | A dropdown; the field is the chosen index |
| `bool` | A toggle |

**Example.**

```ts compile
@module({ name: "Ref param", category: "Utility/Script" })
export class RefParam {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Cutoff", min: 20, max: 20000, init: 1000, map: "exp", unit: "Hz", decimals: 0 }) cutoff: f32 = 1000;
  @param({ name: "Mode", choices: ["Low", "High"] }) mode: i32 = 0;
  @param({ name: "Steps", min: 1, max: 8 }) steps: i32 = 4;
  @param({ name: "Bypass" }) bypass: bool = false;

  private z: f32 = 0;
  private a: f32 = 0.1;
  constructor(sampleRate: f64) {}

  block(): void { this.a = <f32>(1.0 - Math.exp(-6.283185307 * <f64>this.cutoff / 48000.0)); }
  sample(): void {
    this.z += this.a * (this.x - this.z);
    const y = this.mode == 0 ? this.z : this.x - this.z;
    this.out = this.bypass ? this.x : y;
  }
}
```

### `@probe`

**What it does.** Declares a value the view shows as a meter. It is not a jack: nothing can be cabled to it. Write the field as often as you like; the view reads it about ten times a second. Use it to show a level, a gain reduction, a phase, or a step counter.

**API.**

```ts
@probe({ name?: string, count?: number, description?: string }) field: f32
@probe field: f32            // without options
```

**Example.**

```ts compile
@module({ name: "Ref probe", category: "Utility/Script" })
export class RefProbe {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @probe({ name: "Peak" }) peak: f32 = 0;
  constructor(sampleRate: f64) {}

  sample(): void {
    this.out = this.x;
    const a = abs(this.x);
    this.peak = a > this.peak ? a : this.peak * 0.9999;     // a peak meter that falls slowly
  }
}
```

### `@button`

**What it does.** Declares a button in the module's view. The method runs when the button is pressed, between blocks. The method name is the button's id and must be a plain identifier.

**API.**

```ts
@button({ name?: string, description?: string }) methodName(): void
```

**Example.**

```ts compile
@module({ name: "Ref button", category: "Utility/Script" })
export class RefButton {
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @probe({ name: "Pressed" }) pressed: f32 = 0;

  private count: i32 = 0;
  constructor(sampleRate: f64) {}

  @button({ name: "Count" }) bump(): void { this.count++; this.pressed = <f32>this.count; }
  @button({ name: "Clear" }) clear(): void { this.count = 0; this.pressed = 0; }
}
```

### `@on` for notes

**What it does.** Runs a method once for every note event that arrives on a notes input, at the sample where it happens. Whatever you `push` to a notes output leaves at the same sample. The decorator names the input **field**.

**API.**

```ts
@on("inputField") handler(e: NoteEvent): void
```

**Example.**

```ts compile
import { NoteEvent, NoteStream } from "./bleep/notes";

@module({ name: "Ref note handler", category: "Utility/Script" })
export class RefNoteHandler {
  @input({ name: "Notes", type: "notes" }) notes!: NoteStream;
  @output({ name: "Notes", type: "notes" }) out!: NoteStream;
  constructor(sampleRate: f64) {}

  // every note on and off goes out a fifth higher; other events pass unchanged
  @on("notes") fifth(e: NoteEvent): void {
    if (e.isOn || e.isOff) e.transpose(7);
    this.out.push(e);
  }
}
```

### `@on` for edges

**What it does.** Runs a method at the sample where a `control`, `gate` or `trigger` input crosses a level. `rising` fires when the signal goes from below the level to at or above it; `falling` the other way round. Give exactly one of them. The first block never fires an edge.

**API.**

```ts
@on("inputField", { rising: level }) handler(): void
@on("inputField", { falling: level }) handler(): void
```

**Example.**

```ts compile
@module({ name: "Ref edge", category: "Utility/Script" })
export class RefEdge {
  @input({ name: "Trig", type: "trigger" }) trig: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @probe({ name: "Count" }) count: f32 = 0;

  private n: i32 = 0;
  constructor(sampleRate: f64) {}

  @on("trig", { rising: 0.5 }) hit(): void {
    this.n++;
    this.count = <f32>this.n;
  }
}
```

### `@transport`

**What it does.** Tells the module where the host's transport is: the tempo, the position and whether it is playing. The engine calls the method **once per block, before `block()`**. Use it for anything that follows the tempo: an LFO or delay synced to the beat, an arpeggiator, a step sequencer. One method per module can have it, and it takes exactly these three arguments.

Because it is block rate, take the host's value at the start of each block and advance the position yourself per sample in between, as the example does. When `playing` turns from false to true, the transport has started. A module that never uses the transport simply leaves the method out.

**API.**

```ts
@transport name(bpm: f64, ppq: f64, playing: bool): void
```

| Argument | Meaning |
|---|---|
| `bpm` | The tempo in quarter notes per minute |
| `ppq` | The position at the start of the block, in quarter notes (beats) from the start of the song. 4.0 is the start of the second bar in 4/4 |
| `playing` | `true` while the transport runs, `false` when it is stopped |

The [`Clock`](library.md#clock) class in `bleep/env` does the position bookkeeping for you.

**Example.** A tremolo that runs once per beat, locked to the song position while it plays and free-running when it is stopped:

```ts compile
@module({ name: "Ref transport", category: "Utility/Script" })
export class RefTransport {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Cycles per beat", min: 0.25, max: 8, init: 1, map: "exp" }) rate: f32 = 1;
  @param({ name: "Depth", min: 0, max: 1, init: 0.7 }) depth: f32 = 0.7;

  private bpm: f64 = 120;
  private beat: f64 = 0;
  private sampleRate: f64;
  constructor(sampleRate: f64) { this.sampleRate = sampleRate; }

  @transport tempo(bpm: f64, ppq: f64, playing: bool): void {
    this.bpm = bpm;
    if (playing) this.beat = ppq;          // take the song position; when stopped, free-run
  }

  sample(): void {
    this.beat += this.bpm / 60.0 / this.sampleRate;       // beats per sample
    const p = this.beat * <f64>this.rate;
    const lfo = <f32>(0.5 + 0.5 * Math.sin(2.0 * Math.PI * (p - Math.floor(p))));
    this.out = this.x * (1 - this.depth * (1 - lfo));
  }
}
```

## Note types

### `NoteEvent`

**What it does.** One note, control or pitch-bend event. The handler of an `@on` method receives one, and you `push` one to send. Handle the types you know and ignore the rest.

**API.**

```ts
class NoteEvent {
  type: u8        // NOTE_ON 0, NOTE_OFF 1, NOTE_PRESSURE 2, NOTE_CC 3, NOTE_PROGRAM 4, NOTE_BEND 5, NOTE_CHANNEL_PRESSURE 6, NOTE_SYSTEM 7
  channel: u8     // MIDI channel, 0 to 15
  offset: i16     // the sample inside the block
  note: i32       // MIDI note number; for types 3 to 7 the controller or program number
  pitch: f32      // pitch in volts: 1.0 is one octave, 0 is C4
  value: f32      // velocity or pressure 0 to 1; a control change's data / 127; a bend -1 to +1

  get isOn(): bool
  get isOff(): bool
  get isCc(): bool
  transpose(semitones: i32): void     // shifts note and pitch together
}
```

**Example.** Turn a note-on velocity into a control signal, and drop the pitch by an octave:

```ts compile
import { NoteEvent, NoteStream } from "./bleep/notes";

@module({ name: "Ref note event", category: "Utility/Script" })
export class RefNoteEvent {
  @input({ name: "Notes", type: "notes" }) notes!: NoteStream;
  @output({ name: "Notes", type: "notes" }) out!: NoteStream;
  @output({ name: "Velocity", type: "control", bipolar: false }) velocity: f32 = 0;
  constructor(sampleRate: f64) {}

  @on("notes") handle(e: NoteEvent): void {
    if (e.isOn) {
      this.velocity = e.value;
      e.transpose(-12);
    }
    this.out.push(e);
  }
}
```

### `NoteStream`

**What it does.** The events of a notes input for this block, or the events a notes output will send. An output starts every block empty. A handler gets each incoming event already, so you need `read` only to look at all the events of the block at once.

**API.**

```ts
class NoteStream {
  get length(): i32                       // events waiting (0 to 64)
  offsetAt(i: i32): i32                   // the sample offset of event i
  read(i: i32, into: NoteEvent): void     // copies event i into a NoteEvent you own
  push(e: NoteEvent): void                // sends an event; dropped silently when 64 are queued
  clear(): void                           // forgets the queued events
}
```

**Example.** Pass notes through, but only the first four of each block:

```ts compile
import { NoteEvent, NoteStream } from "./bleep/notes";

@module({ name: "Ref note stream", category: "Utility/Script" })
export class RefNoteStream {
  @input({ name: "Notes", type: "notes" }) notes!: NoteStream;
  @output({ name: "Notes", type: "notes" }) out!: NoteStream;
  private e: NoteEvent;                   // allocated once, in the constructor
  constructor(sampleRate: f64) { this.e = new NoteEvent(); }

  block(): void {
    for (let i = 0; i < 4; i++) {          // loop bounds must be constants
      if (i >= this.notes.length) break;
      this.notes.read(i, this.e);
      this.out.push(this.e);
    }
  }
}
```

## The patch builder

A [patch script](patch-scripts.md) builds a cell from TypeScript or JavaScript. It runs once, when you compile. These are all its calls.

### `cell(name, options, build)`

**What it does.** The one thing a patch script exports: `export default cell(...)`. It names the cell and gives the function that builds it. `options` can be left out.

**API.**

```ts
cell(name: string, options: { description?: string, settings?: Setting[] }, build: (c: Builder, s: Settings) => void)
cell(name: string, build: (c: Builder, s: Settings) => void)
```

**Example.**

```ts patch
export default cell("Two oscillators", { description: "A saw and a pulse, mixed." }, (c) => {
  c.stereoOut();
  const a = c.add("oscillator", { coarse: 0 });
  const b = c.add("oscillator", { coarse: 7 });
  c.cable(a, "saw", c.cout, "l");
  c.cable(b, "saw", c.cout, "r");
});
```

### `c.input` and `c.output`

**What it does.** Adds a jack to the cell, shared by everything inside. `c.stereoIn()` and `c.stereoOut()` add the pair `l` and `r`.

**API.**

```ts
c.input(id: string, name: string, type?: "control" | "audio" | "pitch" | "gate" | "trigger" | "notes")   // default "control"
c.output(id: string, name: string, type?: ...)                                                              // default "audio"
c.stereoIn(): void
c.stereoOut(): void
```

**Example.**

```ts patch
export default cell("Gated voice", (c) => {
  c.input("pitch", "Pitch", "pitch");
  c.input("gate", "Gate", "gate");
  c.stereoOut();
  const osc = c.add("oscillator");
  const amp = c.add("vca");
  c.cable(c.cin, "pitch", osc, "pitch");
  c.cable(c.cin, "gate", amp, "gain");
  c.cable(osc, "saw", amp, "l");
  c.stereo(amp, c.cout);
});
```

### `c.add`

**What it does.** Adds a module and returns a handle to cable from and to. `values` sets knobs in their own units; a value outside the range, of the wrong kind or for a knob that does not exist is an error that lists the real knobs.

**API.**

```ts
c.add(type: string, values?: Record<string, number | boolean | string>, opts?: {
  name?: string, id?: string,
  at?: [column: number, row: number],     // a grid of 300 by 220 pixels
  x?: number, y?: number,                 // pixels
  data?: unknown,                         // the module's node data
}): Handle
```

**Example.**

```ts patch
export default cell("Filtered saw", (c) => {
  c.stereoOut();
  const osc = c.add("oscillator", { fine: -12 }, { name: "Saw", at: [0, 0] });
  const lp = c.add("filter", { cutoff: 800, mode: "LP" }, { at: [1, 0] });
  c.cable(osc, "saw", lp, "l");
  c.stereo(lp, c.cout);
});
```

### `c.cable`

**What it does.** Draws a cable from an output jack to an input jack, or to a knob that cables can drive. The amount runs from −1 to +1 (default 1). Several cables into one input add up.

**API.**

```ts
c.cable(from: Handle, fromJack: string, to: Handle, toJack: string, amount?: number): void
```

**Example.**

```ts patch
export default cell("Wobble", (c) => {
  c.stereoOut();
  const osc = c.add("oscillator");
  const lfo = c.add("lfo", { rate: 4 });
  const lp = c.add("filter", { cutoff: 1200 });
  c.cable(osc, "saw", lp, "l");
  c.cable(lfo, "out", lp, "cutoff", 0.4);        // an LFO into a knob
  c.stereo(lp, c.cout);
});
```

### `c.stereo`

**What it does.** Cables both channels at once: `from.l` to `to.l` and `from.r` to `to.r`.

**API.**

```ts
c.stereo(from: Handle, to: Handle, jacks?: { from?: [string, string], to?: [string, string], amount?: number }): void
```

**Example.**

```ts patch
export default cell("Pass through a filter", (c) => {
  c.stereoIn();
  c.stereoOut();
  const lp = c.add("filter", { cutoff: 3000 });
  c.stereo(c.cin, lp);
  c.stereo(lp, c.cout);
});
```

### `c.place`

**What it does.** Puts a module at a pixel position inside the cell. Without a position, modules are laid out in a grid between *Cell In* and *Cell Out*.

**API.**

```ts
c.place(handle: Handle, x: number, y: number): void
```

**Example.**

```ts patch
export default cell("Placed", (c) => {
  c.stereoOut();
  const osc = c.add("oscillator");
  c.place(osc, 40, 40);
  c.cable(osc, "saw", c.cout, "l");
});
```

### `c.cin` and `c.cout`

**What it does.** The cell's own input and output sides, as handles. Cable from `c.cin` to feed things inside from the cell's inputs, and to `c.cout` to send things to the cell's outputs.

**API.**

```ts
c.cin: Handle
c.cout: Handle
```

**Example.** See [`c.input` and `c.output`](#cinput-and-coutput) above.

## The `bleep` UI object

A [self-made UI](custom-ui.md#a-self-made-ui) is JavaScript in the UI tab. It runs in a worker and talks to its module only through `bleep`. These are all its members.

### `bleep.param(id)` and `bleep.params`

**What it does.** `bleep.param(id)` returns one param of the module and throws with the known ids when there is none; `bleep.params` has all of them. A param has `id`, `name`, `kind`, `unit`, `min`, `max`, `steps`, `choices`, `value` in its own units and `normalised` from 0 to 1, plus `set(units)` and `setNormalised(x)`. A UI can set at most 240 values per second.

**API.**

```js
bleep.param(id: string): Param
bleep.params: Record<string, Param>
param.set(units: number): void
param.setNormalised(x: number): void
```

**Example.**

```js
const drive = bleep.param("drive");
const c = bleep.canvas(40);
c.el.addEventListener("pointerdown", (e) => drive.setNormalised(e.clientX / c.width));
```

### `bleep.probe(id)`

**What it does.** The latest value of a `@probe`, 0 until the module reports one.

**API.**

```js
bleep.probe(id: string): number
```

**Example.**

```js
const m = bleep.canvas(20);
bleep.onFrame(() => {
  m.g.clearRect(0, 0, m.width, m.height);
  m.g.fillStyle = bleep.theme.accent;
  m.g.fillRect(0, 0, m.width * bleep.probe("peak"), m.height);
});
```

### `bleep.button(id)`

**What it does.** Presses a `@button` method of the module, as if the user had clicked it.

**API.**

```js
bleep.button(id: string): void
```

**Example.**

```js
const c = bleep.canvas(30);
c.el.addEventListener("click", () => bleep.button("clear"));
```

### `bleep.onFrame(fn)` and `bleep.onValues(fn)`

**What it does.** `onFrame` calls your function every animation frame with the time since the last one, in seconds: draw animation here. `onValues` calls it only when a param or probe has changed: redraw here if the picture does not move on its own.

**API.**

```js
bleep.onFrame(fn: (dt: number) => void): void
bleep.onValues(fn: () => void): void
```

**Example.**

```js
let phase = 0;
const c = bleep.canvas(60);
bleep.onFrame((dt) => {
  phase += dt * bleep.param("rate").value;       // a dot that moves at the LFO's rate
  c.g.clearRect(0, 0, c.width, c.height);
  c.g.fillStyle = bleep.theme.accent;
  c.g.fillRect((phase % 1) * c.width, 20, 8, 8);
});
```

### `bleep.size(h)` and `bleep.canvas(h)`

**What it does.** `bleep.size(h)` asks for a height in pixels, 40 to 800; the width is the node's. `bleep.canvas(h)` makes a canvas as wide as the view and `h` high, scaled for the screen, and returns `{ el, g, width, height }`. `bleep.canvas("fill")` is as high as the view too, so it follows the window when it is resized.

**API.**

```js
bleep.size(h: number): void
bleep.canvas(h: number | "fill"): { el, g: CanvasRenderingContext2D, width: number, height: number }
```

**Example.**

```js
const c = bleep.canvas("fill");
bleep.onFrame(() => {
  c.g.fillStyle = bleep.theme.panel;
  c.g.fillRect(0, 0, c.width, c.height);
});
```

### `bleep.theme`

**What it does.** The board's colours, so a UI looks at home in both themes.

**API.**

```js
bleep.theme: { bg: string, panel: string, line: string, text: string, muted: string, accent: string, warn: string }
```

**Example.**

```js
const c = bleep.canvas(40);
c.g.strokeStyle = bleep.theme.line;
c.g.strokeRect(0.5, 0.5, c.width - 1, c.height - 1);
```
