---
title: Standalone app
description: Build, run and extend the Bleep App: the board without a DAW, with its own MIDI ports, Link and bridge server.
order: 10
---

# Standalone app

The **Bleep App** is the same engine, board and modules as the plugins, without a DAW. Besides the board it adds projects, a preset browser, an audio device, system audio, its own MIDI ports, Ableton Link and the servers that connect it to Live and to the browser.

## Prerequisites

CMake 3.22 or newer, a C++ compiler (Xcode command line tools on macOS, Visual Studio on Windows), optionally Ninja, and JUCE 8.0.9 (downloaded on the first build, or `--juce <dir>` / `BLEEP_JUCE_DIR`). The first build also fetches Ableton Link 4.1.

## Build and run

```bash
scripts/run/run-app.sh                        # Release build, then start with console output here
scripts/run/run-app.sh my-project.bleepboard  # open a project
scripts/run/run-app.sh --no-build             # start the last build
scripts/run/run-app.sh --smoke                # no audio inputs or Link; print a report and quit
scripts/run/run-app.sh --ui-dev               # read the board UI from patch/; ⌘R after an edit
```

Without the script: `cmake -S patch -B build/patch -DCMAKE_BUILD_TYPE=Release -DBLEEP_JUCE_DIR=…`, then `cmake --build build/patch --target BleepApp`. The result is `build/patch/BleepApp_artefacts/Release/Bleep App.app` (macOS) or an executable in the same folder on Windows.

| CMake option | Default | Effect |
|---|---|---|
| `BLEEP_BUILD_APP` | ON | Build the standalone app |
| `BLEEP_LINK` | ON | Include Ableton Link. **This makes the app binary GPL.** Turn it off for a build that must stay MIT |
| `BLEEP_UI_DEV` | OFF | Development only: the UI comes from the source tree. Never ship |
| `BLEEP_LINK_DIR` | unset | Use a local Link checkout instead of downloading it |

## What the app adds

- **Projects and presets:** `.bleepboard` projects; a preset browser with five demo boards for every advanced module and your own boards.
- **Audio and MIDI:** channel pairs of the audio device become *In 1/2*, *Out 1/2*… ports. The app creates its own MIDI ports (*Bleep App 1…n*), which Live can use as *MIDI From* and *MIDI To*.
- **System audio:** what the computer plays, as a *System* node. Core Audio tap on macOS 14.2+, WASAPI loopback on Windows, PulseAudio or PipeWire monitor on Linux (needs libpulse at build time).
- **Ableton Link:** the *Link* node puts tempo, beat, bar, clock and start/stop on the board.
- **Bleep Audio Bridge:** each bridge plugin in Live is a node with *Send* and *Return*; while bridges are connected, Live's audio blocks drive the app.
- **Settings:** File → Settings (⌘,) has Audio, MIDI and sync, Web, Library and Security; plugins and Bleep Play have their own tabs (design: `doc/specs/settings.md` in the repository; for musicians: [Settings](../../musicians/use/settings.md)). The module update check at start is `updateCheck` in the library's `settings.json`, shared with the plugins.
- **Web connection:** off by default. File → Settings → Web listens on `127.0.0.1:47100` for Bleep Play pages and for plugins whose *Board* is *Bleep Play*. `BLEEP_WEB_PORT=<port>` turns it on for one run; `BLEEP_WEB_ROOT=<folder>` makes the app serve Bleep Play from a folder `scripts/build/build-web.sh` wrote.

## Checks before you hand out a build

```bash
scripts/build/build-patch.sh      # plugins and tests; the app is built from the same tree
scripts/run/run-app.sh --smoke
```

On macOS, start the smoke run with `--system-audio` through LaunchServices (`open -W … --args --smoke --system-audio`), or the audio permission is not the app's and the capture stays silent.

## Licences and signing

- **Link is GPLv2-or-later**, so app binaries built with it are distributed under the GPL with their source. A closed-source build needs a licence from Ableton, or `-DBLEEP_LINK=OFF` (the app then uses an internal clock). JUCE is AGPLv3 or commercial.
- No script here signs or notarises the app. A downloaded unsigned macOS build is blocked by Gatekeeper until it is signed with a Developer ID and notarised; users of unsigned builds follow [Installing unsigned builds](../../musicians/start/unsigned-builds.md). The app is released to the [Bleep Library](../modules/library.md) like the plugins, with the library signature described in [Signing](../modules/signing.md).

## Modules in the app

The app loads modules from the Bleep Library as signed `.wasm` files, through an embedded WebAssembly runtime. See the [Module ABI](../modules/module-abi.md) and the [Bleep Library](../modules/library.md).
