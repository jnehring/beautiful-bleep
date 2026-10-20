---
title: Bleep Script
description: Write modules, message routing and generated patches in code: what Bleep Script is, how it works, and a map of these pages.
order: -10
---

# Bleep Script

**Bleep Script** lets you write parts of a patch as code. A **Code node** on the board has an editor and a Compile button. Depending on what you write, it becomes a new module with its own jacks, knobs and meters, or it builds a whole cell of modules and cables for you.

```ts
@module({ name: "Tremolo", category: "Utility/Script" })
export class Tremolo {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Rate", min: 0.1, max: 20, init: 4, unit: "Hz" }) rate: f32 = 4;
  @param({ name: "Depth", min: 0, max: 1, init: 0.5 }) depth: f32 = 0.5;

  private phase: f64 = 0;
  private sampleRate: f64;
  constructor(sampleRate: f64) { this.sampleRate = sampleRate; }

  sample(): void {
    this.phase += <f64>this.rate / this.sampleRate;
    this.phase -= Math.floor(this.phase);
    const lfo = <f32>(0.5 + 0.5 * Math.sin(2.0 * Math.PI * this.phase));
    this.out = this.x * (1 - this.depth * (1 - lfo));
  }
}
```

Compile that and the node gets an In jack, an Out jack and two dials. Nothing else is needed.

## What it is for

| Job | What you write | Page |
|---|---|---|
| **Custom modules** | A class with `sample()`: DSP, per sample | [Module scripts](module-scripts.md) |
| **Message routing and scripting** | `@on` handlers for notes and control edges, at their exact sample | [Events and routing](events.md) |
| **Complex patches** | A script that builds a cell: 100 oscillators from a loop | [Patch scripts](patch-scripts.md) |

## How it works

- **Two kinds of script.** A *module script* (it has `@module`) is [AssemblyScript](https://www.assemblyscript.org/), a TypeScript-like language that compiles to WebAssembly. A *patch script* (it ends in `export default cell(...)`) is TypeScript or JavaScript that runs once and describes modules and cables.
- **You pick the rate by the method you write.** `block()` runs once per 32 samples, `sample()` once per sample, `@on` handlers once per event.
- **The compiler runs in your browser.** Compiling takes about a second and produces one `.wasm` file that follows the [module ABI](../modules/module-abi.md), the same format as every other module. The engine runs it in the same sandbox.
- **Real-time code is restricted.** The compiler rejects what an audio thread must not do, and estimates the cost of a block. See [Limits and safety](limits.md).
- **Share source, not binaries.** A script is text saved in the patch. Whoever opens the patch compiles it themselves, in a sandbox.

## Where things stand

| Where | State |
|---|---|
| **Bleep Play in the browser** | Works: compile, edit, run, save with the patch |
| **The standalone app and the plugins** | The engine can run Code nodes and keeps their cables and knob values; the compiler is not shipped with these builds yet, so you cannot compile there. See [The Code node](code-node.md) |

## These pages

| Page | Content |
|---|---|
| [Quickstart](quickstart.md) | Your first script, in five minutes |
| [The Code node](code-node.md) | The editor, compiling, settings, saving, and what is available where |
| [Module scripts](module-scripts.md) | Reference: decorators, signal types, parameters, probes, buttons, settings |
| [Events and routing](events.md) | Notes and edge handlers, with a router |
| [Patch scripts](patch-scripts.md) | Reference: building cells from code |
| [Custom UIs and widgets](custom-ui.md) | Layouts of knobs, faders and meters, or a self-made canvas UI |
| [Library](library.md) | `bleep/osc`, `filters`, `delay`, `random`, `env`, `dynamics`, `fx`, `fft`, `util`, `dsp`, `notes`: oscillators, filters, delays, envelopes, dynamics, reverb, notes |
| [Tutorial: a synth voice](tutorial-synth-voice.md) | Build a supersaw voice from the library, step by step |
| [Limits and safety](limits.md) | What is refused, the cost estimate, and the sandboxes |

## Where it lives

| Piece | Path |
|---|---|
| Compiler, transform, library, patch runner, playground, tests | `patch/script/` (see its `README.md`) |
| The Code node in the board | `patch/board/ui/board-code.js` |
| Native engine support | `patch/engine/wasm/CodeNodes.cpp` |
| Concept and design, with what differs from it | `doc/specs/bleep-script.md` |
