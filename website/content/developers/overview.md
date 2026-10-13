---
title: Developer overview
description: Which developer guide is for you, and how the pieces of Beautiful Bleep fit together.
order: 0
---

# Build with Beautiful Bleep

Everything here is MIT-licensed. Pick the guide that matches what you want to build.

| I want to… | Start here |
|---|---|
| Make plugins talk to each other, in any DAW | [Bleep Bus quickstart](quickstart.md) |
| Add a sound, effect or utility to the board | [Modules](modules/01-overview.md) |
| Work on the Bleep plugins in Ableton Live | [Plugins](plugins/01-overview.md) |
| Work on the standalone Bleep App | [Standalone app](app/01-standalone-app.md) |
| Work on Bleep Play, the board in the browser | [Web](web/01-bleep-play.md) |
| Check an exact contract (ABI, signing, store) | [Reference](reference/module-abi.md) |

## How the pieces fit

```
                      Bleep Bus (open protocol, shared memory)
                                 │  between any plugins
 ┌───────────────────────────────┼───────────────────────────────┐
 │  Bleep plugins in Live        │   Bleep App (standalone)      │   Bleep Play (browser)
 │  Board, MIDI/Audio ports,     │   same engine, own MIDI ports │   board UI + engine in JS,
 │  Instrument, FX               │   Link, Audio Bridge server   │   AudioWorklet
 └───────────────┬───────────────┴───────────────┬───────────────┴───────────┬───────
                 │        one engine and board per process (native)          │
                 └──────────────── modules: one .wasm per module ────────────┘
                                           ▲
                          Bleep Store: signed modules, plugins, presets
```

- **Modules** are the nodes on the board (oscillators, filters, sequencers). Each is a standalone WebAssembly file, so the same module runs in the plugins, the app and the browser. They are installed from the Bleep Store.
- **Plugins** are the VST3s you add in Live. A set has one engine; the first plugin loaded creates it and the others share it. Ports connect a track to the board.
- **The app and the web build** run the same board without a DAW. The three can exchange audio, MIDI and sync through bridges.
- **Bleep Bus** is separate from all of this: an open protocol for per-sample control signals between any audio plugins.

## Plugin or module?

A **module** lives on the board: it has jacks, knobs and a view, and it is processed by the engine. A **plugin** is something a DAW loads. If your idea is a new sound or effect, write a module. If it must appear in a DAW's device chain, or exchange signals with other plugins, it is a plugin (a Bleep plugin, or any plugin using Bleep Bus).

## For coding assistants

Every audience has single-file versions of its documentation and an `llms.txt` index; see "Single files" in the sidebar.
