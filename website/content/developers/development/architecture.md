---
title: Architecture overview
description: How the Bleep board, engine and modules fit together: what a wasm module is, how it reaches the engine from the library, local files or a script, and how the plugins, the standalone app and Bleep Play differ.
order: 5
---

# Architecture overview

Beautiful Bleep is a modular board: oscillators, filters, sequencers and effects are **modules**, you connect them with cables, and the result runs as audio. The same board runs in three places: as plugins inside Ableton Live, as a standalone app, and in a web browser. This page explains how that works underneath: what a module is, how the engine runs it, where modules come from and how they are distributed, how a script becomes a module, and what differs between the three places.

If you only want to use Bleep, the [musicians' documentation](../../musicians/start/getting-started.md) is the place to start. If you want to connect your own plugin to other plugins, that is a different system, the [Bleep Bus](../bleep-bus/architecture.md). This page is about the board itself.

## The big picture

![The Bleep plugins in Live, the Bleep App and Bleep Play each run a board UI, an engine and a module host. All three load the same standalone wasm module files. Bridges connect the plugins to the app by shared memory and the app to the browser by WebSocket.](/img/board-runtimes.svg)

Every host is built from the same three layers:

- **The board UI** is the window you patch in: the cables, the module panels, the preset browser and the library view. It is written in HTML and JavaScript, and it is the same code in the plugins, in the app and in the browser. It edits a copy of the board document and sends the result to the engine.
- **The engine** owns the board. It sanitises the document, compiles it into a program (cells are flattened, cables are sorted into an order that respects what feeds what, and a cycle gets a 32-sample feedback delay), keeps the undo history and runs the program for every block of audio. The native hosts share one C++ engine. The browser has a JavaScript port of it that runs in an AudioWorklet and follows the same rules, so a board sounds the same everywhere.
- **The module host** loads module files and makes one instance per node on the board. The native hosts embed the Wasmtime WebAssembly runtime for this. The browser uses its own WebAssembly support.

Under all of it are the **modules**: one standalone `.wasm` file for each module, with no per-platform code. This is the central design decision. A module is compiled once and the same file runs in a plugin on a Mac, in the app on Windows and in a browser tab. Because a WebAssembly module can only compute (it has no files, no clock and no network), it is also safe to run modules that other people wrote.

The three hosts are connected by **bridges**: the plugins and the app share audio, MIDI and sync through shared memory, and the app talks to Bleep Play through a WebSocket on `127.0.0.1`. The bridges are described in [Bleep plugins](../plugins/bleep-plugins.md), the [standalone app](../app/standalone-app.md) and [Web](../web/bleep-play.md).

## What a module is

A module is a folder in `patch/modules/<slug>/` with a `module.json` (name, category, colour, documentation), the DSP source, optionally a custom view in JavaScript, and its documentation. Building the folder produces one `module.wasm` that provides one or more **node types**. Most modules provide one; the drum modules provide several.

The file follows the [Module ABI](../modules/module-abi.md), a small C interface that every module exports. The important parts:

- **Standalone.** One exported memory, no JavaScript glue and nothing shared with other modules. The only imports allowed are a few stubs, so a module that asks for anything else is refused.
- **Described by the file itself.** `bleep_spec_json` returns the node types as JSON: their jacks, knobs, ranges, meters and defaults. The board UI builds a module's panel from that description, so adding a module touches no shared file.
- **Deterministic.** There is no clock and no randomness from the host, so the same input and knob values give the same output on every host.
- **Single-threaded instances.** An instance is entered by one thread at a time. Knob changes, buttons and other messages are queued by the host and applied between chunks, and nothing on the audio thread waits.

Modules are written in C++ (about a third of them use `juce_core` for node data, and the build links that in for the browser), or in [Bleep Script](#bleep-script-modules). The browser build compiles the C++ ones with Emscripten and adds a small shim that turns the module into the exported C interface.

### How the engine runs a module

![The engine splits a host block into 32-sample chunks. For every chunk it calls bleep_process of each node in cable order, one module instance per node.](/img/board-module-lifecycle.svg)

When a node of a given type is first needed, the module host compiles the file once, and then creates **one instance per node**. The engine reads the pointers to the instance's parameter, input and output buffers once, because they stay fixed for the life of the instance.

Audio runs in **chunks of 32 samples**, whatever the host block size is. A host block of 256 samples is eight chunks. For each chunk the engine goes through the nodes in the order the compiled program gives, writes each node's input buffers, knob values and the transport position, calls `bleep_process`, and reads the output buffers. The next node then reads what the previous one wrote. Slow work, such as reading dials or computing filter coefficients, is done once per chunk; per-sample work is done inside `bleep_process`.

A module can allocate when it is created or prepared, but never while processing: the audio thread must not allocate, lock or do I/O.

## Where modules come from

![Modules reach the module host from the Bleep Library, from local files, or from a Code node compiled in the browser. All three pass the same checks before loading, then the host compiles a module when its node type is first used and runs one instance per node.](/img/board-module-sources.svg)

The apps and plugins can be built **without modules** (that is the default when the Wasmtime host is built in): every module, first-party or not, is then installed from one place and goes through one set of rules. A build option, `BLEEP_BUNDLE_MODULES`, compiles the modules into the host instead, which skips everything below. There are three ways for a module to arrive.

### The Bleep Library

The [Bleep Library](../modules/library.md) is the central place for plugins, modules and presets. Everything that installs, updates or loads one of them talks to the library and nothing else.

A module is published as a **`.bleepmod`** package: a zip with `module.json`, `module.wasm`, optional custom views, and its documentation and screenshot. Published versions are immutable: a fix is a new version, and files are stored under their hash so a cache never goes stale. The library's `index.json` lists the packages; each carries what it needs (`requires.engineAbi`, other modules) and its signature.

Code is **signed**. First-party modules are signed by their developer's key under the project's root key. A module that someone shares through their account is checked by the library (its files, its imports and exports, its node types and its licence) and then signed by the library's community key, so authors do not need a key of their own. Every host checks the signature before it loads anything. See [Signing](../modules/signing.md) for the details, and [Publishing a module](../modules/publishing.md) for the author's side.

Modules reach people in three ways:

- **On demand.** The Library section of the app, or of the plugin window, installs and updates modules one by one. In the browser, the page fetches a module the first time a board contains one of its node types, and checks its signature before running it.
- **In bundles.** The first-run setup offers a *default modules* bundle (every first-party module, about 25 MB of wasm) and a *default plugins* bundle, so a new user does not install eighty modules by hand. An offline installer carries both.
- **By hand**, as described next.

A **plugin in Live never downloads anything by itself.** A download inside an audio host would be risky, so the plugin uses the set of modules installed on the machine. A board that uses a module that is not installed shows a placeholder node until the module is installed from the Library section.

### Local files

Modules can also be copied into a folder. Modules installed from the library live in `<data>/modules/registry/<id>/<version>/`, which the Library section manages. Your own modules go in `<data>/modules/local/`, as a `.bleepmod`, or as a `<name>.wasm` with a `<name>.json` (the `module.json`) next to it. The folder is read at start and again when it changes. `<data>` is `~/Library/Application Support/Bleep` on macOS, `%APPDATA%\Bleep` on Windows and `~/.local/share/Bleep` on Linux.

Local files go through the same checks as a download. An unsigned module loads only when *Allow unsigned modules* is switched on in **Settings → Security**, which the app, the plugins and the Library section all read from the same settings file. When several copies provide the same node type, the engine picks the highest compatible version, then a signed one over an unsigned one, then the manual folder over the library.

### Bleep Script modules

[Bleep Script](../bleep-script/overview.md) is a third way to get a module. A **Code node** on the board has an editor and a Compile button. A *module script* is an [AssemblyScript](https://www.assemblyscript.org/) class, with decorators such as `@input`, `@output` and `@param` that declare the jacks and knobs, and a `sample()` or `block()` method that does the DSP. The compiler turns it into a `.wasm` file that follows the same Module ABI as every other module, so the engine cannot tell the difference.

Where this runs today:

- **In Bleep Play** the compiler runs in the browser, in a Worker, and everything is compiled on your own machine. There is nothing to install.
- **In the app and the plugins** the engine can already run Code nodes and keeps their cables and knob values, but the compiler is not shipped with those builds yet. A patch saved in Bleep Play with Code nodes in it therefore plays there, but you cannot edit the script.

The node's source is saved with the patch as text and the compiled module travels with the node. The engine registers a node type for that node alone (named from the node and a hash of its source), and it applies the same checks as for an installed module: it must be a conforming module with exactly one node type and may import nothing the ABI does not allow. Its own limits for memory and time per call still apply.

The first-party script modules in `patch/modules/` (they have `"language": "bleep-script"` in their `module.json`) are built and packaged like the C++ ones, so for a user they are ordinary library modules. A *patch script* is different: it does not process audio, it runs once and describes which modules and cables to create. See [Patch scripts](../bleep-script/patch-scripts.md).

## The three hosts

|  | Bleep plugins in Live | Bleep App | Bleep Play |
|---|---|---|---|
| **What it is** | VST3 plugins in Ableton Live | A standalone program | The board in a browser tab, served at `/play/` |
| **Engine** | C++. The first Bleep plugin loaded creates one engine per Live set; the others find it and use it through [`IEngine`](engine-abi.md) | C++, the same engine code | JavaScript port, running in an AudioWorklet |
| **Module host** | Wasmtime | Wasmtime | WebAssembly in the AudioWorklet |
| **Who owns the audio** | Live. Ports (MIDI In/Out, Audio In/Out, Instrument, FX) connect a track to the board | The app's own audio device, and *System* audio from the computer; while a Live bridge is connected, Live's blocks drive the app | The browser's AudioContext |
| **MIDI** | Live's tracks, through the ports | The app's own MIDI ports (*Bleep App 1…n*) | Web MIDI and the computer keyboard |
| **Modules arrive from** | The set installed on the machine by the app or the plugin window; never downloaded inside Live | The Library section, local files, bundles | Fetched from the site's library on first use, signature checked in the browser |
| **Code nodes** | Run; compiler not shipped yet | Run; compiler not shipped yet | Compile and run |
| **Sync** | Live's transport | Ableton Link, and Live's transport while bridged | The app's tempo and beat, when connected |
| **Latency between ports** | With Bleep Board in the set, its own track has no latency and each crossing to or from another track takes exactly one block, whatever order Live runs the tracks in (input port to output port: two) | Not applicable | Not applicable |

A few differences deserve more explanation.

**One engine per Live set.** Each Bleep plugin is its own compiled file, yet a set has only one board. The first plugin loaded creates the engine and publishes it in the process, and it pins itself so it is never unloaded. The other plugins call it through `IEngine`. Two builds can share an engine only when their *major* ABI versions match; a different minor version is fine. See the [Engine ABI](engine-abi.md). For each host block the first plugin to run claims the block and runs the compiled board, and plugins exchange their audio with the engine through small tagged rings.

**The app is the hub.** Browsers cannot open shared memory or talk to a plugin, and a plugin that hosted a socket server would make every Live set run a server. So the app, which runs once per machine anyway, is the hub: Live reaches the app through shared memory that is locked to the sample clock, and Bleep Play reaches the app through a WebSocket on localhost, where audio is buffered with a jitter buffer instead. A plugin whose **Board** menu says *Bleep Play* goes through the app as well. Both bridges work on one computer only, and the web connection is off until you turn it on in **Settings → Web**. See `doc/specs/bridges.md` in the repository for the protocols.

**The browser has no plugin and no installation.** Bleep Play needs no server for audio: it is static files plus the library the page installs its modules from. The price is that some things are not ported yet: Voice Cells, the Harmony bus, Link, Macros, audio input, host MIDI out and the media folder.

## Not the Bleep Bus

The Bleep Bus is a different thing with a similar name. It lets *any* plugins, with or without Bleep, exchange per-sample control signals through shared memory, and it does not know about the board, the engine or any module. The cables on the board stay inside one engine. The two systems share only an idea, signals between things, and are described in separate places: the Bus in [its architecture overview](../bleep-bus/architecture.md), and the board and modules here.

## Where to read next

| I want to… | Read |
|---|---|
| Write a module in C++ | [Writing a module](../modules/writing-a-module.md), [Module ABI](../modules/module-abi.md) |
| Write a module as a script | [Bleep Script](../bleep-script/overview.md), [Module scripts](../bleep-script/module-scripts.md) |
| Publish a module | [Publishing](../modules/publishing.md), [Signing](../modules/signing.md), [Library](../modules/library.md) |
| Change how plugins share an engine | [Engine ABI](engine-abi.md), [Bleep plugins](../plugins/bleep-plugins.md) |
| Change the app or the browser version | [Standalone app](../app/standalone-app.md), [Web](../web/bleep-play.md) |
