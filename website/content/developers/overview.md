---
title: Developer documentation
description: Which developer guide is for you, and how the pieces of Beautiful Bleep fit together.
order: -10
---

# Build with Beautiful Bleep

Bleep is GPL-3.0-or-later with a module exception, so your modules can be closed source or paid; Bleep Bus is MIT. See [Licensing](modules/licensing.md). The documentation has five parts, each with its own overview page and its own menu in the sidebar.

| Section | What it is for | Start here |
|---|---|---|
| **Bleep Bus** | Make plugins talk to each other in any DAW: the open protocol, SDK, specification and conformance | [Bleep Bus overview](bleep-bus/overview.md) |
| **Bleep Assistant** | The AI assistant in the board: how it works, how to extend it, how it is measured | [Assistant overview](bleep-assistant/overview.md) |
| **Development** | Work on Bleep itself: the plugins in Live, the standalone app, Bleep Play in the browser, and modules | [Development overview](development/overview.md) |
| **Bleep Script** | Write modules, message routing and generated patches in code (AssemblyScript and TypeScript) | [Bleep Script overview](bleep-script/overview.md) |
| **Setup and release** | Install the tools, build everything, cut a release, configure the website | [Setup overview](setup/overview.md) |

## I want to…

| I want to… | Read |
|---|---|
| Send or receive a per-sample signal from my own plugin | [Bleep Bus quickstart](bleep-bus/quickstart.md) |
| Add a sound, effect or utility to the board | [Modules](modules/overview.md) |
| Check an exact contract (module ABI, signing, library) | [Module ABI](modules/module-abi.md), [Signing](modules/signing.md), [Library](modules/library.md) |
| Write a module or a patch in code, in the browser | [Bleep Script](bleep-script/overview.md) |
| Change the Bleep plugins in Live | [Plugins](plugins/overview.md) |
| Change the standalone app | [Standalone app](app/standalone-app.md) |
| Change Bleep Play, the board in the browser | [Web](web/bleep-play.md) |
| Work on the Bleep Assistant, or measure it | [Bleep Assistant](bleep-assistant/overview.md) |
| Set up my computer, build or release | [Developer setup](setup/overview.md), [Build and release](setup/build-and-release.md) |
| Set an environment variable or option | [Configuration](setup/configuration.md) |

## How the pieces fit

![Bleep plugins in Live, the Bleep App and Bleep Play in the browser each run an engine and board. They load modules, one .wasm file each, installed from the Bleep Library. The Bleep Bus is a separate open protocol between any plugins.](/img/developer-overview.svg)

- The [Architecture overview](development/architecture.md) explains all of this in more depth.
- **Modules** are the nodes on the board (oscillators, filters, sequencers). Each is a standalone WebAssembly file, so the same module runs in the plugins, the app and the browser. They are installed from the Bleep Library. [Bleep Script](bleep-script/overview.md) is a way to write them in code.
- **Plugins** are the VST3s you add in Live. A set has one engine; the first plugin loaded creates it and the others share it. Ports connect a track to the board.
- **The app and the web build** run the same board without a DAW. The three can exchange audio, MIDI and sync through bridges.
- **The Bleep Assistant** is a chat in the board in which an AI agent helps with a patch.
- **Bleep Bus** is separate from all of this: an open protocol for per-sample control signals between any audio plugins.
