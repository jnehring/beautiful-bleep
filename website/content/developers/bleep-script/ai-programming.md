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

- If you ask for a custom look (a drawn curve, your own meters), it writes the **UI tab** too: a second code block of JavaScript that you paste into the Code node's UI tab, next to the module in the Script tab. Without such a request it leaves the standard controls alone, or arranges them with a layout.
- The assistant writes a **module script** (one module: a class with `sample()` and knobs), because that is what nearly every request needs. If you ask for a patch built from existing modules, say so, and it writes a **patch script** instead.
- It can only use what the Bleep Script library offers. The library covers oscillators, filters, delays, noise, envelopes and LFOs, dynamics, effects, an FFT and helpers; anything else (a vocoder, convolution, granular) it writes inside the module, which takes more code and may need a round of fixes. That is normal and takes a few lines.
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
- No imports except `./bleep/dsp`, `./bleep/notes` and `./bleep/env`. No other files, no build setup.
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
- **Not available at all:** `Math.random()` (use `Xorshift` from `./bleep/random`), the clock, files, network, `console`.
- Helper functions and constants at the top level of the file are fine (`function polyBlep(...)`, `const TWO_PI: f64 = 6.283185307179586;`) and so are helper classes that are not decorated: plain classes holding the state of one voice, one channel, one allpass stage.
- Private fields: `private phase: f64 = 0;`. Methods are plain methods.

## 5. What the compiler refuses in the audio code

The checker walks `block()`, `sample()`, `reset()`, the `@on` handlers and everything they call. It refuses, with a message naming the line:

- recursion, closures, exceptions, regular expressions;
- anything that allocates or copies at run time: `new` anywhere outside the constructor, `push`, `map`, `filter`, `concat`, `slice`, `split`, string building, `Array` growth, `Map` and `Set`;
- calls to anything except your own functions, `Math`, the built-ins above and the `bleep/` libraries;
- `declare`, and these **names, anywhere, even as your own variable or parameter**: `load`, `store`, `memory`, `changetype`, `unchecked`, `unreachable`, `abort`, `trace`, `seed`, `unsafe`, `call_indirect`, and any name starting with `__`;
- imports from anywhere but `./bleep/dsp`, `./bleep/notes` and `./bleep/env`;
- **loops without a bound the checker can see, and loops longer than 4096 iterations.** Use a literal or a `const` bound, or a setting constant: `for (let i = 0; i < 8; i++)`, `for (let i = 0; i < STAGES; i++)`. A loop over `this.something` is not accepted. If you need a variable count (say 4 to 12 stages), loop to the **maximum** with a constant bound and skip the unused iterations with an `if` or a `break`.
- **Cost:** the checker adds up the work of one 32-sample block (loops counted at their bound). More than 60,000 operations warns; more than 400,000 refuses the module. A single block-rate `Math.pow` is fine, 32 of them per block is not. Long buffers are fine as memory, but **a loop that touches a whole second of audio is not**: never clear or scan a long buffer in `reset()` or `block()`. Remember how much of it has been written (a `filled` counter) and treat older entries as zero instead.

## 6. The library

Eleven libraries exist, all inlined into your module (using them costs nothing extra). Use exactly these names and signatures; anything not listed here you write yourself inside the module (section 11 has recipes for a few things). **Prefer the library over hand-written code**: it is tested, band-limited where it matters, and safe under fast modulation.

| Import | What is in it |
|---|---|
| `./bleep/osc` | band-limited saw, pulse and triangle, fast sine, wavetables, supersaw, FM operator |
| `./bleep/filters` | one-pole, state-variable and ladder filters, resonator, formants, all-passes, comb |
| `./bleep/delay` | delay line, table interpolation, tape delay, plucked string |
| `./bleep/random` | seeded random numbers, white, pink and brown noise, sample and hold, random LFO |
| `./bleep/env` | ADSR and friends, followers, slew, LFO, ramps, triggers, tempo clock |
| `./bleep/dynamics` | compressor, limiter, gate, wave shapers, bitcrusher, oversampling |
| `./bleep/fx` | reverb, phaser, chorus, pitch shifter |
| `./bleep/fft` | a fixed-size FFT |
| `./bleep/util` | ranges, pitch conversion, fast math, pan and mid/side, RMS |
| `./bleep/dsp` | smoothing, meters, biquad filter, dB conversion |
| `./bleep/notes` | note events |

