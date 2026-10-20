---
title: Implementation
description: How Bleep Script is built in the repo: the parts, where each lives, and a map of the pages in this section.
order: -10
---

# Implementation

Bleep Script is not one program. It is a compiler pipeline that runs in your browser, a sandboxed interpreter for patch scripts, a node in the board's UI, and a place in the engine where the result is loaded. This section is for people who work on the language itself. If you only write scripts, you do not need it.

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
| Code | `patch/script/transform/`, `compiler/`, `src/bleep/` | `patch/script/patch/` |

## Where the code is

| Piece | Path |
|---|---|
| Compiler, transform, library, patch runner, playground, tests | `patch/script/` (see its `README.md`) |
| The editor | `patch/script/editor/` |
| The Code node in the board, and its Worker | `patch/board/ui/board-code.js`, `board-code-worker.js` |
| The browser module host | `patch/web/js/module-host.js` |
| Native engine support | `patch/engine/wasm/CodeNodes.cpp` |
| Concept and design, with what differs from it | `doc/specs/bleep-script.md` |

## Where to start reading

| If you want to change... | Start here |
|---|---|
| A decorator, or what a module's node looks like | `transform/bleep.mjs` |
| What the compiler refuses, or the cost estimate | `transform/subset.mjs` |
| The compile flags, or how errors are reported | `compiler/compile.mjs` |
| A library function | `src/bleep/<file>.ts`, and its page in [Library](../library.md) |
| What a patch script can build | `patch/prelude.mjs`, `patch/materialize.mjs` |
| The editor | `editor/editor-entry.mjs` |
| The Code node's behaviour in the board | `patch/board/ui/board-code.js` |
| How the engine loads a Code node | `patch/engine/wasm/CodeNodes.cpp` |

## The pages in this section

| Page | Content |
|---|---|
| [The compiler](compiler.md) | `asc` in memory, the Bleep transform, the subset checker, the library and the bundle |
| [Patch script runner](patch-runner.md) | The QuickJS sandbox and how a description becomes nodes and cables |
| [The board and the engine](board-and-engine.md) | The Code node, its Worker, and how the result is loaded in the browser and in the app |
| [The lifecycle of a script](lifecycle.md) | From typing to sound, and from opening a patch to sound, step by step |
| [Limits and safety](limits.md) | What is refused, the cost estimate, and the sandboxes |
| [Running the tests](testing.md) | Every test suite, the commands, and what each one covers |
