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
| **Convert to module** | Turns this node into the module itself: it keeps its cables and knob values, appears in the Add menu and shows its own UI. The same button on the module's window says **Convert to code** and turns it back. See [Convert to module](#convert-to-module) |
| **Share…** | Publishes the module in the Bleep Library, after asking for the metadata and the help text. See [Share](#share) |
| **Settings** | A number field per setting the script declares, such as *Channels*. Changing one compiles again. See [Settings](module-scripts.md#settings-and-counted-jacks) |
| **Editor** | [CodeMirror](https://codemirror.net/) with TypeScript highlighting, line numbers, bracket matching, folding, undo within the editor, and completion for the decorators and library (type `@` or press `Ctrl+Space`) |
| **Status line** | `Fold: compiled · about 3,000 ops per block (1 % of the limit)`, or the number of errors |
| **Problems** | One line per error or warning with line and column; click one to jump to it. The first 30 are shown. Errors are also underlined in the editor |
| **Help tab** | The module's help page in Markdown (*Write* and *Preview*). The **?** button of the node's window shows it, and a module saved from the node keeps it. Without one, the **?** shows a page made from the module's description: its text, knobs with their ranges, jacks and meters. Headings, lists, tables, bold, code and links work; images are left out |
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

## Convert to module

A script you want to keep using does not have to live in a Code node. **Convert to module** (once the script has compiled) compiles it for good, keeps it on this computer and turns the node into the module: the same node, with the same cables and knob values, now an ordinary module of the category its `@module` names (for example *Effects › Distortion*), with its own UI and help page. It also appears in the **Add** menu, so you can place more of it.

The button on the module's window says **Convert to code**. It turns that node back into a Code node with the module's source, UI, help page and metadata, so you can change it and convert it again: the two modes are two views of the same thing, to try either.

- The module is stored in the browser (IndexedDB) and is yours alone: it is your own code, so it is not signed and runs in the same sandbox as every module. Its type id is `<publisher>/<name>` (see the Metadata tab; *mine* until you have a library name).
- Converting again replaces the stored module with the Code node's current source. Other nodes of it get the new version after a reload.
- A module is not part of a patch file: someone who opens your patch needs the module too, so share it (see [Share](#share)).
- The modules that come with the board (the vintage modules, in *Add › Effects*) are the same kind of module: **Convert to code** opens their source.

## Metadata

The **Metadata** tab holds what the module says about itself: the *publisher* (your library name, filled in when you are logged in, otherwise *mine*), the *module name* (from `@module({ name })`), the *version*, a *summary* of up to 280 characters, the *category*, the *licence*, *tags*, a *web page* and *release notes*. It is saved with the node and with the module.

## Share

**Share…** publishes the module in the Bleep Library as a community module, for everyone to install. It asks for the summary, category, licence, version and the help page, builds the package in the browser and uploads it under your library name (`<your name>/<module name>`); you must be logged in to the library. The library checks it and signs it. Each share needs a higher version than the last. A shared module carries no JavaScript, so it shows its knobs and not its own UI.

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
