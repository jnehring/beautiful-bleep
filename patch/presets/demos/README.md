# Demo patches

Five whole patches (the standalone app calls them *projects*) for every module that can be shown on its own, one file per module
(`<module type>.mjs`, the type being the folder name in `patch/modules/`). The
standalone app's preset browser (File → Presets…, ⌘P) lists them under *Demos
by module*; the website's module docs mention them under *Demo patches*.

`node patch/presets/build.mjs` compiles them into
[`../../board/ui/demo-patches.json`](../../board/ui/demo-patches.json) with the
cell presets; `--check` (CI) fails when it is out of date.

```bash
node patch/presets/build.mjs --demos grains,reverb --out /tmp/d.json   # just these modules
build/light/bleep_demo_patches_artefacts/Release/bleep_demo_patches /tmp/d.json -v   # load + render each one
ctest --test-dir build/light -R demo-patches                           # every demo, as CI runs it
```

## Rules

- **Exactly five patches per file**, named `<Module name>: <Title>` (the module's name as the Add menu
  shows it, e.g. `Verb: Cathedral`); names are unique.
- **A demo plays by itself**: it needs no MIDI or audio input, only the transport (the app starts it when a
  demo is loaded). It reaches **Out 1/2** (`p.out`), uses the module it demonstrates, and each of the five
  shows a different side of that module (modes, settings, a different musical use).
- **A description** of one to three sentences: what you hear and what to try changing. Tags for the
  browser's search. Our own words: no hardware names (spec §21).
- **Levels**: RMS between about −26 and −12 dB, peak below 1. The test fails on silence, clipping, anything
  not finite and anything that eats more than 60 % of a core in real time, and it loads each patch through
  `board::sanitise` (unknown knobs, out-of-range values, dropped cables).
- Build with [`../kit.mjs`](../kit.mjs) (`patch(name, {module, tempo, description, tags})`, `p.add`, `p.cable`,
  `p.stereo`, `p.out`, `p.midi`) and the shared sources in [`../demo-kit.mjs`](../demo-kit.mjs) (`melody`, `beat`).
  Values are in units, as for the cell presets ([`../README.md`](../README.md)).
- The module's manual (`doc/<type>.md`) lists the five under *Demo patches* and the website shows them as cards with
  *Run in Play*. Both are generated from this folder: after changing a demo run `node patch/presets/build.mjs` and
  `node patch/presets/build-docs.mjs` (`--check` in CI); never edit the section between the `generated` markers.

## Front panels, "Show on load" and tags

`build.mjs` gives every project a **front panel** (a board panel, [`doc/specs/panels.md`](../../../doc/specs/panels.md)): the module the
project is about first and with the most knobs, then the main knobs of the other modules, the module's own view if it has one
(a sequencer, the Sampler's waveform) and an Out meter (`projectPanel` in `build.mjs`, which runs the board's *Build panel*
code with `focus`). A project whose module is an **instrument** (sources, drums, samplers, sequencers) or an **effect** (the Effects
categories, filters, mixers, manglers) is tagged `instrument` or `effect` and its panel is set to **Show on load**, so it opens with the panel
in a window, as an instrument or effect does. The user can change this in the panel's sidebar (*Show on load*: Off, In a window, Full screen) and
it is saved with the project. Modulators, utilities and the rest get a panel too, but it does not open by itself.

## Samples

A project may carry recordings (`p.sample("<name>")`, files from [`../samples/`](../samples/README.md), which also says where
each comes from). They are embedded in the project (`media`, at most 8 files and 5 MB counted as 32-bit float) and imported
into the media folder when it is loaded. Give a Sampler `samplerData(s, {markers})` and Grains `grainsData(s)` from
[`../media.mjs`](../media.mjs). Markers are frame positions; every sample except the rain is 48 kHz, the rate the app runs at, so they land
where you put them. The test imports the audio and checks that each file gets the id it is filed under.
