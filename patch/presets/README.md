# Factory presets

Two kinds live here: the **cell presets** under *Add → Cell → <category>*
(below) and the **demo boards**, whole boards for the standalone app's preset
browser, five per advanced module (`demos/`, see [`demos/README.md`](demos/README.md)).

The cells under *Add → Cell → <category>* that ship with Beautiful Bleep. Each
category is one file here; [`build.mjs`](build.mjs) compiles them all into
[`../board/ui/factory-presets.json`](../board/ui/factory-presets.json), which
the board loads next to the user's own presets.

```bash
node patch/presets/build.mjs              # write factory-presets.json
node patch/presets/build.mjs --check      # CI: the JSON files are current (cell presets, panels, demo boards)
node patch/presets/build.mjs --reference  # every module's knobs, in units
ctest --test-dir build/patch -R factory   # the engine loads every preset without a warning
ctest --test-dir build/patch -R demo      # every demo board loads and makes sound
```

## How the preset system fits together

| Piece | Where | What |
|---|---|---|
| Preset document | `{format, root, category, description, tags, nodes, cables}` | A cell and everything inside it, knob values normalised (0…1), the same as on the board. User presets add `{name, preset}` around it in a `.bleepcell` file. |
| Factory presets | this folder → `factory-presets.json` | Written in units with [`kit.mjs`](kit.mjs), compiled and checked; read-only in the app. |
| User presets | `<app data>/Beautiful Bleep/Cells/*.bleepcell` | *Right-click a cell → Save as preset…* (name, category, description). Deleted under *Add → Cell → <category> → Delete preset*. |
| Help | `help` in the preset's opts → `help` in the preset document | `{text, images?}`, required for every factory preset. Shown by the "?" on the placed cell (the text is copied onto the cell, so it survives saving the board and *Save as preset*). Plain text, paragraphs separated by a blank line: what it is, what to patch where, one tip. Images are optional: `help: { text, images: [{ src: "help-<name>.png", alt, caption? }] }`, with the file in `patch/board/ui/` (served flat; `build.mjs` checks it exists). |
| Browsing | Add menu, Tab search | *Add → Cell → <category> → <preset>*; hovering shows the description. Tab search matches names, categories, tags and descriptions. |
| Panels | [`panels.mjs`](panels.mjs) → `../board/ui/factory-panels.json` | Hand-written front panels for cell presets (so far Punch Machine), keyed by preset name: tabs, a few knobs per module, mixer faders, loaded module panels. Checked against the preset when built; see [`doc/specs/panels.md`](../../doc/specs/panels.md) §6. `node patch/presets/panels-gallery.mjs out.html [name …]` draws them. |
| Checks | `kit.mjs`, `bleep_dump_types --check-presets` | The kit rejects unknown modules, knobs, choices, jacks, out-of-range values and incompatible cables while building; the ctest runs every preset through the engine's `board::sanitise` and fails on any warning or anything dropped. |

## Dependencies (`needs`)

A preset can list the modules it requires: `"needs": { "<module slug>": { "min": "1.2.0", "max": "2.0.0" } }`
(both versions optional, inclusive). Presets saved from the board get it automatically, `min` being the module
version installed at the time; add `max` by hand. Loading a preset or placing a cell whose modules are missing or too old
asks to download them from the Bleep Store first (spec: [`website/content/developers/reference/store.md`](../website/content/developers/reference/store.md) section 6).
Factory presets leave it out.

## What a preset can be loaded as (`plays`)

Bleep Instrument and Bleep FX load one cell preset each (spec:
[`doc/specs/cell-plugins.md`](../../doc/specs/cell-plugins.md)). The build puts a `plays`
entry in every preset that can be one, derived from the cell's jacks
(`derivePlays` in [`kit.mjs`](kit.mjs)): Voice Cells and cells with audio out and no audio in are
instruments, cells with audio in and out are effects. Categories Test, Sequencers and Modulators
stay on the board. `p.plays({...})` overrides it (`p.plays(false)`: board only). Each preset that
has `plays` gets a panel (generated if you don't write one), and `ctest -R cell-plugin` plays
every one of them: a note into each instrument, noise through each effect.

```js
const p = cell("Dub Echo", { ... }).stereoIn().stereoOut()
  .plays({ effect: { in: ["l", "r"], out: ["l", "r"], tail: 6 } });   // only to override the derived value
```

An effect that rings on (reverb, feedback delays) needs `tail` as long as it takes to die away:
the test fails otherwise and tells you how long it still sounds.

## Writing a preset

```js
import { voice, cell, category, ampEnvelope, envelope, semis } from "./kit.mjs";

function acidLine() {
  const p = voice("Acid Line", {
    description: "One sentence: what it is and what to play it with.",
    tags: ["mono", "acid"],
  }).settings({ voices: 1, mode: "Legato", glide: 0.08 })   // the Voice Cell's settings, in units
    .input("cut", "Cutoff");                                  // a shared input jack (Cell In → "cut")
  const osc = p.add("oscillator", [0, 0], { shape: 1 });     // [column, row] on a 300 × 220 grid
  const flt = p.add("filter", [1, 0], { cutoff: 300, resonance: 0.8, type: "Diode Ladder Tanh" });
  p.cable(p.vin, "pitch", osc, "pitch")                       // output jack → input jack (amount 1)
   .cable(osc, "out", flt, "l")
   .cable(p.cin, "cut", flt, "cutoff", 0.5);                  // into a knob: amount −1…+1
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { decay: 0.3, sustain: 0 });
  return p;
}
export default category("Basses", "One sentence about the category.", [acidLine, /* … */]);
```

- **Values are in units**: Hz, seconds, semitones, percent as 0…1 where the
  knob is 0…1. Choices by name (`type: "Ladder Tanh"`), toggles as booleans,
  integers as whole numbers. `raw(x)` passes a normalised value through.
  `--reference` lists every knob with its range and default.
- **Voice Cells** (`voice(...)`) have `p.vin` (Voice In: pitch, gate, trigger,
  velocity, release, pressure, voice, random), `p.vout` (Voice Out: l, r,
  active), `p.cin` and `p.cout`. Patch *Active* (from the amp envelope or a
  Low Pass Gate) so voices free up; `ampEnvelope()` does that.
- **Plain cells** (`cell(...)`) declare their jacks: `stereoIn()`,
  `stereoOut()`, `input(id, name, type)`, `output(id, name, type)`; inside,
  `p.cin` outputs and `p.cout` inputs carry those ids.
- **Cable amounts** into a knob add `source × amount` to the knob's
  normalised value (spec §5.6): on Cutoff (20 Hz…20 kHz, exponential) 0.1 is
  about one octave. Pitch is 1 V/oct: `semis(2)` is the amount for ±2
  semitones from a ±1 source.
- Sequencers without a cable in *Clock* follow the transport, so cells play
  in time with Live (or the standalone app's transport) as they are.
- **Tempo comes in through the cell.** `build()` gives every module that plays
  in time (a Clock input and no Sync on Free: sequencers, drums, synced LFOs,
  delays and benders) a shared **Clock** cell input, and the Drum Grid a
  **Run** gate too, unless the preset already patches that jack. Nothing
  patched into them still means "follow the transport"; a cable overrides it.
- Every preset needs a **description**; names are unique across all
  categories. Keep each category at ten presets.
