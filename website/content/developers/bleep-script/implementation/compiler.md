---
title: The compiler
description: How a module script becomes a .wasm file: asc running in memory, the Bleep transform, the subset checker, the library and the browser bundle.
order: 10
---

# The compiler

A module script goes through four steps. All of the code is in `patch/script/`.

![The module pipeline: the source is parsed, the Bleep transform checks it and adds the entry file, asc and Binaryen compile it to module.wasm. The node description and the problems come out on the side.](/img/script-compiler.svg)

## 1. asc, in memory

`compiler/compile.mjs` exports `compileScript(asc, source, { lib, typeId, constants })`. It calls the AssemblyScript compiler, `asc.main`, with in-memory `readFile` and `writeFile` hooks: the script and the library sources are strings in a map, and the output `.wasm` is captured as bytes. There is no file system. The same function runs in node (tests, the build), in a page (the playground) and in a worker (the board).

It resolves to `{ wasm, specs, generated, problems, ms }`. `wasm` is `null` when there is an error.

The flags are fixed, and each has a reason:

| Flag | Why |
|---|---|
| `--runtime stub` | No garbage collector. Nothing is allocated while audio runs. |
| `--use abort=` | Removes the `env.abort` import, so the file imports nothing. |
| `--exportStart _initialize` | The module ABI's `_initialize` runs the global initialisers. |
| `--optimizeLevel 3 --shrinkLevel 1 --noAssert` | Speed and size. |
| `--use NAME=value` | One constant per `settings` entry of the module. |

If the module declares `settings`, the compiler runs **twice**. A quick first pass stops right after parsing and only reads the settings, because their values are compile-time constants (`--use`) and must be known before the real compile.

## 2. The Bleep transform

`transform/bleep.mjs` is an AssemblyScript **transform**: a plugin the compiler calls between parsing and compiling. In `afterParse` it:

- reads the decorators (`@module`, `@input`, `@output`, `@param`, `@probe`, `@button`, `@on`, `@transport`) with a small literal parser. Decorator arguments are never evaluated; an identifier or a call in a decorator is an error;
- builds the **node type description**: the JSON the rest of Bleep uses to draw the node, its jacks, knobs and meters;
- generates an **entry source file** with the `bleep_*` exports of the [module ABI](../../modules/module-abi.md) and a glue class that copies the ABI's buffers into the module's fields (params once per chunk, inputs per sample, outputs read back after `sample()`);
- adds that entry file to the compilation with `parser.parseFile`, so the compiler type-checks it like your own code and errors read as source lines.

The transform only reads syntax trees, with no file system and no `eval`, so it runs unchanged in node and in a page, and the output is byte-identical in both.

## 3. The subset checker

`transform/subset.mjs` runs inside the transform, on the syntax tree, before the compiler sees the code. It does two jobs:

1. **The whole file:** nothing that adds a host import or reaches memory directly (`declare function`, `@external`, `load`, `store`, `changetype`, `unchecked`, imports other than `bleep/*`).
2. **Real-time code** (`block()`, `sample()`, `reset()`, `@on` handlers, and everything they call): no loop without a constant bound, no recursion, no allocation, no exceptions, no call to something unknown.

It also estimates the cost of one 32-sample chunk in abstract operations: loops are multiplied by their bound and calls by the callee. A module over the budget is a warning, and far over it is an error. See [Limits and safety](limits.md).

The library sources in `src/bleep/` are trusted: they are read for their cost but not held to these rules.

## 4. The module file

The result is one `.wasm` file with no imports. It exports `memory`, `_initialize` and the `bleep_*` functions, which is the same [module ABI](../../modules/module-abi.md) every other Bleep module uses. A typical module is under 20 KB.

## The library

`patch/script/src/bleep/*.ts` is the standard library (see [Library](../library.md)). It is plain AssemblyScript, compiled into your module together with your script: `import { Svf } from "./bleep/filters"` pulls the source in, and unused code is dropped. The library sources are also embedded in the compiler bundle as strings, which is how an in-memory compile finds `./bleep/...`.

## The bundle

`npm run bundle` (`bundle.mjs`, using esbuild) produces two files in `patch/script/dist/`:

| File | Content |
|---|---|
| `bleep-script-compiler.js` | `asc`, Binaryen, the transform, the library sources, the example scripts and the patch runner, in one file. Exports `compile`, `patch` and `examples`. |
| `bleep-script-editor.js` | The CodeMirror 6 editor, with completion for the decorators and the library. |

The board loads them only when a Code node is opened for the first time, so a patch without scripts pays nothing. Binaryen embeds its own `.wasm`; `bundle.mjs` replaces its `fetch("data:...")` of it, which a content-security policy without `data:` in `connect-src` would block.
