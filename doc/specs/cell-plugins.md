# Bleep Instrument and Bleep FX

Status: design (not built). Two VST3 plugins that each load **one cell preset** with its **panel**, so you pick "Warm Saws" or "Dub Ping-Pong" and play it like any plugin. Underneath, each instance is a full part of the shared board: it shows up there as a cell you can open, edit and cable to other plugins.

| Plugin | Live device | In | Out | Loads |
|---|---|---|---|---|
| **Bleep Instrument** | instrument | MIDI | audio | cell presets that play notes |
| **Bleep FX** | audio effect | audio | audio | cell presets that process audio |

## 0. Decisions

- The new plugins are named **Bleep Instrument** and **Bleep FX**.
- The old **Bleep Instrument** and **Bleep Audio Insert** ports are **removed**; the new plugins replace them (section 7 shows nothing is lost). The VST3 id `BpIn` is reused by the new Instrument so existing sets keep loading it; `BpAs` (Audio Insert) is retired, sets using it show a missing plugin.
- Every instrument and FX preset has a **panel**, loaded when the plugin opens. The user can always open the board and edit the patch.
- Each instance is a **full board part**: it lives on the shared board like every other patch, so it can be cabled to other plugins.

## 1. What an instance is

An instance is a **cell node on the shared board** plus two host-facing ports built into it:

```
Bleep Instrument                              Bleep FX
host MIDI ─▶ [notes in] ┐                     host audio ─▶ [in L,R] ┐
                        │ preset cell                                │ preset cell
                        │ (editable)                                 │ (editable)
audio out ◀─ [out L,R] ◀┘                     audio out ◀─ [out L,R] ◀┘
          + any extra jacks the cell has, free to cable on the board
```

- It is the old port and the preset in one: the plugin is the *MIDI In + Audio Out* (or *Audio In + Audio Out + dry/wet*) and the cell is already patched to them. Drag cables from the cell's other jacks (Clock, a control input, extra outputs) to any other node, exactly as with any cell.
- The cell is the real thing: *Open Board* shows it, you open the cell, rewire it, swap a module, save it as a user preset. The plugin's state stores the edited cell, so edits survive save/reopen.
- It uses the one shared engine, so it follows all board rules: compiled with the rest of the board, cycles get the 32-sample delay, undo covers it, the board's sanitiser checks it.
- **Latency stays as today** (two blocks reported to Live, `specs.md` §5.3), the same as the old Bleep Instrument and Audio Insert. Optimisation for later: when a cell has no cables to other plugins, run it directly in its own block with zero latency; only a cell connected elsewhere pays the two blocks.
- Several instances: each is its own cell on the board with its own name (editable in the plugin window, as for ports).

## 2. Which cells go in: the preset manifest

**Every cell preset declares what it can be loaded as.** One field on the preset document (`{format, root, category, description, tags, plays, nodes, cables}`):

```json
"plays": { "instrument": { "notes": "voice" } }
"plays": { "instrument": { "notes": { "trigger": "trig", "velocity": "velocity" } } }
"plays": { "effect": { "in": ["l", "r"], "out": ["l", "r"], "tail": 8 } }
```

Either key may be absent; `plays` absent means "board only". A preset may declare both. The panel is not a field: panels are keyed by preset name in `factory-panels.json`, and the build fails if a preset with `plays` has none (section 3).

### 2.1 Instrument

`instrument.notes` says how the host's MIDI reaches the cell. The plugin's MIDI side offers the same signals as a Bleep MIDI In node (`notes`, `pitch`, `gate`, `velocity`, `trigger`), and `notes` names the cell input each one goes to:

| Shape | Presets | `notes` |
|---|---|---|
| **Voice Cell** (`voice-cell` root) | Synthesizers, Basses, Leads, Pads, Plucks, Empty Instrument | `"voice"`: the MIDI `notes` go to the voice allocator; audio from Voice Out |
| **Drum cell** (plain, `trig` input) | all Drums, and Drum Machines that have one | `{trigger: "trig", velocity: "velocity"}`: any note triggers the sound, velocity to the velocity jack |
| **Hi-hat cell** (`closed` and `open` inputs) | Drums/Hats | `{trigger: {"default": "closed", "44": "closed", "46": "open"}, velocity}`: the General MIDI hat notes, any other note closes |
| **Pitched plain cell** (a `pitch` input) | Seasons Turning, Lichen Drone | `{pitch: "root"}`: the last note's pitch |
| **Self-playing** (no note input; clocked or free-running) | Generative | `{}`: MIDI is ignored, the cell plays with the transport |
| **Drum machine** (self-playing, plus a shared `notes` input) | Drum Machines | `{notes: "notes"}`: the host's MIDI stream goes to the cell's Notes input, where a **Drum Notes** module turns General MIDI drum notes (kick 35/36, snare 38/40, rim 37, clap 39, hats 42/44 and 46, toms, cowbell 56, ride, crash) into hits on top of the pattern (`p.gmDrums(...)` in the kit) |

