---
title: Modulating any Live parameter (loopback workaround)
description: Modulate any Live parameter with a virtual MIDI port until the Max for Live bridge exists.
order: 21
---

# Modulating any Live parameter (v1 workaround)

Until the Max for Live bridge exists, a virtual MIDI port lets you map signals from the board to any parameter in Live:

1. **macOS:** open *Audio MIDI Setup → MIDI Studio → IAC Driver*, tick
   *Device is online*. **Windows:** install loopMIDI and create a port.
2. In Live's MIDI preferences, enable *Remote* for the IAC/loopMIDI input.
3. Route the Bleep MIDI Out track's **MIDI To** to that port.
4. Enter MIDI Map mode, click the target parameter, then patch a moving
   signal into MIDI Out's *CC 1* input on the board. Live learns the mapping.

Limits: 7-bit resolution, updates at Live's control rate, and the mapping
overrides automation on that parameter.
