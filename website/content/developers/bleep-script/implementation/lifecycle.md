---
title: The lifecycle of a script
description: What happens to a script from typing to sound, when a patch is saved and opened again, and how a module instance lives and dies in the engine.
order: 40
---

# The lifecycle of a script

A script has three lives that overlap: the **source** you edit and save, the **compiled module** the board keeps, and the **instance** the engine runs.

![From the editor to sound: edit, compile in the Worker, register with the engine, run. The result is saved with the patch as source, settings and interface, and opening the patch compiles it again.](/img/script-lifecycle.svg)

## 1. Edit

The source is text in a CodeMirror editor. Nothing is compiled while you type, and typing never triggers the board's shortcuts. The node keeps the last compiled version running.

## 2. Compile

Compile (the button, or Ctrl/Cmd+Enter) sends the source to the Worker.

1. `board-code.js` hashes the source and the settings. If that hash was compiled before, the cached result is used and nothing else happens.
2. If the script is a **patch script**, it runs in the QuickJS sandbox and the board builds the cell ([Patch script runner](patch-runner.md)). The rest of this list is for module scripts.
3. If the module declares `settings`, a first pass reads them.
4. The Bleep transform reads the decorators, the subset checker looks at the real-time code, and `asc` compiles ([The compiler](compiler.md)).
5. On **failure**, nothing changes. The problems are listed and marked in the editor, and the previous version keeps running.
6. On **success**, the result is the `.wasm` file and the node description, and it is kept in the cache.

## 3. Register

The board gives the compiled module to the engine under the type id `code:<node id>:<hash>`. The hash is in the id on purpose:

- the **same** source and settings are the same type, so the engine keeps the running instance;
- a **changed** source is a new type, so the engine builds a new instance and replaces the old one. The jacks and knobs are rebuilt, and cables and knob values stay wherever the jack or parameter id still exists.

The browser engine takes the module at once. The native engine checks it first: it compiles the file, verifies the ABI, and refuses any import the ABI does not allow.

## 4. Run: the life of an instance

This is the [module ABI](../../modules/module-abi.md)'s life of a module instance, as the generated code sees it.

| Step | What happens |
|---|---|
| Instantiate | The host compiles and instantiates the file, once per node. |
| `_initialize` | The module's global initialisers run. |
| `bleep_spec_json`, `bleep_chunk` | The host reads the node description and checks that the chunk is 32 samples. |
| `bleep_create(type, sampleRate)` | The generated glue constructs your class, passing the sample rate to the constructor. Everything you allocate, such as a delay buffer, is allocated here. |
| Knobs | The host sets every knob once, so the module sees the saved state. |
| Every chunk of 32 samples | The glue copies the params in, calls `block()` once, then calls `sample()` for each sample (copying inputs in and outputs out), and runs `@on` handlers at the sample where their event happened. |
| `bleep_reset` | A transport jump or a cleared tail calls your `reset()`. |
| `bleep_destroy` | The node was removed or its source changed. |

With the stub runtime nothing is freed, so `bleep_destroy` frees nothing. The host drops the whole instance with its memory (capped at 64 MiB), so nothing leaks across nodes. This is why allocation is allowed in the constructor and refused in real-time code.

## 5. Save

The patch stores, on the Code node: the **source**, the **settings** and the **interface** (the node description). It does not store the `.wasm`.

Because the interface is saved, a patch shows its Code nodes with their jacks, cables and knob values at once, before anything is compiled.

## 6. Open

When a patch is opened, the board calls `sync` for every Code node that has a source:

1. The node is **claimed** with its hash, so a second board message does not start another compile.
2. The source is compiled in the Worker (nodes with the same source and settings share one compile), and the result goes through step 3.
3. If the source does not compile, or the compiler cannot be loaded, the node stays **silent** and a message goes to the console. Its jacks and knobs are still there from the saved interface.

**Patch scripts are not compiled on open.** The cell they built is ordinary patch content and is already in the file.

In the standalone app and the plugins the compiler is not shipped yet, so a Code node opened there keeps its saved interface and is silent unless the module was registered by a UI that has the compiler.
