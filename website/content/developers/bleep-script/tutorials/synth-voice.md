---
title: "Tutorial: a synth voice"
description: Build a monophonic supersaw voice from the library, step by step: oscillator, filter, envelope, notes, chorus.
order: 80
---

# Tutorial: a synth voice

This tutorial builds the **Synth voice** example (in the Code node's example list, and as `patch/script/src/synth-voice.dsp.ts`) one piece at a time. Each step is a complete module you can paste into the Code node and compile. You need the [quickstart](../quickstart.md) first. Everything used here is in the [library](../library.md).

## 1. An oscillator

The simplest sound is a saw wave. A naive saw (`2 * phase - 1`) aliases audibly above a few hundred Hz, so use `sawBlep`, which corrects the waveform at its jump:

```ts
import { sawBlep } from "./bleep/osc";

@module({ name: "Saw", category: "Utility/Script" })
export class Saw {
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Pitch", min: 30, max: 2000, init: 110, map: "exp", unit: "Hz", decimals: 1 }) pitch: f32 = 110;

  private phase: f64 = 0;
  private sampleRate: f64;
  constructor(sampleRate: f64) { this.sampleRate = sampleRate; }

  sample(): void {
    const dt = <f64>this.pitch / this.sampleRate;      // phase step of one sample
    this.phase += dt;
    if (this.phase >= 1.0) this.phase -= 1.0;
    this.out = sawBlep(this.phase, dt) * 0.3;
  }
}
```

Two habits to notice: the phase is an `f64` (an `f32` phase loses precision within seconds), and `dt` is passed to `sawBlep` because the correction depends on how far the phase moves per sample.

## 2. Seven oscillators

`Supersaw` is a stack of detuned band-limited saws. Create it in the constructor, set the detune in `block()` (it computes a `pow` per voice), and call `next(frequency)` per sample:

```ts
import { Supersaw } from "./bleep/osc";

// in the class:
private saw: Supersaw;
constructor(sampleRate: f64) { this.saw = new Supersaw(sampleRate, 7, 20.0); }
block(): void { this.saw.setDetune(<f64>this.detune); }
sample(): void { this.out = this.saw.next(<f64>this.pitch) * 0.6; }
```

## 3. A filter

A ladder low-pass makes it warm. `set` computes an `exp`, so set the filter from `block()`:

```ts
import { LadderFilter } from "./bleep/filters";

private filter: LadderFilter = new LadderFilter();
block(): void { this.filter.set(this.sampleRate, <f64>this.cutoff, <f64>this.resonance); }
sample(): void { this.out = this.filter.next(this.saw.next(<f64>this.pitch)) * 0.6; }
```

## 4. An envelope

An `Adsr` turns a gate into a level. Give it its times in `block()` and feed it the gate every sample:

```ts
import { Adsr } from "./bleep/env";

private env: Adsr;                       // new Adsr(sampleRate) in the constructor
block(): void { this.env.set(<f64>this.attack, <f64>this.decay, <f64>this.sustain, <f64>this.release); }
sample(): void { const e = this.env.next(this.gate); /* ... * e */ }
```

To make the filter follow the envelope, read the envelope's last value in `block()` and open the cutoff by up to five octaves (`fastExp2` is 2 to the power of its argument):

```ts
const cutoff = <f64>this.cutoff * <f64>fastExp2(this.envAmount * 5.0 * this.env.value);
this.filter.set(this.sampleRate, cutoff, <f64>this.resonance);
```

The filter then moves in steps of one chunk (32 samples, under a millisecond), which sounds smooth, and the `exp` runs once per chunk instead of once per sample. This is the usual way to put a slow modulation on a filter.

## 5. Notes

A `notes` input delivers events to an `@on` handler (see [Events and routing](../events.md)). The handler sets the pitch and the gate; `midiToHz` converts the note number. A `Smoother` on the pitch gives a short glide between notes:

```ts
import { NoteEvent, NoteStream } from "./bleep/notes";
import { midiToHz } from "./bleep/util";
import { Smoother } from "./bleep/dsp";

@input({ name: "Notes", type: "notes" }) notes!: NoteStream;

@on("notes") play(n: NoteEvent): void {
  if (n.isOn) { this.note = n.note; this.pitch.target = <f32>midiToHz(<f64>n.note); this.gate = 1.0; }
  else if (n.isOff && n.note == this.note) this.gate = 0.0;      // only the last note can release it
}
```

## 6. Chorus, and the whole thing

`Chorus` thickens the sum. Its `mix` is set in `block()`, `next(x)` in `sample()`. Put together, `sample()` is four lines:

```ts
sample(): void {
  const e = this.env.next(this.gate);
  const tone = this.saw.next(<f64>this.pitch.next());
  const filtered = this.filter.next(tone);
  this.out = this.fx.next(filtered * e * 0.6);
}
```

The full source is the **Synth voice** example. Compile it, cable a keyboard or a sequencer into **Notes**, and turn the knobs.

## Where to go from here

- Swap `Supersaw` for `FmOp` (two operators make a bell), a `Wavetable`, or `KarplusStrong` for a plucked string.
- Put a `Reverb` or `TapeDelay` after the chorus; mix the effect with the dry signal yourself.
- Put an `Oversampler2x` around a `softClip` for a driven sound that does not alias.
- Drive a `Clock` and `Lfo` for a tempo-synced filter wobble.
