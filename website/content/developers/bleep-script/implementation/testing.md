---
title: Running the tests
description: How to run the Bleep Script unit tests: the whole suite, a single file, the Wasmtime and browser checks, and what each test covers.
order: 70
---

# Running the tests

All Bleep Script tests are in `patch/script/test/` and run with node. They need no browser and no audio device.

## Setup

You need node 22 or later.

```bash
cd patch/script
npm install
```

## Run everything

```bash
npm test
```

This is what CI runs. It takes about a minute and a half, and ends with `all library tests passed`. It runs these steps in order, and stops at the first one that fails:

| Step | What it covers |
|---|---|
| `node build.mjs` | Compiles the two example modules (`src/gains.dsp.ts`, `src/synth-voice.dsp.ts`) and the script modules of `patch/modules/` (`language: bleep-script`) to `build/`. A compile error here fails the run. |
| `test/transform.test.mjs` | The transform: the generated description against a hand-written one, errors with file and line, int, choice, bool and float params, two modules in one file, the subset checker and the cost estimate |
| `test/patch.test.mjs` | Patch scripts: the sandbox and its limits, `materialize` against the module types, unit conversion |
| `test/docs.test.mjs` | The documentation: every block fenced as ` ```ts compile ` in `website/content/developers/bleep-script/` compiles, and the tutorials' modules do what the text says |
| `test/spike.mjs` | The Gains module in the browser module host (V8): behaviour against a reference model, knob changes, speed |
| `test/dsp/all.mjs` | The library, one process per file (see below) |

## Run one file

```bash
node test/transform.test.mjs
node test/dsp/filters.test.mjs
node test/dsp/all.mjs        # all library tests
```

Each prints one `ok` or `FAIL` line per check and exits non-zero if any failed.

## The library tests

`test/dsp/` has one test file per library file (`osc`, `filters`, `delay`, `random`, `env`, `dynamics`, `fx`, `util`), each with a `*.harness.ts`: an AssemblyScript wrapper that exposes the functions to node. They check shapes, aliasing, filter responses, timing, and that processing allocates nothing.

| File | What it covers |
|---|---|
| `module.test.mjs` | The library inside a module script, with the subset checker: calling library code breaks no real-time rule, and a cost is estimated |
| `docs.test.mjs` | Every export of the library is listed in `library.md`, and the page's examples compile (`test/doc-examples.mjs` wraps each one into a whole module) |

If you add a library function, `docs.test.mjs` fails until the function has an entry and an example in [Library](../library.md).

## Checks that need more

| Check | How | Needs |
|---|---|---|
| The engine's Wasmtime host runs the same module | `test/wasmtime-check.sh` | The Wasmtime C API that `scripts/experiments/wasm-spike.sh` downloads to `build/wasm-spike/wasmtime`, and `clang++` |
| A module's own UI in the real sandbox (a worker in a sandboxed frame), driven by a real mouse, with screenshots | `node test/browser/ui-chrome.mjs <outdir>` | Chrome (`CHROME=…` if it is not in the usual place) and `node build.mjs` first |
| The sandbox of the UI frame: escape attempts, endless loops | `test/browser/run-custom-ui.sh` | Chrome |
| The compiler runs in a page | Start the `script-spike` server from `.claude/launch.json` (it serves `patch/` on port 8767) and open `/script/test/browser/index.html` | A browser |
| The custom UI frame | `test/browser/custom-ui.html`, served the same way | A browser |

## The board's side

CI also runs three tests for the browser part of the Code node, from the repository root:

```bash
node patch/web/test/board-code-test.mjs
node patch/web/test/library-client-test.mjs
node patch/web/test/user-modules-test.mjs
node patch/web/test/web-settings-test.mjs
```

`board-code-test.mjs` checks the Code node without a compiler: its type description, when its view is rebuilt, and that a board with Code nodes is handed to the compiler once.

## When you change something

| You changed | Run |
|---|---|
| A library file | `node test/dsp/<file>.test.mjs`, then `node test/dsp/docs.test.mjs` |
| The transform or the checker | `node test/transform.test.mjs`, then `npm test` |
| A page in `website/content/developers/bleep-script/` that has code | `node test/docs.test.mjs` |
| The patch runner | `node test/patch.test.mjs` |
| `board-code.js` | `node patch/web/test/board-code-test.mjs` |
| `user-modules.js`, or how `library-client.js` lists the saved modules | `node patch/web/test/user-modules-test.mjs` |
