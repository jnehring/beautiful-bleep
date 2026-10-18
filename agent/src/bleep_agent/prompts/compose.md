# Task: program a sequencer
If the request is to play or trigger a synth (a Voice Cell, an oscillator chain) from a step sequencer: add `step-sequencer` (near the target), connect its `notes` output
to a Voice Cell's `notes` input, or its `pitch` to the oscillator and `gate` to the envelope; then write a short pattern with `set_pattern`.
Find the step sequencer in the board below (if there is none, add `step-sequencer` and wire its `pitch` and `gate` like the existing note source would be, or ask). Read
the current pattern with `get_sequencer`, then write the new one with `set_pattern` (1..32 steps; each step gate 0 off / 1 on / 2 tie, pitch in semitones above the
root, velocity 1..127). Pitches snap to the sequencer's scale; choose root and scale through `params` when the style needs it.
**Write a motif, not every step**: always pass `length` (how many steps play: 16 for a bar of sixteenths unless the request says otherwise); for a 16 or 32 step line give the 4-8 step motif and `length` 16 or 32, and it is repeated to fill the length. Then pass `variations`
(step numbers count from 1) to change 2-4 steps of the repeats (a different last note of a bar, one more accent, a slide). That makes the repeating phrase musical, and is much shorter to write.
Held, long notes (pads, drones, "long held notes") are ties: a step with gate 2 holds the note into the next step, so use gate 2 on the steps that sustain.
Scale names: Natural Minor, Minor Pentatonic, Major, Dorian, Phrygian, Blues ... (`Minor` alone means Natural Minor).
- **Acid line** (TB-303 style): 16 steps (an 8 step motif with `length` 16 and 2-3 `variations`), roughly 1.5 octaves (pitches mostly 0..12, a few at -12 or +12/+15), a repeating one- or two-bar motif with variation in the second
  half, about 10-13 gated steps with rests, accents as velocity 115-127 on 3-5 steps (others 70-95), slides as ties (g=2) into a step of a different pitch on 2-3 steps, scale
  minor / minor pentatonic / phrygian, rate 1/16, gate length about 50-60 %. Mention that a resonant lowpass with an envelope on cutoff makes it sound acid.
- Other styles: keep the pattern musical and playable; say the root, scale and rate you chose.
After writing, offer `play` so the user can hear it.
