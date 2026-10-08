# Bleep

Modular-style control for Ableton Live, built on an open protocol.
Everything in this repository is MIT-licensed.

| Folder | What | Start here |
|---|---|---|
| [`bus/`](bus/) | **Bleep Bus**: the open standard. C library, C++/JUCE helpers, examples, conformance suite | [Quickstart](website/content/developers/quickstart.md) |
| [`patch/`](patch/) | **Bleep Patch**: the modules (Function, Random, Utility, Filter, MIDI Out); each has `dsp/` and `ui/` | [Getting started](website/content/musicians/getting-started.md) |
| [`website/`](website/) | The Bleep Patch homepage and **all documentation** (`website/content/`) | [Spec v0.1](website/content/developers/spec/v0.1/00-overview.md) |
| [`scripts/`](scripts/) | Build, run and check scripts (below) | |

## Scripts

All scripts live in [`scripts/`](scripts/) and work from any directory.

| Script | What it does |
|---|---|
| [`build-bus.sh`](scripts/build-bus.sh) | Builds Bleep Bus (library, examples, conformance suite) into `build/bus/` and runs its tests. Options: `--debug`, `--clean`, `--no-test` |
| [`build-patch.sh`](scripts/build-patch.sh) | Builds the modules as VST3 + Standalone into `build/patch/` and runs the DSP and headless-host tests. Options: `--juce <dir>` (or `BLEEP_JUCE_DIR`; otherwise JUCE 8.0.9 is downloaded), `--install`, `--formats "VST3;Standalone;AU"`, `--clap`, `--ui-dev`, `--debug`, `--clean`, `--no-test` |
| [`reload-live.sh`](scripts/reload-live.sh) | macOS: rebuilds the modules, quits Ableton Live, replaces the VST3s and reopens a test set: `scripts/reload-live.sh ~/Music/test.als [build options]` |
| [`run-website.sh`](scripts/run-website.sh) | Runs the website in Docker on http://localhost:8080: `up` (default), `down`, `logs`, `rebuild` |
| [`ui-server.py`](scripts/ui-server.py) | Serves one module's UI in a browser with a fake backend, e.g. `scripts/ui-server.py filter` |
| [`build-docs.py`](scripts/build-docs.py) | Writes the single-file docs per audience and `llms.txt` (also run by the website build) |
| [`check-api-docs.py`](scripts/check-api-docs.py) | Checks that every function in `bleep_bus.h` is documented in the API reference |
| [`check-repo.py`](scripts/check-repo.py) | Checks the dependency rules between `bus/`, `patch/` and `website/`, SPDX headers and LICENSE files |

```bash
scripts/build-bus.sh
scripts/build-patch.sh --juce /path/to/JUCE
scripts/run-website.sh
```

### Developing in Live

Live keeps a plugin's code loaded until it quits, so:

- **UI changes (HTML/CSS/JS):** build once with `scripts/build-patch.sh --install --ui-dev`.
  These dev builds read their UI from `patch/` instead of the embedded copy.
  After an edit, reopen the plugin window or press ⌘R in it. No rebuild, no restart.
  Don't ship `--ui-dev` builds.
- **DSP, bus or C++ changes:** save your test set and run `scripts/reload-live.sh <set.als>`.
  It builds first, and only quits Live if the build succeeded. It never
  force-quits Live: answer Live's save dialog if one appears.
  Don't use `--install` while Live is running: overwriting a loaded plugin can crash Live.
- **Quick checks without Live:** the standalone apps, or `scripts/ui-server.py <module>` for the UI.

Or everything with CMake: `cmake -S . -B build -DBLEEP_JUCE_DIR=/path/to/JUCE && cmake --build build && ctest --test-dir build`.

Status: **v0.1, experimental.** The bus layout may change with every 0.x
release.

Dependency rules (checked in CI by `scripts/check-repo.py`): `bus/` depends
on nothing else here; `patch/` uses the bus only through its public API;
nothing depends on `website/`.
