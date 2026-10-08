---
title: MIDI Out
order: 14
---

# MIDI Out

Turns bus signals into MIDI, so any instrument or hardware can follow your
patch. It is a VST3 instrument that makes no sound.

| Control | Range | What it does |
|---|---|---|
| Velocity | 0 – 100 % | note-on velocity |
| CC A / CC B | 0 – 100 % | sent as MIDI CC (numbers below) |
| Bend | −1 … +1 | 14-bit pitch bend |
| Channel | 1 – 16 | |
| CC A # / CC B # | 0 – 127 | controller numbers (default 1 = mod wheel, 74 = brightness) |
| Transpose | ±24 semitones | |
| Send CC + Bend | on/off | |

**Inputs:** *Gate* (note on/off) and *Pitch* (1 V/oct, 0 = C4). A pitch
change while the gate is high plays legato.

See [Routing MIDI Out in Live](../guides/midi-out-routing.md).
