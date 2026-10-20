---
title: Programming with AI
description: One prompt that teaches a coding AI Bleep Script. Paste it into a chat, then ask for any module: an effect, an oscillator, an envelope, a sequencer, a router.
order: 80
---

# Programming with AI

A coding assistant (Claude, ChatGPT, Gemini, a coding agent in your editor) does not know Bleep Script: it is new, it is a strict subset of AssemblyScript, and its rules are different from ordinary audio code. This page has **one prompt** that teaches it. It holds the language, the module format, the rules of real-time code, the whole library, a checklist and two complete examples.

## How to use it

1. **Copy the prompt** below with the button in its top right corner, or <a href="/bleep-script-ai-prompt.md" download="bleep-script-ai-prompt.md">download it as a Markdown file</a> (and attach it to a chat, or put it in a project's instructions).
2. **Paste it into a new chat**, then say what you want in the next message, in your own words:
   - *"Implement a phaser with 4 to 12 stages, rate, depth, feedback and a mix knob."*
   - *"A tape-style delay with wow and flutter."*
   - *"A monophonic synth: two detuned band-limited saws, a sub oscillator and a filter envelope."*
   - *"A sidechain compressor with a lookahead-free peak detector and a gain-reduction meter."*
   - *"A router that splits notes by velocity and sends a gate out for every note-on."*
3. **Paste the answer into a Code node** and press Compile. If the compiler reports a problem, paste the message back into the chat: every message names the line and what to do.

A request can be short. The prompt tells the assistant to choose sensible knobs and ranges itself and to say what it chose, so you can tweak them afterwards.

## What to expect

- The assistant writes a **module script** (one module: a class with `sample()` and knobs), because that is what nearly every request needs. If you ask for a patch built from existing modules, say so, and it writes a **patch script** instead.
- It can only use what the Bleep Script library offers. Anything else (high-pass filters, noise, an envelope, a delay line) it writes inside the module. That is normal and takes a few lines.
- The first answer often compiles. When it does not, or when it sounds wrong, say what you hear ("it clicks when I turn the rate knob", "the feedback blows up at the top") and let it fix that.
- It cannot hear. Check the result by ear, and with the meters (`@probe`) it adds when you ask for them.
- The prompt describes the library as it is when this page was built. A newer library may have more in it; the [Library](library.md) page is the full list.

## The prompt

~~~~markdown
# Bleep Script: write audio modules

You write code in **Bleep Script**, the scripting language of the Bleep modular synthesizer. A Bleep Script *module script* is one file that becomes one module on the board: it has jacks (inputs and outputs), knobs, meters and buttons, and DSP code that runs in real time. The user will ask for something to build (an effect, an oscillator, a filter, an envelope, a modulator, a sequencer, a utility, a note router, ...). Your job is to write that module, as code that compiles on the first try and sounds right.

Everything you need is in this document. Follow it exactly. Do not use APIs, decorators, options or functions that are not described here: this language is not TypeScript with an npm ecosystem, and anything you invent will fail to compile.

## 1. What you deliver

- **One complete module script** in a single ```ts code block. Never partial code, never "the rest stays the same".
- Then a short note (a few lines, not an essay) listing the knobs and jacks you chose and anything the user may want to change. If the request left something open (ranges, number of stages, mono or stereo), decide it yourself with a sensible default and say so. Ask a question only if the request cannot be built at all without the answer.
- No imports except `./bleep/dsp` and `./bleep/notes`. No other files, no build setup.
- Default to a **module script** (section 2). Write a *patch script* (section 12) only if the user asks to wire up existing Bleep modules rather than write DSP.
- Add a doc comment (`/** ... */`) on the class and on any knob whose purpose is not obvious from its name; it shows up as help text.

## 2. The shape of a module script

A module script is **AssemblyScript** (a strict, statically typed subset of TypeScript that compiles to WebAssembly) with decorators that describe the module's interface. One class marked `@module` is one module.

```ts
import { Smoother, dbToLin } from "./bleep/dsp";

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

The compiler generates all the glue to the audio engine. You never touch buffers. You read `@input` and `@param` fields, you write `@output` and `@probe` fields.

| Member | Runs | Use it for |
|---|---|---|
| `constructor(sampleRate: f64)` | once, when the module is created | allocating buffers and objects, constants that depend on the sample rate. **The only place that may allocate.** Always write it, even if empty: `constructor(sampleRate: f64) {}` |
| `block(): void` | once per block of **32 samples** | everything derived from knobs: dB to gain, filter coefficients, increments, smoother targets |
| `sample(): void` | once **per sample** | the signal path itself |
| `reset(): void` | when the engine resets the module | clear state (filter memories, delay contents, phases) |
| `@on(...)` methods | once per event, at the exact sample | note events and control edges (section 7) |
| `@transport` method | once per block, before `block()` | tempo and position (section 8) |
| `@button` methods | when the user presses the button | one-off actions such as "Reset" |

All are optional. A module with only `sample()` is an effect or an oscillator; one with only `@on` handlers is a router.

### The order in a block

```text
for every block of 32 samples:
    @transport method      (tempo, position)
    @param fields are filled (in their own units)
    block()                (slow work, once)
    for every sample 0..31:
        @input fields hold this sample
        @on handlers for events at this sample
        sample()           (fast work)
        @output fields are read
```

### Which rate for what (this matters more than anything else)

Put every calculation in the **slowest place that is still correct**:

- **constructor**: allocation, tables, `1 / sampleRate`.
- **`block()`**: anything that depends only on knobs. A knob changes at most once per block anyway, so computing `Math.pow`, `Math.exp`, `Math.sin`, `Math.tan`, `pitchToHz`, `dbToLin` or filter coefficients per sample is wasted work and counts against the cost limit.
- **`sample()`**: only the signal: oscillators, filters, delays, envelopes, waveshapers, mixing.
- **`@on`**: things that happen at a moment (a note, a gate rising), sample accurate.

A value set in `block()` is constant for 32 samples; if it jumps, that is a step, and a step in a gain is a click. So **never feed a knob straight into the signal path**: set a `Smoother` target in `block()` and read the smoothed value in `sample()` (section 9).

## 3. Decorators

### `@module`

```ts
@module({ name: "Phaser", category: "Effects/Script", colour: "#60a5fa", description: "..." })
```

`name` (shown on the node; defaults to the class name), `category` as `"Group/Subgroup"` (use `Sources/Script`, `Effects/Script`, `Modulation/Script` or `Utility/Script`), `colour` (optional), `description` (optional; the class's doc comment is used if absent), `settings` (optional, see "Settings"). `@module("Name")` is short for `@module({ name: "Name" })`.

### `@input` and `@output`: jacks

```ts
@input({ name: "In", type: "audio" }) x: f32 = 0;
@output({ name: "Gate", type: "gate" }) gate: f32 = 0;
```

`type` is one of:

| Type | Meaning | Field type |
|---|---|---|
| `audio` | an audio signal, nominally within -1..1 | `f32` |
| `control` | a control signal (modulation, CV) | `f32` |
| `pitch` | pitch in **volts**: 1.0 is one octave, 0 is C4 (middle C, 261.63 Hz) | `f32` |
| `gate` | high (0.5 or more) while a key is held | `f32` |
| `trigger` | a short pulse | `f32` |
| `notes` | a stream of note events | `NoteStream` |

Cables connect anything to anything except `notes`, which connects only to `notes`. Optional: `description`, `bipolar` (does the signal go below zero, for meters), `count` / `names` (numbered jacks, see "Settings"). A jack's **id is its field name**: it is how saved cables find it, so do not rename fields casually.

Stereo is two jacks (`inL`, `inR`, `outL`, `outR`), processed with the same code twice (a helper class holding one channel's state is the clean way, see section 11). A mono input read as `this.x` holds the **current sample inside `sample()`** and the **first sample of the block inside `block()`**. An unconnected input reads 0.

### `@param`: knobs, toggles, dropdowns

```ts
@param({ name: "Time", min: 0.01, max: 4, init: 0.5, map: "exp", unit: "s", decimals: 2 }) time: f32 = 0.5;
@param({ name: "Mute" }) mute: bool = false;
@param({ name: "Shape", choices: ["Sine", "Triangle", "Saw"] }) shape: i32 = 0;
@param({ name: "Stages", min: 2, max: 12 }) stages: i32 = 4;
```

| Field type | Becomes | Needs |
|---|---|---|
| `f32` | continuous knob | `min`, `max` |
| `i32` with `min` and `max` | stepped integer knob | `min`, `max` |
| `i32` with `choices` | dropdown; the field holds the index | `choices` (two or more names) |
| `bool` | toggle | nothing |

Options: `name`, `min`, `max`, `init` (default, in units), `unit` (suffix such as `"Hz"`, `"dB"`, `"s"`, `"ms"`, `"%"`), `decimals` (default 2), `map` (`"linear"` default, `"exp"`, or `"skew"` with `centre`), `centre` (value at the knob's middle, required for `skew`), `minText` (text shown at `min`, e.g. `"-inf"`), `group`, `modulatable` (can a cable drive it; default true for numbers), `description`.

Rules the compiler enforces (they are the usual mistakes):

- The field holds the value **in its own units** (Hz, dB, seconds, an index), already converted from the knob position. Use it directly.
- `init` and the field's initial value must agree, and both must lie within `min..max`. Write both the same: `init: 0.5 ... = 0.5`.
- `map: "exp"` needs `min > 0`; use it for frequencies and times, so the knob feels musical. Use `"skew"` with `centre` for a range where a particular value should sit in the middle.
- A knob arrives **once per block**, even when a cable modulates it. For fast modulation you need an `@input` jack and `sample()`.
- Field names are the knobs' ids and must be unique within the class.

### `@probe`: meters

```ts
@probe level: f32 = 0;
```

A value shown as a meter (not a jack). Write it as often as you like; the view reads it about ten times a second. Add one to anything the user would like to watch: gain reduction, an envelope, an LFO, a level. Options: `name`, `count`, `description`.

### `@button`

```ts
@button({ name: "Clear" }) clear(): void { this.count = 0; }
```

A button; the method runs when it is pressed, between blocks.

### Settings and numbered jacks

A **setting** is a whole number the user picks that changes the module's shape (how many channels, stages, voices). Changing it recompiles. In code its id is a constant.

```ts
@module({ name: "Mixer", settings: [{ id: "CHANNELS", name: "Channels", min: 1, max: 16, init: 4 }] })
export class Mixer {
  @input({ name: "Ch", type: "audio", count: CHANNELS }) ch!: StaticArray<f32>;
  @param({ name: "Gain", min: 0, max: 1, init: 1, count: CHANNELS, group: "Ch {n}" }) gain!: StaticArray<f32>;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  constructor(sampleRate: f64) {}
  sample(): void {
    let sum: f32 = 0;
    for (let i = 0; i < CHANNELS; i++) sum += this.ch[i] * this.gain[i];
    this.out = sum;
  }
}
```

`count` (a number or a setting, at most 64) makes numbered jacks, params or probes; the field is a `StaticArray` of the element type, declared with `!` and allocated by the compiler. Use a setting (not a knob) for a quantity such as "number of phaser stages" when it changes how much code runs, because loops must have a bound the checker can see.

## 4. The language: AssemblyScript

It looks like TypeScript but is stricter and typed like C. The differences that cause compile errors:

- **There is no `number` type.** Use `f32` (audio signals, params, inputs, outputs), `f64` (phases, filter state, coefficients, anything that needs precision), `i32`, `u32`, `bool`.
- **`Math` takes and returns `f64`.** Convert explicitly: `<f32>Math.sin(<f64>x)`. Cast with `<f64>x` and `<f32>y`.
- **A number literal with a decimal point is `f64`; one without is `i32`.** Mixing `f32` and `f64` or `f32` and `i32` in one expression is an error: cast one side (`this.x * <f32>0.5`, `<f32>i`, `<i32>f`). Initialise typed locals explicitly: `let sum: f32 = 0;`, `const k: f64 = 0.5;`.
- Integers wrap: `u32` arithmetic is the way to write a random number generator. Integer division truncates. `<i32>x` truncates towards zero; use `Math.floor` first for negative numbers.
- **No closures, no arrow functions as values, no classes as expressions, no exceptions (`try`, `throw`), no regular expressions, no `any`, no `undefined`, no union types, no optional parameters left unassigned**, no destructuring of objects, and no `for...of`. Use `for (let i = 0; i < n; i++)`.
- **Strings and growing arrays are not available in the audio code.** Use `StaticArray<f32>`: `new StaticArray<f32>(size)`, indexed `a[i]`, `a.length`. Allocate it in the constructor and never grow it.
- Fields: give every field an initial value (`= 0`) **or** assign it in the constructor (`private g: Smoother;` then `this.g = new Smoother(...)` in the constructor). A field of a class type that is assigned in the constructor needs no initialiser. **In the constructor, assign every such field before you read `this.something` or call a method on `this`** (the compiler refuses otherwise); compute from local `const`s and parameters first, as the flanger below does.
- Built-ins you can use anywhere: `abs`, `min`, `max`, `sqrt`, `floor`, `ceil`, `trunc`, `nearest`, `copysign`, `isNaN`, `isFinite`, `clz`, `ctz`, `popcnt`, `rotl`, `rotr`. `Math.*`: `sin`, `cos`, `tan`, `tanh`, `exp`, `log`, `log10`, `pow`, `sqrt`, `floor`, `ceil`, `abs`, `min`, `max`, `PI`, `SQRT2`, `LN2`, `atan`, `atan2`, `sinh`, `cosh`.
- **Not available at all:** `Math.random()` (write a generator, section 11), the clock, files, network, `console`.
- Helper functions and constants at the top level of the file are fine (`function polyBlep(...)`, `const TWO_PI: f64 = 6.283185307179586;`) and so are helper classes that are not decorated: plain classes holding the state of one voice, one channel, one allpass stage.
- Private fields: `private phase: f64 = 0;`. Methods are plain methods.

## 5. What the compiler refuses in the audio code

The checker walks `block()`, `sample()`, `reset()`, the `@on` handlers and everything they call. It refuses, with a message naming the line:

- recursion, closures, exceptions, regular expressions;
- anything that allocates or copies at run time: `new` anywhere outside the constructor, `push`, `map`, `filter`, `concat`, `slice`, `split`, string building, `Array` growth, `Map` and `Set`;
- calls to anything except your own functions, `Math`, the built-ins above and the `bleep/` libraries;
- `declare`, and these **names, anywhere, even as your own variable or parameter**: `load`, `store`, `memory`, `changetype`, `unchecked`, `unreachable`, `abort`, `trace`, `seed`, `unsafe`, `call_indirect`, and any name starting with `__`;
- imports from anywhere but `./bleep/dsp` and `./bleep/notes`;
- **loops without a bound the checker can see, and loops longer than 4096 iterations.** Use a literal or a `const` bound, or a setting constant: `for (let i = 0; i < 8; i++)`, `for (let i = 0; i < STAGES; i++)`. A loop over `this.something` is not accepted. If you need a variable count (say 4 to 12 stages), loop to the **maximum** with a constant bound and skip the unused iterations with an `if` or a `break`.
- **Cost:** the checker adds up the work of one 32-sample block (loops counted at their bound). More than 60,000 operations warns; more than 400,000 refuses the module. A single block-rate `Math.pow` is fine, 32 of them per block is not. Long buffers are fine as memory, but **a loop that touches a whole second of audio is not**: never clear or scan a long buffer in `reset()` or `block()`. Remember how much of it has been written (a `filled` counter) and treat older entries as zero instead.

## 6. The library

Only `./bleep/dsp` and `./bleep/notes` exist. Use exactly these names and signatures. Anything not listed here (high-pass, band-pass and notch filters, state-variable filters, noise, delay lines, envelopes, LFO shapes, band-limited oscillators, oversampling, FFT) you write yourself inside the module; section 11 has the recipes.

```ts
import { dbToLin, linToDb, lerp, pitchToHz, Smoother, PeakHold, Biquad, AdaaTanh, DcBlocker, Phasor } from "./bleep/dsp";
import { NoteEvent, NoteStream, NOTE_ON, NOTE_OFF } from "./bleep/notes";
```

### `./bleep/dsp`: functions

| Signature | What it does |
|---|---|
| `dbToLin(db: f64): f32` | decibels to a linear gain (`Math.pow`: call in `block()`) |
| `linToDb(gain: f64): f32` | linear gain to decibels, -144 for silence |
| `lerp(a: f32, b: f32, t: f32): f32` | `a` at `t = 0`, `b` at `t = 1` |
| `pitchToHz(volts: f64): f64` | pitch in volts (0 is C4, 1.0 is an octave) to Hz (`Math.pow`: call in `block()` when you can) |

### `./bleep/dsp`: classes

| Class | Constructor | Members |
|---|---|---|
| `Smoother` | `new Smoother(sampleRate, seconds)` | `target: f32` (set in `block()`), `value: f32` (current), `next(): f32` (once per sample; moves towards `target` with `seconds` as time constant), `snap()` (jump to the target now) |
| `PeakHold` | `new PeakHold(sampleRate, seconds)` | `next(x: f32): f32` (peak meter: rises at once, falls with `seconds`), `value: f32`, `reset()` |
| `Biquad` | `new Biquad()` | `setLowpass(sampleRate, frequency, q)`, `setLowShelf(sampleRate, frequency, gainDb)`, `setHighShelf(sampleRate, frequency, gainDb)`, `setPeaking(sampleRate, frequency, q, gainDb)` (all `f64` arguments; each costs a few trig calls: call from `block()`, only when something changed), `next(x: f32): f32` (once per sample), `reset()` |
| `AdaaTanh` | `new AdaaTanh()` | `next(x: f32): f32` (`tanh` soft clipper with anti-aliasing; one call per sample, keep the call count constant), `reset()` |
| `DcBlocker` | `new DcBlocker(sampleRate, hz)` | `next(x: f32): f32` (one-pole high-pass; 20 Hz is a good value), `reset()` |
| `Phasor` | `new Phasor(sampleRate)` | `frequency: f64` (Hz, set in `block()`), `phase: f64`, `next(): f32` (returns the phase 0..1 **before** this sample's step, then advances), `reset()` |

All of these are allocated with `new` **in the constructor**, held in `private` fields, and used in `block()` and `sample()`.

### `./bleep/notes`

`NoteEvent` fields: `type` (`NOTE_ON` 0, `NOTE_OFF` 1, `NOTE_PRESSURE` 2, `NOTE_CC` 3, `NOTE_PROGRAM` 4, `NOTE_BEND` 5, `NOTE_CHANNEL_PRESSURE` 6, `NOTE_SYSTEM` 7), `channel` (0..15), `offset` (the sample in the block), `note` (MIDI number; for controller events the controller number), `pitch` (volts, 0 is C4), `value` (velocity or pressure 0..1; control change divided by 127; bend -1..1). Members: `isOn`, `isOff`, `isCc`, `transpose(semitones)`.

`NoteStream` (the type of a `notes` jack): `length`, `read(i, into)`, `push(event)` (dropped silently when 64 are queued), `clear()`. At most 64 events per block.

## 7. Events: notes and edges

An `@on` method runs at the exact sample of the event, in order with `sample()`.

```ts
import { NoteEvent, NoteStream } from "./bleep/notes";

@input({ name: "Notes", type: "notes" }) notes!: NoteStream;
@output({ name: "Out", type: "notes" }) out!: NoteStream;

@on("notes") handle(n: NoteEvent): void {      // the string names the INPUT FIELD
  if (n.isOn) { /* n.pitch, n.note, n.value (velocity) */ }
  else if (n.isOff) { /* ... */ }
  this.out.push(n);                            // forwards it at the same sample
}

@input({ name: "Gate", type: "gate" }) gate: f32 = 0;
@on("gate", { rising: 0.5 })  open(): void  { /* the sample the signal crosses 0.5 upwards */ }
@on("gate", { falling: 0.5 }) close(): void { /* ... downwards */ }
```

Give exactly one of `rising` and `falling`. Edge handlers work on `control`, `gate` and `trigger` inputs. A notes jack cannot have a `count`. Handle the types you understand and ignore the rest.

For a **monophonic** instrument, keep the current pitch and a gate flag in fields and set them in the handler; for **polyphony**, keep a fixed number of voice objects in a `StaticArray` allocated in the constructor and assign notes to free voices (steal the oldest when none is free). A voice is a small undecorated class with its own phase, envelope and filter state.

## 8. Tempo sync

```ts
@transport tempo(bpm: f64, ppq: f64, playing: bool): void { ... }
```

At most one per module. Called once per block before `block()`: the tempo, the position at the start of the block in quarter notes, and whether the transport plays. Between blocks, advance the position yourself per sample (`this.beat += bpm / (60 * sampleRate)`) and take `ppq` again when `playing`. Use it for tempo-synced LFOs, delays and sequencers; derive musical divisions from beats (a sixteenth note is 0.25 beats). The tempo does not exist without it: a module has no clock.

## 9. Making it sound right

These are the things that separate a module that works from one that clicks, rings or blows up. Apply them without being asked.

**Smoothing.** Any knob that changes a gain, a mute, a mix, a cutoff, a delay time or a pan goes through a `Smoother`: target in `block()`, `next()` in `sample()`. 5 to 20 ms for gains and mixes, 10 to 30 ms for cutoffs, 50 to 200 ms for delay times (a fast change in delay time bends the pitch). Smooth the linear gain, not the dB value. Toggles (`bool`) and `choices` are knobs too: smooth a mute with a 0/1 target; crossfade between two shapes or filter types.

**Filters.** Recompute coefficients in `block()` from the smoothed frequency, not per sample. Clamp frequency to a safe range (`min(max(f, 10), 0.45 * sampleRate)`) and Q to something finite. Use `f64` for filter state and coefficients. A filter or any feedback path should start from a defined state and clear it in `reset()`.

**Feedback.** Keep loop gain strictly below 1 (limit the feedback knob to, say, 0.95 or 0.98, or soft-clip inside the loop). Put a `DcBlocker` in a feedback loop that contains a nonlinearity. Never divide by something that can be 0.

**Aliasing.** A naive saw or square (`2 * phase - 1`) and any hard nonlinearity (clipping, folding, rectifying, bit-crushing, ring modulation by a square) create harmonics above Nyquist that fold back as inharmonic noise. For oscillators use PolyBLEP (section 11); for `tanh` soft clipping use `AdaaTanh`; otherwise keep the drive moderate and say so. There is no built-in oversampler.

**Level.** Audio is nominally within -1..1. Keep gain staging sane: normalise the sum of mixed voices, compensate drive with make-up gain, and never let an effect add large gain at its default settings. Give gains in dB with `unit: "dB"`, and a bottom of "-inf" through `minText` when the lowest value should mean silence (`this.level <= -59.9 ? 0 : dbToLin(this.level)`).

**Phase and time in `f64`.** Phases, positions and anything that accumulates small increments are `f64` and wrapped with `x -= Math.floor(x)`, so they stay exact for hours. Express every time as seconds times `sampleRate`, never as a fixed number of samples: the sample rate is 44.1 kHz, 48 kHz or 96 kHz and the sound must not change with it.

**Delay lines** (chorus, flanger, echo, reverb, Karplus-Strong): a `StaticArray<f32>` allocated in the constructor at the longest delay plus 2 samples, a write index that wraps, a fractional read with linear interpolation (`read = write - delay`, add `size` if negative, interpolate between `buffer[i]` and the next index, wrapping). Delays shorter than one sample do not work in a feedback loop; keep a minimum of 1 or 2 samples.

**Modulation.** An LFO is a `Phasor` (or an `f64` phase) at `rate` Hz with a shape function of the phase. A modulated delay or filter needs the modulator at audio rate: compute it in `sample()`. A *rate* knob is converted to a phase increment in `block()`. When a module should take an external modulation signal, add a `control` input and read it in `sample()`.

**Stereo.** Two inputs, two outputs, one state object per channel. Decorrelate stereo modulation by offsetting the right LFO's phase (for example by a quarter or half cycle).

**Meters.** Add `@probe` fields for anything worth watching (input and output level with `PeakHold`, gain reduction, an LFO, an envelope) when it helps; they cost almost nothing.

**Defaults.** Choose defaults that give a useful sound at once: effects at about 50 % mix or a clearly audible setting, a filter open enough to hear the input, an oscillator at a moderate level.

## 10. Two complete examples

A modulated delay effect with an LFO, a delay line, smoothing, a meter and a block-rate/audio-rate split:

```ts
import { Phasor, Smoother, DcBlocker } from "./bleep/dsp";

/** A flanger: a short delay swept by an LFO, mixed back with the dry signal. */
@module({ name: "Flanger", category: "Effects/Script", colour: "#38bdf8" })
export class Flanger {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Rate", min: 0.05, max: 10, init: 0.4, map: "exp", unit: "Hz", decimals: 2 }) rate: f32 = 0.4;
  @param({ name: "Depth", min: 0, max: 1, init: 0.6 }) depth: f32 = 0.6;
  @param({ name: "Delay", min: 0.1, max: 8, init: 2, unit: "ms", decimals: 2 }) delayMs: f32 = 2;
  @param({ name: "Feedback", min: -0.95, max: 0.95, init: 0.5 }) feedback: f32 = 0.5;
  @param({ name: "Mix", min: 0, max: 1, init: 0.5 }) mix: f32 = 0.5;
  @probe lfo: f32 = 0;

  private lfoPhase: Phasor;
  private buffer: StaticArray<f32>;
  private size: i32;
  private write: i32 = 0;
  private center: Smoother;     // the base delay in samples
  private sweep: Smoother;      // how far the LFO moves it, in samples
  private fb: Smoother;
  private wet: Smoother;
  private dc: DcBlocker;
  private sampleRate: f64;

  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    const size = <i32>(sampleRate * 0.02) + 4;             // 20 ms of room, and the interpolation margin
    this.size = size;
    this.buffer = new StaticArray<f32>(size);
    this.lfoPhase = new Phasor(sampleRate);
    this.center = new Smoother(sampleRate, 0.05);
    this.sweep = new Smoother(sampleRate, 0.05);
    this.fb = new Smoother(sampleRate, 0.02);
    this.wet = new Smoother(sampleRate, 0.02);
    this.dc = new DcBlocker(sampleRate, 20);
    this.center.target = <f32>(sampleRate * 0.002);
    this.center.snap();
  }

  reset(): void { this.lfoPhase.reset(); this.dc.reset(); }

  block(): void {
    const base = <f64>this.delayMs * 0.001 * this.sampleRate;
    this.lfoPhase.frequency = <f64>this.rate;
    this.center.target = <f32>base;
    this.sweep.target = <f32>(base * 0.9 * <f64>this.depth);   // never reaches 0 or below the minimum
    this.fb.target = this.feedback;
    this.wet.target = this.mix;
  }

  sample(): void {
    const p = <f64>this.lfoPhase.next();
    const m = <f32>(0.5 - 0.5 * Math.cos(2.0 * Math.PI * p));  // 0..1, starts at the shortest delay
    this.lfo = m;
    const d = max(<f32>1.0, this.center.next() - this.sweep.next() * (1 - m));   // delay in samples, at least 1
    let read = <f32>this.write - d;
    if (read < 0) read += <f32>this.size;
    const i = <i32>read;
    const frac = read - <f32>i;
    const a = this.buffer[i];
    const b = this.buffer[i + 1 >= this.size ? 0 : i + 1];
    const delayed = a + (b - a) * frac;
    const input = this.x;
    this.buffer[this.write] = this.dc.next(input + delayed * this.fb.next());
    this.write = this.write + 1 >= this.size ? 0 : this.write + 1;
    this.out = input + (delayed - input) * this.wet.next();
  }
}
```

A note-driven monophonic synth with a band-limited saw, an envelope, a filter and a note handler:

```ts
import { Phasor, Smoother, Biquad, pitchToHz, dbToLin } from "./bleep/dsp";
import { NoteEvent, NoteStream } from "./bleep/notes";

/// The PolyBLEP correction: nonzero only within one phase step of the wrap.
function polyBlep(t: f64, dt: f64): f64 {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1.0; }
  if (t > 1.0 - dt) { const x = (t - 1.0) / dt; return x * x + x + x + 1.0; }
  return 0.0;
}

@module({ name: "Mono Saw", category: "Sources/Script", colour: "#f59e0b" })
export class MonoSaw {
  @input({ name: "Notes", type: "notes" }) notes!: NoteStream;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Cutoff", min: 40, max: 16000, init: 2500, map: "exp", unit: "Hz", decimals: 0 }) cutoff: f32 = 2500;
  @param({ name: "Resonance", min: 0.5, max: 8, init: 0.9, map: "exp" }) resonance: f32 = 0.9;
  @param({ name: "Attack", min: 0.001, max: 2, init: 0.01, map: "exp", unit: "s", decimals: 3 }) attack: f32 = 0.01;
  @param({ name: "Release", min: 0.005, max: 4, init: 0.3, map: "exp", unit: "s", decimals: 3 }) release: f32 = 0.3;
  @param({ name: "Level", min: -40, max: 0, init: -9, unit: "dB", decimals: 1 }) level: f32 = -9;
  @probe env: f32 = 0;

  private osc: Phasor;
  private filter: Biquad;
  private cut: Smoother;
  private gain: Smoother;
  private step: f64 = 0;
  private velocity: f32 = 0;
  private gateOn: bool = false;
  private envelope: f32 = 0;
  private attackRate: f32 = 0;
  private releaseRate: f32 = 0;
  private sampleRate: f64;

  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    this.osc = new Phasor(sampleRate);
    this.filter = new Biquad();
    this.cut = new Smoother(sampleRate, 0.02);
    this.gain = new Smoother(sampleRate, 0.01);
    this.cut.target = 2500;
    this.cut.snap();
  }

  reset(): void { this.filter.reset(); this.envelope = 0; this.gateOn = false; }

  @on("notes") handle(n: NoteEvent): void {
    if (n.isOn && n.value > 0) {
      this.osc.frequency = pitchToHz(<f64>n.pitch);       // pow per note, not per sample: fine
      this.step = this.osc.frequency / this.sampleRate;
      this.velocity = n.value;
      this.gateOn = true;
    } else if (n.isOff || (n.isOn && n.value == 0)) {
      this.gateOn = false;
    }
  }

  block(): void {
    this.cut.target = this.cutoff;
    this.gain.target = dbToLin(this.level);
    this.attackRate = <f32>(1.0 / (<f64>this.attack * this.sampleRate));
    this.releaseRate = <f32>(1.0 / (<f64>this.release * this.sampleRate));
    this.filter.setLowpass(this.sampleRate, min(<f64>this.cut.value, 0.45 * this.sampleRate), <f64>this.resonance);
  }

  sample(): void {
    this.cut.next();
    if (this.gateOn) this.envelope = min(<f32>1.0, this.envelope + this.attackRate);
    else this.envelope = max(<f32>0.0, this.envelope - this.releaseRate * this.envelope - 0.000001);
    const t = <f64>this.osc.next();
    const saw = <f32>(2.0 * t - 1.0 - polyBlep(t, this.step));
    this.out = this.filter.next(saw) * this.envelope * this.velocity * this.gain.next();
    this.env = this.envelope;
  }
}
```

## 11. Recipes for what the library lacks

Write these yourself, inside the module file (as top-level functions or small undecorated classes).

**Random numbers**: a linear congruential generator, `u32` state, no `Math.random`:

```ts
class Noise {
  private state: u32;
  constructor(initial: u32) { this.state = initial; }
  /// White noise, -1..1.
  next(): f32 {
    this.state = this.state * 1664525 + 1013904223;
    return <f32>(<i32>this.state) / 2147483648.0;
  }
}
```

**A state-variable filter** (low-pass, band-pass, high-pass and notch from one structure; stable under fast modulation; the right choice for resonant filters that move):

```ts
class Svf {
  private ic1: f64 = 0; private ic2: f64 = 0;
  private a1: f64 = 0; private a2: f64 = 0; private a3: f64 = 0; private k: f64 = 1;
  low: f32 = 0; band: f32 = 0; high: f32 = 0;
  /// Call from block(). q is about 0.5 to 10.
  set(sampleRate: f64, frequency: f64, q: f64): void {
    const g = Math.tan(Math.PI * min(frequency, 0.45 * sampleRate) / sampleRate);
    this.k = 1.0 / max(q, 0.1);
    this.a1 = 1.0 / (1.0 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  /// Call per sample; read low, band and high afterwards (notch = low + high).
  next(x: f32): void {
    const v0 = <f64>x;
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2.0 * v1 - this.ic1;
    this.ic2 = 2.0 * v2 - this.ic2;
    this.low = <f32>v2;
    this.band = <f32>v1;
    this.high = <f32>(v0 - this.k * v1 - v2);
  }
  reset(): void { this.ic1 = 0; this.ic2 = 0; }
}
```

**A first-order allpass stage** (the building block of phasers; the coefficient `a` follows the frequency, `a = (tan(pi f / sr) - 1) / (tan(pi f / sr) + 1)`; compute it in `block()` or per sample when swept by an LFO):

```ts
class Allpass1 {
  private z: f64 = 0;
  /// y = a*x + z; z = x - a*y
  next(x: f32, a: f64): f32 {
    const y = a * <f64>x + this.z;
    this.z = <f64>x - a * y;
    return <f32>y;
  }
  reset(): void { this.z = 0; }
}
```

**An envelope** (attack and release as rates, as in the example above): a stage or a level, moved towards a target by a fixed step or by a fraction of the distance. A one-pole follower `level += (target - level) * coefficient` with `coefficient = 1 - exp(-1 / (seconds * sampleRate))` computed in `block()` gives exponential segments. Retrigger on `NOTE_ON`; do not restart from 0, continue from the current level to avoid a click.

**An envelope follower or compressor detector**: `PeakHold` for the level, or `abs(x)` smoothed by two coefficients (attack when rising, release when falling). Convert to dB with `linToDb` in `sample()` only when needed (it calls `log10`); a compressor often does the comparison in the linear domain, or in dB at block rate for a slow control signal.

**A waveshaper** : `AdaaTanh` for `tanh`. Others (hard clip `max(-1, min(1, x))`, a foldback, an asymmetric curve) are one line each; put a `DcBlocker` after an asymmetric curve and make up the gain.

**Wavetable or sine lookup**: a `StaticArray<f32>` filled in the constructor (a loop of at most 4096 iterations, so tables up to 4096 entries), read with a fractional index and `lerp`.

**Band-limited square, triangle and pulse**: PolyBLEP corrections at each edge (`square = (t < width ? 1 : -1) + polyBlep(t, dt) - polyBlep((t + 1 - width) % 1, dt)`), a triangle by leaky-integrating the square.

**Tempo-synced LFO or delay**: section 8; a quarter-note delay in samples is `60 / bpm * sampleRate`.

## 12. Patch scripts (only on request)

A *patch script* builds a cell of existing modules and cables from TypeScript at compile time, instead of writing DSP. Use it only if the user asks for something like "a patch with 100 detuned oscillators into a filter". It has no `@module`, ends in `export default cell(...)`, and runs once:

```ts
export default cell("Stack", { description: "Three oscillators into a filter." }, (c) => {
  c.input("pitch", "Pitch", "pitch");
  c.stereoOut();
  const filter = c.add("filter", { cutoff: 2000 });
  for (let i = 0; i < 3; i++) {
    const osc = c.add("oscillator", { coarse: i * 7, shape: 0.2 });
    c.cable(c.cin, "pitch", osc, "pitch");
    c.cable(osc, "saw", filter, "l", 0.5);
  }
  c.stereo(filter, c.cout);
});
```

`cell(name, options, build)`; `options.settings` as for modules; the builder `c` has `input(id, name, type)`, `output(id, name, type)`, `stereoIn()`, `stereoOut()`, `add(type, values, opts)` (module type id and knob values in their own units; returns a handle), `cable(from, fromJack, to, toJack, amount)` (amount -1..1, a cable can also end at a modulatable knob), `stereo(from, to)`, `place(handle, x, y)`, `cin`, `cout`. Module type ids and knob ids must exist on the user's board; if you do not know them, say so instead of guessing, because a wrong id is a compile error.

## 13. Check before you answer

Go through this list on your code. Fix what fails before you reply.

1. One class with `@module`, a `constructor(sampleRate: f64)`, only `./bleep/dsp` and `./bleep/notes` imported.
2. Every `new` is in the constructor. No `push`, `slice`, strings, `Map`, closures, recursion or `Math.random` in `block()`, `sample()`, `reset()` or handlers.
3. Every loop has a literal, `const` or setting bound, and at most 4096 iterations. No loop over a whole second of audio.
4. Types agree: no `f32` mixed with `f64` or `i32` without a cast; `Math.*` calls take `<f64>` and are cast back with `<f32>`; typed locals (`let s: f32 = 0;`).
5. Every `@param` has `min` and `max` (numbers) or `choices`; `init` equals the field's initial value; both are inside the range; `exp` has `min > 0`.
6. Expensive calls (`pow`, `exp`, `tan`, `sin` for coefficients, `pitchToHz`, `dbToLin`, `setLowpass`...) are in `block()`, not `sample()` (unless they must follow an audio-rate modulator).
7. Every knob that reaches the signal path through a gain, mix, mute, frequency or delay time goes through a `Smoother`.
8. Nothing can blow up: feedback below 1, no division by zero, frequencies clamped below Nyquist, state cleared in `reset()`, no NaN from `log(0)` or `sqrt` of a negative.
9. Time-based values come from `sampleRate`, not from a fixed number of samples.
10. Sensible defaults: it makes a useful sound the moment it is added.
11. The reply is the complete file in one code block, followed by a short note on the knobs and the choices you made.

# The request

The user's request for the module follows in their next message.
~~~~
