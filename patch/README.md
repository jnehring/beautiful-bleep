# Beautiful Bleep: engine, board and plugins

The shared engine, the **board** and the Bleep plugins you add in Ableton
Live (spec: [`doc/specs/specs.md`](../doc/specs/specs.md)). Modules (**Function**,
**Random**, **Utility**, **Filter**) are not plugins any more: they are nodes
on the board. In Live you add only:

| Plugin | Live device | On the board |
|---|---|---|
| **Bleep Board** | audio effect | required once per set; stores and opens the board; 16 macros |
| **Bleep MIDI In** | instrument | notes, pitch, gate, velocity, CCs from a MIDI track |
| **Bleep MIDI Out** | instrument (VST3 MIDI out) | notes, gate/pitch, CCs and bend to another track |
| **Bleep Audio In** | audio effect | the track's audio |
| **Bleep Audio Out** | instrument | board audio on its own track |
| **Bleep Instrument** | instrument | one instrument preset (its panel in the window): MIDI in, its cell, audio out |
| **Bleep FX** | audio effect | one effect preset (its panel in the window), the track's audio through its cell and back, dry/wet |
| **Bleep Audio Bridge** | audio effect | connects Live to the standalone Bleep App (spec §11.3) |

MIDI In/Out and Audio In/Out also have a **Board** menu (*This set*, *Bleep App*, *Bleep Play*): with the app or a
Bleep Play the plugin talks to that board, not this set's (doc/specs/bridges.md, and *Connecting plugin, app and web*
in the user docs). Try it without Live: `build/patch/bleep_bridge_probe_artefacts/Release/bleep_bridge_probe audio-in,audio-out web`.

```bash
scripts/build/build-patch.sh --juce /path/to/JUCE      # or set BLEEP_JUCE_DIR; without it JUCE 8.0.9 is downloaded
scripts/build/build-patch.sh --install                 # also copy the plugins into your user plugin folder
```

VST3 only, Ableton Live only for now (spec §5.2). The script builds into
`build/patch/`, then runs the DSP tests, the engine tests and the bridge tests.

It also builds the standalone **Bleep App** (spec §11): the board without
a DAW, with its own MIDI ports, Ableton Link and the Bleep Audio Bridge server.
See [`app/README.md`](app/README.md). Its preset browser (File → Presets…) loads
whole demo boards, five per advanced module.

## Layout

```
patch/
├── engine/           the shared engine (spec §5.3): board model, compiler, block claiming, ports, undo
├── board/            the board window (BoardWindow.cpp) and its page (ui/: board.js, board.css, demo backend)
├── app/              the standalone app: AppController (device, MIDI ports, Link, projects), Main
├── bridges/ableton/  the plugins: PortProcessor (one class for all of them) and its small editor
├── bridges/standalone/  Bleep Audio Bridge: shared-memory protocol, plugin (client), app side (server), Link clock
├── presets/          factory cell presets and the demo boards (presets/demos/), compiled into board/ui
├── modules/<name>/
│   ├── dsp/          the module's DSP (<Name>Dsp.h, no JUCE)
│   ├── <Name>Module.cpp   the node: params, jacks, process()
│   ├── ui/           optional custom displays for its module view (<name>.js)
│   ├── doc/          its documentation (<type>.md, plus any images), shown by the view's ? button
│   └── module.json   metadata for the website
├── common/
│   ├── dsp/          shared DSP: SVF, smoothing, counter-based randomness, tempo
│   └── ui/           bleep-bridge.js (JUCE bridge), bleep-view.js/.css (module views), bleep-markdown.js (docs)
└── tests/            DSP, engine and bridge tests, bridge plugin test, board smoke test, type dump
```

## How the pieces fit

- **One engine per process.** JUCE builds one plugin per binary, so every
  plugin contains the engine code. The first Bleep plugin loaded creates the
  engine and publishes it in the process (`BLEEP_ENGINE`); the others
  use that instance. The binary that created it pins itself so it is never
  unloaded. Binaries of another engine major refuse to share and say so. The plugins agree on a major and a minor version of the engine interface: [`website/content/developers/reference/engine-abi.md`](../website/content/developers/reference/engine-abi.md).
- **Ticks.** For every host block the first plugin to run claims the block
  and runs the compiled board. Plugins exchange their block with the engine
  through small tagged rings: a signal from an input port to an output port
  takes exactly two blocks, whatever order Live runs the tracks in. Output
  ports report that latency to Live.
- **The board** is a JSON document owned by the engine and saved in Bleep Board's state. The page edits a copy and commits it; the engine sanitises
  it (`engine/Board.cpp`), compiles it (`engine/Program.cpp`: cells are
  flattened, cycles get a 32-sample feedback delay) and keeps the undo stack.
- **Ports** appear on the board on their own, can't be deleted there, and
  turn into ghosts when their plugin is gone or inactive.

## Data folders

User data lives in `Beautiful Bleep/` (the app-data folder: `Cells/`, `Drum Patterns/`, `Boards/`,
the app's settings) and `~/Music/Beautiful Bleep/Media/`. Before 0.2 these were called `Bleep Patch`,
and whole boards were `Patches/*.bleeppatch`. The engine and the app move the old folders over on
start (`media::migrateLegacyFolders()` in `engine/Media.cpp`): a board becomes `Boards/*.bleeppreset`,
and a file that already exists under the new name is kept (the old one stays where it was).

## Working on the board UI

```bash
python3 scripts/run/ui-server.py      # http://localhost:8765, with a fake engine (no audio)
```

With `scripts/build/build-patch.sh --ui-dev`, plugins read the page from the
source tree; press ⌘R in the board window after an edit. The demo backend
reads node types from `board/ui/demo-types.json`; after changing a module's
params or jacks, regenerate it (ctest checks it is current):

```bash
build/patch/bleep_dump_types_artefacts/Release/bleep_dump_types --write patch/board/ui/demo-types.json
```

`bleep_board_smoke` opens the real board window on a real engine for a few
seconds and checks the page through the real bridge (not part of ctest).

**JUCE licensing:** this source is MIT, but binaries built with JUCE are
also covered by JUCE's license (AGPLv3 or a commercial JUCE licence).
Check that before you distribute builds.

User docs: [getting started](../website/content/musicians/getting-started.md).
