# Bleep Script (spike)

AssemblyScript modules for Beautiful Bleep. Concept and design: [doc/specs/bleep-script.md](../../doc/specs/bleep-script.md).
This folder is the **spike** of phase 1 (section 14 of the concept): can an AssemblyScript module be compiled to a file that the
Bleep module ABI, the browser host and the engine's Wasmtime host accept, with only the compiler and no C++ toolchain?

```
cd patch/script
npm install
npm run build                       # src/*.dsp.ts -> build/*.wasm (asc + the Bleep transform, in node)
npm test                            # build, test/transform.test.mjs, then test/spike.mjs (the module in the browser module host, V8)
test/wasmtime-check.sh              # the same file in the engine's Wasmtime host (needs build/wasm-spike/wasmtime)
```

Compile in a browser: start the `script-spike` server (`.claude/launch.json`, serves `patch/` on port 8767) and open
`/script/test/browser/index.html`. The page compiles the module with `asc` in memory, runs a transform, and tests the result.

## Files

| File | What |
|---|---|
| `src/bleep/abi.ts` | The module-independent part of the ABI: `Module` base class (buffers, text, scratch) |
| `src/bleep/dsp.ts`, `src/bleep/format.ts` | The start of the standard library: `Smoother`, `PeakHold`, `dbToLin`, number formatting |
| `src/gains.dsp.ts` | **Gains**: volume, mute and solo for one mixer channel, with smoothing and a level probe. The interface is declared with decorators |
| `transform/bleep.mjs` | **The Bleep Script transform**: reads the decorators, generates the node type description and the `bleep_*` exports (see the concept, section 7) |
| `build.mjs` | Calls `asc` with the transform and the flags below; also writes `build/*.spec.json` and the generated `build/*.bleep-entry.ts` |
| `test/transform.test.mjs` | The transform: the generated description against a hand-written one, errors with file and line, int/choice/bool/float params, two modules in one file |
| `test/spike.mjs` | Node: module host, reference model, behaviour, speed |
| `test/wasmtime_check.cpp`, `test/wasmtime-check.sh` | The engine's `WasmRuntime` (Wasmtime) |
| `test/browser/` | The compiler and a transform running in a page |

## Compiler flags and why

| Flag | Why |
|---|---|
| `--runtime stub` | No garbage collector; nothing is allocated while processing. `bleep_destroy` frees nothing (see results) |
| `--use abort=` | Removes the `env.abort` import: the file imports nothing at all |
| `--exportStart _initialize` | The ABI's `_initialize` runs the module's global initialisers |
| `--optimizeLevel 3 --shrinkLevel 1 --noAssert` | Size and speed |

## Results (Apple M-series, 48 kHz, one core, AssemblyScript 0.28.20)

| Question | Result |
|---|---|
| Does it compile to a file the ABI accepts? | Yes: 10 KB, **no imports**, exports `memory`, `_initialize` and all `bleep_*` functions |
| Does the browser module host (`patch/web/js/module-host.js`) run it? | Yes. Output matches a plain-JS reference model within 1e-5 of the peak (f32 against f64) with random knob changes |
| Does the engine's Wasmtime host (`WasmRuntime`) accept and run it? | Yes: it passes `Compiled::compile`'s import check and the same behaviour checks |
| Speed | Hand-written entry: 9 ns per sample in V8, 16 ns in Wasmtime. **With the decorators and the generated glue: 15 ns in V8, 24 ns in Wasmtime** (0.11 % of a core at 48 kHz) for the Gains channel. Not compared with a C++ build of the same code |
| Does the compiler run in a browser page? | Yes: `asc.main` with in-memory `readFile`/`writeFile`, about 0.6 to 0.9 s for this module |
| Do transforms run in the browser build? | Yes. The Bleep transform runs in the page: it reads the decorators in `afterParse` and adds the generated entry file with `parser.parseFile`. AssemblyScript ignores decorators it does not know |
| Is the browser build the same as the node build? | Yes, **byte for byte** |
| Compile errors? | `asc.main` returns `error` and calls `reportDiagnostic` with the message and the source range: enough for editor markers |

## What the spike found

- AssemblyScript has no `toFixed`: `bleep/format.ts` has `formatNumber`.
- `@in` and `@out` do not parse (`in` is reserved); the decorators are `@input` and `@output`.
- The decorator version is about 50 % slower per sample than the hand-written one. The glue copies each input and output between the ABI buffers and the module's fields on every sample, and `Smoother`/`PeakHold` are objects behind a field. Worth measuring before optimising: copy only the jacks that are connected, and keep small helpers as value-like locals.
- With `--runtime stub` nothing is ever freed, so `bleep_destroy` frees nothing. The host drops a removed node's whole instance (and its memory, capped at 64 MiB), so nothing leaks across nodes; what stays is allocation inside one live instance. That is harmless while all allocation happens in `init()`. If a module must allocate later, use `--runtime minimal` or a bump allocator that `bleep_reset` rewinds.
- A transform sees the standard library's sources too. Filter by `source.normalizedPath.startsWith("~lib/")`.
- `Module` is an abstract class with virtual `process`; the compiler inlines nothing across it, and it still costs 16 ns per sample for this module.
- Events (`NoteEvent` with sample offsets), notes jacks, probes with arrays, `bleep_perform` and `bleep_set_data` are stubbed: not yet exercised.
- The real-time limits are not enforced yet. A module that loops forever is stopped by Wasmtime's time budget, which is not tested here.

## Not done yet

`@button`, `@on` event handlers with notes jacks, array params, exponential params, TSDoc descriptions, the subset checker, the cost bound, the Code module, layer 1, and the widget registry:
phases 2 to 7 of the concept.
