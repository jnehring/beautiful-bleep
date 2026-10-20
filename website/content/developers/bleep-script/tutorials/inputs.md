---
title: Processing different inputs
description: How to read each signal type: audio, control, pitch, gate, trigger and notes, with a small complete module for each.
order: 50
---

# Processing different inputs

Every jack has a **type**, and the type tells you how to read it. The first five (`audio`, `control`, `pitch`, `gate`, `trigger`) are all just an `f32` that holds the signal's value at the current sample. What differs is what the values **mean**, and which tool fits: read the value directly, watch it for an **edge**, or treat it as a **pitch**. The sixth, `notes`, is not a signal at all but a list of events.

| Type | What the value is | Read it with |
|---|---|---|
| `audio` | A waveform, usually −1 to 1 | The field in `sample()` |
| `control` | A slowly moving value (an LFO, an envelope, a knob) | The field in `sample()` or `block()` |
| `pitch` | A pitch in volts: 1.0 is an octave, 0 is C4 | The field, converted with `pitchToHz` |
| `gate` | High (0.5 or more) while something is held | `@on(..., { rising })` and `{ falling }`, or the level |
| `trigger` | A short pulse | `@on(..., { rising })` |
| `notes` | Note events with an exact sample | `@on("jack")` with a `NoteEvent` |

Remember the [rates](../rates.md): in `sample()` an input field holds **this sample**; in `block()` it holds the **first sample of the block**.

## Audio: an envelope follower

Audio is processed per sample. This module turns audio into a control signal that follows its level, using a peak meter with a release time:

```ts compile
import { PeakHold } from "./bleep/dsp";

@module({ name: "Follower", category: "Utility/Script" })
export class Follower {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Level", type: "control", bipolar: false }) level: f32 = 0;
  @param({ name: "Release", min: 0.005, max: 2, init: 0.15, map: "exp", unit: "s", decimals: 3 }) release: f32 = 0.15;
  @param({ name: "Gain", min: 0, max: 10, init: 1 }) gain: f32 = 1;

  private peak: PeakHold;
  private sampleRate: f64;
  constructor(sampleRate: f64) { this.sampleRate = sampleRate; this.peak = new PeakHold(sampleRate, 0.15); }

  sample(): void { this.level = this.peak.next(this.x) * this.gain; }
}
```

The `PeakHold` rises at once and falls with the time you gave it. (Its time is fixed when it is made. To make `Release` a knob, compute a decay from the knob once per block, as the [sample and hold](sample-and-hold.md) does for its glide.)

## Pitch: transpose and convert

A `pitch` signal is in **volts per octave**: adding 1.0 goes up an octave, adding 1/12 goes up a semitone, and 0 is C4 (261.63 Hz). That makes transposing a plain addition:

```ts compile
import { Smoother, pitchToHz } from "./bleep/dsp";

@module({ name: "Transpose", category: "Utility/Script" })
export class Transpose {
  @input({ name: "Pitch", type: "pitch" }) pitch: f32 = 0;
  @output({ name: "Pitch", type: "pitch" }) out: f32 = 0;
  @output({ name: "Hz", type: "control", bipolar: false }) hz: f32 = 0;
  @param({ name: "Semitones", min: -24, max: 24, init: 0 }) semitones: i32 = 0;
  @param({ name: "Fine", min: -100, max: 100, init: 0, unit: "cents", decimals: 0 }) fine: f32 = 0;

  private shift: Smoother;
  constructor(sampleRate: f64) { this.shift = new Smoother(sampleRate, 0.005); }

  block(): void { this.shift.target = <f32>(<f64>this.semitones / 12.0 + <f64>this.fine / 1200.0); }

  sample(): void {
    const v = this.pitch + this.shift.next();
    this.out = v;
    this.hz = <f32>pitchToHz(<f64>v);
  }
}
```

Two things: the offset is **smoothed** so a knob change does not step the pitch (a stepped pitch is a click on the oscillator after it), and `pitchToHz` is the conversion for anything that needs a frequency. It uses `pow`, so call it per block when you can, per sample only when the pitch itself is modulated.

## Gate and trigger: edges

A `gate` is high while a key is held; a `trigger` is a short pulse. Both are **edges you react to**. Do not compare the level in `sample()` every sample and remember the previous value yourself: declare `@on` handlers and the engine does it for you, at the exact sample.

