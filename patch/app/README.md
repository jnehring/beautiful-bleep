# Bleep Patch app

The standalone app (spec §11): the same engine, board and modules as the
plugins, without a DAW. Built by `scripts/build-patch.sh` as
`build/patch/BleepPatchApp_artefacts/<Config>/Bleep Patch.app`.

- **Projects:** File → New / Open / Save (`.bleepboard`). The app reopens the
  last project.
- **Audio device:** File → Settings. Pairs of input and output channels are
  *In 1/2*, *Out 1/2*, … nodes on the board.
- **MIDI:** the app creates its own MIDI ports, *Bleep Patch 1* … *n* (number
  in Settings, default 2). Each is a MIDI In and a MIDI Out node; in Live,
  choose them under *MIDI From* / *MIDI To*. MIDI inputs enabled in Settings
  and the default MIDI output appear as nodes too.
- **Ableton Link:** Transport → Ableton Link. The *Link* node puts tempo,
  beat, bar, clock and start/stop on the board; its *Quantum* and *Start/Stop
  Sync* settings apply to the app. Transport → Play/Stop (⌘↩).
- **Bleep Audio Bridge:** put the plugin on any track in Live while the app
  runs; each one is a node with *Send* and *Return*. While bridges are
  connected, Live's audio blocks drive the app and the app's own audio device
  is silent. Latency: two blocks, reported to Live.

Development: `"Bleep Patch.app/Contents/MacOS/Bleep Patch" --smoke` starts
without audio inputs and without Link, prints what it set up and quits.

## Ableton Link and the license

Link (fetched from github.com/Ableton/link, tag `Link-4.1`) is licensed
GPLv2-or-later. Our source stays MIT, but **app binaries built with Link are
distributed under the GPL**, together with their source (fine for this open
project; JUCE builds are AGPLv3 anyway, which is compatible with GPLv2-or-later
via GPLv3). A closed-source build needs a license from Ableton
(link-devs@ableton.com), or build without Link:

```bash
cmake -S patch -B build/patch -DBLEEP_PATCH_LINK=OFF
```

Without Link the app uses an internal clock (Transport → Play/Stop, tempo
from the project).