Import only the names you use, from the library that holds them:

```ts
import { dbToLin, linToDb, lerp, pitchToHz, Smoother, PeakHold, Biquad, AdaaTanh, DcBlocker, Phasor } from "./bleep/dsp";
import { NoteEvent, NoteStream, NOTE_ON, NOTE_OFF } from "./bleep/notes";
import { sawBlep, squareBlep, triangle, Wavetable, Supersaw } from "./bleep/osc";
import { Svf, LadderFilter, OnePole } from "./bleep/filters";
import { Adsr, Lfo, LFO_TRIANGLE, Clock } from "./bleep/env";
```

Rules that hold for every library class:

- **Allocate in the constructor, never in `block()` or `sample()`.** Every class that needs memory (a delay line, a table, a reverb) takes its size in its constructor and allocates then. Hold it in a `private` field.
- **`set*` and `update` methods may call `sin`, `tan`, `exp` or `pow`.** Call them in `block()`, and only when a setting changed, not in `sample()`. The `next()` methods are made for `sample()`.
- **Audio is `f32`, `Math` takes `f64`.** Phases and frequencies are `f64` where precision matters; audio samples and levels are `f32`. Frequencies are in Hz, times in seconds, levels in dB when a name says so (`thresholdDb`) and linear otherwise.

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
| `Biquad` | `new Biquad()` | `setLowpass(sampleRate, frequency, q)`, `setHighpass(sampleRate, frequency, q)`, `setBandpass(sampleRate, frequency, q)` (0 dB at the peak), `setNotch(sampleRate, frequency, q)`, `setAllpass(sampleRate, frequency, q)`, `setLowShelf(sampleRate, frequency, gainDb)`, `setHighShelf(sampleRate, frequency, gainDb)`, `setPeaking(sampleRate, frequency, q, gainDb)` (all `f64` arguments; each costs a few trig calls: call from `block()`, only when something changed), `next(x: f32): f32` (once per sample), `reset()` |
| `AdaaTanh` | `new AdaaTanh()` | `next(x: f32): f32` (`tanh` soft clipper with anti-aliasing; one call per sample, keep the call count constant), `reset()` |
| `DcBlocker` | `new DcBlocker(sampleRate, hz)` | `next(x: f32): f32` (one-pole high-pass; 20 Hz is a good value), `reset()` |
| `Phasor` | `new Phasor(sampleRate)` | `frequency: f64` (Hz, set in `block()`), `phase: f64`, `next(): f32` (returns the phase 0..1 **before** this sample's step, then advances), `reset()` |

All of these are allocated with `new` **in the constructor**, held in `private` fields, and used in `block()` and `sample()`.

### `./bleep/osc`

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

### `./bleep/filters`

```ts
import { OnePole, Svf, LadderFilter, Resonz, Formant, Allpass1, Allpass2, CombFilter } from "./bleep/filters";
```

Frequencies are clamped below Nyquist, so a modulated cutoff cannot make a filter unstable. All filters have `reset()`. For a plain low-pass, high-pass, band-pass, notch, all-pass or shelf at a fixed setting, `Biquad` is the cheapest.

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

### `./bleep/delay`

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

### `./bleep/random`

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

### `./bleep/env`: envelopes, followers, LFOs, triggers, clock

```ts
import { Adsr, Lfo, LFO_TRIANGLE, Clock } from "./bleep/env";
```

Use these instead of hand-written envelopes and LFOs. Like the `dsp` classes, allocate with `new` in the constructor, keep them in `private` fields, configure with `set*` in `block()` (only when a knob changed) and call `next(...)` once per sample in `sample()`. Times are in seconds, frequencies in Hz.

| Class | Constructor | Members |
|---|---|---|
| `Adsr` | `new Adsr(sampleRate)` | `set(attack, decay, sustain, release)` (seconds; `sustain` is a level 0..1), `next(gate: f32): f32` (the gate is on from 0.5), `value`, `active`, `currentStage` (`ENV_IDLE`, `ENV_ATTACK`, `ENV_DECAY`, `ENV_SUSTAIN`, `ENV_RELEASE`), `reset()`. Exponential curves unless `exponential = false`. A retrigger during the release attacks from the current level; `hardRetrigger = true` restarts from 0. |
| `Ar` | `new Ar(sampleRate)` | attack-release on a gate: `set(attack, release)`, `next(gate)` |
| `Ad` | `new Ad(sampleRate)` | one-shot attack-decay started by a trigger (a rising edge), plays out whatever the trigger does: `set(attack, decay)`, `next(trigger)` |
| `EnvFollower` | `new EnvFollower(sampleRate, attack, release)` | `next(x)` returns the smoothed `abs(x)`; `setTimes(attack, release)` |
| `Slew` | `new Slew(sampleRate)` | slew limiter (portamento, click-free controls): `rise` and `fall` are the fastest the output may move, in units per second; `next(x)`, `snap(x)` |
| `Lfo` | `new Lfo(sampleRate, seed)` | output -1..1. `shape` = `LFO_SINE`, `LFO_TRIANGLE`, `LFO_SAW`, `LFO_SAW_DOWN`, `LFO_SQUARE` (with `width`) or `LFO_SAMPLE_HOLD`; `next(frequency)` per sample; `sync()` restarts the cycle, `nextSync(frequency, gate)` does so on a rising gate; `phaseOffset` in cycles (use it to decorrelate a stereo pair); `uni` is the last output as 0..1 |
| `Line` | `new Line(sampleRate)` | a straight line: `set(from, to, seconds)`, `next()`, `done` |
| `Ramp` | `new Ramp(sampleRate)` | a 0..1 ramp started by a trigger: `setTime(seconds)`, `next(trigger)`, `start()` |
| `Trigger` | `new Trigger()` | `next(x)` is 1 for the one sample in which `x` rises through `threshold` (0.5), else 0 |
| `Schmitt` | `new Schmitt(low, high)` | output 0 or 1, high above `high`, low below `low`; `rose` and `fell` flag the change |
| `Clock` | `new Clock(sampleRate)` | tempo-synced phasor: `bpm` (feed it from `@transport`) and `ratio` (1 = a quarter note per cycle, 4 = sixteenths, 0.25 = a bar of 4/4); `next()` returns the phase 0..1, `ticked` is true in the sample where a cycle starts, `count`; `setBeat(beats)` aligns it with a host beat position |

Example, a filter envelope: `this.env.set(a, d, s, r)` in `block()`, then in `sample()` `const e = this.env.next(this.gate);` and use `e` (0..1) to scale the cutoff or the amplitude. Show it with `this.envLevel = e;` on a `@probe`.

### `./bleep/dynamics`

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

```text
this.os.up(x);
const y = this.os.down(hardClip(this.os.a * drive), hardClip(this.os.b * drive));
```

### `./bleep/fx`

```ts
import { Reverb, Phaser, Chorus, PitchShift } from "./bleep/fx";
```

| Name | What it does |
| --- | --- |
| `Reverb(sampleRate)` | A Freeverb reverb: mono in, stereo out. Set `roomSize`, `damping`, `width` and call `update()`; `next(x)` sets `left` and `right`. The output is the reverb only: mix it with the dry signal. It allocates about 1 MB. |
| `Phaser(sampleRate, stages = 4)` | A phaser with 2 to 12 all-pass stages swept between `minHz` and `maxHz` at `rate`. `feedback`, `mix`, `centre` (the sweep position when `rate` is 0). `next(x)`. |
| `Chorus(sampleRate, voices = 2)` | Up to 4 modulated delay voices spread across left and right. `rate`, `delayMs`, `depthMs`, `mix`. `next(x)` sets `left` and `right` and returns their mean. |
| `PitchShift(sampleRate, windowSeconds = 0.06)` | A two-tap delay-line pitch shifter. `ratio` is the frequency ratio (2 is an octave up). Good on single notes, grainy on chords. |

### `./bleep/fft`

```ts
import { Fft } from "./bleep/fft";
```

| Name | What it does |
| --- | --- |
| `Fft(size)` | A complex FFT of `size` points (a power of two) in place on the public arrays `re` and `im`. `forward()`, `inverse()` (divides by `size`), `clearImag()`, `applyHann()`, `magnitude(k)`, `phase(k)`. A transform costs about 5 size log2(size) operations: do it once per hop in `block()`, not per sample. Bin k is at `k * sampleRate / size` Hz. |

### `./bleep/util`

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

### `./bleep/notes`

`NoteEvent` fields: `type` (`NOTE_ON` 0, `NOTE_OFF` 1, `NOTE_PRESSURE` 2, `NOTE_CC` 3, `NOTE_PROGRAM` 4, `NOTE_BEND` 5, `NOTE_CHANNEL_PRESSURE` 6, `NOTE_SYSTEM` 7), `channel` (0..15), `offset` (the sample in the block), `note` (MIDI number; for controller events the controller number), `pitch` (volts, 0 is C4), `value` (velocity or pressure 0..1; control change divided by 127; bend -1..1). Members: `isOn`, `isOff`, `isCc`, `transpose(semitones)`.

`NoteStream` (the type of a `notes` jack): `length`, `read(i, into)`, `push(event)` (dropped silently when 64 are queued), `clear()`. At most 64 events per block.

### What the library does not have

Write these yourself, or say the limit: minBLEP and hard-sync oscillators (the `*Blep` shapes lose ground near Nyquist), convolution and impulse responses, vocoders, granular engines and time stretching, a feedback-delay-network reverb (`Reverb` is Freeverb; build an FDN from `DelayLine` and `Allpass1`), sample buffers (a module cannot read audio files), oversampled filters (wrap them in `Oversampler2x`), multiband compressors.

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

## 7b. The UI tab (only when asked)

By default a module shows one control per `@param`, a meter per `@probe` and a button per `@button`. Change that only if the user asks for a particular look, in one of two ways. Do nothing here for an ordinary request.

**A layout** (no code, safe, enough for most requests): a `layout` list in `@module`, arranging the standard widgets. Every id must be a param, probe or button of the module; errors are reported at compile time.

```ts
@module({
  name: "Mixer",
  settings: [{ id: "CHANNELS", name: "Channels", min: 1, max: 16, init: 4 }],
  layout: [
    { row: [
      { repeat: CHANNELS, title: "Ch {n}", column: [
        { fader: "level{n}", meter: "peak{n}" },
        "pan{n}",
        "mute{n}",
      ] },
      { title: "Master", column: [{ fader: "master", meter: "peakMaster" }] },
    ] },
  ],
})
```

Items: `"id"` (the fitting widget: knob for a number, toggle for a boolean, select for a choice, meter for a probe, button for a `@button`), `{ knob: "id" }`, `{ fader: "id", meter: "probeId" }`, `{ toggle: "id" }`, `{ select: "id" }`, `{ meter: "id" }`, `{ value: "id" }` (read-only text), `{ button: "id" }`, `{ label: "text" }`, `{ spacer: true }`, `{ row: [...] }`, `{ column: [...] }`. Any item may have `label` and `title`. A container with `repeat` (a number or a setting's name) makes one copy per channel; `{n}` in ids and titles becomes the copy number from 1. At most 400 widgets.

**A self-made UI**: the Code node has a **Script** tab (the module, everything above) and a **UI** tab. The UI tab holds plain **JavaScript** (not AssemblyScript, no types, no decorators) that draws on a canvas and talks to the module through a global `bleep` object. It is a second file: when the user wants a custom UI, deliver the module script in one ```ts block and the UI in a separate ```js block, and say which goes in which tab. The ids you use in the UI must match the module's `@param` and `@probe` field names.

```js
const level = bleep.canvas(60);            // as wide as the node, 60 px high
bleep.onFrame(() => {                      // every animation frame
  const { g, width, height } = level;      // g is a 2D canvas context
  g.clearRect(0, 0, width, height);
  g.fillStyle = bleep.theme.accent;
  g.fillRect(0, 0, width * bleep.probe("level"), height);
});
```

| Member | What it does |
|---|---|
| `bleep.params` / `bleep.param(id)` | All params / one param (throws on an unknown id). A param has `id`, `name`, `kind`, `unit`, `min`, `max`, `steps`, `choices`, `value` (in its own units), `normalised` (0..1), `set(units)` and `setNormalised(x)`. |
| `bleep.probe(id)` | The latest value of a `@probe`; 0 until the module reports one. |
| `bleep.button(id)` | Presses a `@button` method. |
| `bleep.onFrame(fn)` | Calls `fn(dt)` every animation frame, `dt` in seconds. |
| `bleep.onValues(fn)` | Calls `fn()` when a param or probe has changed. |
| `bleep.size(h)` | Asks for a height in pixels, 40..800; the width is the node's. |
| `bleep.canvas(h)` | A canvas as wide as the view and `h` high, scaled for the screen: `{ el, g, width, height }`. `bleep.canvas("fill")` also takes the view's height, so it follows resizing and fullscreen. |
| `bleep.theme` | The board's colours: `bg`, `panel`, `line`, `text`, `muted`, `accent`, `warn`. Use them so the UI fits the board. |

Rules: a UI sets at most 240 values per second (so a drag may call `param.set` freely, but not in a tight loop); it runs sandboxed, with no network, storage or access outside `bleep`, and the board asks the user before running it the first time; an error in the UI code stops the UI and is shown with its line; a loop that never ends freezes the page. Ordinary DOM (buttons, inputs, selects) may be built in the page body. To let the user drag a point or curve, read the pointer on `canvas.el` (`pointerdown`, `pointermove`) and call `bleep.param(id).setNormalised(x)`. Redraw in `onFrame` or `onValues`, never keep a second copy of the state: the params are the state.

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

**Aliasing.** A naive saw or square (`2 * phase - 1`) and any hard nonlinearity (clipping, folding, rectifying, bit-crushing, ring modulation by a square) create harmonics above Nyquist that fold back as inharmonic noise. For oscillators use `sawBlep`, `squareBlep`, `triangle`, `Wavetable` or `Supersaw` from `./bleep/osc`; for `tanh` soft clipping use `AdaaTanh`; for other non-linear steps (clipping, folding) run them between `up` and `down` of `Oversampler2x` from `./bleep/dynamics`. Oversampling costs CPU, so say so when you use it.

**Level.** Audio is nominally within -1..1. Keep gain staging sane: normalise the sum of mixed voices, compensate drive with make-up gain, and never let an effect add large gain at its default settings. Give gains in dB with `unit: "dB"`, and a bottom of "-inf" through `minText` when the lowest value should mean silence (`this.level <= -59.9 ? 0 : dbToLin(this.level)`).

**Phase and time in `f64`.** Phases, positions and anything that accumulates small increments are `f64` and wrapped with `x -= Math.floor(x)`, so they stay exact for hours. Express every time as seconds times `sampleRate`, never as a fixed number of samples: the sample rate is 44.1 kHz, 48 kHz or 96 kHz and the sound must not change with it.

**Delay lines** (chorus, flanger, echo, reverb, Karplus-Strong): use `DelayLine` from `./bleep/delay` (or the ready-made `TapeDelay`, `KarplusStrong`, `Chorus`, `Reverb`). To build one by hand: a `StaticArray<f32>` allocated in the constructor at the longest delay plus 2 samples, a write index that wraps, a fractional read with linear interpolation (`read = write - delay`, add `size` if negative, interpolate between `buffer[i]` and the next index, wrapping). Delays shorter than one sample do not work in a feedback loop; keep a minimum of 1 or 2 samples.

**Modulation.** An LFO is a `Phasor` (or an `f64` phase) at `rate` Hz with a shape function of the phase. A modulated delay or filter needs the modulator at audio rate: compute it in `sample()`. A *rate* knob is converted to a phase increment in `block()`. When a module should take an external modulation signal, add a `control` input and read it in `sample()`.

**Stereo.** Two inputs, two outputs, one state object per channel. Decorrelate stereo modulation by offsetting the right LFO's phase (for example by a quarter or half cycle).

**Meters.** Add `@probe` fields for anything worth watching (input and output level with `PeakHold`, gain reduction, an LFO, an envelope) when it helps; they cost almost nothing.

**Defaults.** Choose defaults that give a useful sound at once: effects at about 50 % mix or a clearly audible setting, a filter open enough to hear the input, an oscillator at a moderate level.

## 10. Two complete examples

A modulated delay effect built from library parts (`Lfo`, `DelayLine`, `Smoother`, `DcBlocker`), with a meter and a block-rate/audio-rate split:

```ts
import { Smoother, DcBlocker } from "./bleep/dsp";
import { Lfo } from "./bleep/env";
import { DelayLine } from "./bleep/delay";

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

  private lfoOsc: Lfo;
  private line: DelayLine;
  private center: Smoother;     // the base delay in samples
  private sweep: Smoother;      // how far the LFO moves it, in samples
  private fb: Smoother;
  private wet: Smoother;
  private dc: DcBlocker;
  private sampleRate: f64;

  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    this.lfoOsc = new Lfo(sampleRate);                       // a sine, -1..1
    this.line = new DelayLine(<i32>(sampleRate * 0.02));     // 20 ms of room
    this.center = new Smoother(sampleRate, 0.05);
    this.sweep = new Smoother(sampleRate, 0.05);
    this.fb = new Smoother(sampleRate, 0.02);
    this.wet = new Smoother(sampleRate, 0.02);
    this.dc = new DcBlocker(sampleRate, 20);
    this.center.target = <f32>(sampleRate * 0.002);
    this.center.snap();
  }

  reset(): void { this.lfoOsc.reset(); this.line.reset(); this.dc.reset(); }

  block(): void {
    const base = <f64>this.delayMs * 0.001 * this.sampleRate;
    this.center.target = <f32>base;
    this.sweep.target = <f32>(base * 0.9 * <f64>this.depth);   // never reaches 0 or below the minimum
    this.fb.target = this.feedback;
    this.wet.target = this.mix;
  }

  sample(): void {
    this.lfoOsc.next(<f64>this.rate);
    const m = this.lfoOsc.uni;                                  // 0..1
    this.lfo = m;
    const d = max(<f32>1.0, this.center.next() - this.sweep.next() * (1 - m));   // delay in samples, at least 1
    const delayed = this.line.readCubic(d);                    // read before writing: the line holds the past
    const input = this.x;
    this.line.write(this.dc.next(input + delayed * this.fb.next()));
    this.out = input + (delayed - input) * this.wet.next();
  }
}
```

A note-driven monophonic synth with a band-limited saw (`sawBlep`), an ADSR, a state-variable filter and a note handler:

```ts
import { Phasor, Smoother, pitchToHz, dbToLin } from "./bleep/dsp";
import { NoteEvent, NoteStream } from "./bleep/notes";
import { sawBlep } from "./bleep/osc";
import { Svf } from "./bleep/filters";
import { Adsr } from "./bleep/env";

@module({ name: "Mono Saw", category: "Sources/Script", colour: "#f59e0b" })
export class MonoSaw {
  @input({ name: "Notes", type: "notes" }) notes!: NoteStream;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Cutoff", min: 40, max: 16000, init: 2500, map: "exp", unit: "Hz", decimals: 0 }) cutoff: f32 = 2500;
  @param({ name: "Resonance", min: 0.5, max: 8, init: 0.9, map: "exp" }) resonance: f32 = 0.9;
  @param({ name: "Attack", min: 0.001, max: 2, init: 0.01, map: "exp", unit: "s", decimals: 3 }) attack: f32 = 0.01;
  @param({ name: "Decay", min: 0.005, max: 4, init: 0.2, map: "exp", unit: "s", decimals: 3 }) decay: f32 = 0.2;
  @param({ name: "Sustain", min: 0, max: 1, init: 0.8 }) sustain: f32 = 0.8;
  @param({ name: "Release", min: 0.005, max: 4, init: 0.3, map: "exp", unit: "s", decimals: 3 }) release: f32 = 0.3;
  @param({ name: "Level", min: -40, max: 0, init: -9, unit: "dB", decimals: 1 }) level: f32 = -9;
  @probe env: f32 = 0;

  private osc: Phasor;
  private filter: Svf;
  private adsr: Adsr;
  private cut: Smoother;
  private gain: Smoother;
  private step: f64 = 0;
  private velocity: f32 = 0;
  private gate: f32 = 0;
  private sampleRate: f64;

  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    this.osc = new Phasor(sampleRate);
    this.filter = new Svf();
    this.adsr = new Adsr(sampleRate);
    this.cut = new Smoother(sampleRate, 0.02);
    this.gain = new Smoother(sampleRate, 0.01);
    this.cut.target = 2500;
    this.cut.snap();
  }

  reset(): void { this.filter.reset(); this.adsr.reset(); this.gate = 0; }

  @on("notes") handle(n: NoteEvent): void {
    if (n.isOn && n.value > 0) {
      this.osc.frequency = pitchToHz(<f64>n.pitch);       // pow per note, not per sample: fine
      this.step = this.osc.frequency / this.sampleRate;
      this.velocity = n.value;
      this.gate = 1;
    } else if (n.isOff || (n.isOn && n.value == 0)) {
      this.gate = 0;
    }
  }

  block(): void {
    this.cut.target = this.cutoff;
    this.gain.target = dbToLin(this.level);
    this.adsr.set(<f64>this.attack, <f64>this.decay, <f64>this.sustain, <f64>this.release);
    this.filter.set(this.sampleRate, <f64>this.cut.value, <f64>this.resonance);   // clamped below Nyquist by the library
  }

  sample(): void {
    this.cut.next();
    const e = this.adsr.next(this.gate);
    this.filter.tick(sawBlep(<f64>this.osc.next(), this.step));
    this.out = this.filter.low * e * this.velocity * this.gain.next();
    this.env = e;
  }
}
```

## 11. Recipes for what the library lacks

**Look in section 6 first**: the library has random numbers and noise (`Xorshift`, `WhiteNoise`, `PinkNoise`), state-variable, ladder, one-pole and all-pass filters, delay lines, envelopes, followers, wavetables, band-limited oscillators and wave shapers. Use these recipes only for what no library class does, or for a deliberately different shape. Write them inside the module file (as top-level functions or small undecorated classes).

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

**A simple envelope** (prefer `Adsr`, `Ar` or `Ad` from `./bleep/env`; hand-roll only for a special shape; attack and release as rates, as in the example above): a stage or a level, moved towards a target by a fixed step or by a fraction of the distance. A one-pole follower `level += (target - level) * coefficient` with `coefficient = 1 - exp(-1 / (seconds * sampleRate))` computed in `block()` gives exponential segments. Retrigger on `NOTE_ON`; do not restart from 0, continue from the current level to avoid a click.

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

1. One class with `@module`, a `constructor(sampleRate: f64)`, only `./bleep/dsp`, `./bleep/notes` and `./bleep/env` imported.
2. Every `new` is in the constructor. No `push`, `slice`, strings, `Map`, closures, recursion or `Math.random` in `block()`, `sample()`, `reset()` or handlers.
3. Every loop has a literal, `const` or setting bound, and at most 4096 iterations. No loop over a whole second of audio.
4. Types agree: no `f32` mixed with `f64` or `i32` without a cast; `Math.*` calls take `<f64>` and are cast back with `<f32>`; typed locals (`let s: f32 = 0;`).
5. Every `@param` has `min` and `max` (numbers) or `choices`; `init` equals the field's initial value; both are inside the range; `exp` has `min > 0`.
6. Expensive calls (`pow`, `exp`, `tan`, `sin` for coefficients, `pitchToHz`, `dbToLin`, `setLowpass`...) are in `block()`, not `sample()` (unless they must follow an audio-rate modulator).
7. Every knob that reaches the signal path through a gain, mix, mute, frequency or delay time goes through a `Smoother`.
8. Nothing can blow up: feedback below 1, no division by zero, frequencies clamped below Nyquist, state cleared in `reset()`, no NaN from `log(0)` or `sqrt` of a negative.
9. Time-based values come from `sampleRate`, not from a fixed number of samples.
10. Sensible defaults: it makes a useful sound the moment it is added.
11. The reply is the complete file in one code block (plus one ```js block for the UI tab only if a self-made UI was asked for), followed by a short note on the knobs and the choices you made.

# The request

The user's request for the module follows in their next message.
~~~~
