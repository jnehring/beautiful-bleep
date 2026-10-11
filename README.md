# Bleep

A modular sound engine as a plugin (Ableton Live), a standalone app and in the browser, built on an open protocol.
Everything in this repository is MIT-licensed.

| Folder | What | Start here |
|---|---|---|
| [`bus/`](bus/) | **Bleep Bus**: the open standard. C library, C++/JUCE helpers, examples, conformance suite | [Quickstart](website/content/developers/quickstart.md) |
| [`patch/`](patch/) | **Bleep Patch**: the shared engine, the Bleep Board and the plugins you add in Live (Bleep Patch and the ports); modules (Function, Random, Utility, Filter) run on the board | [Getting started](website/content/musicians/getting-started.md) |
| [`website/`](website/) | The Bleep Patch homepage and **all documentation** (`website/content/`) | [Spec v0.1](website/content/developers/spec/v0.1/00-overview.md) |
| [`doc/`](doc/) | The specifications (`doc/specs/`) and internal operations docs (`doc/operations/`: build, release, website) | [Index](doc/README.md) |
| [`scripts/`](scripts/) | Build, run, check, docs and release scripts (below) | |

## Scripts

All scripts live in [`scripts/`](scripts/), one folder per kind of work, and work from any directory.

| Folder | Script | What it does |
|---|---|---|
| [`build/`](scripts/build/) | [`build-bus.sh`](scripts/build/build-bus.sh) | Builds Bleep Bus (library, examples, conformance suite) into `build/bus/` and runs its tests. Options: `--debug`, `--clean`, `--no-test` |
| | [`build-patch.sh`](scripts/build/build-patch.sh) | Builds the plugins as VST3 into `build/patch/` and runs the DSP, engine and headless-host tests. Options: `--juce <dir>` (or `BLEEP_JUCE_DIR`; otherwise JUCE 8.0.9 is downloaded), `--install`, `--ui-dev`, `--debug`, `--clean`, `--no-test` |
| | [`build-web.sh`](scripts/build/build-web.sh) | Builds the board for the browser: one `.wasm` per module and the web engine (`--no-modules`, `--modules-only`, `--docker`) |
| [`run/`](scripts/run/) | [`run-app.sh`](scripts/run/run-app.sh) | Builds only the standalone Bleep Patch app and starts it with its console output: `scripts/run/run-app.sh [project.bleepboard]`. Options: `--debug`, `--ui-dev`, `--no-build`, `--smoke`, `--juce <dir>` |
| | [`reload-live.sh`](scripts/run/reload-live.sh) | macOS: rebuilds the plugins, quits Ableton Live, replaces the VST3s and reopens a test set: `scripts/run/reload-live.sh ~/Music/test.als [build options]` |
| | [`run-website.sh`](scripts/run/run-website.sh) | Runs the website in Docker on http://localhost:8080: `up` (default), `down`, `logs`, `rebuild` |
| | [`ui-server.py`](scripts/run/ui-server.py) | Serves the board UI in a browser with a fake engine: `scripts/run/ui-server.py`, then open http://localhost:8765 |
| [`docs/`](scripts/docs/) | [`build-docs.py`](scripts/docs/build-docs.py) | Writes the single-file docs per audience (module manuals one file per category) and `llms.txt` (also run by the website build) |
| | [`module-screenshots.py`](scripts/docs/module-screenshots.py) | Screenshots every module's view into its `doc/<type>.png` (needs `ui-server.py` running and Playwright) |
| [`check/`](scripts/check/) | [`check-api-docs.py`](scripts/check/check-api-docs.py) | Checks that every function in `bleep_bus.h` is documented in the API reference |
| | [`check-repo.py`](scripts/check/check-repo.py) | Checks the dependency rules between `bus/`, `patch/` and `website/`, SPDX headers and LICENSE files |
| [`release/`](scripts/release/) | [`release.py`](scripts/release/release.py) | Signs and publishes plugins to the registry, or adds a platform build to a published release ([release.md](doc/operations/release.md)) |
| | [`signing.py`](scripts/release/signing.py) | Keys, certificates, signing and verifying packages ([signing.md](doc/specs/signing.md)) |
| | `test_release.py`, `test_signing.py` | Their unit tests: `cd scripts/release && python3 -m unittest test_release test_signing` |
| [`experiments/`](scripts/experiments/) | [`wasm-spike.sh`](scripts/experiments/wasm-spike.sh) | Runs the Verb module's `.wasm` in Wasmtime and wasm3 next to the native build ([patch/wasm-host](patch/wasm-host/README.md)) |

```bash
scripts/build/build-bus.sh
scripts/build/build-patch.sh --juce /path/to/JUCE
scripts/run/run-website.sh
```

### Developing in Live

Live keeps a plugin's code loaded until it quits, so:

- **UI changes (HTML/CSS/JS):** build once with `scripts/build/build-patch.sh --install --ui-dev`.
  These dev builds read the board UI from `patch/` instead of the embedded copy.
  After an edit, press ⌘R in the board window. No rebuild, no restart.
  Don't ship `--ui-dev` builds.
- **DSP, bus or C++ changes:** save your test set and run `scripts/run/reload-live.sh <set.als>`.
  It builds first, and only quits Live if the build succeeded. It never
  force-quits Live: answer Live's save dialog if one appears.
  Don't use `--install` while Live is running: overwriting a loaded plugin can crash Live.
- **Quick checks without Live:** `scripts/run/ui-server.py` runs the board UI in a browser
  against a fake engine; the engine tests (`ctest --test-dir build/patch`) simulate Live's
  parallel tracks.

Or everything with CMake: `cmake -S . -B build -DBLEEP_JUCE_DIR=/path/to/JUCE && cmake --build build && ctest --test-dir build`.

Status: **v0.1, experimental.** The bus layout may change with every 0.x
release.

Dependency rules (checked in CI by `scripts/check/check-repo.py`): `bus/` depends
on nothing else here; `patch/` uses the bus only through its public API;
nothing depends on `website/`.
