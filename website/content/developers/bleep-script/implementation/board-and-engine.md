---
title: The board and the engine
description: The Code node, the Worker that holds the compiler, what is saved on a node, and how a compiled module is loaded in the browser and in the app.
order: 30
---

# The board and the engine

## The Code node

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

`board-code.js` caches compiled results by a hash of the source and the settings, so the same source is compiled once, however many nodes use it.

## What is saved

A compile result is saved with the node as three things: the **source**, the **settings** and the **interface** (the node type description). The `.wasm` is not saved in the patch. That is why a shared patch is text, and why opening one means compiling it yourself.

## In the browser

`patch/web/js/module-host.js` instantiates the `.wasm` in the AudioWorklet, through the same code path as every other module. Compiling happens in the Worker, and the compiled module is handed to the engine with `BleepWeb.registerCode`, so the audio thread never compiles.

## In the app and the plugins

`patch/engine/wasm/CodeNodes.cpp` registers the **Code** entry in the engine's module registry. A Code node's real type id is `code:<node id>:<hash of source and settings>`, so the same source and settings are the same module, and a changed source is a new type.

- `registerCodeModule(...)` takes the compiled bytes, loads them as a package (`WasmPackage::load` checks the ABI and refuses any import the ABI does not allow), gives the module that type id and registers it.
- When a patch is loaded and the module is not registered yet, `resolve(...)` builds a spec from the **saved interface**. The node is silent, but it has its jacks and knobs, so cables and knob values survive loading.

The engine runs the file in Wasmtime (`WasmRuntime.cpp`), the same sandbox as the other WebAssembly modules. Today the compiler is not shipped with the app and the plugins; see [The Code node](../code-node.md#where-it-is-available).