**Time:** the Instrument port node has a `clock` (24 per quarter note, only while the host plays) and a `playing` output. A cell with a shared input named `clock` gets the first, one named `run` the second, so self-playing cells follow Live's transport and start/stop.

Keys: `trigger` (a jack id, or a map of MIDI note → jack with a `default`), `velocity`, `pitch`, `gate`, all optional. The kit's `checkPlays` rejects a jack the cell does not have. `cc` and `bend` mappings are not in the first version.

### 2.2 Effect

`effect` names the jacks that receive the host's audio and those that return it (`in`/`out`, almost always `["l","r"]`; mono input is duplicated) and **`tail`**, the seconds the effect rings after the input stops, returned as the plugin tail so Live does not cut reverbs and delays on stop. The other cell inputs (Mix, Feedback, Clock …) are ordinary jacks: panel knobs and board cables. Later: a `sidechain` jack.

### 2.3 Derivation, so it is never forgotten

`derivePlays(doc, category)` in `presets/kit.mjs` fills `plays` in from the jacks and the build checks it; the author overrides with `p.plays({...})` (or `p.plays(false)` for board-only):

1. Categories `Test`, `Sequencers`, `Modulators`: board only.
2. Root `voice-cell` → instrument, `"voice"`.
3. No audio out → board only.
4. Audio in and audio out → effect; `tail` is the longest of the modules in it (reverb and delay network 8 s, zone delay 6, grains 2, frequency shifter 1, others 0).
5. Audio out, no audio in → instrument; the shapes in 2.1 follow from the jacks named `trig`, `closed`/`open`, `velocity` and the `pitch`-typed input.

The three hand-written presets in `board/ui/factory-presets.js` carry their `plays` by hand; `build.mjs` fails when it differs from the derived one and prints the line to paste. `node patch/presets/build.mjs --check` (CI) fails when the committed JSON is stale.

## 3. Panels

The panel is required, not optional:

- A preset with `plays` **must have a panel** (an entry in `factory-panels.json`, from `panels.mjs`; the build fails without one). The build **generates one automatically** (*Build panel from cell*: the same code the board uses) for any preset without a hand-written one, and commits the result as data, so the rule holds for all 108 candidates from day one. Hand-written panels override it, best presets first.
- The plugin window **opens on the panel**, not on a settings view. A small bar on top has the preset name, ◀ ▶, a preset browser, *Open Board*, and (FX) Dry/Wet.
- *Open Board* opens the board scrolled to this cell; the panel's controls are wired to the cell's knobs, so edits there are reflected live. If the user rewires the cell, the panel keeps working where its targets still exist; a control whose target is gone shows as disabled. *Reset panel* rebuilds it.
- A user can swap the panel (any panel of the board) or save the edited cell with its panel as a user preset.

## 4. Where presets come from

No registration step: **a preset with `plays` appears in the right plugin.**

| Source | Where | Notes |
|---|---|---|
| Factory | `factory-presets.json`, compiled into the plugin binary | always there, offline |
| Store | `<data>/presets/` (`.bleeppreset`, `preset.type: "cell"`, `website/content/developers/modules/library.md` §6) | after install; scanned at start and on folder change |
| User | `<app data>/Beautiful Bleep/Cells/*.bleepcell` | under "User" |

Each plugin lists only presets whose `plays` contains its role and whose `needs` modules are available; one with a missing module is greyed with "Install 2 modules". Both plugins carry the whole factory file and filter at run time (new `PortKind::CellInstrument` / `CellEffect`).

**Preset browser** (in the plugin window): category tree, search over name/tags/description (same matcher as Tab search), description on hover, ◀ ▶. Picking a preset **replaces the instance's cell** (undoable; cables from the old cell's shared jacks are kept where jack ids match).

## 5. State, parameters, Live

