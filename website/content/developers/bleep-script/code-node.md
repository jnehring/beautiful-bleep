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
| **Save as module** | Keeps the compiled module on this computer, in the Add menu (see [Save as module](#save-as-module)) |
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

## Save as module

A script you want to keep using does not have to live in a Code node. **Save as module** (next to *Examples*, once the script has compiled) keeps the compiled module and its UI on this computer. It then appears in the **Add** menu like any module, under the category its `@module` names (for example *Effects › Distortion*), with its knob layout and its own UI, and needs no Code node, no compile and no "Allow unsigned modules".

- The module is stored in the browser (IndexedDB) and is yours alone: it is your own code, so it is not signed and runs in the same sandbox as every module. Its type id is `mine/<name>`.
- **Update saved module** replaces it with the Code node's current source. Patches that already use it get the new version after a reload.
- **My modules** in the *Examples* menu opens a saved module's source (and UI) in the Code node, to change it and update it.
- **Remove module** takes it off this computer. Nodes of that module in a patch show as missing; the Code node keeps its source.
- A saved module is not part of a patch file: someone who opens your patch needs the module too, so share it through the library (see [Publishing a module](../modules/publishing.md)).

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
