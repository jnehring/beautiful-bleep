---
title: Glossary
description: The words used across Beautiful Bleep: board, module, cell, Bleep plugin, Bleep App, Bleep Play and more.
order: 1
---

# Glossary

**Beautiful Bleep** is the whole technology: the engine, the board, the modules,
the plugins for your DAW, the app, the browser version, the library and the open
protocol. The names below are the ones used everywhere in the docs and in the
programs.

## Ways to run it

The same board runs in three places. Patches, presets and modules work in all of them.

| Term | What it is |
|---|---|
| **Bleep plugin** | Everything you add in your DAW (Ableton Live today): the main plugin, which stores and opens the board, and the ports. VST3. |
| **Bleep App** | The standalone app: the board without a DAW, with its own MIDI ports and Ableton Link. |
| **Bleep Play** | The board in your browser, with no install. Modules load from the Bleep Library on demand. |

## The board and what is on it

| Term | What it is |
|---|---|
| **Board** | The patching canvas. One per Live set, or per project in the app. It shows every node, cable and cell. |
| **Node** | Anything on the board that has jacks: a module, a port, a cell, an external plugin. |
| **Module** | A node type that processes signals: Function, Random, Filter and so on. Modules exist only on the board, never as plugins in Live. Shipped as `.bleepmod` packages. |
| **Cable** | A directed connection from an output jack to an input jack. |
| **Jack** | An input or output on a node. |
| **Cell** | A named group of nodes with its own jacks. Cells nest, can be copied and saved as cell presets. |
| **Voice Cell** | A cell that runs the voice you patch inside it once per note, so one voice becomes a polyphonic instrument. |
| **Panel** | A front panel of controls (dials, sliders, buttons, keys) for a cell or the board. |
| **Module view** | A module's full interface: knobs, switches, scopes. It opens as a window inside the board. |
| **Engine** | The shared code that runs the board. One engine runs per process, shared by every Bleep plugin loaded. |

## Bleep plugins in Live

| Term | What it is |
|---|---|
| **Bleep Board plugin** | The main plugin. Every Live set that uses Beautiful Bleep needs exactly one, on any track. It stores the board and opens it. |
| **Port** | A Bleep plugin on a track that connects that track to the board: *Bleep MIDI In*, *MIDI Out*, *Audio In*, *Audio Out*, *Instrument*, *FX*. Each port is one node on the board. |
| **Ableton bridge** | The ports together. Later bridges connect the board to other worlds the same way. |
| **Ghost** | A node whose port is not available right now (deleted, deactivated, not loaded yet). It is greyed out and keeps its cables. |
| **Bleep Audio Bridge** | A plugin in Live that connects a track's audio to a running Bleep App. |

## Saving and sharing

| Term | What it is |
|---|---|
| **Project** | A whole board with its panels: what you save, open and share. Demo projects, your own and the Library's are all projects. |
| **Preset** | A reusable cell (a **cell preset**), which can bring a panel of its own. Whole boards are projects, not presets. |
| **Bleep Library** | Where plugins, modules and presets are installed from. Downloading needs no login; sharing a preset needs an account. |

"Patch" and "patching" stay everyday words for connecting cables. They are not
names of a file or a product.

## For developers

| Term | What it is |
|---|---|
| **Bleep Bus** | The open protocol and SDK that lets other plugins (Grit, Cinch, third-party) send and receive per-sample control signals through shared memory and join the board. |
| **Registry** | The technical name of the Bleep Library's interface (`/registry/v1/`, `BLEEP_REGISTRY_URL`). In prose it is always the Bleep Library. |
