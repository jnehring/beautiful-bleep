# Build the standalone app

The standalone app is `BleepApp` in `patch/CMakeLists.txt` (spec §11): the board in its own window, with its own MIDI ports, Ableton Link and the Bleep Audio Bridge server. The product is named **Bleep App**.

## Prerequisites

- CMake 3.22 or newer, a C++ compiler (Xcode command line tools on macOS, Visual Studio on Windows), optionally Ninja.
- JUCE 8.0.9. Either let the build download it, or point to a checkout with `--juce <dir>` or `BLEEP_JUCE_DIR`.
- Internet on the first build: Ableton Link 4.1 is fetched (set `BLEEP_LINK_DIR` to use a local copy).

## Build and run (macOS)

```bash
scripts/run/run-app.sh                       # Release build, then starts the app with its console output here
scripts/run/run-app.sh my-project.bleepboard # open a project
scripts/run/run-app.sh --no-build            # start the last build
scripts/run/run-app.sh --smoke               # no audio inputs or Link, prints a report, quits (a quick check)
scripts/run/run-app.sh --debug               # Debug build
scripts/run/run-app.sh --ui-dev              # reads the board UI from patch/ (edit HTML/CSS/JS, press Cmd-R)
```

The script builds only the app target, in `build/patch/`. A running copy is asked to quit first and is never force-quit.

The result is `build/patch/BleepApp_artefacts/Release/Bleep App.app`.

## Build without the script, or on Windows

```bash
cmake -S patch -B build/patch -DCMAKE_BUILD_TYPE=Release -DBLEEP_JUCE_DIR=/path/to/JUCE
cmake --build build/patch --config Release --target BleepApp --parallel
```

The Windows executable ends up in `build/patch/BleepApp_artefacts/Release/`.

## Options

| CMake option | Default | Effect |
|---|---|---|
| `BLEEP_BUILD_APP` | ON | Build the standalone app |
| `BLEEP_LINK` | ON | Include Ableton Link. **This makes the app binary GPL.** Turn it off for a build that must stay MIT |
| `BLEEP_UI_DEV` | OFF | Development only: the UI comes from the source tree. Never ship |
| `BLEEP_LINK_DIR` | unset | Use a local Link checkout instead of downloading it |

## Checks before you hand a build to anyone

```bash
scripts/build/build-patch.sh        # plugins and tests (DSP, engine, bridge); the app is built with the same tree
scripts/run/run-app.sh --smoke
```

The app is **not signed or notarized** by any script in this repository. On macOS a downloaded unsigned build is blocked by Gatekeeper until it is signed with a Developer ID and notarized; see [release.md](release.md).
