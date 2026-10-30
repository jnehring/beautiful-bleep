# Beautiful Bleep

**A modular sound engine for Ableton Live, as a standalone app and in your browser, built on an open protocol.**

[Website](https://beautifulbleep.com) · [Play in the browser](https://beautifulbleep.com/play/) · [Download](https://beautifulbleep.com/download/) · [Library](https://beautifulbleep.com/library/) · [Musician docs](https://beautifulbleep.com/docs/musicians/overview/) · [Developer docs](https://beautifulbleep.com/docs/developers/overview/) · [Blog](https://beautifulbleep.com/blog/)

Beautiful Bleep puts all your modules on one canvas, the **board**. You patch them with cables, every knob is a
modulation destination, and small plugins called **ports** connect the board to your tracks in Live. The same board runs
in three places: as plugins in Ableton Live, as the standalone **Bleep App**, and in the browser as **Bleep Play**.
Underneath is **Bleep Bus**, an open (MIT) protocol and C SDK for passing per-sample control signals between audio plugins.

Status: **v0.1, experimental.** The bus layout may change with every 0.x release.

## Documentation

All documentation is on [beautifulbleep.com](https://beautifulbleep.com) (the sources are in [`website/content/`](website/content/)).
Coding assistants can read [`llms.txt`](https://beautifulbleep.com/llms.txt), which links single-file versions of every section.

### For musicians

| Start here | |
|---|---|
| [Ways to use Bleep](https://beautifulbleep.com/docs/musicians/start/ways-to-use/) | Plugin, app or browser: which one is for you |
| [Get started in Live](https://beautifulbleep.com/docs/musicians/start/getting-started/) | Install the plugins, play a preset, open the board |
| [Get started with the app](https://beautifulbleep.com/docs/musicians/start/getting-started-app/) | The board without a DAW |
| [Get started in the browser](https://beautifulbleep.com/docs/musicians/start/getting-started-play/) | Bleep Play, no install |
| [First sound](https://beautifulbleep.com/docs/musicians/start/first-sound/) | Play a preset with no cables |
| [Your first patch](https://beautifulbleep.com/docs/musicians/learn/first-patch/) | Five minutes on the board: filter, modulation, modulating the modulator |
| [Modulation](https://beautifulbleep.com/docs/musicians/learn/modulation/) | How cables move knobs |
| [Cells and panels](https://beautifulbleep.com/docs/musicians/learn/cells-and-panels/) | Group a patch and give it a front panel |
| [The board](https://beautifulbleep.com/docs/musicians/use/board/) | Everything about adding modules, cables, grouping and panels |
| [MIDI controllers](https://beautifulbleep.com/docs/musicians/connect/midi-controllers/) | Connect and map a keyboard or pad controller |
| [Shortcuts](https://beautifulbleep.com/docs/musicians/reference/shortcuts/) · [Glossary](https://beautifulbleep.com/docs/musicians/reference/glossary/) | Reference |

### For developers

| Start here | |
|---|---|
| [Developer overview](https://beautifulbleep.com/docs/developers/overview/) | Which guide is for you, and how the pieces fit |
| [Architecture](https://beautifulbleep.com/docs/developers/development/architecture/) | Board, engine, wasm modules; plugins vs. app vs. Bleep Play |
| [Developer setup](https://beautifulbleep.com/docs/developers/setup/overview/) | Tools, one-time steps, [building and releasing](https://beautifulbleep.com/docs/developers/setup/build-and-release/), [running the tests](https://beautifulbleep.com/docs/developers/setup/running-tests/) |
| [Writing a module](https://beautifulbleep.com/docs/developers/modules/writing-a-module/) | Build a board module; then [publish it to the library](https://beautifulbleep.com/docs/developers/modules/publishing/) |
| [Bleep Script](https://beautifulbleep.com/docs/developers/bleep-script/overview/) | Modules, routing and patches in AssemblyScript/TypeScript ([quickstart](https://beautifulbleep.com/docs/developers/bleep-script/quickstart/)) |
| [Bleep Bus](https://beautifulbleep.com/docs/developers/bleep-bus/overview/) | The open protocol ([quickstart](https://beautifulbleep.com/docs/developers/bleep-bus/quickstart/), [spec v0.1](https://beautifulbleep.com/docs/developers/spec/v0.1/00-overview/), [API reference](https://beautifulbleep.com/docs/developers/api-reference/00-overview/)) |
| [Plugins](https://beautifulbleep.com/docs/developers/plugins/overview/) · [Standalone app](https://beautifulbleep.com/docs/developers/app/standalone-app/) · [Bleep Play](https://beautifulbleep.com/docs/developers/web/bleep-play/) | Working on each of the three hosts |
| [Bleep Assistant](https://beautifulbleep.com/docs/developers/bleep-assistant/overview/) | The agentic assistant in the board |

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md) and the [CLA](CLA.md).

## Repository overview

| Folder | What | Start here |
|---|---|---|
| [`bus/`](bus/) | **Bleep Bus**: the open standard. C library, C++/JUCE helpers, examples, conformance suite | [Quickstart](https://beautifulbleep.com/docs/developers/bleep-bus/quickstart/) |
| [`patch/`](patch/) | **Beautiful Bleep**: the shared engine, the board, the Bleep plugins you add in Live (Bleep Board and the ports), the standalone app and the built-in modules | [Architecture](https://beautifulbleep.com/docs/developers/development/architecture/) |
| [`website/`](website/) | The [beautifulbleep.com](https://beautifulbleep.com) site (Next.js), its accounts API and **all documentation** (`website/content/`) | [website/README.md](website/README.md) |
| [`agent/`](agent/) | The Bleep Assistant (Python): agent loop, tools, skills, documentation search and the evaluation benchmark | [Bleep Assistant](https://beautifulbleep.com/docs/developers/bleep-assistant/overview/) |
| [`presets/`](presets/) | Example board projects (`.bleepboard`) | |
| [`doc/`](doc/) | The specifications (`doc/specs/`) and internal operations docs (`doc/operations/`: build, release, website) | [Index](doc/README.md) |
| [`scripts/`](scripts/) | Build, run, check, docs and release scripts (below) | [scripts/README.md](scripts/README.md) |
| [`config/`](config/) · [`ci/`](ci/) | Shared and per-machine settings; the self-hosted CI runner | |

Dependency rules (checked in CI by `scripts/check/check-repo.py`): `bus/` depends
on nothing else here; `patch/` uses the bus only through its public API;
nothing depends on `website/`.

## Building from source

One command does the everyday work: `./bleep` (see [`scripts/README.md`](scripts/README.md)). It works from any directory.
This machine's settings (JUCE checkout, release token file, registry, Live set) go into `config/bleep.local.json`
(copy [`config/bleep.local.example.json`](config/bleep.local.example.json); `./bleep config` shows what is in effect).

| Command | What it does |
|---|---|
| `./bleep build [bus\|plugins\|app\|web\|modules\|agent-data]` | Builds (default: everything, i.e. `bus`, `plugins` and `web`; name targets to build only those, e.g. `./bleep build plugins`. `agent-data` is only built when named, since it calls paid APIs. The plugins as VST3 into `build/patch/`, copied to your plugin folders together with the Bleep Live Link device (into Live's User Library), then the DSP, engine and host tests). Options: `--juce <dir>`, `--install` / `--no-install`, `--ui-dev`, `--debug`, `--clean`, `--no-test`, `--plugins-only`, `--no-app`; web/modules: `--docker`, `--no-modules`, `--out` |
| `./bleep run app\|ui\|site\|play\|live` | `app`: builds only the standalone app and starts it (`--no-build`, `--smoke`, `--ui-dev`, a `.bleepboard` project); `ui`: the board UI in a browser with a fake engine (http://localhost:8765); `site`: the website in Docker (`--action up\|down\|logs\|rebuild`); `play`: updates the dev site's Bleep Play; `live`: macOS, rebuilds the plugins, quits Ableton Live, replaces the VST3s and reopens a set |
| `./bleep test [py\|js\|script\|presets\|bus\|native\|check\|all]` | The unit tests: default is `py js presets check` (seconds, no compiler); `bus` and `native` are the C++ suites, `all` runs everything |
| `./bleep check [repo\|api-docs\|account]` | Dependency rules, SPDX headers and LICENSE files; documented bus API; the app's sign-in against a real API |
| `./bleep docs [build\|help-index\|screenshots]` | The single-file docs and `llms.txt`; the board's Help index; the module screenshots |
| `./bleep package` / `./bleep release plugins\|modules\|community` | Packages modules and installs them for the app and the plugins (`--no-install` only packages); publishes plugins or modules to the library ([release.md](doc/operations/release.md)) |

Behind it: [`scripts/bleep.py`](scripts/bleep.py) (the command), [`scripts/settings.py`](scripts/settings.py) (the settings), and the tools it calls:
`build/build-web.sh`, `run/ui-server.py`, `docs/*.py`, `check/*.py`, `release/release.py`, `package-module.py`, `community-publish.py`.
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
  `./bleep build plugins` copies the plugins by default, also while Live is running (it warns): overwriting a loaded plugin can
  crash Live. Quit Live first, or use `--no-install` to only build.
- **Quick checks without Live:** `./bleep run ui` runs the board UI in a browser
  against a fake engine; the engine tests (`ctest --test-dir build/patch`) simulate Live's
  parallel tracks.

Or everything with CMake: `cmake -S . -B build -DBLEEP_JUCE_DIR=/path/to/JUCE && cmake --build build && ctest --test-dir build`.

## License

The engine, board and apps in `patch/` are GPL-3.0-only with a [module exception](LICENSE-EXCEPTION.md), so modules can
be open source, closed source or paid. The built-in modules are GPL-3.0-only too (the three ported from other code keep
their original licence). Bleep Bus (`bus/`), the scripts and the website are MIT.
[Licensing in plain terms](https://beautifulbleep.com/docs/developers/modules/licensing/).
