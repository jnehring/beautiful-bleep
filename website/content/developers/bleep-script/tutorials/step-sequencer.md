---
title: An 8-step, 4-lane step sequencer
description: Build a step sequencer with four lanes of eight steps and four gate outputs, that runs from the host tempo or from a clock input, step by step.
order: 10
---

# An 8-step, 4-lane step sequencer

This tutorial builds a **step sequencer** with four lanes of eight steps. Each lane has its own gate output, so one pattern can play a kick, a snare, a hat and an accent. It can run from the **host tempo** or from a **clock input**, and a reset input starts the pattern again.

It uses most of what the other pages teach: [rates](../rates.md), a `@transport` method, edge handlers, counted outputs and a widget layout.

## The design

- **Inputs:** *Clock* and *Reset*, both triggers.
- **Outputs:** four gates, one per lane.
- **Knobs:** *Source* (tempo or clock in), *Division* (how long a step is when following the tempo), *Steps* (the pattern length, 1 to 8), *Pulses per step* (how many clock pulses make one step), *Gate length* (a fraction of the step).
- **Pattern:** 32 toggles, eight per lane.

Two questions drive the code: *when does a new step begin*, and *when does its gate end*.

### When a step begins

| Source | A step begins when |
|---|---|
| **Tempo** | the position in beats, times the steps per beat, passes a whole number. The module counts the position itself, per sample, and takes the host's value (`ppq`) at the start of each block |
| **Clock in** | a rising edge arrives on *Clock* (and `pulses` of them have gone by) |

In both cases the module calls the same method, `begin(n)`, which opens the gates of the lanes that have step `n` switched on.

### When a gate ends

A gate should be high for a **fraction of the step**, so the module needs to know how long a step lasts, in samples. Following the tempo, that is `sampleRate * 60 / (bpm * stepsPerBeat)`. Following a clock, it is **measured**: the time between two pulses, times the pulses per step. The gate closes when the time since the step began passes `stepSamples * gateLength`.

## The module

```ts compile
@module({
  name: "Step Sequencer 4x8",
  category: "Sequencing/Script",
  description: "Eight steps, four lanes, one gate out per lane. Runs from the tempo or from a clock input.",
  layout: [
    { row: [{ select: "source" }, { select: "division" }, { knob: "steps" }, { knob: "pulses" }, { knob: "gateLength" }] },
    { title: "Lane 1", row: [{ repeat: 8, column: ["a{n}"] }] },
    { title: "Lane 2", row: [{ repeat: 8, column: ["b{n}"] }] },
    { title: "Lane 3", row: [{ repeat: 8, column: ["c{n}"] }] },
    { title: "Lane 4", row: [{ repeat: 8, column: ["d{n}"] }] },
    { meter: "position" },
  ],
})
export class StepSequencer {
  @input({ name: "Clock", type: "trigger" }) clock: f32 = 0;
  @input({ name: "Reset", type: "trigger" }) restart: f32 = 0;
  @output({ name: "Gate", type: "gate", count: 4 }) gate!: StaticArray<f32>;

  @param({ name: "Source", choices: ["Tempo", "Clock in"] }) source: i32 = 0;
  @param({ name: "Division", choices: ["1/4", "1/8", "1/16", "1/32"] }) division: i32 = 2;
  @param({ name: "Steps", min: 1, max: 8, init: 8 }) steps: i32 = 8;
  @param({ name: "Pulses per step", min: 1, max: 24, init: 1 }) pulses: i32 = 1;
  @param({ name: "Gate length", min: 0.05, max: 1, init: 0.5, unit: "of a step", decimals: 2 }) gateLength: f32 = 0.5;
  @param({ name: "Step", count: 8, group: "Lane 1" }) a!: StaticArray<bool>;
  @param({ name: "Step", count: 8, group: "Lane 2" }) b!: StaticArray<bool>;
  @param({ name: "Step", count: 8, group: "Lane 3" }) c!: StaticArray<bool>;
  @param({ name: "Step", count: 8, group: "Lane 4" }) d!: StaticArray<bool>;
  @probe position: f32 = 0;

  private sampleRate: f64;
  private bpm: f64 = 120;
  private beat: f64 = 0;            // the position in quarter notes, advanced per sample
  private playing: bool = false;
  private step: i32 = -1;           // the step that is sounding; -1 before the first
  private pulse: i32 = 0;           // clock pulses since the step began
  private stepSamples: f64 = 0;     // how long a step lasts, to time the gates
  private sinceStep: f64 = 0;
  private sinceClock: f64 = 0;
  private open: bool = false;
  private fresh: bool = false;       // a reset happened on this sample

  constructor(sampleRate: f64) { this.sampleRate = sampleRate; this.stepSamples = sampleRate / 8.0; }

  @transport tempo(bpm: f64, ppq: f64, playing: bool): void {
    this.bpm = bpm;
    if (this.source == 0) {
      if (playing && !this.playing) this.step = -1;          // the transport started: begin again
      if (playing) this.beat = ppq;                          // follow the host's position exactly once per block
      if (!playing) this.closeAll();
    }
    this.playing = playing;
  }

  reset(): void { this.step = -1; this.pulse = 0; this.closeAll(); }

  private stepsPerBeat(): f64 {
    return this.division == 0 ? 1.0 : this.division == 1 ? 2.0 : this.division == 2 ? 4.0 : 8.0;
  }

  private closeAll(): void {
    for (let i = 0; i < 4; i++) this.gate[i] = 0;
    this.open = false;
  }

  /// Moves to step `n` and opens the gates of the lanes that have it on.
  private begin(n: i32): void {
    this.step = n;
    this.sinceStep = 0;
    this.gate[0] = this.a[n] ? 1 : 0;
    this.gate[1] = this.b[n] ? 1 : 0;
    this.gate[2] = this.c[n] ? 1 : 0;
    this.gate[3] = this.d[n] ? 1 : 0;
    this.open = true;
    this.position = <f32>(n + 1) / <f32>this.steps;
  }

  @on("restart", { rising: 0.5 }) rewind(): void {
    this.pulse = 0;
    this.fresh = true;
    this.begin(0);
  }

  @on("clock", { rising: 0.5 }) tick(): void {
    if (this.source != 1) return;
    if (this.sinceClock < this.sampleRate * 2.0) this.stepSamples = this.sinceClock * <f64>this.pulses;    // a step lasts as long as the clock says
    this.sinceClock = 0;
    if (this.fresh) return;                                   // a reset on the same sample wins: the clock does not move on
    if (this.step >= 0 && this.pulse + 1 < this.pulses) { this.pulse++; return; }
    this.pulse = 0;
    this.begin(this.step < 0 ? 0 : (this.step + 1) % this.steps);
  }

  sample(): void {
    this.fresh = false;
    this.sinceClock += 1;
    this.sinceStep += 1;
    if (this.source == 0) {
      if (!this.playing) return;
      this.stepSamples = this.sampleRate * 60.0 / (this.bpm * this.stepsPerBeat());
      const n = <i32>Math.floor(this.beat * this.stepsPerBeat()) % this.steps;
      if (n != this.step) this.begin(n);
      this.beat += this.bpm / (60.0 * this.sampleRate);      // after the check: the first sample of a block is exactly at ppq
    }
    if (this.open && this.sinceStep >= this.stepSamples * <f64>this.gateLength) this.closeAll();
  }
}
```

