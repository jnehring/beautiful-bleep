---
title: Events and routing
description: Notes jacks and @on handlers: react to note events and control edges at their exact sample, with a router example.
order: 40
---

# Events and routing

Some things happen at a moment, not continuously: a key goes down, a gate rises. A module script handles them with `@on` methods. The engine runs them **at the sample where the event happened**, in order with `sample()`, so timing is exact.

## Notes

A notes jack carries a stream of note events. Declare it with `type: "notes"` and the `NoteStream` type, imported from the library:

```ts
import { NoteEvent, NoteStream } from "./bleep/notes";

@module({ name: "Router", category: "Utility/Script" })
export class Router {
  @input({ name: "Notes", type: "notes" }) notes!: NoteStream;
  @output({ name: "Low", type: "notes" }) low!: NoteStream;
  @output({ name: "High", type: "notes" }) high!: NoteStream;
  constructor(sampleRate: f64) {}

  @on("notes") route(n: NoteEvent): void {
    if (n.pitch < 0) {
      this.low.push(n);
    } else {
      n.transpose(12);
      this.high.push(n);
    }
  }
}
```

`@on("notes")` names the **input field**. The method is called once per event arriving on that jack, with the event. Whatever you `push` goes out of that output jack at the same sample. A notes jack cannot have a `count`.

### `NoteEvent`

| Field | Meaning |
|---|---|
| `type` | `0` note on, `1` note off, `2` pressure, `3` control change, `4` program change, `5` pitch bend, `6` channel pressure, `7` realtime message. Constants: `NOTE_ON`, `NOTE_OFF`, … |
| `channel` | MIDI channel, 0 to 15 |
| `offset` | The sample inside the block where it happens |
| `note` | The MIDI note number (for types 3 to 7, the controller or program number, 0, 0 or the status byte) |
| `pitch` | Pitch in volts: 1.0 is one octave, 0 is C4 |
| `value` | Velocity or pressure from 0 to 1; for a control change the data divided by 127; for a bend −1 to +1 |

Helpers: `isOn`, `isOff`, `isCc`, and `transpose(semitones)`, which shifts `note` and `pitch` together. Handle the types you know and ignore the rest: `if (n.isOn) { … }`.

### `NoteStream`

| Member | Meaning |
|---|---|
| `length` | Events waiting on this jack (at most 64 per block) |
| `read(i, into)` | Copies event `i` into a `NoteEvent` you own |
| `push(e)` | Sends an event; dropped silently when 64 are already queued |
| `clear()` | Forgets the queued events (an output starts every block empty) |

You rarely need more than `push`: the handler already gets each incoming event.

## Control edges

Handlers also fire when a control, gate or trigger signal crosses a level:

```ts
@input({ name: "CC", type: "control" }) cc1: f32 = 0;
@output({ name: "Gate", type: "gate" }) gate: f32 = 0;

@on("cc1", { rising: 0.5 })  open(): void  { this.gate = 1; }
@on("cc1", { falling: 0.5 }) close(): void { this.gate = 0; }
```

A rising edge fires on the sample where the signal goes from below the level to at or above it; a falling edge the other way round. Give exactly one of `rising` and `falling`. The first block never fires an edge: the previous value is taken from the first sample.

## Order within a sample

For each sample, in this order: inputs are set, note events at this sample are handled, edge handlers run, then `sample()` runs, then outputs are read. `block()` runs once before the first sample, and sees each input at its first sample of the block.

## Cost

Handlers count in the [cost estimate](limits.md#the-cost-estimate) at their worst case: a note handler is assumed to run for 64 events per block, an edge handler for every sample.

## The router example

The *Note router* example in the Code node's *Examples* menu is the module above with a control edge as well: notes below middle C go out *Low*, the others go out *High* an octave up, and a control above 0.5 opens a gate. Cable a Keyboard's *Notes* into it and press keys: the *Count* meter counts events.
