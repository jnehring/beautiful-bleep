# Beautiful Bleep

A modular sound engine as a plugin (Ableton Live), a standalone app and in the browser, built on an open protocol.
The engine, board and apps in `patch/` are GPL-3.0-only with a [module exception](LICENSE-EXCEPTION.md), so modules can be open source, closed source or paid. The built-in modules are GPL-3.0-only too (the three ported from other code keep their original licence). Bleep Bus (`bus/`), the scripts and the website are MIT. [Licensing in plain terms](website/content/developers/modules/licensing.md).

| Folder | What | Start here |
|---|---|---|
| [`bus/`](bus/) | **Bleep Bus**: the open standard. C library, C++/JUCE helpers, examples, conformance suite | [Quickstart](website/content/developers/bleep-bus/quickstart.md) |
| [`patch/`](patch/) | **Beautiful Bleep**: the shared engine, the board and the Bleep plugins you add in Live (Bleep Board and the ports); modules (Function, Random, Utility, Filter) run on the board | [Getting started](website/content/musicians/start/getting-started.md) |
| [`website/`](website/) | The Beautiful Bleep homepage and **all documentation** (`website/content/`) | [Spec v0.1](website/content/developers/spec/v0.1/00-overview.md) |
| [`doc/`](doc/) | The specifications (`doc/specs/`) and internal operations docs (`doc/operations/`: build, release, website) | [Index](doc/README.md) |
| [`scripts/`](scripts/) | Build, run, check, docs and release scripts (below) | |

## Scripts

One command does the everyday work: `./bleep` (see [`scripts/README.md`](scripts/README.md)). It works from any directory.
This machine's settings (JUCE checkout, signing kit, release token file, registry, Live set) go into `config/bleep.local.json`
(copy [`config/bleep.local.example.json`](config/bleep.local.example.json); `./bleep config` shows what is in effect).

| Command | What it does |
|---|---|
| `./bleep build [bus\|plugins\|app\|web\|modules\|agent-data]` | Builds (default: the plugins as VST3 into `build/patch/`, copied to your plugin folders together with the Bleep Live Link device (into Live's User Library), then the DSP, engine and host tests). Options: `--juce <dir>`, `--install` / `--no-install`, `--ui-dev`, `--debug`, `--clean`, `--no-test`, `--plugins-only`, `--no-app`; web/modules: `--docker`, `--no-modules`, `--out` |
| `./bleep run app\|ui\|site\|play\|live` | `app`: builds only the standalone app and starts it (`--no-build`, `--smoke`, `--ui-dev`, a `.bleepboard` project); `ui`: the board UI in a browser with a fake engine (http://localhost:8765); `site`: the website in Docker (`--action up\|down\|logs\|rebuild`); `play`: updates the dev site's Bleep Play; `live`: macOS, rebuilds the plugins, quits Ableton Live, replaces the VST3s and reopens a set |
| `./bleep test [py\|js\|script\|presets\|bus\|native\|check\|all]` | The unit tests: default is `py js presets check` (seconds, no compiler); `bus` and `native` are the C++ suites, `all` runs everything |
| `./bleep check [repo\|api-docs\|account]` | Dependency rules, SPDX headers and LICENSE files; documented bus API; the app's sign-in against a real API |
| `./bleep docs [build\|help-index\|screenshots]` | The single-file docs and `llms.txt`; the board's Help index; the module screenshots |
| `./bleep package` / `./bleep release plugins\|modules\|community` | Packages modules; signs and publishes plugins or modules to the library ([release.md](doc/operations/release.md)) |

Behind it: [`scripts/bleep.py`](scripts/bleep.py) (the command), [`scripts/settings.py`](scripts/settings.py) (the settings), and the tools it calls:
`build/build-web.sh`, `run/ui-server.py`, `docs/*.py`, `check/*.py`, `release/release.py`, `package-module.py`, `signing.py`, `community-publish.py`.
`experiments/wasm-spike.sh` runs the Verb module's `.wasm` in Wasmtime and wasm3 ([patch/wasm-host](patch/wasm-host/README.md)).

```bash
./bleep build bus
./bleep build plugins --juce /path/to/JUCE
./bleep run site
```

### Developing in Live

Live keeps a plugin's code loaded until it quits, so:

- **UI changes (HTML/CSS/JS):** build once with `./bleep build plugins --install --ui-dev`.
  These dev builds read the board UI from `patch/` instead of the embedded copy.
  After an edit, press ⌘R in the board window. No rebuild, no restart.
  Don't ship `--ui-dev` builds.
- **DSP, bus or C++ changes:** save your test set and run `./bleep run live <set.als>`.
  It builds first, and only quits Live if the build succeeded. It never
  force-quits Live: answer Live's save dialog if one appears.
  While Live is running, `./bleep build plugins` only builds and says it did not copy: overwriting a loaded plugin can crash
  Live. Quit Live and run `./bleep build plugins --install` (the plain command copies by default when Live is not running).
- **Quick checks without Live:** `./bleep run ui` runs the board UI in a browser
  against a fake engine; the engine tests (`ctest --test-dir build/patch`) simulate Live's
  parallel tracks.

Or everything with CMake: `cmake -S . -B build -DBLEEP_JUCE_DIR=/path/to/JUCE && cmake --build build && ctest --test-dir build`.

Status: **v0.1, experimental.** The bus layout may change with every 0.x
release.

Dependency rules (checked in CI by `scripts/check/check-repo.py`): `bus/` depends
on nothing else here; `patch/` uses the bus only through its public API;
nothing depends on `website/`.
