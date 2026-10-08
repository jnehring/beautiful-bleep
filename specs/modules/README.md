# Module specifications

One file per board module. The main specification (`specs/specs.md`, section 12)
lists every module in one line each; the file here holds the full design.

Each file follows the same outline, so they're easy to compare:

1. **Purpose** — what the module is for, in two or three sentences.
2. **Jacks** — inputs and outputs, with their signal type (`specs.md` section 7.1).
3. **Controls** — knobs (modulatable floats) and settings (choices, toggles, integers).
4. **Behaviour** — how it works, including timing, edge cases and transport.
5. **Module view** — what the floating window shows and how it's edited.
6. **Saved state** — what the board document stores beyond knob values.
7. **Engine requirements** — anything the module needs that the engine doesn't have yet.
8. **Tests** — what the automated tests check.
9. **Later** — ideas kept out of the first version.

Modules are our own designs, built from generic modular concepts (`specs.md`
section 21): no hardware names in the files, the UI or the docs.

| Module | File | Status |
|---|---|---|
| Step Sequencer | [step-sequencer.md](step-sequencer.md) | Implemented |
| Attenuverter | [attenuverter.md](attenuverter.md) | Implemented |
| CV Mixer | [cv-mixer.md](cv-mixer.md) | Implemented |
| Audio Mixer | [audio-mixer.md](audio-mixer.md) | Implemented |
| Multiplier | [multiplier.md](multiplier.md) | Implemented |
| Crossfader | [crossfader.md](crossfader.md) | Implemented |
| Logic | [logic.md](logic.md) | Implemented |
| Quantizer | [quantizer.md](quantizer.md) | Implemented |
| Switch | [switch.md](switch.md) | Implemented |
| Notes to CV | [notes-to-cv.md](notes-to-cv.md) | Implemented |
| Drum Grid | [drum-grid.md](drum-grid.md) | Implemented |
| LFO | [lfo.md](lfo.md) | Implemented |
| Noise | [noise.md](noise.md) | Implemented |
| Ring Drums | [ring-drums.md](ring-drums.md) | Implemented |
| Punch Drums | [punch-drums.md](punch-drums.md) | Implemented |
| Dial | [dial.md](dial.md) | Implemented |
| Button | [button.md](button.md) | Implemented |
| Keyboard | [keyboard.md](keyboard.md) | Implemented |
| Level Meter | [level-meter.md](level-meter.md) | Implemented |

Proposed modules (draft specs, not yet reviewed):

