# Bleep Board in the browser

The board, running completely in the visitor's browser. No server, no plugin.
Build with `scripts/build-web.sh` (needs the Emscripten SDK); the website serves
the result at `/play/` and embeds it on `/board/`.

```
main thread                               AudioWorklet (real time)
-----------                               -------------------------
board UI (patch/board/ui, unchanged)      worklet.js
board-demo.js  — the document, undo,        graph.js   — the graph runner
                 presets (as in the demo)    module-host.js — one ModuleInstance
bleep-web.js   — loads module .wasm  ──►     per node, each its own .wasm
                 on demand, keyboard, MIDI
```

## One `.wasm` per module folder

`src/WebShim.cpp` is linked with a module's own `*Module.cpp` (and its
header-only DSP) into a **standalone** WebAssembly file: no JUCE, no Emscripten
JS glue, no shared memory. It exports a small C ABI (spec JSON, create, knobs,
process, notes, perform, live values). `module-host.js` instantiates it with
plain `WebAssembly.Module`/`Instance`, so the same code runs in an
AudioWorklet and in node (the tests).

Why not Emscripten dynamic linking (`SIDE_MODULE`)? Standalone files need no
loader, no shared function table and nothing special in the worklet. The cost
is a copy of the (tiny) per-chunk buffers between JS and the module's memory.

`build_modules.py` builds every folder, reads each file's node types back out
of it, and writes `manifest.json` (`modules`, `types → module`, `unavailable`).
The page loads a module's file the first time a board contains one of its types.

## The engine

`graph.js` ports `engine/Program.cpp`: cell flattening, normalled jacks,
`effective = clamp(knob + Σ source × amount)`, topological order, feedback
through the previous chunk, 32-sample chunks inside the 128-sample render
quantum. Port nodes (Audio Out, MIDI In/Device) are built in; the computer
keyboard and Web MIDI play MIDI In.

## Status (spike)

- 48 of 72 module folders build unchanged. The other 24 still use
  `juce::var`/`String`/`JSON` for node data (sequencers, quantizers, Button,
  Drum Grid, samplers…). Next step: compile `juce_core` under Emscripten or
  replace the few calls with a small JSON shim. They show up in the board and
  stay silent (`manifest.unavailable` lists them with the reason).
- Not ported yet: Voice Cells, Harmony Master/bus, Link, Macros, media import,
  audio input.
- The engine is JavaScript for now, not a `core.wasm`: `Board.cpp` and
  `Engine.cpp` are JUCE-heavy. It can move to wasm later without changing the
  module files or the UI contract.

## Hosting

Static files. `manifest.base` can point at another origin (for example an
S3/MinIO bucket behind the site's Caddy) to ship modules separately from the site.

## Tests

```
scripts/build-web.sh build/web/site
node patch/web/test/graph-test.mjs build/web/site
```
