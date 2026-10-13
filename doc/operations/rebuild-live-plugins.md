# Rebuild the Live plugins by hand

The VST3 plugins that Ableton Live loads are all built from `patch/CMakeLists.txt`:

| Plugin | CMake target |
|---|---|
| Bleep Board | `BleepBoard` |
| Bleep MIDI In | `BleepMidiIn` |
| Bleep MIDI Out | `BleepMidiOut` |
| Bleep Audio In | `BleepAudioIn` |
| Bleep Audio Out | `BleepAudioOut` |
| Bleep Instrument | `BleepInstrument` |
| Bleep Audio Insert | `BleepAudioInsert` |
| Bleep Audio Bridge | `BleepAudioBridge` |

The first seven share the engine and the board; Bleep Audio Bridge talks to the standalone app. Each plugin is a separate binary. Plugins share one engine when they have the same engine **major version**; a different minor is fine (see [engine-abi.md](../../website/content/developers/reference/engine-abi.md)). Rebuilding just one plugin works as long as the major has not changed since the others were built.

## Prerequisites

Same as [the standalone app](build-standalone-app.md): CMake 3.22+, a C++ compiler, optionally Ninja, JUCE 8.0.9 (downloaded on the first build, or `--juce <dir>` / `BLEEP_JUCE_DIR`).

## With the script

```bash
scripts/build-patch.sh --juce /path/to/JUCE           # build into build/patch/ and run the tests
scripts/build-patch.sh --no-test                      # skip the tests
scripts/build-patch.sh --install                      # also copy the VST3s to ~/Library/Audio/Plug-Ins/VST3
```

## Without the script

```bash
cmake -S patch -B build/patch -DCMAKE_BUILD_TYPE=Release \
    -DBLEEP_JUCE_DIR=/path/to/JUCE -DBLEEP_FORMATS=VST3 -DBLEEP_COPY_PLUGINS=OFF
cmake --build build/patch --config Release --parallel
```

Only some plugins: add `--target BleepMidiIn_VST3 --target BleepBoard_VST3` (target name plus `_VST3`) to the build command. Build all of them if the engine major (`kAbiTag`) changed; otherwise the ones you rebuilt work next to the old ones.

The bundles end up in `build/patch/<Target>_artefacts/Release/VST3/`, for example `build/patch/BleepMidiIn_artefacts/Release/VST3/Bleep MIDI In.vst3`.

## Install into Live

1. **Quit Live.** Live keeps a plugin's code loaded until it quits, and overwriting a loaded plugin can crash it.
2. Copy every bundle (replacing the old ones):

   ```bash
   for b in build/patch/*_artefacts/Release/VST3/*.vst3; do
       rm -rf ~/Library/Audio/Plug-Ins/VST3/"$(basename "$b")"
       cp -R "$b" ~/Library/Audio/Plug-Ins/VST3/
   done
   ```

3. Start Live. If a plugin is missing, rescan: Settings → Plug-Ins, with "Use VST3 Plug-In System Folders" on, then *Rescan*. The plugins appear under **Plug-Ins → Beautiful Bleep**.

On Windows the folder is `C:\Program Files\Common Files\VST3`.

`scripts/reload-live.sh <set.als>` does the same (build, quit Live, replace the bundles, reopen a set) in one step.

## Troubleshooting

- **Only some Bleep plugins show up in Live.** Check `ls ~/Library/Audio/Plug-Ins/VST3 | grep -i bleep`. Plugins that are not there were not built or not copied. `build/patch-dev/` holds old Debug builds: don't install from there.
- **Stale CMake cache.** Run `scripts/build-patch.sh --clean`, or delete `build/patch/`.
- **Plugin refuses to share the engine.** The binaries have different engine major versions (`kAbiTag`). Rebuild and reinstall all of them.
- **Only the board UI (HTML/CSS/JS) changed.** Build once with `--ui-dev` and press ⌘R in the board window instead of rebuilding (see the main [README](../../README.md)).
