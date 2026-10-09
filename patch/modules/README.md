# Writing a module

A module is a folder in `patch/modules/` with a `module.json`. The build finds
it on its own and the module registers itself, so adding one touches no
shared file:

```
patch/modules/<type>/
├── module.json            name, slug (= type id), tagline, colour, formats, doc
├── <Name>Module.cpp       the node: spec (params, jacks, buttons) and process()
├── dsp/<Name>Dsp.h        the DSP, no JUCE (namespace bleep::patch)
├── doc/<type>.md          the user documentation (the view's ? button and the website)
├── doc/<type>.png         screenshot of the module view, shown at the top of the doc
├── ui/<type>.js           optional custom displays for the module view
└── tests/test_<name>.cpp  DSP tests: each file is its own executable and ctest
```

End `<Name>Module.cpp` with the registration function (`static`, it is only
used here) and

```cpp
BLEEP_REGISTER_MODULE(registerFooModule);
```

The design lives in `doc/specs/modules/<name>.md`; the module follows it, and the
spec is updated where the implementation had to differ.

Advanced modules also get **five demo patches** (`patch/presets/demos/<type>.mjs`,
whole boards for the app's preset browser, see
[`presets/demos/README.md`](../presets/demos/README.md)) and a *Demo patches*
section in their doc.

## Building and testing

```bash
cmake -S patch -B build/light -G Ninja -DBLEEP_PATCH_LIGHT_TESTS=ON   # juce_core only, no plugins
cmake --build build/light && ctest --test-dir build/light
build/light/bleep_module_harness_artefacts/Release/bleep_module_harness <type>   # one module, with CPU use
```

`bleep_module_harness` runs every module type on a compiled board with every
input fed (noise, control, gates, triggers, pitch, notes), knobs at defaults,
at 0, at 1 and random, at three sample rates, with the transport starting,
stopping and jumping. Outputs must stay finite and within ±64.

After changing params or jacks, regenerate the board UI's type list
(`bleep_dump_types --write patch/board/ui/demo-types.json`). The website reads
each module's category from it. A module whose type list entry doesn't exist
yet needs `"category"` in its `module.json`.

Every doc starts with its screenshot (`![Name in the module view](<type>.png)`
under the title). With `scripts/ui-server.py` running,
`scripts/module-screenshots.py [type ...]` retakes them after a view changes.
The website shows them; the plugins only embed the `.md` files.

## Shared code

Before writing DSP, look in `patch/common/dsp/` (namespace `bleep::dsp`):

| Header | What |
|---|---|
| `OscCore.h`, `Wavetable.h`, `Partials.h`, `Formant.h`, `Folder.h` | oscillators, tables, additive, formant bursts, wavefolding |
| `ModalBank.h`, `Waveguide.h`, `Exciter.h`, `Room.h`, `Vactrol.h` | physical models, small rooms, low-pass-gate cells |
| `Delay.h`, `Hilbert.h`, `Fdn.h`, `Grains.h`, `Lofi.h` | delays, frequency shifting, reverb, granular, degradation |
| `Chords.h`, `Harmony.h`, `Scales.h`, `SeqClock.h`, `SeqNotes.h`, `Tempo.h` | chords and voicing, the harmony bus, scales, sequencer timing and note output |
| `Waves.h`, `Shapes.h`, `Slope.h`, `Chaos.h`, `Random.h`, `Noise.h` | LFO waves, shape library, slope generators, chaos/neurons, seeded randomness |
| `Svf.h`, `Smoothing.h`, `Oversampler.h`, `Clip.h`, `Gain.h`, `Drums.h` | filters, smoothing and edges, oversampling, limiting, faders, drum parts |

Randomness is always seeded and counter-based (`Random.h`), so offline renders
repeat. Transport-synced timing derives positions from `ctx.ppqAt(i)` so a
module stays on the grid after loop jumps.

## Engine features

