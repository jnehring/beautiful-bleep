# Factory samples

The audio that the factory projects and cells for **Sampler** and **Grains** carry. Everything here is mono, 16-bit WAV, a few
seconds at most, cut from recordings that are free to use. [`manifest.json`](manifest.json) lists each file, where it comes from
and how it was cut; [`prepare.mjs`](prepare.mjs) makes the WAV files from the originals (`node patch/presets/samples/prepare.mjs <folder>`).
The originals are not in the repository; fetch them from the addresses below.

The factory build embeds the files a project or cell uses in the preset itself (`media`, see
[`../../../doc/specs/preset-system-plan.md`](../../../doc/specs/preset-system-plan.md), "Samples in presets"), so a preset keeps working
on any computer.

## Sources and licences

- **University of Iowa Musical Instrument Samples**, Lawrence Fritts, University of Iowa Electronic Music Studios: <https://theremin.music.uiowa.edu/MIS.html>. Free for any project, without restrictions (the site's own words: the recordings "may be downloaded and used for any projects, without restrictions"). No credit is required; the author asks to hear about projects that use them.
- **Rain loopable**, Ylmir: <https://opengameart.org/content/rain-loopable>. CC0 1.0 Universal (public domain dedication): https://creativecommons.org/publicdomain/zero/1.0/

## Files

| File | Source | What it is | Original |
|---|---|---|---|
| `piano-c3.wav` | University of Iowa Musical Instrument Samples | Piano, mezzo-forte (root note C3) | `Piano_Other/piano/Piano.mf.C3.aiff` |
| `piano-c4.wav` | University of Iowa Musical Instrument Samples | Piano, mezzo-forte (root note C4) | `Piano_Other/piano/Piano.mf.C4.aiff` |
| `piano-c5.wav` | University of Iowa Musical Instrument Samples | Piano, mezzo-forte (root note C5) | `Piano_Other/piano/Piano.mf.C5.aiff` |
| `crotale-c6.wav` | University of Iowa Musical Instrument Samples | Crotale, fortissimo (root note C6) | `Percussion/crotales/crotale.C6.ff.aif` |
| `thai-gong-a4.wav` | University of Iowa Musical Instrument Samples | Thai gong, mezzo-forte (root note A4) | `Percussion/gongs & tamtams/thaigongs/thaigong.A4.mf.aif` |
| `tam-tam.wav` | University of Iowa Musical Instrument Samples | 22-inch tam-tam, mezzo-forte | `Percussion/gongs & tamtams/22tamtam.mf.aif` |
| `crash-cymbal.wav` | University of Iowa Musical Instrument Samples | 18-inch orchestral crash (French), mezzo-forte | `Percussion/cymbals/crash cymbals/18orchcrash.french.mf.aif` |
| `hihat-closed.wav` | University of Iowa Musical Instrument Samples | Hi-hat, foot close | `Percussion/cymbals/hihat/hihat.footclose.mf.aif` |
| `hihat-open.wav` | University of Iowa Musical Instrument Samples | Hi-hat, normal strike | `Percussion/cymbals/hihat/hihat.normal.mf.aif` |
| `clave.wav` | University of Iowa Musical Instrument Samples | Claves | `Percussion/hand percussion/claves/clave1.mf.aif` |
| `castanet.wav` | University of Iowa Musical Instrument Samples | Castanets | `Percussion/hand percussion/castanets/castanet1.mf.aif` |
| `granite-block.wav` | University of Iowa Musical Instrument Samples | Granite block | `Percussion/hand percussion/graniteblocks/graniteblock1.mf.aif` |
| `tambourine.wav` | University of Iowa Musical Instrument Samples | Tambourine, normal | `Percussion/tambourines/tambourine1.normal.mf.aif` |
| `tambourine-shake.wav` | University of Iowa Musical Instrument Samples | Tambourine, shake roll | `Percussion/tambourines/tambourine1.shakeroll.mf.aif` |
| `balloon-pop.wav` | University of Iowa Musical Instrument Samples | Balloon pop | `Piano_Other/balloonpop/Balloon.pop.aiff` |
| `rain-a.wav` | Rain loopable | Steady rain, first of the four loopable takes | `Rain OGG.zip: 1.ogg` |
| `rain-b.wav` | Rain loopable | Steady rain, fourth of the four loopable takes | `Rain OGG.zip: 4.ogg` |
| `wood-loop.wav` | made here | One bar of claves, castanets, granite block and hi-hats arranged by us from the single hits above. 120 BPM, 4 beats. | from the files above |

## Credit and redistribution

- The Iowa recordings carry no credit requirement, but we name the source here and in the module manuals. Their terms speak of
  using the recordings in projects; they do not say whether the unmodified files may be handed on, so the files here are cut,
  faded, normalised and reduced to mono, and each preset carries only a short piece of one recording.
- Factory presets and projects are published under CC BY 4.0 like every shared preset; the CC0 recordings are free of any condition.
- Adding a recording: only from a source whose terms allow redistribution inside a preset (CC0, CC BY, or an explicit permission);
  add it to `manifest.json` with its address and licence, run `prepare.mjs --readme`, and keep each file small
  (a shared preset may carry 8 files and 5 MB, counted as 32-bit float: 176 KB per second at 44.1 kHz mono).
