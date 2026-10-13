# Build, release and upload: cheat sheet

Short version for the three things we ship. Details: [build-standalone-app.md](build-standalone-app.md), [rebuild-live-plugins.md](rebuild-live-plugins.md), [release.md](release.md). All commands run from the repository root (`bleep-patch/`).

"Release" and "upload" are one step: `scripts/release/release.py` zips the build, signs it, uploads it to the store and publishes it. Versions are immutable, so a fix is a new version.

## Contents

- [One-time setup (all three)](#one-time-setup-all-three)
- [Standalone app](#standalone-app-bleep-app)
- [Plugins](#plugins-vst3)
- [Modules](#modules)
- [Web board](#web-board)

## One-time setup (all three)

- A **release token** (shown once) and a **signing kit** from the website stack; see "Releasing plugins to the store" in [release.md](release.md):

  ```bash
  cd website
  docker compose exec api python -m app.cli token-create "my laptop" --days 90 > ~/.bleep-release-token
  docker compose exec api python -m app.cli developer-create bleep --scopes module,plugin --first-party > ~/.bleep-signing-kit.json
  chmod 600 ~/.bleep-release-token ~/.bleep-signing-kit.json
  ```

- `pip install cryptography` (release.py and signing.py need it).
- Put the shared options in the environment so the commands below stay short:

  ```bash
  # the store (website address; the API is under /api)
  export BLEEP_REGISTRY_URL=http://localhost:8080
  export BLEEP_RELEASE_TOKEN=$(cat ~/.bleep-release-token)
  export BLEEP_SIGNING_KIT=~/.bleep-signing-kit.json
  ```

- Always rehearse first: add `--dry-run` (no token needed, changes nothing).
- `--level` says what to count up: `patch` (1.4.2 → 1.4.3), `minor` (→ 1.5.0), `major` (→ 2.0.0). Each plugin and each module has its own counter.

## Standalone app (`bleep-app`)

Build (needs CMake 3.22+, a C++ compiler, JUCE 8.0.9; Link 4.1 is downloaded on the first build):

```bash
# Release build of the app target, then starts it
scripts/run/run-app.sh
# quick check of the last build: prints a report and quits
scripts/run/run-app.sh --no-build --smoke
```

Result: `build/patch/BleepApp_artefacts/Release/Bleep App.app`. Without the script:

```bash
cmake -S patch -B build/patch -DCMAKE_BUILD_TYPE=Release -DBLEEP_JUCE_DIR=/path/to/JUCE
cmake --build build/patch --config Release --target BleepApp --parallel
```

**Skip the tests:** `run-app.sh` builds only the app target and runs no tests, so there is nothing to skip. The optional `--smoke` check is the only test step, so leave it out. If you build the app with `build-patch.sh` (same tree as the plugins), pass `--no-test`.

Release and upload:

```bash
scripts/release/release.py bleep-app --level patch --dry-run
scripts/release/release.py bleep-app --level patch --notes "what changed"
```

- The app includes Ableton Link, which makes the binary GPL (`-DBLEEP_LINK=OFF` for an MIT build). Never ship a `BLEEP_UI_DEV=ON` build.
- The zip is **not** signed with a Developer ID or notarized by any script. Gatekeeper blocks a downloaded unsigned app until you do that by hand.
- One release holds this machine's build (`macos-arm64`, …). Add another platform to a published version from the other machine: `release.py bleep-app --add-platform latest`.

## Plugins (VST3)

Store ids: `bleep-board`, `bleep-midi-in`, `bleep-midi-out`, `bleep-audio-in`, `bleep-audio-out`, `bleep-instrument`, `bleep-fx`.

Build (builds, runs the DSP, engine and bridge tests; the app is built in the same tree):

```bash
scripts/build/build-patch.sh --juce ../bastelbox/brilliant-bleep/plugins/JUCE
# skip the tests
scripts/build/build-patch.sh --no-test
# also copy the VST3s to ~/Library/Audio/Plug-Ins/VST3 (quit Live first)
scripts/build/build-patch.sh --install
```

**Skip the tests:** `--no-test`, as in the second command above. `release.py --build` always runs the tests (it has no way to skip them), so for a release without tests build first with `build-patch.sh --no-test` and leave `--build` off.

Bundles end up in `build/patch/<Target>_artefacts/Release/VST3/`. Plugins share one engine only when the engine major (`kAbiTag`) matches: rebuild and release all of them if it changed.

Release and upload (`--list` shows the ids):

```bash
scripts/release/release.py bleep-board --level 1.x
scripts/release/release.py --all --level patch --dry-run
scripts/release/release.py --all --level patch --notes "what changed"
# runs build-patch.sh first
scripts/release/release.py --all --build --level patch
```

The product version is `project(BleepBoard VERSION …)` in `patch/CMakeLists.txt`; plugins and app take it from there. For a tagged release also tag `plugin-vX.Y.Z` (see "The manual release" in [release.md](release.md)).

## Modules

Modules are WebAssembly (`.bleepmod` packages). One `.wasm` build, one package and one release serve the web board, the standalone app and the plugins, so local and web stay in sync. The native apps load the same `.wasm` files through Wasmtime; `build-web.sh` is the only module build. Building needs emcc (`source emsdk_env.sh`), python3 and node, or Docker:

```bash
# build/web/modules/*.wasm + manifest.json
scripts/build/build-web.sh --modules-only
# same, in the Emscripten image (no local emsdk)
scripts/build/build-web.sh --docker --modules-only
```

**Skip the tests:** none of the module steps (`build-web.sh`, `package-module.py`, `release.py --modules`) run a test suite, so there is nothing to skip. Packaging does check each `.wasm` against the module ABI, and that check can't be turned off.

Package (checks each `.wasm` against `doc/specs/module-abi.md`, writes reproducible zips to `build/store/modules/`):

```bash
# every module with a built .wasm
scripts/release/package-module.py
# just these
scripts/release/package-module.py reverb filter
```

Release and upload. Each module counts its own version, and a module whose content did not change since its newest published version is skipped (`--force` overrides). Both the app and the web board install modules from the store, so this one release reaches both:

```bash
scripts/release/release.py --modules --package --level patch --dry-run
# all changed modules
scripts/release/release.py --modules --package --level patch
# one module
scripts/release/release.py --modules reverb --level minor
```

`--package` runs `package-module.py` first; leave it out to release what is already in `build/store/modules/`.

Only if the native build has no Wasmtime (`BLEEP_WASMTIME_DIR` unset and no `build/wasm-spike/wasmtime`) are the modules compiled into the app and plugins as C++; then a module change also needs a native rebuild and release.

To try a module in the app without the store, `package-module.py --install DATA --kit KIT` signs the packages and puts them into `DATA/modules/local`, the folder the apps read hand-copied modules from.

## Web board

The board UI and web engine are built by `build-web.sh` (the modules too, unless you skip them). The board doesn't load the `.wasm` files from its own folder: it installs its modules from the store as signed packages, so a module reaches the web only through the release steps above.

```bash
# the whole site: UI, web engine and modules, into build/web/site
scripts/build/build-web.sh
# only the UI and the web engine (seconds, no Emscripten or JUCE needed; what the website image does)
scripts/build/build-web.sh --no-modules
# same, in the Emscripten image
scripts/build/build-web.sh --docker
# look at the result
python3 -m http.server -d build/web/site 8000
```

The website is deployed by rebuilding its containers (see [website.md](website.md)); deploying from CI is not set up yet. A change to the board UI needs a website deploy; a change to a module needs only the module release.
