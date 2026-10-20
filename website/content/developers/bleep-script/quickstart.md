---
title: Quickstart
description: Write, compile and use your first Bleep Script module, then your first patch script.
order: 10
---

# Quickstart

You need Bleep Play in a browser with the Bleep Script compiler (see [The Code node](code-node.md) for what is available where). Start audio first: browsers only allow sound after a click.

## A module in five steps

1. **Add a Code node.** Press `Tab` on the board, type `code`, press Enter. A node called *Code* appears with no jacks yet.
2. **Open it.** Click the node. The editor opens with a *Wave folder* example loaded.
3. **Compile.** Press **Compile** (or `Ctrl+Enter`, `Cmd+Enter` on a Mac). A second later the status line reads `Fold: compiled`, the node has an In and an Out jack, and the view shows two dials, *Drive* and *Mix*, and a *Level* meter.
4. **Patch it in.** Cable an oscillator into **In** and **Out** into the next module or the speakers. Turn *Drive* while a note plays.
5. **Change the code.** Edit the source, compile again. The running module is swapped, your cables stay as long as the jacks still exist, and *Undo* brings the previous source back.

If something is wrong, the **problems list** under the editor shows the line and column; click a problem to jump to it. A failed compile leaves the previous version running.

## What you just compiled

```ts
import { Smoother, PeakHold } from "./bleep/dsp";

@module({ name: "Fold", category: "Utility/Script", colour: "#f6c35b",
          description: "A wave folder: pushes the signal into a sine fold and mixes it back." })
export class Fold {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;

  @param({ name: "Drive", min: 0, max: 20, init: 2, decimals: 1 }) drive: f32 = 2;
  @param({ name: "Mix", min: 0, max: 1, init: 1, decimals: 2 }) mix: f32 = 1;

  /** The output level, for the meter. */
  @probe level: f32 = 0;

  private k: Smoother;
  private meter: PeakHold;
  constructor(sampleRate: f64) {
    this.k = new Smoother(sampleRate, 0.01);
    this.meter = new PeakHold(sampleRate, 0.3);
  }

  block(): void { this.k.target = this.drive; }            // once per 32 samples
  sample(): void {                                          // once per sample
    const folded = <f32>Math.sin(<f64>(this.x * this.k.next()));
    this.out = this.x + (folded - this.x) * this.mix;
    this.level = this.meter.next(this.out);
  }
}
```

- The decorators declare the interface. The compiler turns them into the node's jacks, dials and meter.
- Fields hold the values: `x` is the current input sample, `drive` is the dial's value in its own units, `out` is what you write.
- `block()` is for slow work, such as setting a smoother's target. `sample()` is for per-sample work.
- `Smoother` and `PeakHold` come from the [library](library.md).

More in [Module scripts](module-scripts.md).

## A patch script

The same Code node can build patches. Choose **SuperSaw: 100 oscillators (patch script)** from the *Examples* menu and press Compile:

```ts
import { cell } from "bleep/patch";

export default cell("SuperSaw", {
  description: "Many detuned saw oscillators into one filter.",
  settings: [
    { id: "VOICES", name: "Oscillators", min: 1, max: 200, init: 100 },
    { id: "SPREAD", name: "Spread (cents)", min: 0, max: 100, init: 30 },
  ],
}, (c, s) => {
  c.input("pitch", "Pitch", "pitch");
  c.stereoOut();

  const filter = c.add("filter", { cutoff: 4000, resonance: 0.2 });
  for (let i = 0; i < s.VOICES; i++) {
    const detune = s.VOICES > 1 ? (i / (s.VOICES - 1) - 0.5) * 2 * s.SPREAD : 0;
    const osc = c.add("oscillator", { fine: detune }, { name: "Saw " + (i + 1) });
    c.cable(c.cin, "pitch", osc, "pitch");
    c.cable(osc, "saw", filter, "l", 1 / Math.sqrt(s.VOICES));
  }
  c.stereo(filter, c.cout);
});
```

A cell called *SuperSaw* appears next to the Code node, with a Pitch input and Out L and Out R outputs, holding 100 oscillators and a filter. Two number fields, *Oscillators* and *Spread*, appear above the editor: change one and the cell is rebuilt. More in [Patch scripts](patch-scripts.md).

## Next

- [The Code node](code-node.md): settings, saving, panels, what to do when the compiler is missing
- [Events and routing](events.md): notes and control edges
- [Limits and safety](implementation/limits.md): what the compiler refuses and why
