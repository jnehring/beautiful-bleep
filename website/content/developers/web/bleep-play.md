---
title: Web developers
description: Bleep Play: the board running entirely in the browser, how it is built and hosted, and how it connects to the app.
order: 10
---

# Web developers

**Bleep Play** is the board running completely in the visitor's browser: no server and no plugin. The website serves it at `/play/` and embeds it on `/board/`.

```
main thread                               AudioWorklet (real time)
-----------                               -------------------------
board UI (patch/board/ui, unchanged)      worklet.js
board-demo.js  — the document, undo,        graph.js        — the graph runner
                 presets                    module-host.js  — one instance per node,
bleep-web.js   — loads module .wasm                           each its own .wasm
                 on demand, keyboard, MIDI
```

The UI is the same as in the plugins and the app. The engine is a JavaScript port of the native one (`graph.js`: cell flattening, normalled jacks, topological order, feedback through the previous chunk, 32-sample chunks inside the 128-sample render quantum). Port nodes are built in; the computer keyboard and Web MIDI play *MIDI In*.

## Modules in the browser

Each module folder is compiled, with a small shim, to **one standalone `.wasm`**: no JUCE glue, no Emscripten JS loader, no shared memory. `module-host.js` instantiates it with plain `WebAssembly.Module` and `Instance`, so the same code runs in an AudioWorklet and in Node (the tests). The file's contract is the [Module ABI](../modules/module-abi.md).

`build_modules.py` builds every folder, reads each file's node types back out, and writes `manifest.json`. The page loads a module the first time a board contains one of its types, from the [Bleep Library](../modules/library.md) of the site, and checks its signature in the browser before running it ([Signing](../modules/signing.md)).

## Build

```bash
scripts/build/build-web.sh                 # needs the Emscripten SDK
scripts/build/build-web.sh --no-modules    # UI and engine only
scripts/build/build-web.sh --modules-only  # modules only
scripts/build/build-web.sh --docker        # Emscripten in Docker
```

About a third of the modules use `juce_core` for node data; `build_modules.py --juce <JUCE 8 checkout>` compiles it once for WebAssembly and links it into those modules (about +200 KB each).

## Test

```bash
node patch/web/test/graph-test.mjs build/web/site
```

The bridge tests (`bridge-protocol-test.mjs`, `bridge-ring-test.mjs`, `bridge-client-test.mjs`, `bridge-engine-test.mjs`) run in plain Node with no build and no network.

## Hosting

Static files, plus the library the page installs its modules from (`/registry/v1/index.json`). `manifest.base` can point at another origin to ship modules separately from the site. The whole website stack runs with `scripts/run/run-website.sh` (Caddy, the API, PostgreSQL and the object storage).

## Connecting to the app

The page can join the Bleep App, and through it Live, over a WebSocket on `127.0.0.1`: audio and MIDI both ways, plus the app's tempo and beat. Nothing connects until the page calls `BleepWeb.connectBridge()`.

```js
const bridge = await BleepWeb.connectBridge({ name: "Chrome", mode: "low" });
bridge.on("channels", (list) => { /* Live ports the hub announces */ });
bridge.on("status", ({ state }) => { /* idle connecting handshake open retrying failed denied closed */ });
bridge.sendMidi("node-7", [[null, 0x90, 60, 100]], { lookaheadBeats: 0.1 });
bridge.requestTempo(128);
```

- **Two paths, one API.** When the page is cross-origin isolated (the app serves it with COOP and COEP), the Worker and the worklet share a `SharedArrayBuffer` ring: mode `low`, 16 ms target fill. Otherwise the client falls back to `safe` with `MessagePort` chunks and 64 ms.
- **Browser limits.** Safari blocks `ws://127.0.0.1` from a secure page and Chrome may ask for local-network access. `connectToApp()` explains the failure and points at the app's own page, `http://127.0.0.1:47100/`.
- **Remote nodes.** A board node bound to a channel carries what the hub sends and sends what is patched into it. *Remote Audio* and *Remote MIDI* nodes let two boards exchange audio and MIDI without Live.

## Not yet in the browser

Voice Cells, the Harmony bus, Link, Macros, audio input, host MIDI out and the media folder (Splice, Grains and Wavetable Osc import find no files) are not ported yet.
