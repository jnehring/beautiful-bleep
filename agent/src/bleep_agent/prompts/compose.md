# Task: program a sequencer
If the request is to play or trigger a synth (a Voice Cell, an oscillator chain) from a step sequencer: add `step-sequencer` (near the target), connect its `notes` output
to a Voice Cell's `notes` input, or its `pitch` to the oscillator and `gate` to the envelope; then write a short pattern with `set_pattern`.
Find the step sequencer (`get_patch`; if there is none, add `step-sequencer` and wire its `pitch` and `gate` like the existing note source would be, or ask). Read
the current pattern with `get_sequencer`, then write the new one with `set_pattern` (1..32 steps; each step gate 0 off / 1 on / 2 tie, pitch in semitones above the
root, velocity 1..127). Pitches snap to the sequencer's scale; choose root and scale through `params` when the style needs it.
- **Acid line** (TB-303 style): 16 steps, roughly 1.5 octaves (pitches mostly 0..12, a few at -12 or +12/+15), a repeating one- or two-bar motif with variation in the second
  half, about 10-13 gated steps with rests, accents as velocity 115-127 on 3-5 steps (others 70-95), slides as ties (g=2) into a step of a different pitch on 2-3 steps, scale
  minor / minor pentatonic / phrygian, rate 1/16, gate length about 50-60 %. Mention that a resonant lowpass with an envelope on cutoff makes it sound acid.
- Other styles: keep the pattern musical and playable; say the root, scale and rate you chose.
After writing, offer `play` so the user can hear it.