```ts compile
@module({ name: "Gate Envelope", category: "Utility/Script", description: "Rises while a gate is high and falls when it ends. A trigger restarts it." })
export class GateEnvelope {
  @input({ name: "Gate", type: "gate" }) gate: f32 = 0;
  @input({ name: "Retrigger", type: "trigger" }) retrigger: f32 = 0;
  @output({ name: "Env", type: "control", bipolar: false }) env: f32 = 0;
  @output({ name: "Eoc", type: "trigger" }) eoc: f32 = 0;     // a pulse when the release ends
  @param({ name: "Attack", min: 0.001, max: 2, init: 0.01, map: "exp", unit: "s", decimals: 3 }) attack: f32 = 0.01;
  @param({ name: "Release", min: 0.001, max: 4, init: 0.3, map: "exp", unit: "s", decimals: 3 }) release: f32 = 0.3;

  private level: f32 = 0;
  private up: f32 = 0;              // the step per sample while the gate is high
  private down: f32 = 0;
  private high: bool = false;
  private pulse: i32 = 0;
  private sampleRate: f64;
  constructor(sampleRate: f64) { this.sampleRate = sampleRate; }

  @on("gate", { rising: 0.5 })  open(): void  { this.high = true; }
  @on("gate", { falling: 0.5 }) close(): void { this.high = false; }
  @on("retrigger", { rising: 0.5 }) again(): void { this.level = 0; }

  block(): void {
    this.up = <f32>(1.0 / (this.sampleRate * <f64>this.attack));
    this.down = <f32>(1.0 / (this.sampleRate * <f64>this.release));
  }

  sample(): void {
    if (this.high) this.level = min(1, this.level + this.up);
    else if (this.level > 0) {
      this.level = max(0, this.level - this.down);
      if (this.level == 0) this.pulse = 48;          // end of cycle: a short pulse
    }
    this.eoc = this.pulse > 0 ? 1 : 0;
    if (this.pulse > 0) this.pulse--;
    this.env = this.level;
  }
}
```

A rising edge happens on the sample where the signal goes from below the level to at or above it, so a gate and a retrigger that arrive together are both seen at the right sample. A cable that is not connected reads 0, and the first block never fires an edge.

Use `0.5` as the level for gates and triggers: it is the board's own threshold (a gate is high at 0.5 or more).

## Notes: events with a sample position

A `notes` input is a list of events, not a stream of values. Each event arrives in its `@on` handler, at the sample where it belongs. This module turns notes into a monophonic **pitch, gate and velocity**, last note wins:

```ts compile
import { NoteEvent, NoteStream } from "./bleep/notes";

@module({ name: "Mono Note", category: "Utility/Script", description: "Notes to pitch, gate and velocity." })
export class MonoNote {
  @input({ name: "Notes", type: "notes" }) notes!: NoteStream;
  @output({ name: "Pitch", type: "pitch" }) pitch: f32 = 0;
  @output({ name: "Gate", type: "gate" }) gate: f32 = 0;
  @output({ name: "Velocity", type: "control", bipolar: false }) velocity: f32 = 0;

  private held: StaticArray<i32> = new StaticArray<i32>(16);    // the notes that are down, in the order they were pressed
  private count: i32 = 0;
  constructor(sampleRate: f64) {}

  @on("notes") handle(n: NoteEvent): void {
    if (n.isOn && n.value > 0) {
      this.remove(n.note);                                       // a repeated note goes to the top
      if (this.count < 16) { this.held[this.count] = n.note; this.count++; }
      this.pitch = n.pitch;
      this.velocity = n.value;
      this.gate = 1;
    } else if (n.isOff || (n.isOn && n.value == 0)) {
      this.remove(n.note);
      if (this.count == 0) this.gate = 0;                        // the last key went up
      else this.pitch = <f32>(this.held[this.count - 1] - 60) / 12.0;   // back to the key still down
    }
  }

  private remove(note: i32): void {
    let to = 0;
    for (let i = 0; i < 16; i++) {
      if (i >= this.count) break;
      if (this.held[i] != note) { this.held[to] = this.held[i]; to++; }
    }
    this.count = to;
  }
}
```

`n.pitch` is already in volts, `n.note` is the MIDI number, `n.value` the velocity from 0 to 1. Notes to *other* notes (a transposer, a router, an arpeggiator) push events instead: see [Events and routing](../events.md).

The fixed-size `StaticArray` and the bounded loop are the usual way to keep a list in real-time code: there is no growing array in `sample()` or a handler.

## Several inputs of one kind

`count` makes numbered jacks, and the field is a `StaticArray`. Read them in a loop with a constant bound. See [Module scripts](../module-scripts.md#settings-and-counted-jacks) and the *Mixer* example.

## Summary

- `audio`, `control`, `pitch`: read the field. `gate`, `trigger`: add an edge handler. `notes`: a note handler.
- Do derived work (coefficients, conversions) in `block()`, and per-sample work in `sample()`.
- Smooth anything that steps ([smoothing](smoothing.md)).
