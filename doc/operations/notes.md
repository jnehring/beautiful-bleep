# Build, release and upload: cheat sheet

Short version for the three things we ship. Details: [build-standalone-app.md](build-standalone-app.md), [rebuild-live-plugins.md](rebuild-live-plugins.md), [release.md](release.md). All commands run from the repository root (`bleep-patch/`).

"Release" and "upload" are one step: `scripts/release/release.py` zips the build, signs it, uploads it to the store and publishes it. Versions are immutable, so a fix is a new version.

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
  export BLEEP_REGISTRY_URL=http://localhost:8080      # the store (website address; the API is under /api)
  export BLEEP_RELEASE_TOKEN=$(cat ~/.bleep-release-token)
  export BLEEP_SIGNING_KIT=~/.bleep-signing-kit.json
  ```

- Always rehearse first: add `--dry-run` (no token needed, changes nothing).
- `--level` says what to count up: `patch` (1.4.2 → 1.4.3), `minor` (→ 1.5.0), `major` (→ 2.0.0). Each plugin and each module has its own counter.

## Standalone app (`bleep-app`)

Build (needs CMake 3.22+, a C++ compiler, JUCE 8.0.9; Link 4.1 is downloaded on the first build):

```bash
scripts/run/run-app.sh                        # Release build of the app target, then starts it
scripts/run/run-app.sh --no-build --smoke     # quick check of the last build: prints a report and quits
```

Result: `build/patch/BleepApp_artefacts/Release/Bleep App.app`. Without the script:

```bash
cmake -S patch -B build/patch -DCMAKE_BUILD_TYPE=Release -DBLEEP_JUCE_DIR=/path/to/JUCE
cmake --build build/patch --config Release --target BleepApp --parallel
```

Release and upload:

```bash
scripts/release/release.py bleep-app --level patch --dry-run
scripts/release/release.py bleep-app --level patch --notes "what changed"
```

- The app includes Ableton Link, which makes the binary GPL (`-DBLEEP_LINK=OFF` for an MIT build). Never ship a `BLEEP_UI_DEV=ON` build.
- The zip is **not** signed with a Developer ID or notarized by any script. Gatekeeper blocks a downloaded unsigned app until you do that by hand.
- One release holds this machine's build (`macos-arm64`, …). Add another platform to a published version from the other machine: `release.py bleep-app --add-platform latest`.

## Plugins (VST3: `bleep-board`, `bleep-midi-in`, `bleep-midi-out`, `bleep-audio-in`, `bleep-audio-out`, `bleep-instrument`, `bleep-fx`)

Build (builds, runs the DSP, engine and bridge tests; the app is built in the same tree):

```bash
scripts/build/build-patch.sh --juce ../bastelbox/brilliant-bleep/plugins/JUCE
scripts/build/build-patch.sh --no-test          # skip the tests
scripts/build/build-patch.sh --install          # also copy the VST3s to ~/Library/Audio/Plug-Ins/VST3 (quit Live first)
```

Bundles end up in `build/patch/<Target>_artefacts/Release/VST3/`. Plugins share one engine only when the engine major (`kAbiTag`) matches: rebuild and release all of them if it changed.

Release and upload (`--list` shows the ids):

```bash
scripts/release/release.py bleep-board --level 1.x
scripts/release/release.py --all --level patch --dry-run
scripts/release/release.py --all --level patch --notes "what changed"
scripts/release/release.py --all --build --level patch   # runs build-patch.sh first
```

The product version is `project(BleepBoard VERSION …)` in `patch/CMakeLists.txt`; plugins and app take it from there. For a tagged release also tag `plugin-vX.Y.Z` (see "The manual release" in [release.md](release.md)).

## Modules (`.bleepmod` packages)

Modules are WebAssembly. Building needs emcc (`source emsdk_env.sh`), python3 and node, or Docker:

```bash
scripts/build/build-web.sh --modules-only               # build/web/modules/*.wasm + manifest.json
scripts/build/build-web.sh --docker --modules-only      # same, in the Emscripten image (no local emsdk)
```

Package (checks each `.wasm` against `doc/specs/module-abi.md`, writes reproducible zips to `build/store/modules/`):

```bash
scripts/release/package-module.py               # every module with a built .wasm
scripts/release/package-module.py reverb filter # just these
```

Release and upload. Each module counts its own version, and a module whose content did not change since its newest published version is skipped (`--force` overrides):

```bash
scripts/release/release.py --modules --package --level patch --dry-run
scripts/release/release.py --modules --package --level patch            # all changed modules
scripts/release/release.py --modules reverb --level minor               # one module
```

`--package` runs `package-module.py` first; leave it out to release what is already in `build/store/modules/`. Modules are also compiled statically into the native plugins (`BLEEP_REGISTER_MODULE`), so a module change that must reach plugin users needs a plugin release too.

For tests, `package-module.py --install DATA --kit KIT` signs the packages and puts them into `DATA/modules/local`, the folder the apps read hand-copied modules from.