- **State** saved with the set: `{preset: {id, version, sha256}, cell: <the edited cell document>, panel, params}`. The cell is the source of truth, so a set opens identically after the preset changes or its module disappears; `preset` only drives "update available" and "revert to preset". A missing module shows the install prompt and plays silence.
- **Parameters:** 16 fixed host parameters (like Bleep Board's macros), taken in order from the panel controls marked *expose*; titles updated per preset (`kParamTitlesChanged`). Fixed ids keep automation stable across preset changes.
- **Live's preset menu:** the flat preset list is exposed as VST3 programs ("Basses / Acid Line"), if Live lists them (verify); the in-window browser does not depend on it.
- Instrument also has Volume and Voices; FX has Dry/Wet (the dry signal is delayed to match latency, as the Audio Insert does today).

## 6. Build, test, release

- `bleep_add_plugin(... KIND CellInstrument SYNTH)` and `... KIND CellFx`, same helper as the ports. Live refuses VST3 instruments without an event input bus; FX has no MIDI bus.
- **Removed:** the `Instrument` and `AudioInsert` kinds, targets `BleepInstrument` / `BleepAudioInsert`, their `PortProcessor` branches, `release.py` entries and docs (README table, `specs.md` §6, §9.7 wording).
- `release.py` `PLUGINS`: `bleep-instrument` and `bleep-fx`; both in the default plugin bundle.
- **ctest per preset** (extends `ctest -R factory`): every `plays.instrument` preset plays a note (or its mapped drum note) → finite, non-silent, below clipping, silent after note-off; every `plays.effect` preset passes noise → finite and bounded, silence in → silence out after `tail`; every preset with `plays` has a panel whose targets all exist; committed `plays` equals derived.

## 7. Nothing is lost

| Old | Replaced by |
|---|---|
| Bleep Instrument (MIDI in + audio out, patch it yourself) | Bleep Instrument with the preset **"Empty Instrument"** (a voice cell with notes in and audio out, nothing inside) |
| Bleep Audio Insert (track audio through the board and back, dry/wet) | Bleep FX with **"Empty FX"** (audio in wired to out; passes through until you build) |
| Showing a panel in the port's window | now the default |
| Cabling the port to the rest of the board | the cell's jacks, cabled as any cell |
| Bleep MIDI In / Audio In / Audio Out / MIDI Out | unchanged; they stay for plain routing |

Two empty presets are part of the delivery. Existing sets: the old Instrument id is kept; sets with an Audio Insert lose it (small user base, early product; say so in the release notes).

## 8. Phases

| # | Deliverable | Gate |
|---|---|---|
| 1 | **Done:** `plays` in the kit and preset schema, derived and checked; drum note maps; the panel requirement; the *Starters* category with Empty Instrument and Empty FX; `patch.cell-plugin-presets` | `--check` green, all shapes load |
| 2 | **Spike (done in the engine, not yet tried in Live):** see section 10 | Engine tests green; sound, state round trip and latency in Live still to check by ear |
| 3 | The two plugins: panel window, browser, replace-preset, state, parameters, Dry/Wet | Pick, play, edit, save the set, reopen |
| 4 | Remove the old Instrument and Audio Insert (code, release, docs) | Builds and tests green without them |
| 5 | User and store presets, missing-module prompts, zero-latency fast path for unconnected cells, hand-written panels | Software Center installs a preset and it shows up |

## 9. Open questions

1. ~~What does *replace preset* do to cables to jacks the new cell does not have?~~ **Decided: they stay as ghosts** (as ports do when their plugin is gone), and reconnect when a jack with that id comes back.
2. Per-voice multi-out for drum cells (more audio outputs to Live)? Out of scope now.
3. Does Live's hot-swap list VST3 programs? Verify in phase 3.

## 10. What the spike built (phase 2)

The spike showed that **the existing ports already are the host side**. An instance is the old `Instrument` or `AudioInsert` port node with a preset cell inserted next to it and cabled to it, all as ordinary board nodes. No new module type and no new plugin-to-engine protocol.

- **Engine** (`EngineApi.h`, ABI tag 6): `setCellPreset(handle, json, replace)` and `cellPreset(handle)`. `Engine::attachPreset` inserts the preset (fresh ids, its panels bound to the new cell) next to the port node and cables it from `plays`; `board::insertPreset`, `attachHost`, `attachedCell`, `removeCell` and `extractPreset` in `Board.cpp` do the document work. Choosing another preset replaces the cell.
- **State:** the plugin saves the cell as it is on the board, edits included (`cellPreset`). Restoring with `replace` false keeps a cell already on the board, so with Bleep Board the board's copy wins and the plugin's copy only fills a gap.
- **No Bleep Board needed:** while the set has no Bleep Board, the engine keeps an implicit board for the cell plugins and drops it when the last one goes. Adding Bleep Board replaces it with its own board; each instance's port node and cell are re-added from its saved copy. Cables between plugins need Bleep Board, because only its board is saved.
- **Plugins:** the existing Bleep Instrument and Bleep Audio Insert load a preset today (`PresetLibrary`: the factory presets compiled in, filtered by `plays`) with a plain menu in the window and a default for new instances (Warm Saws, Empty FX). Renaming, the real browser and the panel window are phase 3.
- **A fix found on the way:** an Audio Insert's send and return were one node, so the way through the board counted as a cycle and got the 32-sample feedback delay: wet arrived 32 samples after the dry the plugin delays. The compiler now splits the node into send and return (`audio-return`), so a pass-through returns exactly two blocks later. This fixes the old Audio Insert too.
- **Known gaps:** hi-hat cells (`closed`/`open`) get every note on the default jack, so open hats are not reachable yet; the three presets in `factory-presets.js` are not in the plugins' library yet; cables of a replaced cell are dropped, not kept as ghosts (decided, not built); the instance's window shows no panel yet.
- **Tests:** `bleep_engine_tests` `cellPlugins` (an Instrument alone in the set plays a note; state round trip; Bleep Board arriving; replacing a preset; an FX returns audio two blocks later).

## 11. Phase 3 design: the plugin window

### 11.1 What the window shows

```
┌ Bleep Instrument ─────────────────────────────────────────────┐
│ ◀ ▶  Warm Saws ▾    ·  Synthesizers          Open Board  ⋯   │  top bar (native JUCE, 32 px)
├───────────────────────────────────────────────────────────────┤
│                                                               │
│                  the preset's panel                           │  web view: panels.js on the cell's panel
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

- The top bar is native: ◀ ▶ step through the plugin's presets, the name opens the **browser** (a web overlay, section 11.3), *Open Board* opens the board scrolled to the cell, ⋯ holds *Reset panel*, *Revert to preset*, *Rename*. Bleep FX adds Dry/Wet there, Bleep Instrument a Volume.
- The panel is the cell's own panel (`board.panels` entry with `cell` = the cell). The window **opens on it**. It is sized to the panel (`cols × rows × 20 px`, plus the bar) and not resizable in the first version; a panel bigger than the screen scrolls.
- No panel found (the user deleted it): the window offers *Build panel from cell* (the board's code), so it is never empty.
- The window no longer opens the board by itself (today's behaviour); *Open Board* does. (Old spec §9.1 opened it with the window; with a panel to play, that would be in the way.)

### 11.2 How the panel gets its data (the one hard part)

A plugin's editor cannot use the engine's web view: the engine may live in **another plugin's binary** (the first Bleep plugin loaded creates it), and JUCE objects must not cross binaries, which is why `IEngine` uses plain types only. So the editor makes **its own** `WebBrowserComponent` (from its own binary and its own copy of `board/ui`, which already holds `panels.js`, the module views and the bridge) and talks to the engine through a JSON call on the ABI:

```cpp
// IEngine, ABI tag 7
virtual size_t uiCall(int handle, const char* method, const char* argsJson, char* out, size_t capacity) noexcept = 0;
```

`Engine::uiCall` is a table of the same handlers `BoardView` already registers as native functions, and `BoardView` is rewritten to use it, so board and plugin window share one set of handlers. The plugin window needs only: `panel` (the instance's cell with its panel, the node types its controls use: `describeTypes`), `setParam`, `beginGesture`, `perform`, `command`, `setData`, `watch`, `liveState` (polled by a 30 Hz timer in the editor and pushed to the page as the board window does), and the preset calls. It does not get `commit` or `loadPatch`: the panel edits knobs, not the graph.

New page `plugin-panel.html` + `plugin-panel.js`: loads `panels.js` and the module views, implements the `host` object `BleepPanels.create` wants (`node`, `param`, `value`, `set`, `begin`, `view`, `refreshView`) on top of `native("setParam", …)`, and shows nothing but the panel. Smaller than `board.js` by an order of magnitude; no board code is loaded.

*Risk to check first:* a `WebBrowserComponent` (WKWebView) inside Live's VST3 plugin window. JUCE 8 supports it, but focus, keyboard (the panel's Keyboard control) and resizing in Live need a quick spike before the rest is built (step 1 of 11.7).

### 11.3 Preset browser

An overlay in the same web page, reusing `project-browser.js`: category tree, search over name, tags and description, description on hover, filtered by `plays` for the plugin's role. It lists factory presets (compiled in), then user and store ones as they appear (phase 5). Picking one calls `uiCall("loadPreset", {name})` → `setCellPreset(..., replace=true)`. In the first version the native menu stays as the fallback.

Presets hand-written in `factory-presets.js` (there are none at the moment: every factory cell is written in `patch/presets`) would become part of the library: the build writes them, with their panels and `plays`, into `hand-written-presets.json`, which the plugins' library reads next to `factory-presets.json`.

### 11.4 Parameters

16 host parameters `p1…p16`, always the same ids and names "Param 1…16" so automation keeps its meaning across presets (spec §5 / section 5). They are taken, in order, from the controls of the preset's panel that are marked `"expose": true` in the panel document (new optional field; the generated panels mark their first 16 dials and sliders, hand-written panels choose). The mapping `param slot → (node, knob)` is rebuilt when the cell or panel changes; titles update with `kParamTitlesChanged`.

A host automation write is stored in an atomic per slot; the editor-independent processor timer (30 Hz, message thread) applies changed ones with `uiCall("setParam")`. A panel knob move updates the slot, so the host sees the change. The first version applies automation at 30 Hz, which is smooth for knobs; sample-accurate parameter control is not a goal.

### 11.5 Names, ids and the old plugins

- **Bleep Instrument** keeps `PluginCode BpIn`, so old sets still find it. **Bleep FX** is a new product, `BpFx` (target `BleepFx`, `PortKind::AudioInsert` inside), and replaces *Bleep Audio Insert* (`BpAs`), which is deleted in the same phase (this *is* the old phase 4: nothing else is left to remove, because the new plugins are the old ports with presets).
- Both stay `IS_SYNTH` (Instrument, with a MIDI input) and effect (FX); VST3 categories `Instrument Synth` and `Fx`.
- `release.py`: `bleep-audio-insert` → `bleep-fx`; docs and READMEs updated.
- **Existing sets:** an old *Audio Insert* shows as a missing plugin (no migration); an old *Instrument* without a saved preset stays empty (no default is loaded into a saved set).

### 11.6 Known gaps closed in this phase

- **Open hi-hats:** `attachHost` feeds the default jack only. Cells with several triggers get a small engine module, `note-router` (a node: `notes` in, one trigger out per mapped note), cabled by `attachHost`; the manifest's `{default, "46": "open"}` is its configuration.
- **Ghost cables:** replacing a cell keeps the cables that touched jacks of the old cell as cables to a ghost endpoint (same id), and reconnects them when a jack with that id comes back.
- **Preset library:** the three hand-written presets (11.3).

### 11.7 Build order

1. **Spike:** an editor with a `WebBrowserComponent` showing a static panel page, in Live. Gate: renders, takes mouse and keyboard, survives close/reopen and two instances.
2. `uiCall` on the ABI, `BoardView` moved onto it; the board window unchanged for the user.
3. `plugin-panel.html/js`, the editor with top bar and panel, *Reset panel*.
4. The 16 parameters and `expose`.
5. Browser overlay, the three extra presets.
6. `note-router`, ghost cables.
7. Rename and remove Audio Insert; release script and docs.
8. Tests: `uiCall` round trip, parameter mapping, editor opens in the plugin test (`bridge_plugin_test`), `note-router`.

## 12. Phase 3 status

Built (commits `9b70a1d` and after):

- **Panel in the plugin window** (11.1, 11.2): `IEngine::uiCall` (ABI 7); the board page's plugin mode (`?panelOf=` in a browser, `init.plugin` in a plugin); `PanelView` (a web view in the editor) and a bar with ◀ ▶, the preset menu, *Open Board* and Dry/Wet. The window is resizable and the panel scales to it; the first size comes from the panel's grid. The window no longer opens the board. If the panel is gone, the page builds one from the cell, once.
- **16 parameters** (11.4): `SlotParameter` p1…p16 on both plugins; `Engine` answers `cellParams` (controls marked `expose`, else the first 16 dials and sliders of the panel); a 30 Hz message-thread timer carries host automation to the knobs and knob moves back to the host, and updates the names. No `expose` flag is set by any generated panel yet, so the fallback picks the first 16.
- **Hand-written presets** (11.3, 11.6): `build.mjs` writes any of them to `hand-written-presets.json` (empty now); the plugins' library reads it next to `factory-presets.json`.
- **Rename** (11.5): *Bleep Audio Insert* is **Bleep FX** (`BleepFx`, code `BpFx`, `PortKind::AudioInsert` inside); `release.py`, READMEs and `specs.md` follow.

Not built, and not tried in Live: the web view inside Live's plugin window (the risk named in 11.2: rendering, keyboard focus, close and reopen, two instances), the browser overlay (the native menu stays), `note-router` for open hi-hats, ghost cables.
