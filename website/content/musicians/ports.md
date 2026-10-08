---
title: Ports
order: 2
---

# Ports: the plugins you add in Live

These are the only Bleep plugins in Live's browser. Each one (except Bleep
Patch) appears on the board as a node, named after its track. Settings such
as MIDI channels and CC numbers are in the node's view on the board.

| Plugin | Put it on | On the board |
|---|---|---|
| **Bleep Patch** | any track, once per set | *Macros*: 16 outputs you can automate and MIDI-map in Live |
| **Bleep MIDI In** | a MIDI track | *Notes* (polyphonic), mono *Pitch*, *Gate*, *Velocity*, *Trigger*, *Pressure*, *Bend*, *Mod Wheel*, 8 CCs |
| **Bleep MIDI Out** | a MIDI track | inputs *Notes*, *Gate* + *Pitch* (mono), 8 CCs, *Bend*. See [routing](guides/midi-out-routing.md) |
| **Bleep Audio In** | any track, anywhere in the chain | the track's audio at that point (*L*, *R*); the audio passes through unchanged |
| **Bleep Audio Out** | its own MIDI track | board audio (*L*, *R*) on that track, with its own mixer channel |
| **Bleep Instrument** | a MIDI track | MIDI In and Audio Out in one plugin: a board synth on one track |
| **Bleep Audio Insert** | any track | *Send* (the track's audio) and *Return* (back to the track), with Dry/Wet. With nothing patched into *Return*, the audio passes through |

**Latency:** audio through the board arrives two audio buffers late. Audio
Out, Instrument and Audio Insert report it to Live (Live's delay
compensation then lines them up). It isn't compensated for MIDI Out, or for
tracks you monitor while *Reduced Latency When Monitoring* is on.

**Ghosts:** when a port's plugin is deleted, deactivated or its track is
frozen, its node turns grey and its outputs fall silent. The cables stay;
when the plugin comes back (for example after undo in Live), it reconnects.
