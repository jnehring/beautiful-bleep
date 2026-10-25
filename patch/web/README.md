# Bleep Play

The board, running completely in the visitor's browser. No server, no plugin.
Build with `scripts/build/build-web.sh` (needs the Emscripten SDK; `--no-modules` and `--modules-only` build the
UI and the modules separately); the website serves the result at `/play/` and embeds it on `/board/`.

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
- Audio input: the worklet has one input; `Engine.render(left, right, frames, inL, inR)` feeds the Audio In nodes, and `BleepWeb.input` connects
  the microphone or a looping audio file to it (Bleep Play's effects page uses it). Not the Bleep Bridge's audio, which is separate.
- Voice Cells run (`js/voices.js`): the board is expanded before compiling, one plain cell per voice plus an allocator; a voice that is
  neither held nor sounding is not run. Not ported yet: Harmony Master/bus (modules run, but no shared
  bus), Link, Macros, audio input, host MIDI out, and exporting audio a module made (Grains' freeze).
  The media folder is in the browser: `js/web-media.js` decodes an imported WAV and keeps it in IndexedDB under the native id
  (the page's `importMedia` / `readMedia`); `bleep-web.js` sends the clips a board's nodes name to the worklet once each, and
  `graph.js` answers the modules' `bleep_media_info` / `bleep_media_read` imports from them (`module-host.js`), then sets the node's
  data again so a module that loads in `setData()` finds the clip. Splice, Grains, Sampler and Wavetable Osc load audio this way.
  Modules that start
  threads need a change: Wavetable Osc builds its factory banks on demand
  in the browser.
- The engine is JavaScript for now, not a `core.wasm`: `Board.cpp` and
  `Engine.cpp` are JUCE-heavy. It can move to wasm later without changing the
  module files or the UI contract.

## The bridge to the app

The board can join the Bleep App (and, through it, Live) over a WebSocket on `127.0.0.1`: audio and MIDI both
ways, and the app's tempo and beat. The wire format is `doc/specs/bridges.md` §10; this is the browser side.
Nothing connects until the page calls `BleepWeb.connectBridge()` (or `connectToApp()` from a button).

```
main thread                       Worker (bridge-worker.js)        AudioWorklet (worklet.js)
-----------                       -------------------------        -------------------------
bridge-client.js  ── text ──────► owns the WebSocket               bridge-worklet.js
  channels, sync follower,        pings, reconnect + backoff         BridgeEndpoint: jitter readers,
  MIDI epochs, latency report ◄── forwards text messages             MIDI queues, RemoteBinding
                                  audio packets ◄──► rings ◄──────►  (graph.js nodes read/write it)
```

| File | What |
|---|---|
| `js/bridge-protocol.js` | Pure functions: audio packet encode/decode, JSON message builders and validators, hub clock estimator, beat extrapolation, MIDI epoch rule. |
| `js/bridge-ring.js` | `AudioRing` (planar stereo ring on an `ArrayBuffer` or `SharedArrayBuffer`, counters with `Atomics`), `JitterReader` (§10.4: target fill, ratio nudge, underrun/overrun, resampling), `Packetizer`. |
| `js/bridge-worker.js` | The Worker. `BridgeWorkerCore` holds the logic and takes its environment as arguments (tests run it with a fake socket). |
| `js/bridge-worklet.js` | `BridgeEndpoint`, `RemoteBinding`, and the stand-alone `bleep-bridge` AudioWorkletProcessor. |
| `js/bridge-client.js` | `BridgeClient`, `connectToApp()`, `explainFailure()`. |
| `js/bridge-types.js` | The node types `remote-audio` and `remote-midi` (`REMOTE_TYPES`). |

**Two paths, one API.** When the page is cross-origin isolated (the app serves it with COOP/COEP, §4.1) the mode is
`low`: the Worker writes received audio into a `SharedArrayBuffer` ring that the worklet reads, and drains the ring
the worklet writes; target fill 16 ms. Otherwise the client falls back to `safe` (`client.mode`, `client.modeNote`):
the Worker posts `Float32Array` chunks to the worklet over a `MessagePort` (still not through main-thread JavaScript),
target fill 64 ms. The worklet code above the rings does not know which one it has.

**Remote nodes in the board.** A board node is bound to a channel by `node.remote = <channel key>` (any port-type
node, or `remote-audio` / `remote-midi`). Bound, a node carries what the hub sends on its outputs and sends what is
patched into its inputs to the hub, instead of playing to the local speakers or the computer keyboard:

| Channel `port` | Node type (`nodeTypeForChannel`) | Does |
|---|---|---|
| `audio-in` | `audio-in` | outputs carry what Live sent |
| `midi-in` | `midi-in` | outputs follow Live's MIDI |
| `instrument` | `instrument` | MIDI outputs from Live; audio inputs go back to Live |
| `audio-out` | `audio-out` | inputs go to Live (not to the local speakers) |
| `midi-out` | `midi-out` | the `notes` input goes to Live |
| `audio-insert` | `audio-insert` | outputs = the track's audio, inputs = the return |
| `remote` | `remote-audio`, `remote-midi` | a node the page opened itself (`openChannel`) |

A channel that is offline (the peer is gone, or the link dropped) gives silence; the node and its cables stay.
Edits to `graph.js` are small and marked `[bridge]`: `Engine.bridge`, `PortNode.setRemote/remote/remoteMidi`, the
`kind` of a bound node, `setNotesIn` and one line in `setBoard`. `worklet.js` connects the endpoint and forwards
the `bridge` / `bridge-port` messages. The board UI has to know the two new types (`REMOTE_TYPES`) and create nodes
for announced channels (the `channels` event).

```js
const bridge = await BleepWeb.connectBridge({ name: "Chrome", mode: "low" });   // starts audio, attaches, connects
bridge.on("channels", (list) => …);       // [{ch, kind, dir, key, name, port, source, online, latency, reactive}]
bridge.on("status", ({ state }) => …);    // idle connecting handshake open retrying failed denied closed
bridge.openChannel({ key: "node-7", kind: "midi", dir: "fromWeb", name: "Sequencer" });
bridge.sendMidi("node-7", [[null, 0x90, 60, 100]], { lookaheadBeats: 0.1 });    // null beat = now + lookahead
bridge.getBeat(); bridge.getTempo(); bridge.playing; bridge.leader; bridge.epoch;
bridge.requestTempo(128); bridge.requestPlay(true);
```

`connectToApp({ port })` is the *Connect to app* button: it resolves `{ ok, message, client }` and, when it fails
from a page the app does not serve, explains why (Safari blocks `ws://127.0.0.1` from a secure page; Chrome may ask
for local network access) and points at the app's own page, `http://127.0.0.1:47100/`.

**The board page.** `js/bridge-ui.js` adds the *Connect to app* button (next to *Start audio*) to the web build: it
connects, turns every Live port the hub announces into a port node named *Live: track* (`BleepDemo.mirrorPort` in
`board-demo.js`; the node stays as a ghost when the port goes away) and opens a channel for every *Remote Audio* /
*Remote MIDI* node on the board. The page does not need the Bleep Library to do this: without it only the built-in
ports and the remote nodes run. `BleepWeb.debugBridge()` returns what the worklet's endpoint holds (channels, which node
is bound to which key, the peak of what a bound node sends) when a channel stays silent.

The app serves this page itself when `BLEEP_WEB_ROOT` points at the folder `scripts/build/build-web.sh` wrote (or the
folder is `Contents/Resources/web` in the app bundle): `BLEEP_WEB_ROOT=build/web/site BLEEP_WEB_PORT=47100 "Bleep App"`.
`GET /status` on the app lists the connected boards and, per channel, the jitter buffer's fill and under- and overruns.

**Try it.** With the app running and *Web connection* on:

```
node patch/web/test/bridge-smoke.mjs          # hello → prints welcome, channels, sync; "no hub" when nothing listens
```

then open `http://127.0.0.1:47100/` (the app's own page: isolated, Low latency) and press *Connect to app*.

**Tests** (plain `node`, no build, no network):

```
node patch/web/test/bridge-protocol-test.mjs   # packets, messages, clock, sync, epochs
node patch/web/test/bridge-ring-test.mjs       # ±200 ppm for 10 minutes, steps, underrun/overrun, resampling
node patch/web/test/bridge-client-test.mjs     # fake hub: hello → welcome → channels → MIDI → reconnect, audio through the Worker
node patch/web/test/bridge-engine-test.mjs     # remote nodes in the graph runner
```

## Developing a module in Bleep Play

Bleep Play installs its modules from the Library as packages. To try a module change without packaging or
releasing it:

```
scripts/build/build-web.sh --modules-only      # or: scripts/build/build-web.sh --docker --modules-only
```

Besides `build/web/modules`, this copies the `.wasm` files and the modules' view scripts (`ui/*.js`) to
`website/app/public/play/local-modules/`, which the website's dev site serves next to Bleep Play (skipped when that folder does
not exist; `BLEEP_LOCAL_MODULES=<dir>` picks another one, `off` skips it). Reload the page (it only works when the page is served from `localhost`, `127.0.0.1` or `[::1]`; a deployed site never uses `local-modules/`): the modules and views from `local-modules/` replace the Library's of the same name, and
the status line says "loaded <module> from the local build". Modules not built locally still come from the Library. Without the folder, nothing changes.

## Hosting

Static files. `manifest.base` can point at another origin (for example an
S3/MinIO bucket behind the site's Caddy) to ship modules separately from the site.

## Tests

```
scripts/build/build-web.sh build/web/site
node patch/web/test/graph-test.mjs build/web/site
```
