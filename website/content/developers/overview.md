---
title: Developer documentation
description: Which developer guide is for you, and how the pieces of Beautiful Bleep fit together.
order: -10
---

# Build with Beautiful Bleep

Everything here is MIT-licensed. Pick the guide that matches what you want to build.

| I want to… | Start here |
|---|---|
| Make plugins talk to each other, in any DAW | [Bleep Bus quickstart](bleep-bus/quickstart.md) |
| Add a sound, effect or utility to the board | [Modules](modules/overview.md) |
| Check an exact contract (module ABI, signing, library) | [Module ABI](modules/module-abi.md), [Signing](modules/signing.md), [Library](modules/library.md) |
| Work on the Bleep plugins in Ableton Live | [Plugins](plugins/overview.md) |
| Work on the standalone Bleep App | [Standalone app](app/standalone-app.md) |
| Work on Bleep Play, the board in the browser | [Web](web/bleep-play.md) |
| Build, release or configure Bleep | [Contribute](contribute/overview.md) |

## The documentation

| Section | What is in it |
|---|---|
| **Bleep Bus** | The open protocol: [quickstart](bleep-bus/quickstart.md), [API reference](api-reference/00-overview.md), [specification](spec/v0.1/00-overview.md), [conformance](bleep-bus/conformance.md), [RFC process](bleep-bus/rfc-process.md) |
| **Modules** | Writing, packaging and publishing a board module, and the contracts a module meets: ABI, signing, the library |
| **Developer setup** | [Install the tools](setup/overview.md) for modules, plugins, the app, Bleep Play and the website, then [build and release](setup/build-and-release.md) |
| **Contribute** | Working on Bleep itself: [configuration](contribute/configuration.md), the [engine ABI](contribute/engine-abi.md), and the plugins, app and web build |

## How the pieces fit

![Bleep plugins in Live, the Bleep App and Bleep Play in the browser each run an engine and board. They load modules, one .wasm file each, installed from the Bleep Library. The Bleep Bus is a separate open protocol between any plugins.](/img/developer-overview.svg)

- **Modules** are the nodes on the board (oscillators, filters, sequencers). Each is a standalone WebAssembly file, so the same module runs in the plugins, the app and the browser. They are installed from the Bleep Library.
- **Plugins** are the VST3s you add in Live. A set has one engine; the first plugin loaded creates it and the others share it. Ports connect a track to the board.
- **The app and the web build** run the same board without a DAW. The three can exchange audio, MIDI and sync through bridges.
- **Bleep Bus** is separate from all of this: an open protocol for per-sample control signals between any audio plugins.

## Plugin or module?

A **module** lives on the board: it has jacks, knobs and a view, and it is processed by the engine. A **plugin** is something a DAW loads. If your idea is a new sound or effect, write a module. If it must appear in a DAW's device chain, or exchange signals with other plugins, it is a plugin (a Bleep plugin, or any plugin using Bleep Bus).

## For coding assistants

Every audience has single-file versions of its documentation and an `llms.txt` index; see `/docs/llms.txt`.
