# Bleep App

The standalone app (spec §11): the same engine, board and modules as the
plugins, without a DAW. Built by `./bleep build plugins` as
`build/patch/BleepApp_artefacts/<Config>/Bleep App.app`.

- **Projects:** File → New / Open / Save (`.bleepboard`). The app reopens the
  last project.
- **Projects from the browser:** File → Open Project… (⌘P) opens the project
  browser: five demo projects for every advanced module (*Demos by module*) and
  your own (*Save to My Projects…*, kept in `Beautiful Bleep/Projects/` in
  the app data folder). Loading one replaces the project, sets the tempo and
  starts the transport (spec §11.5).
- **Audio device:** File → Settings. Pairs of input and output channels are
  *In 1/2*, *Out 1/2*, … ports. An empty board starts with *In 1/2* and
  *Out 1/2* only; the other ports (more audio pairs, MIDI, Link) are added
  from Add → Port and may be deleted (documented in `board/ui/<port>.md`).
- **System audio:** File → Settings → Audio → *System audio* puts what the computer plays on the board
  as the *System* node (an Audio In). macOS 14.2+ (Core Audio tap), Windows (WASAPI loopback), Linux
  (PulseAudio / PipeWire monitor, needs libpulse at build time). Off by default; the app's own sound is
  left out where the system can ([system-audio.md](../../doc/specs/system-audio.md)).
- **MIDI:** the app creates its own MIDI ports, *Bleep App 1* … *n* (number
  in Settings, default 2). Each is a MIDI In and a MIDI Out node; in Live,
  choose them under *MIDI From* / *MIDI To*. MIDI inputs enabled in Settings
  and the default MIDI output appear as nodes too.
- **Ableton Link:** Transport → Ableton Link. The *Link* node puts tempo,
  beat, bar, clock and start/stop on the board; its *Quantum* and *Start/Stop
  Sync* settings apply to the app. Transport → Play/Stop (⌘↩).
- **Web connection:** File → Settings → Web turns on a link for Bleep Play pages and for Bleep plugins in Live whose
  *Board* is *Bleep Play* (doc/specs/bridges.md). It listens on 127.0.0.1 only, port 47100, and is off until you turn it
  on. `BLEEP_WEB_PORT=<port>` turns it on for one run, and `BLEEP_WEB_ROOT=<folder>` makes the app serve Bleep Play
  from the folder `scripts/build/build-web.sh` wrote. Plugins with *Board = Bleep App* need no setting: they
  appear on the app's board as the same nodes they would be in Live.
- **Bleep Audio Bridge:** put the plugin on any track in Live while the app
  runs; each one is a node with *Send* and *Return*. While bridges are
  connected, Live's audio blocks drive the app and the app's own audio device
  is silent. Latency: two blocks, reported to Live.

Development: `"Bleep App.app/Contents/MacOS/Bleep App" --smoke` starts
without audio inputs and without Link, prints what it set up and quits.
Add `--system-audio` to capture what the computer plays for that run (not saved);
the report then says how many frames arrived and the peak level, so play
something while it runs. On macOS start it through LaunchServices, or the system
audio permission is not the app's and the capture stays silent:
`open -W --stdout out.txt "Bleep App.app" --args --smoke --system-audio`.

## Ableton Link and the license

Link (fetched from github.com/Ableton/link, tag `Link-4.1`) is licensed
GPLv2-or-later. Our source is GPL-3.0-only, so that fits; **app binaries built with Link are
distributed under the GPL**, as every build of the app now is,, together with their source (fine for this open
project; JUCE builds are AGPLv3 anyway, which is compatible with GPLv2-or-later
via GPLv3). A closed-source build needs a license from Ableton
(link-devs@ableton.com), or build without Link:

```bash
cmake -S patch -B build/patch -DBLEEP_LINK=OFF
```

Without Link the app uses an internal clock (Transport → Play/Stop, tempo
from the project).