All in `patch/engine/Spec.h` and `Module.h`.

**Stepped knobs.** `ParamSpec::stepped(id, name, choices, def)` and
`ParamSpec::steppedInt(id, name, min, max, def)` are choices and integers
that can be modulated: the view shows a knob that snaps, a cable moves it
through the steps. `value(c, i, s)` returns the rounded value.

**Groups.** `ParamSpec::percent(...).inGroup("Envelope")` puts knobs under a
heading in the module view. Use groups on modules with many knobs.

**Shown in some modes.** `.when("mode", 2, 3)` on a param or a jack shows it
only while the setting `mode` is 2 or 3 (in its own units). Use it for jacks
beyond a *Count* setting (`.when("count", 5, 8)` on jack 5) and for knobs
that only mean something in one mode. Hidden jacks keep their cables and show
dimmed; the module still receives them.

**Names that follow a mode.** `.namedBy("mode", {"Tone", "Shape", "Blend"})`
renames a knob or jack with the setting's value, for modules whose knobs mean
different things per model.

**Normalled inputs.** `JackSpec{"b", "Trig B", Signal::Trigger}.normalledTo("a")`:
while unpatched, *Trig B* reads *Trig A*'s signal. `ctx.inputConnected[b]`
stays false, so the module can tell.

**Unread outputs.** `ctx.isOutputConnected(k)` is false when nothing reads
output `k`. Skip expensive work for it (a filter bank's band outputs), but
leave the buffer finite (the node's scope shows it).

**Buttons and commands.** `s.buttons = {{"ping", "Ping", true}, {"clear", "Clear"}}`
adds buttons to the view (true = momentary: press sends 1, release 0). They
arrive on the audio thread through the command queue:

```cpp
void process(const ProcessContext& c) override {
    pollCommands([&](const Command& cmd) { if (cmd.index == Ping) ping_ = cmd.value > 0.5f; });
    ...
}
```

Override `Module::command(id, value)` for commands a custom view sends with
`view.api.command(id, value)`.

**Node data.** `s.sanitiseData` (JSON in, valid JSON out) and
`Module::setData(json)` for state beyond knobs: steps, patterns, drawn shapes,
media ids. Parse on the message thread and hand the result over with
`RtHandoff<T>` (`Handoff.h`): `publish(shared_ptr)` on the message thread,
`get()` on the audio thread.

**Media.** Audio files live in one media folder and are referenced by id
(`Media.h`). A custom view makes a drop target with
`BleepView.mediaDrop(element, view.api, (r) => view.api.setData({...data, sample: r.id}))`;
`setData` then calls `media::load(id)` and publishes the clip with
`RtHandoff<MediaClip>`. Modules that record override
`exportMedia(slot)`; the view saves with `view.api.exportMedia(slot)` and
stores the returned id in its data.

**Memory.** Set `s.memoryHeavy = true` on modules with large buffers; the
board warns when one goes into a Voice Cell.

**Harmony bus.** `s.harmony = HarmonyRole::Writer` (Harmony Master) or
`Reader` (anything that follows it). Writers run before readers; the state
is in `ctx.harmony` (`dsp/Harmony.h`, `kHarmonyBuses` buses).

**Voices.** Inside a Voice Cell, `ctx.voice` is the voice's index (−1
outside): use it as a random stream so voices vary but renders repeat.

**Data the module changes itself.** Override `takeData(json)` (message
thread, polled ten times a second) to store node data the module produced,
e.g. a captured loop; the engine saves it in the board and calls `setData`.

**Custom views.** `view.api.isPatched(input)` tells whether an input has a
cable; `hideParams: [ids]` in the view hooks hides knobs the custom section
edits itself.

**Live values for views.** `liveValues()` for numbers (a playhead),
`liveArrays()` for arrays (a spectrum, register bits). They arrive in the
view's `onState(st)` as `st.<key>` and `st.arrays.<key>`.
