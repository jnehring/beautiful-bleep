---
title: Bleep Script
description: Write modules, message routing and generated patches in code: what Bleep Script is, how it works, and a map of these pages.
order: -10
---

# Bleep Script

**Bleep Script** lets you write parts of a patch as code. A **Code node** on the board has an editor and a Compile button. Depending on what you write, it becomes a new module with its own jacks, knobs and meters, or it builds a whole cell of modules and cables for you.

![A Code node in Bleep Play holding the Tremolo example: the Compile button and status line on top, the script in the editor, and below it the module's meter and knobs.](/img/code-node-tremolo.png)

This is a small tremolo script. Compile it and the node gets an In jack, an Out jack, the Rate and Depth dials, a Shape menu and a meter for the LFO. Nothing else is needed: the decorators on top declare all of that, and `sample()` at the bottom is the sound.

## What it is for

Bleep Script does three jobs.

**Custom modules.** When the board has no module that does what you want, you write one. A module is a class with a `sample()` method that does the DSP for each audio sample, and decorators such as `@input`, `@output` and `@param` declare its jacks and knobs. This is how you make your own oscillator, effect or distortion. See [Module scripts](module-scripts.md).

**Message routing and scripting.** Some jobs are about logic rather than sound: splitting notes between voices, reacting to a gate going high, building a router. For these you write `@on` handlers for notes and control edges. A handler runs at the exact sample the event happens, so timing stays precise. Handlers live in a module script, so they use the same language and compiler as a custom module. See [Events and routing](events.md).

**Complex patches.** Some patches are too big or too repetitive to place by hand. A patch script does not process audio. It runs once and describes which modules and cables to create, so a loop can build 100 oscillators and wire them up, and the shape of the result can depend on parameters. See [Patch scripts](patch-scripts.md).

## How it works

- **Two kinds of script.** A *module script* (it has `@module`) is [AssemblyScript](https://www.assemblyscript.org/), a TypeScript-like language that compiles to WebAssembly. A *patch script* (it ends in `export default cell(...)`) is TypeScript or JavaScript that runs once and describes modules and cables.
- **You pick the rate by the method you write.** `block()` runs once per 32 samples, `sample()` once per sample, `@on` handlers once per event.
- **No installation on the web.** In Bleep Play there is nothing to install: the compiler runs in your browser and all the code is compiled there, on your machine. Compiling takes about a second and produces one `.wasm` file that follows the [module ABI](../modules/module-abi.md), the same format as every other module. The engine runs it in the same sandbox.
- **Real-time code is restricted.** The compiler rejects what an audio thread must not do, and estimates the cost of a block. See [Limits and safety](implementation/limits.md).
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
| [Rates and timing](rates.md) | When each part of a script runs, and what to put where |
| [Tutorials](tutorials/overview.md) | A step sequencer, drive, smoothing, sample and hold, inputs, the DSP toolbox |
| [The Code node](code-node.md) | The editor, compiling, settings, saving, and what is available where |
| [Module scripts](module-scripts.md) | Reference: decorators, signal types, parameters, probes, buttons, settings |
| [Built-ins reference](reference.md) | Every built-in one by one, with its API and a complete example: lifecycle methods, decorators, `@transport`, note types, the patch builder and the UI object |
| [Events and routing](events.md) | Notes and edge handlers, with a router |
| [Patch scripts](patch-scripts.md) | Reference: building cells from code |
| [Custom UIs and widgets](custom-ui.md) | Layouts of knobs, faders and meters, or a self-made canvas UI |
| [Library](library.md) | `bleep/osc`, `filters`, `delay`, `random`, `env`, `dynamics`, `fx`, `fft`, `util`, `dsp`, `notes`: oscillators, filters, delays, envelopes, dynamics, reverb, notes |
| [Programming with AI](ai-programming.md) | One prompt that teaches a coding AI Bleep Script, to copy or download |
| [Implementation](implementation/overview.md) | How the language is built in the repo: the compiler, the lifecycle of a script, [limits and safety](implementation/limits.md), and how to run the tests |

## Where it lives

| Piece | Path |
|---|---|
| Compiler, transform, library, patch runner, playground, tests | `patch/script/` (see its `README.md`) |
| The Code node in the board | `patch/board/ui/board-code.js` |
| Native engine support | `patch/engine/wasm/CodeNodes.cpp` |
| Concept and design, with what differs from it | `doc/specs/bleep-script.md` |
