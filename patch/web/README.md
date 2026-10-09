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

- All 72 module folders build for the browser. About a third use `juce_core`
  (`juce::var`/`String`/`JSON` for node data: sequencers, quantizers, Button,
  Drum Grid, samplers…): `build_modules.py --juce <JUCE 8 checkout>` compiles
  `juce_core` once for WebAssembly (a patched copy: JUCE 8.0.9's wasm platform
  lacks a thread-priority table and an `<emscripten.h>` include) and links it
  into those modules, +~200 KB each. They use wasm exceptions; every ABI call
  is guarded so a C++ exception never reaches the audio thread.
- Node data (`sanitiseData`) runs inside the module: a new node's defaults come
  back to the board document through the engine's `state` message.
- Not ported yet: Voice Cells, Harmony Master/bus (modules run, but no shared
  bus), Link, Macros, audio input, host MIDI out, and the media folder
  (Splice, Grains and Wavetable Osc import find no files; Media.cpp is linked
  so they build; an IndexedDB store is the next step). Modules that start
  threads need a change: Wavetable Osc builds its factory banks on demand
  in the browser.
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
