---
title: Modulating any Live parameter (loopback workaround)
order: 21
---

# Modulating any Live parameter (v1 workaround)

Until the Max for Live bridge exists, a virtual MIDI port lets you map Bleep
Patch signals to any parameter in Live:

1. **macOS:** open *Audio MIDI Setup → MIDI Studio → IAC Driver*, tick
   *Device is online*. **Windows:** install loopMIDI and create a port.
2. In Live's MIDI preferences, enable *Remote* for the IAC/loopMIDI input.
3. Route the Bleep MIDI Out track's **MIDI To** to that port.
4. Enter MIDI Map mode, click the target parameter, then move MIDI Out's
   CC A knob. Live learns the mapping.

Limits: 7-bit resolution, updates at Live's control rate, and the mapping
overrides automation on that parameter.
