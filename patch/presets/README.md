# Factory cell presets

The cells under *Add → Cell → <category>* that ship with Bleep Patch. Each
category is one file here; [`build.mjs`](build.mjs) compiles them all into
[`../board/ui/factory-presets.json`](../board/ui/factory-presets.json), which
the board loads next to the user's own presets.

```bash
node patch/presets/build.mjs              # write factory-presets.json
node patch/presets/build.mjs --check      # CI: the JSON is current
node patch/presets/build.mjs --reference  # every module's knobs, in units
ctest --test-dir build/patch -R factory   # the engine loads every preset without a warning
```

## How the preset system fits together

| Piece | Where | What |
|---|---|---|
| Preset document | `{format, root, category, description, tags, nodes, cables}` | A cell and everything inside it, knob values normalised (0…1), the same as on the board. User presets add `{name, preset}` around it in a `.bleepcell` file. |
| Factory presets | this folder → `factory-presets.json` | Written in units with [`kit.mjs`](kit.mjs), compiled and checked; read-only in the app. |
| User presets | `<app data>/Bleep Patch/Cells/*.bleepcell` | *Right-click a cell → Save as preset…* (name, category, description). Deleted under *Add → Cell → <category> → Delete preset*. |
| Browsing | Add menu, Tab search | *Add → Cell → <category> → <preset>*; hovering shows the description. Tab search matches names, categories, tags and descriptions. |
| Panels | [`panels.mjs`](panels.mjs) → `../board/ui/factory-panels.json` | Hand-written front panels for cell presets (so far Punch Machine), keyed by preset name: tabs, a few knobs per module, mixer faders, loaded module panels. Checked against the preset when built; see [`specs/panels.md`](../../specs/panels.md) §6. `node patch/presets/panels-gallery.mjs out.html [name …]` draws them. |
| Checks | `kit.mjs`, `bleep_dump_types --check-presets` | The kit rejects unknown modules, knobs, choices, jacks, out-of-range values and incompatible cables while building; the ctest runs every preset through the engine's `board::sanitise` and fails on any warning or anything dropped. |

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
