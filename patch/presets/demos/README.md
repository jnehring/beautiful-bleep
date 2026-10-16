# Demo patches

Five whole patches for every advanced module, one file per module
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

Not covered: **Sampler** plays a WAV file the user loads, and a patch can't ship one, so it has no demos.
