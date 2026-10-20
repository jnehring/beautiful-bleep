---
title: Architecture
description: How Bleep Script is implemented in the repo: the compiler, the transform, the library, the patch runner, the Code node and the engine, and how a script travels from the editor to the audio thread.
order: 90
---

# Architecture

Bleep Script is not one program. It is a small compiler pipeline that runs in your browser, a sandboxed interpreter for patch scripts, a node in the board's UI, and a place in the engine where the result is loaded. This page is the map: which part lives where in the repo, and what travels between the parts.

## The big picture

![The Code node sends the source to a Worker that holds the compiler bundle. A module script becomes a wasm file and a node description; a patch script becomes nodes and cables. The wasm file runs in the browser and in the app and plugins through the same module ABI.](/img/script-overview.svg)

Everything except the last row runs on your machine, in the page. Nothing is sent to a server to be compiled.

## Two kinds of script, two pipelines

| | Module script | Patch script |
|---|---|---|
| Recognised by | `@module` on a class | `export default cell(...)` |
| Language | AssemblyScript (a strict subset) | TypeScript or JavaScript |
| Runs | Every sample or block, on the audio thread, as WebAssembly | Once, when you press Compile |
| Produces | A `.wasm` file and a node type description | A list of modules and cables |
| Code | `patch/script/transform/`, `patch/script/compiler/`, `patch/script/src/bleep/` | `patch/script/patch/` |

## The module pipeline

A module script goes through four steps. The first three are in `patch/script/`.

### 1. The compiler: `asc` in memory

`compiler/compile.mjs` exports `compileScript(asc, source, { lib, typeId, constants })`. It calls the AssemblyScript compiler, `asc.main`, with in-memory `readFile` and `writeFile` hooks: the script and the library sources are strings in a map, and the output `.wasm` is captured as bytes. There is no file system. The same function runs in node (tests, the build), in a page (the playground) and in a worker (the board).

The flags are fixed, and each has a reason:

| Flag | Why |
|---|---|
| `--runtime stub` | No garbage collector. Nothing is allocated while audio runs. |
| `--use abort=` | Removes the `env.abort` import, so the file imports nothing. |
| `--exportStart _initialize` | The module ABI's `_initialize` runs the global initialisers. |
| `--optimizeLevel 3 --shrinkLevel 1 --noAssert` | Speed and size. |
| `--use NAME=value` | One constant per `settings` entry of the module (see below). |

If the module declares `settings`, the compiler runs twice. A quick first pass stops right after parsing and only reads the settings, because their values are compile-time constants (`--use`) and must be known before the real compile.

### 2. The Bleep transform

`transform/bleep.mjs` is an AssemblyScript **transform**: a plugin the compiler calls between parsing and compiling. In `afterParse` it:

- reads the decorators (`@module`, `@input`, `@output`, `@param`, `@probe`, `@button`, `@on`, `@transport`) with a small literal parser. Decorator arguments are never evaluated; an identifier or a call in a decorator is an error;
- builds the **node type description**: the JSON the rest of Bleep uses to draw the node, its jacks, knobs and meters;
- generates an **entry source file** with the `bleep_*` exports of the [module ABI](../modules/module-abi.md) and a glue class that copies the ABI's buffers into the module's fields (params once per chunk, inputs per sample, outputs read back after `sample()`);
- adds that entry file to the compilation with `parser.parseFile`, so the compiler type-checks it like your own code and errors read as source lines.

The transform only reads syntax trees, with no file system and no `eval`, so it runs unchanged in node and in a page, and the output is byte-identical in both.

### 3. The subset checker

`transform/subset.mjs` runs inside the transform, on the syntax tree, before the compiler sees the code. It does two jobs:

1. **The whole file:** nothing that adds a host import or reaches memory directly (`declare function`, `@external`, `load`, `store`, `changetype`, `unchecked`, imports other than `bleep/*`).
2. **Real-time code** (`block()`, `sample()`, `reset()`, `@on` handlers, and everything they call): no loop without a constant bound, no recursion, no allocation, no exceptions, no call to something unknown.

It also estimates the cost of one 32-sample chunk in abstract operations (loops multiplied by their bound, calls by the callee). A module over the budget is a warning, and far over it is an error. See [Limits and safety](limits.md).

The library sources in `src/bleep/` are trusted: they are read for their cost but not held to these rules.

### 4. The module file

![The module pipeline: the source is parsed, the Bleep transform checks it and adds the entry file, asc and Binaryen compile it to module.wasm. The node description and the problems come out on the side.](/img/script-compiler.svg)

The result is one `.wasm` file with no imports. It exports `memory`, `_initialize` and the `bleep_*` functions, which is the same [module ABI](../modules/module-abi.md) every other Bleep module uses. A typical module is under 20 KB.

## The library

`patch/script/src/bleep/*.ts` is the standard library (`osc`, `filters`, `delay`, `env`, `dynamics`, `fx`, `fft`, `random`, `util`, `dsp`, `notes`; see [Library](library.md)). It is plain AssemblyScript. It is compiled into your module together with your script: `import { Svf } from "./bleep/filters"` pulls the source in, and unused code is dropped.

