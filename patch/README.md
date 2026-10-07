# Bleep Patch

The modules: **Function**, **Random**, **Utility**, **Filter** and
**MIDI Out**, built as **VST3** and **Standalone** apps. They are JUCE
plugins with HTML/CSS/JS interfaces, and they talk over Bleep Bus through its
public API only.

```bash
scripts/build-patch.sh --juce /path/to/JUCE      # or set BLEEP_JUCE_DIR; without it JUCE 8.0.9 is downloaded
scripts/build-patch.sh --install                 # also copy the plugins into your user plugin folders
scripts/build-patch.sh --formats "VST3;Standalone;AU" --clap
```

The script builds into `build/patch/`, then runs the DSP unit tests and a
headless VST3 host test.

## Layout

```
patch/
├── common/
│   ├── dsp/          shared DSP: SVF, smoothing, counter-based randomness, tempo
│   ├── module/       ModuleProcessor (bus plumbing, modulation offsets, state), WebView editor
│   └── ui/           shared UI library: bleep-module.js/.css, bleep-bridge.js, bleep-demo.js
├── modules/<name>/
│   ├── dsp/          the module's DSP (<Name>Dsp.h, no JUCE)
│   ├── ui/           the module's page: index.html, <name>.css, <name>.js
│   ├── <Name>Processor.cpp   joins dsp/ and ui/ into a plugin
│   └── module.json   metadata for the website
├── tests/            DSP unit tests, headless host integration test
└── bridges/          later: Max for Live bridge, Extensions SDK tools, OSC, VCV
```

Each plugin embeds its own `ui/` plus `common/ui/`. `bleep-module.js` builds
the standard layout (knobs with mod rings and source menus, settings, ports
with scopes) from the processor's description. A module adds its own views
through `window.BleepModule` hooks in `<name>.js`; Function's slope preview
and Filter's response curve are examples.

With `scripts/build-patch.sh --ui-dev`, plugins read `ui/` and `common/ui/`
from the source tree, so an edited page appears when the plugin window is
reopened (or after ⌘R in it). Without a DAW, serve the same files with a
fake backend:

```bash
python3 scripts/ui-server.py filter      # http://localhost:8765
```

**JUCE licensing:** this source is MIT, but binaries built with JUCE are
also covered by JUCE's license (AGPLv3 or a commercial JUCE licence).
Check that before you distribute builds.

User docs: [getting started](../website/content/users/getting-started.md).
