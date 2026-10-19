---
title: The Code node
description: The editor, compiling, settings, saving and undo, panel wiring, and where the compiler is available.
order: 20
---

# The Code node

The **Code** node (Add menu: *Utility › Script*) holds one script. Click the node to open its view.

## The view

| Part | What it does |
|---|---|
| **Compile** | Compiles the script. `Ctrl+Enter` or `Cmd+Enter` does the same while the cursor is in the editor |
| **Examples** | Loads a starting point: *Gains (mixer channel)*, *Wave folder*, *Tremolo*, *Note router*, *Mixer (configurable)*, *SuperSaw: 100 oscillators (patch script)* |
| **Settings** | A number field per setting the script declares, such as *Channels*. Changing one compiles again. See [Settings](module-scripts.md#settings-and-counted-jacks) |
| **Editor** | [CodeMirror](https://codemirror.net/) with TypeScript highlighting, line numbers, bracket matching, folding, undo within the editor, and completion for the decorators and library (type `@` or press `Ctrl+Space`) |
| **Status line** | `Fold: compiled · about 3,000 ops per block (1 % of the limit)`, or the number of errors |
| **Problems** | One line per error or warning with line and column; click one to jump to it. The first 30 are shown. Errors are also underlined in the editor |
| **Meters** | One bar per `@probe` the module declares |
| **Knobs** | The module's own knobs and buttons, built from its `@param` and `@button` declarations |

Typing in the editor never triggers the board's shortcuts or plays notes on the computer keyboard.

## Compiling

Compiling a **module script** takes about a second (the first time after loading the page, a few seconds while the compiler loads, about 3 MB over the network).

- On **success**, the new module replaces the running one, the node's jacks and knobs are rebuilt, and the source is saved on the node. Cables stay where the jack still exists, and knob values stay where the parameter id still exists. *Undo* restores the previous source, jacks and module together.
- On **failure**, nothing changes. The previous version keeps running, the problems are listed, and the status line says `1 error; the previous version keeps running`.

Running a **patch script** builds a cell next to the node. See [Patch scripts](patch-scripts.md#what-compiling-does).

## Saving and loading

The source, the jacks and knobs it declares, and the settings are saved **in the patch**, on the node. A saved patch shows its Code nodes with their jacks, cables and knob values at once, before anything is compiled. When a patch with a module script is loaded, the page compiles the source in the background and starts the module when it is ready (a few seconds); until then the node is silent.

Patch scripts are not compiled on load: the cell they built is ordinary patch content and is already there.

## Panels

A Code node's knobs can be put on a panel like any module's: right-click a knob in the view and choose *Add to panel*.

## Where it is available

| Host | Compile | Run |
|---|---|---|
| **Bleep Play (the browser)** | Yes | Yes |
| **Dev server (`scripts/run/ui-server.py`)** | Yes | No audio (the demo engine) |
| **Standalone app and plugins** | Not yet: the compiler is not shipped with them | The engine runs a Code node's module once the UI has registered it, and keeps the node's cables, knob values and source |

The compiler is a separate file, `bleep-script-compiler.js` (about 15 MB, 3 MB compressed), and the editor another, `bleep-script-editor.js` (about 470 KB). Without the compiler the Code node says so and keeps working as far as already compiled scripts go; without the editor it falls back to a plain text box.

### Building the bundles

```bash
cd patch/script
npm install
npm run bundle        # dist/bleep-script-compiler.js and dist/bleep-script-editor.js
cd ../..
scripts/build/build-web.sh --no-modules      # copies them next to the board
```

`scripts/run/ui-server.py` serves them straight from `patch/script/dist`, and a native build with `BLEEP_UI_DEV_ROOT` does too. The website image builds them as part of its web stage.

## The playground

`patch/script/playground/` is the same editor and compile flow as a stand-alone page, with a test signal and live audio, handy for working on the compiler or a library module. Start the `script-spike` server from `.claude/launch.json` and open `/script/playground/`.

## Known limits

- **No state-keeping hot reload.** A recompile starts the module fresh: smoothers and filters begin from zero. There is no crossfade between versions.
- **The same source and settings compile once.** Pressing Compile again without a change answers at once.
- **Instances.** Each Code node has its own source and its own interface. Two nodes with the same script compile once but are separate modules.
- **Browser support.** The compiler runs in a module Worker and uses WebAssembly, so it needs a current browser.
