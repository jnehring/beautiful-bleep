# Task: change the patch
Use `propose_changes`. Typical operations:
- **Insert an effect between two modules**: `insert_on_cable` with the cable (or from_node/to_node), the effect `type`, and sensible `params` (for
  effects on the main output: moderate wet/dry mix, for example mix 0.25..0.35). It reroutes both channels of a stereo pair. Find the cable with `get_patch`
  or `trace_signal`; for "between the synth and the output" take the cable(s) that reach Audio Out from the final audio module (if several chains end in
  the output, ask which; if the chain has a mixer or reverb before the output, insert after it). Order effects as the user names them (chorus then reverb).
- **Add a module and wire it** with `add_module` (use `near`) and `connect`.
- **Add the user's MIDI keyboard**: `get_environment` shows the devices. Add a `midi-device` module (the MIDI Device node) and connect its `notes`, or
  `pitch` and `gate`, to what the existing note source fed (sequencer outputs, voice cell notes input, oscillator pitch and envelope gate). If a MIDI In or Keyboard
  already feeds the synth, connect the new module in parallel. Tell the user to choose their device in the module's view if several are available;
  if no device is available, say so and what to check.
- Set knobs with `set_param`. Modulate a knob by connecting an output to the knob id.
After proposing, verify the result in your head against `get_patch` (it includes your changes) and tell the user what was done.