| Module | File | Category | Status |
|---|---|---|---|
| Macro Osc | [macro-oscillator.md](macro-oscillator.md) | Sources | Draft |
| Dual Osc | [dual-oscillator.md](dual-oscillator.md) | Sources | Draft |
| Formant Osc | [formant-oscillator.md](formant-oscillator.md) | Sources | Draft |
| Additive Osc | [additive-oscillator.md](additive-oscillator.md) | Sources | Draft |
| Swarm | [swarm-oscillator.md](swarm-oscillator.md) | Sources | Draft |
| Wavetable Osc | [wavetable-oscillator.md](wavetable-oscillator.md) | Sources | Draft |
| Chord Osc | [chord-oscillator.md](chord-oscillator.md) | Sources | Draft |
| Modal Voice | [modal-voice.md](modal-voice.md) | Sources | Draft |
| Perc Voice | [perc-voice.md](perc-voice.md) | Sources | Draft |
| Analog Drums | [analog-drums.md](analog-drums.md) | Sources | Draft |
| Drum + Mod | [drum-modulator.md](drum-modulator.md) | Sources | Draft |
| Resonator | [resonator.md](resonator.md) | Audio | Draft |
| Folder | [wavefolder.md](wavefolder.md) | Audio | Draft |
| Low Pass Gate | [low-pass-gate.md](low-pass-gate.md) | Audio | Draft |
| Meta Mod | [meta-modulator.md](meta-modulator.md) | Audio | Draft |
| Freq Shifter | [frequency-shifter.md](frequency-shifter.md) | Audio | Draft |
| Dual Filter | [dual-filter.md](dual-filter.md) | Audio | Draft |
| Filter Bank | [filter-bank.md](filter-bank.md) | Audio | Draft |
| Multi-out Filter | [multi-output-filter.md](multi-output-filter.md) | Audio | Draft |
| Grains | [grains.md](grains.md) | Audio | Draft |
| Splice | [splice.md](splice.md) | Audio | Draft |
| Verb | [reverb.md](reverb.md) | Audio | Draft |
| Zone Delay | [zone-delay.md](zone-delay.md) | Audio | Draft |
| Bender | [bender.md](bender.md) | Audio | Draft |
| Delay Net | [delay-network.md](delay-network.md) | Audio | Draft |
| Segments | [segments.md](segments.md) | Modulation | Draft |
| Tidal | [tidal.md](tidal.md) | Modulation | Draft |
| Six Slopes | [six-slopes.md](six-slopes.md) | Modulation | Draft |
| Quad LFO | [quad-lfo.md](quad-lfo.md) | Modulation | Draft |
| Shape Env | [shape-envelope.md](shape-envelope.md) | Modulation | Draft |
| Organic LFOs | [organic-lfos.md](organic-lfos.md) | Modulation | Draft |
| Wobble | [wobble.md](wobble.md) | Modulation | Draft |
| Uncertainty | [uncertainty.md](uncertainty.md) | Modulation | Draft |
| Neuron | [neuron.md](neuron.md) | Modulation | Draft |
| Shift Register | [shift-register.md](shift-register.md) | Sequencing | Draft |
| Recall | [recall.md](recall.md) | Sequencing | Draft |
| Cartesian Seq | [cartesian-sequencer.md](cartesian-sequencer.md) | Sequencing | Draft |
| Stage Seq | [stage-sequencer.md](stage-sequencer.md) | Sequencing | Draft |
| Drum Map | [drum-map.md](drum-map.md) | Sequencing | Draft |
| Gate Sequencer | [gate-sequencer.md](gate-sequencer.md) | Sequencing | Draft |
| Rotating Div | [rotating-divider.md](rotating-divider.md) | Sequencing | Draft |
| Rhythm Bank | [rhythm-bank.md](rhythm-bank.md) | Sequencing | Draft |
| Polymeter Seq | [polymeter-sequencer.md](polymeter-sequencer.md) | Sequencing | Draft |
| Quantizer Suite | [quantizer-suite.md](quantizer-suite.md) | Utility | Draft |
| Harmony Master | [harmony-master.md](harmony-master.md) | Utility | Draft |
| Chord Quantizer | [chord-quantizer.md](chord-quantizer.md) | Utility | Draft |
| Coin Toss | [coin-toss.md](coin-toss.md) | Utility | Draft |
| Sequential Switch | [sequential-switch.md](sequential-switch.md) | Utility | Draft |
| Matrix Mixer | [matrix-mixer.md](matrix-mixer.md) | Utility | Draft |

Proposed lab-gear modules (draft specs, not yet reviewed): modelled on the
character of vintage laboratory test equipment, where drift, bounce and
imperfection are part of the sound.

| Module | File | Category | Status |
|---|---|---|---|
| Test Oscillator | [test-oscillator.md](test-oscillator.md) | Sources | Draft |
| Sweep Generator | [sweep-generator.md](sweep-generator.md) | Sources | Draft |
| Beat Oscillator | [beat-oscillator.md](beat-oscillator.md) | Sources | Draft |
| Pulse Generator | [pulse-generator.md](pulse-generator.md) | Sources | Draft |
| Wave Analyzer | [wave-analyzer.md](wave-analyzer.md) | Audio | Draft |
| Chart Recorder | [chart-recorder.md](chart-recorder.md) | Modulation | Draft |
| XY Scope | [xy-scope.md](xy-scope.md) | Utility | Draft |
