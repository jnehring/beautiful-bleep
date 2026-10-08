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
