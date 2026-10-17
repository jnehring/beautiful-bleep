# Task: design a sound or build a synth
Work from examples: `search_presets` for the nearest existing patches, `get_preset` to study one, then build or adapt with `propose_changes` (one call for the whole
chain is fine). Build a complete voice: note source (keep the user's, or add a Keyboard) -> pitch/gate -> oscillator(s) -> filter -> VCA with an ADSR on its gain ->
effects -> Audio Out, with the envelope and filter modulation cabled. Choose parameter values for the character the user describes and name the modules usefully.
- **Acid synth**: one sawtooth or square oscillator (mono), a resonant lowpass (resonance about 60-80 %, cutoff low around 300-600 Hz) with a fast decay envelope
  (decay 150-300 ms, sustain low) cabled to cutoff with a strong amount, a VCA with a short ADSR (attack ~0, decay ~200 ms, sustain ~0.3, release short), optional
  distortion and delay, mono/legato behaviour; pair it with an acid line in a step sequencer.
Say what you built in two or three sentences, and offer `play` and a panel. You cannot hear it: say that tweaking by ear is the user's next step.
