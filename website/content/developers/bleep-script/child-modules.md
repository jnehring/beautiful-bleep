---
title: Using other modules
description: Import a module of the library, such as Delay, into a module script and use it like an object. The compiler links the two into one file.
order: 65
---

# Using other modules

A module script can use any module of the [library](../modules/library.md) that follows the [module ABI](../modules/module-abi.md): you import it, make one, and hand it audio. The compiler links your script and the module into **one `.wasm` file** that imports nothing, so everything on [Limits and safety](limits.md) still holds.

This is the first slice of the feature. It works in the compiler (node, a page, a Worker) and is tested with the Gains module. The Code node in the board does not pass library modules to the compiler yet, so a script cannot use it there until that is wired.

## The script

```ts
import { Gains } from "./bleep/module-gains";

@module({ name: "Wrap", category: "Utility/Script" })
export class Wrap {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @param({ name: "Volume", min: 0, max: 1, init: 0.909 }) vol: f32 = 0.909;

  private fx: Gains;
  constructor(sampleRate: f64) { this.fx = new Gains(sampleRate); }

  chunk(n: i32, ins: StaticArray<f32>, outs: StaticArray<f32>): void {
    this.fx.set(Gains.PARAM_VOL, this.vol);
    this.fx.feed(Gains.INPUT_X, ins, 0);
    this.fx.process(n);
    this.fx.fetch(Gains.OUTPUT_OUT, outs, 0);
  }
}
```

`./bleep/module-<id>` is the library id of the module, and the class is named after the module. The compiler writes the class from the module's node type description; you do not write it.

## Whole chunks, not single samples

A module of the library processes a **chunk** of up to 32 samples at a time. So the class does not have a per-sample call. It has four steps, and you do them in a new method, `chunk`:

| Call | What it does |
|---|---|
| `set(Class.PARAM_X, v)` | Sets a parameter. `v` is the **normalised** value from 0 to 1, the same as the knob. |
| `feed(Class.INPUT_X, rows, row)` | Copies row `row` of `rows` into an input jack. |
| `process(n)` | Runs the module for `n` samples (1 to 32). |
| `fetch(Class.OUTPUT_X, rows, row)` | Copies an output jack into row `row` of `rows`. |

`chunk(n, inputs, outputs)` runs once per chunk, **after** `sample()`. It gets the chunk's input and output rows, jack by jack, 32 floats per row (row 0 is your first jack). Rows you write in `chunk` replace what `sample()` wrote to the same output. It follows the same real-time rules as `sample()` and its cost is counted.

Signals that run through a child module are not available sample by sample in `sample()`. If you need to mix its output with something you compute per sample, write that into a row first, then `chunk` can add the two.

## What the compiler needs

```js
compile(source, { children: { gains: { wasm, spec, typeIndex } } })
```

| Field | What it is |
|---|---|
| `wasm` | The bytes of the module's `.wasm` file. A host gets them from the library by id and version and **checks it as it does for any module**, before it passes them in. |
| `spec` | The node type description of the type to use: its params, inputs and outputs. |
| `typeIndex` | Which node type of the file it is (default 0). |

A script that imports no library module needs none of this and is compiled as before.

## How it is linked

1. The script compiles to a `.wasm` that imports the child's functions from a module named `bleep-module:<id>`.
2. Binaryen's `wasm-merge` merges it with the child's file and a 127-byte glue file. Calls into the child become plain calls inside one file.
3. The compiler removes the child's and the glue's exports, so the result exports exactly what your script exports, with one `memory`, and checks that no import is left except the few the module ABI allows.

The child keeps **its own memory**. A script cannot address a second memory, so the glue copies rows between the two with `memory.copy`: one copy per `feed` and per `fetch`, 128 bytes each.

`wasm-merge` is an Emscripten tool for node. Bleep runs it inside a Worker on a stand-in node (`compiler/wasm-merge.mjs`: a `process`, a `require` and an in-memory `fs`) and loads it only when a script imports a module: it is a separate file, `bleep-script-merge.js`, about 12 MB.

## Limits

- **The child's own work is not in the cost estimate.** The checker counts your script. A child is a library module and is trusted as such.
- **The host must run files with more than one memory.** Browsers do (Chrome 120, Firefox 125, Safari 18.4) and so does the engine's Wasmtime. wasm3 does not.
- **Modules built with JUCE** bring the WASI imports and exception handling of the module ABI into your file. They are allowed to stay, so a linked file can need a host that supports them. Not tried yet: no module of that kind was available to test with.
- **Parameters are normalised**, not in units. A setter in units is the next step.
- **Transport and note jacks** are not passed to the child yet.