## How it works

**The layout.** The `layout` in `@module` arranges the knobs at the top and one row of eight toggles per lane, with a meter showing the position. `repeat: 8` makes one column per step, and `"a{n}"` becomes `a1` to `a8`, the ids of the first lane's toggles. See [Custom UIs and widgets](../custom-ui.md).

**Counted outputs and params.** `count: 4` on the gate gives `gate1` to `gate4`. Each lane is a field of eight toggles (`a`, `b`, `c`, `d`), `count: 8`, in a group of its own.

**`@transport tempo(bpm, ppq, playing)`.** The engine calls it once per block, before `block()`. The module stores the tempo, and, when it is following the tempo, takes the host's position. This is what makes it **follow tempo changes and transport jumps**: a loop that wraps, or a click on a different bar in the host, moves `ppq`, and the next block sets the sequencer to that position. When the transport starts (`playing` goes from false to true) the step is cleared so the pattern begins at the right step, and when it stops, the gates close.

**`sample()`.** In tempo mode it checks whether the step number has changed at the current position, then advances the position by `bpm / (60 * sampleRate)` quarter notes. This costs a floor and a few multiplications per sample, and it gives the step change **sample accuracy**: not a block (about 0.67 ms) late. In both modes it closes the gate when the time is up.

**`@on("clock", { rising: 0.5 }) tick()`.** On each pulse the module measures the time since the last one, so a **tempo change on the clock** is followed automatically, and advances a step every `pulses` pulses. The first pulse starts the pattern at step 1.

**`@on("restart", { rising: 0.5 })`.** A rising edge on *Reset* jumps to step 1 at that sample. If a clock pulse arrives on the very same sample, the reset wins (that is what the `fresh` flag is for): the pattern starts on step 1 instead of moving on to step 2.

## Try it

1. Add a **Code** node, choose this module (copy the source above into the editor) and press *Compile*.
2. Add a **Clock** or let the transport run, and put some toggles on. Cable *Gate 1* into a drum module's gate input, *Gate 2* into another one.
3. Switch *Source* to *Clock in*, cable a clock into the *Clock* jack and set *Pulses per step*: with a clock that sends 24 pulses per quarter note, 6 pulses give 16th notes.
4. A trigger on *Reset* every bar keeps a shorter pattern aligned: set *Steps* to 7 or 5 for a polyrhythm, and reset on the bar.

## Ideas to extend it

- **Swing:** delay every second step by a fraction of `stepSamples` before calling `begin`.
- **Probability** or **ratchets:** a per-step count that opens the gate several times inside a step. The pieces are there: a counter and `stepSamples`.
- **Pitch lanes:** replace the toggles with `count: 8` knobs and send the value of the current step to a control output.
- **More lanes:** make the lane count a **setting** (`settings: [{ id: "LANES", ... }]`) so the user chooses it; the loops over the lanes use the constant. See [Module scripts](../module-scripts.md#settings-and-counted-jacks).
- **Several patterns:** a notes output whose events are pushed in `begin` instead of gates. See [Events and routing](../events.md).
