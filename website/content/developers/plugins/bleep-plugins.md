---
title: Bleep plugins
description: The plugins in Live, how they share one engine, how to build and reload them, and how they are released.
order: 20
---

# Bleep plugins

The Bleep plugins are VST3s for Ableton Live. Modules are not plugins: they are nodes on the board. In Live you add only:

| Plugin | Live device | On the board |
|---|---|---|
| **Bleep Board** | instrument (MIDI in, audio out) | required once per set; stores and opens the board; 16 macros |
| **Bleep MIDI In** | instrument | notes, pitch, gate, velocity and CCs from a MIDI track |
| **Bleep MIDI Out** | instrument (VST3 MIDI out) | notes, gate/pitch, CCs and bend to another track |
| **Bleep Audio In** | audio effect | the track's audio |
| **Bleep Audio Out** | instrument | board audio on its own track |
| **Bleep Instrument** | instrument | one instrument preset with its panel: MIDI in, its cell, audio out |
| **Bleep FX** | audio effect | one effect preset with its panel: the track's audio through its cell, dry/wet |
| **Bleep Audio Bridge** | audio effect | connects Live to the standalone Bleep App |

MIDI In/Out and Audio In/Out have a **Board** menu (*This set*, *Bleep App*, *Bleep Play*): the plugin then talks to that board instead of this set's.

## How they fit together

- **One engine per process.** Every plugin binary contains the engine code. The first Bleep plugin loaded creates the engine and publishes it in the process; the others use it. That binary pins itself so it is never unloaded. The rules, and how the interface may change, are in the [Engine ABI](../development/engine-abi.md): plugins share an engine when their major versions match, and a different minor is fine.
- **Ticks.** For each host block, the first plugin to run claims the block and runs the compiled board. Plugins exchange their block with the engine through small tagged rings, so a signal from an input port to an output port takes exactly two blocks whatever order Live runs the tracks in. Output ports report that latency to Live.
- **The board** is a JSON document owned by the engine and saved in Bleep Board's state. The page edits a copy and commits it; the engine sanitises it, compiles it (cells are flattened, cycles get a 32-sample feedback delay) and keeps the undo stack.
- **Ports** appear on the board on their own and cannot be deleted there. They turn into ghosts, with their cables kept, when their plugin is gone.

## Build

```bash
./bleep build plugins --juce /path/to/JUCE    # or BLEEP_JUCE_DIR; otherwise JUCE 8.0.9 is downloaded
./bleep build plugins --install               # also copy the VST3s to your plugin folder
```

The script builds into `build/patch/` and runs the DSP, engine and headless-host tests. VST3 and Live only for now. Without the script: `cmake -S patch -B build/patch -DBLEEP_JUCE_DIR=… -DBLEEP_FORMATS=VST3`, then `cmake --build`, with `--target BleepMidiIn_VST3` and so on to build only some plugins. Build them all when the engine major has changed.

## Developing in Live

Live keeps a plugin's code loaded until it quits, and overwriting a loaded plugin can crash it. So:

- **UI changes (HTML, CSS, JS):** build once with `--install --ui-dev`. These builds read the board UI from `patch/` instead of the embedded copy; press ⌘R in the board window after an edit. Never ship `--ui-dev` builds.
- **DSP, bus or C++ changes:** save your test set and run `./bleep run live <set.als>`. It builds first and quits Live only if the build succeeded. It never force-quits Live.
- **Without Live:** `scripts/run/ui-server.py` runs the board UI in a browser with a fake engine, and the engine tests simulate Live's parallel tracks (`ctest --test-dir build/patch`).

## Talking to other boards

A plugin's **Board** setting chooses the board on its other side. The wire formats between Live, the app and the browser are described in the bridges design document in the repository (`doc/specs/bridges.md`); the app's side is in [Standalone app](../app/standalone-app.md) and the browser's in [Web](../web/bleep-play.md).

## Release

Plugins are signed with your developer key and released to the [Bleep Library](../modules/library.md) with `scripts/release/release.py`. The rules are in [Signing](../modules/signing.md). The operating-system signing (macOS Developer ID and notarisation) is separate and not automated.

## Licences

The source is MIT. Binaries built with JUCE are also covered by JUCE's licence (AGPLv3 or a commercial one): check that before you distribute builds.
