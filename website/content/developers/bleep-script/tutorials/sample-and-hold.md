---
title: Sample and hold
description: Build a sample and hold module, first with the generated UI and a widget layout, then with a self-made canvas UI that draws what it holds.
order: 40
---

# Sample and hold

A **sample and hold** takes a snapshot of a signal at the moment a trigger arrives and holds it until the next one. Feed it noise and it makes random steps; feed it a slow LFO and it makes a staircase. It is also a small tour of a trigger input, an edge handler and a smoothed output.

## The module

```ts compile
@module({ name: "Sample and Hold", category: "Utility/Script", description: "Holds the signal at each trigger." })
export class SampleHold {
  @input({ name: "Signal", type: "control" }) signal: f32 = 0;
  @input({ name: "Trigger", type: "trigger" }) trig: f32 = 0;
  @output({ name: "Out", type: "control" }) out: f32 = 0;

  @param({ name: "Glide", min: 0, max: 0.5, init: 0, unit: "s", decimals: 3 }) glide: f32 = 0;
  @param({ name: "Mode", choices: ["Sample", "Track"] }) mode: i32 = 0;
  @probe held: f32 = 0;

  private value: f32 = 0;          // what the last trigger took
  private smooth: f32 = 0;         // the output, gliding towards it
  private coefficient: f32 = 1;    // 1 means no glide
  private tracking: bool = false;
  private sampleRate: f64;
  constructor(sampleRate: f64) { this.sampleRate = sampleRate; }

  @on("trig", { rising: 0.5 }) take(): void {
    this.value = this.signal;                  // the signal at exactly this sample
    this.tracking = this.mode == 1;
  }
  @on("trig", { falling: 0.5 }) release(): void { this.tracking = false; }

  block(): void {
    // the glide time becomes a per-sample coefficient once per block: one exp() here, none in sample()
    this.coefficient = this.glide < 0.0005 ? <f32>1 : <f32>(1.0 - Math.exp(-1.0 / (this.sampleRate * <f64>this.glide)));
    this.held = this.value;
  }

  sample(): void {
    if (this.tracking) this.value = this.signal;      // Track mode follows the signal while the trigger is high
    this.smooth += (this.value - this.smooth) * this.coefficient;
    this.out = this.smooth;
  }
}
```

### What each part does

- **`@on("trig", { rising: 0.5 })`** runs at the exact sample where the trigger crosses 0.5. At that sample `this.signal` already holds the signal's value, so the snapshot is sample-accurate, not rounded to the block ([Rates and timing](../rates.md)).
- **Mode** chooses between *Sample* (snapshot at the rising edge) and *Track* (follow the signal while the trigger is high, hold when it falls).
- **The held value is a probe**, which the view shows as a meter.
- **Glide** slews the stepped output so it can be made smooth. It is a one-pole whose coefficient is computed from the knob **once per block**, so the `exp` is not paid per sample. With `Glide` at 0 the coefficient is 1 and the output follows the held value exactly.

## The prebuilt UI

The Code node generates a control for every `@param`, a meter for every `@probe` and a button for every `@button`, with no further work: after compiling you get the *Glide* knob, the *Mode* dropdown and a meter for *held*. To arrange them, add a **layout** to `@module`:

```ts
@module({
  name: "Sample and Hold",
  layout: [
    { row: [{ knob: "glide" }, { select: "mode" }, { meter: "held" }] },
  ],
})
```

A layout only places the standard widgets; it needs no code and cannot go wrong at run time. See [Custom UIs and widgets](../custom-ui.md) for every widget.

## A custom UI

When the standard widgets are not enough, the **UI** tab holds JavaScript that draws the module's own panel. This one draws a **scope of the held value**: a trace that steps whenever a new sample is taken.

```js
const view = bleep.canvas(120);
const history = new Array(240).fill(0);       // the last 240 frames of the held value
let tick = 0;

bleep.onFrame(() => {
  if (++tick % 2) return;                     // a column every second frame
  history.push(bleep.probe("held"));
  history.shift();

  const { g, width, height } = view;
  g.clearRect(0, 0, width, height);
  g.strokeStyle = bleep.theme.line;
  g.beginPath(); g.moveTo(0, height / 2); g.lineTo(width, height / 2); g.stroke();   // the zero line

  g.strokeStyle = bleep.theme.accent;
  g.lineWidth = 2;
  g.beginPath();
  history.forEach((v, i) => {
    const x = (i / (history.length - 1)) * width;
    const y = height / 2 - v * (height / 2 - 6);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  });
  g.stroke();
});

view.el.addEventListener("pointerdown", () => bleep.param("glide").set(0.1));   // a click sets the glide
```

What to take from it:

- **`bleep.probe("held")`** is how the UI reads a module's `@probe`. The view receives it up to 30 times a second.
- **`bleep.canvas(h)`** gives a canvas as wide as the node, scaled for the screen.
- **`bleep.param("glide").set(v)`** writes a knob **in its own units** (seconds here).
- Everything runs in a sandbox: no network, no storage, and it only talks to its module. It runs in a worker that the board stops if it hangs, so a UI that came with a patch needs no approval. See [Limits and safety](../implementation/limits.md).

The *Wave folder with its own UI* example in the Code node's **Examples** menu is a larger one: it draws the transfer curve and lets you drag it to set the knobs.

## Using it

Cable a **Noise** or an LFO into *Signal*, a clock or a gate sequencer lane into *Trigger*, and *Out* into a pitch or a filter cutoff: the classic random stepped voltage. A slower trigger gives longer steps.
