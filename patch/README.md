# Bleep Patch

The shared engine, the **Bleep Board** and the plugins you add in Ableton
Live (spec: [`specs/specs.md`](../specs/specs.md)). Modules (**Function**,
**Random**, **Utility**, **Filter**) are not plugins any more: they are nodes
on the board. In Live you add only:

| Plugin | Live device | On the board |
|---|---|---|
| **Bleep Patch** | audio effect | required once per set; stores and opens the board; 16 macros |

```bash
scripts/build-patch.sh --juce /path/to/JUCE      # or set BLEEP_JUCE_DIR; without it JUCE 8.0.9 is downloaded
scripts/build-patch.sh --install                 # also copy the plugins into your user plugin folder
```

VST3 only, Ableton Live only for now (spec §5.2). The script builds into
`build/patch/`, then runs the DSP tests and the engine tests.

## Layout

```
patch/
├── engine/           the shared engine (spec §5.3): board model, compiler, block claiming, ports, undo
├── board/            the board window (BoardWindow.cpp) and its page (ui/: board.js, board.css, demo backend)
├── bridges/ableton/  the plugins: PortProcessor (one class for all of them) and its small editor
├── modules/<name>/
│   ├── dsp/          the module's DSP (<Name>Dsp.h, no JUCE)
│   ├── <Name>Module.cpp   the node: params, jacks, process()
│   ├── ui/           optional custom displays for its module view (<name>.js)
│   └── module.json   metadata for the website
├── common/
│   ├── dsp/          shared DSP: SVF, smoothing, counter-based randomness, tempo
│   └── ui/           bleep-bridge.js (JUCE bridge), bleep-view.js/.css (module views)
└── tests/            DSP tests, engine tests, host test, board smoke test, type dump
```

## How the pieces fit

- **One engine per process.** JUCE builds one plugin per binary, so every
  plugin contains the engine code. The first Bleep plugin loaded creates the
  engine and publishes it in the process (`BLEEP_PATCH_ENGINE`); the others
  use that instance. The binary that created it pins itself so it is never
  unloaded. Binaries from another build refuse to share and say so.
- **Ticks.** For every host block the first plugin to run claims the block
  and runs the compiled board. Plugins exchange their block with the engine
  through small tagged rings: a signal from an input port to an output port
  takes exactly two blocks, whatever order Live runs the tracks in. Output
  ports report that latency to Live.
- **The board** is a JSON document owned by the engine and saved in Bleep
  Patch's state. The page edits a copy and commits it; the engine sanitises
  it (`engine/Board.cpp`), compiles it (`engine/Program.cpp`: cells are
  flattened, cycles get a 32-sample feedback delay) and keeps the undo stack.
- **Ports** appear on the board on their own, can't be deleted there, and
  turn into ghosts when their plugin is gone or inactive.

## Working on the board UI

```bash
python3 scripts/ui-server.py      # http://localhost:8765, with a fake engine (no audio)
```

With `scripts/build-patch.sh --ui-dev`, plugins read the page from the
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
