# Bleep Patch

The modules: **Function**, **Random**, **Utility**, **Filter** (VST3 + AU)
and **MIDI Out** (VST3). They are JUCE plugins that share one HTML/CSS/JS
interface (`common/web/`) and talk over Bleep Bus through its public API only.

```bash
cmake -S patch -B build/patch -DBLEEP_JUCE_DIR=/path/to/JUCE   # omit to download JUCE
cmake --build build/patch
ctest --test-dir build/patch     # DSP unit tests + headless VST3 host test
```

Add `-DBLEEP_PATCH_COPY_PLUGINS=ON` to install into your user plugin folders,
or `-DBLEEP_PATCH_CLAP=ON` for CLAP builds.

| Path | Content |
|---|---|
| `common/dsp/` | shared DSP (SVF, smoothing, counter-based randomness, tempo) |
| `common/module/` | `ModuleProcessor` (bus plumbing, modulation offsets, state) and the WebView editor |
| `common/web/` | the module UI; open `index.html` in a browser for a demo |
| `modules/<name>/` | per-module DSP (`*Dsp.h`, JUCE-free) and processor |
| `tests/` | DSP unit tests, headless host integration test |
| `bridges/` | later: Max for Live bridge, Extensions SDK tools, OSC, VCV |

UI work without a DAW: `python3 -m http.server -d patch/common/web`
starts the module UI with a fake backend.

**JUCE licensing:** this source is MIT, but binaries built with JUCE are
also covered by JUCE's license (AGPLv3 or a commercial JUCE licence).
Check that before you distribute builds.

User docs: [getting started](../website/content/users/getting-started.md).
