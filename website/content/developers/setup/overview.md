---
title: Developer setup
description: Set up your computer to write modules, change the plugins, the app or Bleep Play, or work on the website: tools, one-time steps and a check that everything works.
order: -5
---

# Developer setup

What to install before you build anything in this repository. You do not need all of it: pick the goal you have and install only that row's tools.

| I want to… | You need | Jump to |
|---|---|---|
| Write or change a **module** | Git, Python 3, Node 22, Emscripten 4.0.10 (or Docker) | [Modules](#modules) |
| Change the **plugins** or the **standalone app** | Git, CMake 3.22+, a C++ compiler, JUCE 8.0.9 | [Plugins and app](#plugins-and-app) |
| Change **Bleep Play** (the board UI, the web engine) | Git, Python 3, Node 22 | [Bleep Play](#bleep-play) |
| Work on the **website**, the API or the library | Git, Docker with Compose 2.24+ | [Website](#website) |
| **Release** anything | Python 3 with `cryptography`, the website stack | [Build, release and upload](build-and-release.md) |

The commands in these pages are written for macOS and Linux and run from the repository root (`bleep-patch/`).

## Everything: get the code

```bash
git clone <repository-url> bleep
cd bleep/bleep-patch
```

Keep sibling tools next to the repository, not inside it: the instructions below put the Emscripten SDK in `../emsdk`.

## Modules

A module is a folder in `patch/modules/` and compiles to one `.wasm` file that the plugins, the app and Bleep Play all load. The only module build is `scripts/build/build-web.sh`, which needs Emscripten.

1. **Python 3 and Node 22.** Check with `python3 --version` and `node --version`. Node 22 is what CI and the Docker images use.

2. **The Emscripten SDK, pinned to 4.0.10** (same version as CI and the Docker image). One time:

   ```bash
   git clone https://github.com/emscripten-core/emsdk.git ../emsdk
   ../emsdk/emsdk install 4.0.10 && ../emsdk/emsdk activate 4.0.10
   ```

   In **every new shell** before building, so that `emcc` is on the `PATH` of that shell:

   ```bash
   source ../emsdk/emsdk_env.sh
   ```

   If conda's Python gets in the way, run `conda deactivate` first.

   **No local SDK?** Use Docker instead and add `--docker` to every `build-web.sh` call. It works anywhere but is slow on Apple Silicon, because the image is `amd64`. Pick one method and stay with it: the module cache is keyed on the compiler command and paths.

3. **The first build** clones JUCE 8.0.9 into `build/web/JUCE` and compiles `juce_core` once; later builds are cached. To use a JUCE checkout you already have, set `BLEEP_JUCE_DIR`.

4. **Try it** with one existing module:

   ```bash
   BLEEP_WEB_ONLY=reverb scripts/build/build-web.sh --modules-only
   ```

   The result is `build/web/modules/reverb.wasm` plus `manifest.json`.

5. **Native tests** (optional but what CI runs for DSP changes): CMake 3.22+ and Ninja, then

   ```bash
   cmake -S patch -B build/light -G Ninja -DBLEEP_LIGHT_TESTS=ON
   cmake --build build/light && ctest --test-dir build/light
   ```

   This compiles only `juce_core`, no plugins, so it needs no plugin SDKs.

Next: [Writing a module](../modules/writing-a-module.md), then [publishing](../modules/publishing.md). To see a module in a browser, rebuild Bleep Play (below) and load it from the library, or release it to a library on your local website stack.

## Plugins and app

The Bleep plugins (VST3, for Ableton Live) and the Bleep App are one CMake project in `patch/`.

- **CMake 3.22 or newer** and a C++ compiler: the Xcode command line tools on macOS (`xcode-select --install`), Visual Studio on Windows. Ninja is optional.
- **JUCE 8.0.9.** The build downloads it for you. To use your own checkout, pass `--juce <dir>` to the scripts or set `BLEEP_JUCE_DIR`.
- **Internet on the first app build:** Ableton Link 4.1 is fetched (set `BLEEP_LINK_DIR` for a local copy).
- **Ableton Live** to try the plugins. The app and Bleep Play need no DAW.

Try it:

```bash
# build the app, then start it
scripts/run/run-app.sh
# build the plugins, run the DSP, engine and bridge tests, copy the VST3s to ~/Library/Audio/Plug-Ins/VST3
scripts/build/build-patch.sh --install
```

While you edit the board UI (`patch/board/ui`, HTML/CSS/JS), `scripts/run/run-app.sh --ui-dev` reads it from `patch/` instead of the embedded copy: edit, then press Cmd-R in the board window.

The Link library makes the app binary GPL. Build with `-DBLEEP_LINK=OFF` if it has to stay MIT. Details: [standalone app](../app/standalone-app.md), [plugins](../plugins/overview.md).

## Bleep Play

The board UI and the web engine build in seconds and need neither Emscripten nor JUCE:

```bash
scripts/build/build-web.sh --no-modules
python3 -m http.server -d build/web/site 8000
```

Open http://localhost:8000. This is a plain static preview; the board installs its modules from a library, which a bare file server does not have. To see Bleep Play with modules, run it inside the website stack: [Rebuild Bleep Play in the running website](build-and-release.md#rebuild-bleep-play-in-the-running-website). More: [Bleep Play](../web/bleep-play.md).

## Website

The website is the docs, the homepage, the board at `/play/`, the accounts API and the library, all started with Docker Compose from `website/`.

1. **Docker** with Compose 2.24 or newer (`docker compose version`). The dev stack uses `!reset`, which older versions reject.
2. **Configuration.** Copy the template and fill it in (database password and storage secret are required; everything is described in [Configuration](../setup/configuration.md)):

   ```bash
   cp website/.env.example website/.env
   ```

   For plain `http://localhost` also set `BLEEP_COOKIE_SECURE=false`, or the browser drops the session cookie.

3. **Start it.** Production style (static export behind Caddy, about a minute to build) or the dev stack with hot reload:

   ```bash
   scripts/run/run-website.sh
   ```

   ```bash
   docker compose -f website/docker-compose.yml -f website/docker-compose.dev.yml --env-file website/.env up
   ```

   Both serve http://localhost:8080. Without Docker you can only work on docs and pages: `cd website/app && npm install && npm run dev` (http://localhost:3000), with no API and no library.

The docs live in `website/content` as Markdown. After editing them in the dev stack, restart the `dev` service; the commands are in [Build, release and upload](build-and-release.md#website-dev-and-production).

## Check your setup

| If this works… | …then you are set for |
|---|---|
| `BLEEP_WEB_ONLY=reverb scripts/build/build-web.sh --modules-only` | modules |
| `scripts/run/run-app.sh --smoke` | the app and the plugins |
| `scripts/build/build-web.sh --no-modules` | Bleep Play |
| `http://localhost:8080` shows the site | the website |
| `python3 scripts/check/check-repo.py` | the repository rules CI enforces (licence headers, module provenance, dependencies between parts) |

## Releasing

Releasing needs a signing kit and a release token from your own website stack, plus `pip install cryptography`. The one-time steps and every release command are in [Build, release and upload](build-and-release.md).
