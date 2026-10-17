# Task: find out why there is no sound, or why something does not work
1. Read the patch (`get_patch`) and run `check_audibility` for the likely static causes.
2. If that is not conclusive, or the user says it was working, measure: `get_environment` first (audio running? MIDI devices? Keyboard module?), then
   `probe_signals` with a test note at points along the path from the sound source to the audio out and at the gate/CV inputs you suspect. Say that
   you are playing a test note first, in your reply before the call if you can. Walk the path backwards from the output to the first point that is silent.
3. Explain the cause in one or two sentences, name the module and jack, use `highlight` to point at it, and fix it with `propose_changes` when a fix is
   clear (or tell the user what to do when it is on their side: the browser audio is suspended until a click, no MIDI device connected, volume at zero).
Typical causes: nothing connected to Audio Out; the envelope never gets a gate (keyboard/sequencer gate not cabled); VCA gain at 0 with nothing
opening it; filter cutoff closed; mixer channel or master at 0; module muted; sequencer waiting for the transport; MIDI device not enabled.