The library sources are also embedded in the compiler bundle as strings (`compiler/bundle-entry.mjs`), which is how an in-memory compile finds `./bleep/...`.

## The bundle

`npm run bundle` (`bundle.mjs`, using esbuild) produces two files in `patch/script/dist/`:

| File | Content |
|---|---|
| `bleep-script-compiler.js` | `asc`, Binaryen, the transform, the library sources, the example scripts and the patch runner, in one file. Exports `compile`, `patch` and `examples`. |
| `bleep-script-editor.js` | The CodeMirror 6 editor with completion for the decorators and the library. |

The board loads them only when a Code node is opened for the first time, so a patch without scripts pays nothing. Binaryen embeds its own `.wasm`; `bundle.mjs` replaces its `fetch("data:...")` of it, which a content-security policy without `data:` in `connect-src` would block.

## Patch scripts

A patch script (`patch/script/patch/`) never touches the audio thread. Three files make it work:

| File | Role |
|---|---|
| `run.mjs` | Strips the TypeScript types (with Sucrase, keeping line numbers) and runs the script in **QuickJS compiled to WebAssembly**: no network, no files, no clock, no DOM, a 64 MiB memory limit and a 3 second time limit. The only thing that leaves the sandbox is the data the script returns. |
| `prelude.mjs` | The code that runs inside the sandbox before yours. It defines `cell()` and the builder, and records what you ask for as plain data. |
| `materialize.mjs` | Back in the host: checks the description against the board's module types (the module exists, the knobs exist and the values fit, the jacks exist and the signal types match) and turns it into nodes and cables. |

A mistake in a patch script can only produce a description that `materialize.mjs` then refuses.

## The Code node in the board

| Piece | Path |
|---|---|
| The node, its view, Compile, settings, saving | `patch/board/ui/board-code.js`, `board-code-view.html` |
| The Worker that loads the compiler | `patch/board/ui/board-code-worker.js` |
| The standard widgets and the sandboxed custom UI | `patch/board/ui/board-code-widgets.js` |

The Worker keeps the compiler off the page: the first compile takes seconds of CPU, and the board seals the page's built-ins, while the compiler needs a plain JavaScript environment. The page and the Worker talk with three messages:

```
init                                  -> the example scripts
compile { source, typeId, constants } -> { wasm, specs, problems }
patch   { source, settings, types }   -> { ok, nodes, cables, interface }
```

A compile result is saved with the node: the **source**, the **settings** and the **interface** (the node type description). The `.wasm` is not saved in the patch. That is why a shared patch is text, and why opening it means compiling it yourself.

## Running the result

### In the browser

`patch/web/js/module-host.js` instantiates the `.wasm` in the AudioWorklet, using the same code path as every other module. Compiling happens in the Worker, and a compiled `WebAssembly.Module` is posted to the worklet, so the audio thread never compiles.

### In the app and the plugins

`patch/engine/wasm/CodeNodes.cpp` registers the **Code** entry in the engine's module registry. A Code node's real type id is `code:<node id>:<hash of source and settings>`, so the same source and settings are the same module.

- `registerCodeModule(...)` takes the compiled bytes, loads them as a package (`WasmPackage::load` checks the ABI and refuses any import the ABI does not allow), gives it that type id and registers it.
- When a patch is loaded without a compiled module, `resolve(...)` builds a spec from the **saved interface**. The node is silent, but it has its jacks and knobs, so cables and knob values survive loading. Today the compiler is not shipped with these builds, so a script compiled in Bleep Play is what they can load; see [The Code node](code-node.md).

The engine runs the file in Wasmtime (`WasmRuntime.cpp`), the same sandbox as other WebAssembly modules.

## Tests

Everything has tests, run from `patch/script/` with `npm test`.

| Test | What it covers |
|---|---|
| `test/transform.test.mjs` | The transform: the generated description, errors with file and line, param kinds, two modules in one file |
| `test/dsp/*.test.mjs` | The library: one file per library file, plus `docs.test.mjs`, which checks that every export is documented and that the doc examples compile |
| `test/spike.mjs` | The module host: behaviour against a reference model, and speed |
| `test/wasmtime-check.sh` | The engine's Wasmtime host runs the same file |
| `test/browser/` | The compiler and the transform in a page |

## Where to start reading

| If you want to change... | Start here |
|---|---|
| A decorator or what a module's node looks like | `transform/bleep.mjs` |
| What the compiler refuses, or the cost estimate | `transform/subset.mjs` |
| The compile flags, or how errors are reported | `compiler/compile.mjs` |
| A library function | `src/bleep/<file>.ts`, and its page in [Library](library.md) |
| What a patch script can build | `patch/prelude.mjs`, `patch/materialize.mjs` |
| The editor | `editor/editor-entry.mjs` |
| The Code node's behaviour in the board | `patch/board/ui/board-code.js` |
| How the engine loads a Code node | `patch/engine/wasm/CodeNodes.cpp` |

The design document, with what differs from it, is `doc/specs/bleep-script.md`. The spike's measurements and flag rationale are in `patch/script/README.md`.
