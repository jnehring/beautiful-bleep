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
| LFO | [lfo.md](lfo.md) | Implemented |
| Attenuverter | [attenuverter.md](attenuverter.md) | Specified |
| CV Mixer | [cv-mixer.md](cv-mixer.md) | Specified |
| Audio Mixer | [audio-mixer.md](audio-mixer.md) | Specified |
| Multiplier | [multiplier.md](multiplier.md) | Specified |
| Crossfader | [crossfader.md](crossfader.md) | Specified |
| Logic | [logic.md](logic.md) | Specified |
| Quantizer | [quantizer.md](quantizer.md) | Specified |
| Switch | [switch.md](switch.md) | Specified |
| Notes to CV | [notes-to-cv.md](notes-to-cv.md) | Specified |
| Drum Grid | [drum-grid.md](drum-grid.md) | Specified |
| Noise | [noise.md](noise.md) | Implemented |
| Ring Drums | [ring-drums.md](ring-drums.md) | Implemented |
| Punch Drums | [punch-drums.md](punch-drums.md) | Implemented |

The eurorack-inspired set:

| Module | File | Status |
|---|---|---|
| Additive Osc | [additive-oscillator.md](additive-oscillator.md) | Implemented |
| Bender | [bender.md](bender.md) | Implemented |
| Cartesian Seq | [cartesian-sequencer.md](cartesian-sequencer.md) | Implemented |
| Chord Osc | [chord-oscillator.md](chord-oscillator.md) | Implemented |
| Chord Quantizer | [chord-quantizer.md](chord-quantizer.md) | Implemented |
| Coin Toss | [coin-toss.md](coin-toss.md) | Implemented |
| Delay Net | [delay-network.md](delay-network.md) | Implemented |
| Drum Map | [drum-map.md](drum-map.md) | Implemented |
| Dual Filter | [dual-filter.md](dual-filter.md) | Implemented |
| Dual Osc | [dual-oscillator.md](dual-oscillator.md) | Implemented |
| Filter Bank | [filter-bank.md](filter-bank.md) | Implemented |
| Formant Osc | [formant-oscillator.md](formant-oscillator.md) | Implemented |
| Freq Shifter | [frequency-shifter.md](frequency-shifter.md) | Implemented |
| Gate Sequencer | [gate-sequencer.md](gate-sequencer.md) | Implemented |
| Grains | [grains.md](grains.md) | Implemented |
| Harmony Master | [harmony-master.md](harmony-master.md) | Implemented |
| Low Pass Gate | [low-pass-gate.md](low-pass-gate.md) | Implemented |
| Macro Osc | [macro-oscillator.md](macro-oscillator.md) | Implemented |
| Matrix Mixer | [matrix-mixer.md](matrix-mixer.md) | Implemented |
| Meta Mod | [meta-modulator.md](meta-modulator.md) | Implemented |
| Modal Voice | [modal-voice.md](modal-voice.md) | Implemented |
| Neuron | [neuron.md](neuron.md) | Implemented |
| Organic LFOs | [organic-lfos.md](organic-lfos.md) | Implemented |
| Perc Voice | [perc-voice.md](perc-voice.md) | Implemented |
| Polymeter Seq | [polymeter-sequencer.md](polymeter-sequencer.md) | Implemented |
| Quad LFO | [quad-lfo.md](quad-lfo.md) | Implemented |
| Quantizer Suite | [quantizer-suite.md](quantizer-suite.md) | Implemented |
| Recall | [recall.md](recall.md) | Implemented |
| Resonator | [resonator.md](resonator.md) | Implemented |
| Verb | [reverb.md](reverb.md) | Implemented |
| Rhythm Bank | [rhythm-bank.md](rhythm-bank.md) | Implemented |
| Rotating Div | [rotating-divider.md](rotating-divider.md) | Implemented |
| Segments | [segments.md](segments.md) | Implemented |
| Shape Env | [shape-envelope.md](shape-envelope.md) | Implemented |
| Shift Register | [shift-register.md](shift-register.md) | Implemented |
| Six Slopes | [six-slopes.md](six-slopes.md) | Implemented |
| Splice | [splice.md](splice.md) | Implemented |
| Stage Seq | [stage-sequencer.md](stage-sequencer.md) | Implemented |
| Swarm | [swarm-oscillator.md](swarm-oscillator.md) | Implemented |
| Tidal | [tidal.md](tidal.md) | Implemented |
| Uncertainty | [uncertainty.md](uncertainty.md) | Implemented |
| Folder | [wavefolder.md](wavefolder.md) | Implemented |
| Wavetable Osc | [wavetable-oscillator.md](wavetable-oscillator.md) | Implemented |
| Wobble | [wobble.md](wobble.md) | Implemented |
| Zone Delay | [zone-delay.md](zone-delay.md) | Implemented |
| Analog Drums | [analog-drums.md](analog-drums.md) | Not built: Ring Drums and Punch Drums cover it |
| Drum + Mod | [drum-modulator.md](drum-modulator.md) | Not built: the drum modules, LFO, ADSR and Random cover it |
| Sequential Switch | [sequential-switch.md](sequential-switch.md) | Not built: Switch covers it |
| Multi-out Filter | [multi-output-filter.md](multi-output-filter.md) | Not built: the Filter's ladder types cover it |
