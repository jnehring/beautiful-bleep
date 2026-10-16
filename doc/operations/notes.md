# Build, release and upload: cheat sheet

Short version for the three things we ship. Details: [build-standalone-app.md](build-standalone-app.md), [rebuild-live-plugins.md](rebuild-live-plugins.md), [release.md](release.md). All commands run from the repository root (`bleep-patch/`).

"Release" and "upload" are one step: `scripts/release/release.py` zips the build, signs it, uploads it to the store and publishes it. Versions are immutable, so a fix is a new version.

## Contents

- [One-time setup (all three)](#one-time-setup-all-three)
- [Standalone app](#standalone-app-bleep-app)
- [Plugins](#plugins-vst3)
- [Modules](#modules)
- [Web board](#web-board)
- [Website (dev and production)](#website-dev-and-production)

## One-time setup (all three)

- A **release token** (shown once) and a **signing kit** from the website stack; see "Releasing plugins to the store" in [release.md](release.md). Do this once: if `~/.bleep-release-token` and `~/.bleep-signing-kit.json` already exist, skip it (the token lasts 90 days, the kit's certificate 365 by default):

  ```bash
  cd website
  docker compose exec api python -m app.cli token-create "my laptop" --days 90 > ~/.bleep-release-token
  (umask 077; docker compose exec -T api python -m app.cli developer-create bleep --scopes module,plugin --first-party --confirm > ~/.bleep-signing-kit.json)
  chmod 600 ~/.bleep-release-token ~/.bleep-signing-kit.json
  ```

- `pip install cryptography` (release.py and signing.py need it).
- **In every new shell**, before a release, put the shared options in the environment so the commands below stay short. The `export` only lasts for that shell. The token is passed with `--token-file` (it picks the `blp_…` token out of the file, so the two-line output of `token-create` works as saved); without it `release.py` stops with "A release token is required":

  ```bash
  # the store (website address; the API is under /api) and the signing kit
  export BLEEP_REGISTRY_URL=http://localhost:8080 BLEEP_SIGNING_KIT=~/.bleep-signing-kit.json
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
scripts/release/release.py bleep-app --level patch --notes "what changed" --token-file ~/.bleep-release-token
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

**Skip the tests:** `--no-test`, as in the second command above. `release.py --build` runs `build-patch.sh --plugins-only` (no tests, no test targets), so after a `build-patch.sh --plugins-only` run it has nothing left to compile. Run the tests separately with plain `build-patch.sh` before a release.

**Modules are not part of the plugins.** With the wasm module host (`BLEEP_WASMTIME_DIR`, found by default in `build/wasm-spike/wasmtime`) and `BLEEP_BUNDLE_MODULES=OFF`, the plugins carry no modules. They load the signed `.bleepmod` packages installed on the machine, from the same data folder the standalone app installs into (`store::defaultDataDir()`, `~/Library/Application Support/Bleep` on macOS). The app and the plugins share one module installation. What compiles every module in is the test targets (`bleep_module_harness`, `bleep_wasm_parity`, ...), which are the reference the wasm builds are checked against. `--no-test` only skips running them; to not build them either:

```bash
scripts/build/build-patch.sh --plugins-only --install
```

If `BLEEP_WASMTIME_DIR` is empty (no Wasmtime under `build/wasm-spike`), the plugins fall back to compiling all modules in. Check with `grep BLEEP_WASMTIME_DIR build/patch/CMakeCache.txt`.

Bundles end up in `build/patch/<Target>_artefacts/Release/VST3/`. Plugins share one engine only when the engine major (`kAbiTag`) matches: rebuild and release all of them if it changed.

Release and upload (`--list` shows the ids):

```bash
scripts/release/release.py bleep-board --level 1.x --token-file ~/.bleep-release-token
scripts/release/release.py --all --level patch --dry-run
scripts/release/release.py --all --level patch --notes "what changed" --token-file ~/.bleep-release-token
# runs build-patch.sh first
scripts/release/release.py --all --build --level patch --token-file ~/.bleep-release-token
```

The product version is `project(BleepBoard VERSION …)` in `patch/CMakeLists.txt`; plugins and app take it from there. For a tagged release also tag `plugin-vX.Y.Z` (see "The manual release" in [release.md](release.md)).

## Modules

Modules are WebAssembly (`.bleepmod` packages). One `.wasm` build, one package and one release serve the web board, the standalone app and the plugins, so local and web stay in sync. The native apps load the same `.wasm` files through Wasmtime; `build-web.sh` is the only module build. Building needs emcc (the Emscripten SDK), python3 and node, or Docker.

**Local emsdk (recommended, fast).** The SDK lives next to the repository, in `../emsdk`, pinned to 4.0.10 like CI and the Docker image. One-time install:

```bash
git clone https://github.com/emscripten-core/emsdk.git ../emsdk
```

```bash
../emsdk/emsdk install 4.0.10 && ../emsdk/emsdk activate 4.0.10
```

In **every new shell**, before building (it only puts `emcc` on the `PATH` of that shell; run the build in the same terminal):

```bash
source ../emsdk/emsdk_env.sh
```

Then:

```bash
# build/web/modules/*.wasm + manifest.json
scripts/build/build-web.sh --modules-only
```

**One module only** (or a few): name the module folders in `BLEEP_WEB_ONLY`, comma separated (the names under `patch/modules/`). The other modules already in `build/web/modules` stay in the manifest. The Docker variant passes the variable through too.

```bash
BLEEP_WEB_ONLY=reverb scripts/build/build-web.sh --modules-only
```

```bash
BLEEP_WEB_ONLY=reverb,filter scripts/build/build-web.sh --modules-only
```

Then package and release just that module (see below): `package-module.py reverb`, `release.py --modules reverb --level patch`. Modules that use `juce_core` need the one-time JUCE build described above, which a single-module run triggers by itself.

The emsdk brings its own Node and Python, which come first on the `PATH` in that shell. If conda's Python gets in the way, run `conda deactivate` first. The first build also clones JUCE into `build/web/JUCE` and compiles `juce_core` once.

**Docker (no local install, slow on Apple Silicon).** The `emscripten/emsdk` image is `amd64`, so on an M-series Mac every compiler call runs under x86 emulation. Use it where there is no emsdk, e.g. on a machine you only release from:

```bash
# same build, in the Emscripten image
scripts/build/build-web.sh --docker --modules-only
```

The per-module cache is in `build/web/modules/.cache`. Use one method (local or Docker) consistently: the cache key includes the compiler command and paths, so switching probably rebuilds every module.

**Skip the tests:** none of the module steps (`build-web.sh`, `package-module.py`, `release.py --modules`) run a test suite, so there is nothing to skip. Packaging does check each `.wasm` against the module ABI, and that check can't be turned off.

Package (checks each `.wasm` against `website/content/developers/reference/module-abi.md`, writes reproducible zips to `build/store/modules/`):

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
scripts/release/release.py --modules --package --level patch --token-file ~/.bleep-release-token
# one module
scripts/release/release.py --modules reverb --level minor --token-file ~/.bleep-release-token
```

`--package` runs `package-module.py` first; leave it out to release what is already in `build/store/modules/`.

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

## Website (dev and production)

The site is the docs and homepage (`website/app`, Next.js, static export), the board UI, and the store backend: Caddy, the API (FastAPI), PostgreSQL and the store's storage (SeaweedFS). All of it runs with Docker Compose from `website/`. The image has the board UI but **no modules**; they come from the store (see [Modules](#modules)). Details, the admin user and the signing keys: [website.md](website.md).

One-time: copy the config and fill it in (database password, first admin, storage keys, signing keys):

```bash
cp website/.env.example website/.env
```

**Production** (static export behind Caddy, built into the image; about a minute):

```bash
# build the images and start everything: http://localhost:8080
scripts/run/run-website.sh
```

```bash
# after changing website/content, website/app, the board UI or module docs: rebuild and restart
scripts/run/run-website.sh up
```

```bash
# rebuild from scratch, without Docker's layer cache
scripts/run/run-website.sh rebuild
```

```bash
# follow the logs
scripts/run/run-website.sh logs
```

```bash
# stop (the database and the store keep their data; `docker compose down -v` in website/ deletes it)
scripts/run/run-website.sh down
```

On a real server set `BLEEP_COOKIE_SECURE=true` (the site is served over HTTPS) and `BLEEP_SITE_PORT` if 8080 is taken. Deploying is rebuilding the containers on the server; deploying from CI is not set up yet. A module release needs no website deploy.

**Development** (`next dev` with hot reload behind the same Caddy routes, no image rebuild; needs Docker Compose 2.24+):

```bash
docker compose -f website/docker-compose.yml -f website/docker-compose.dev.yml --env-file website/.env up
```

Open http://localhost:8080. After editing `website/content` or a module's `doc/`, regenerate the docs:

```bash
docker compose -f website/docker-compose.yml -f website/docker-compose.dev.yml --env-file website/.env restart dev
```

After editing the board UI (`patch/board`, `patch/web`), rebuild it into the site:

```bash
docker compose -f website/docker-compose.yml -f website/docker-compose.dev.yml --env-file website/.env run --rm play
```

**Without Docker** (docs and pages only, no API or store): `cd website/app && npm install`, then `npm run dev` (http://localhost:3000) or `npm run build` (static export to `website/app/out/`).
