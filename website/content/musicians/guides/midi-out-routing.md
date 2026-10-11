---
title: Routing MIDI Out in Live
description: Send MIDI from the board to another instrument track in Live.
order: 20
---

# Routing MIDI Out in Live

1. Create a MIDI track ("Mod MIDI") and load **Bleep MIDI Out** (VST3) as
   its instrument.
2. Create a second MIDI track with the instrument you want to play.
3. On the second track set **MIDI From** to *Mod MIDI*, choose *Bleep MIDI
   Out* in the second menu, and set **Monitor** to *In*.
4. On the board, patch a gate (e.g. Function's *EOC* through Utility, or
   Random's *Trig*) into MIDI Out's *Gate*, and a pitch (e.g. Random with
   *Semitones* on) into *Pitch*. Or patch a *Notes* output (from MIDI In)
   into its *Notes* input. CC numbers, channel and transpose are in its view.

Live merges MIDI channels on internal routes, so one MIDI Out instance carries
one stream. Use more instances for more streams.
