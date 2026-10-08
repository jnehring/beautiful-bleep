---
title: Function
order: 10
---

# Function

One slope generator that acts as an LFO, an envelope, a slew or a
portamento, depending on how you patch it.

| Control | Range | What it does |
|---|---|---|
| Rise | 1 ms – 10 s | time from 0 to 1 |
| Fall | 1 ms – 10 s | time from 1 back to 0 |
| Shape | −1 … +1 | bends both slopes: negative logarithmic, positive exponential |
| Spread | 0 – 100 % | cycling: B, C and D are phase-shifted by up to ¼ cycle each. Envelope: B, C and D get longer (up to 2×, 4×, 8×) |
| Cycle | on/off | on: loops (LFO). Off: runs once per trigger (envelope) |
| Sync | Free, 1/32 … 8 bars | locks one cycle to musical time; Rise/Fall then set the ratio. Phase follows Live's bars while playing |

**Inputs:** *Trig* (gate): starts the envelope, or restarts the cycle.
Rise, Fall, Shape and Spread are also inputs.

**Outputs:** *A, B, C, D* (0…1), *EOC* (a trigger at the end of each cycle or
envelope).

Recipe, **LFO modulating an LFO**: Function 1 (slow, synced to 4 bars)
→ Function 2 *Rise* and *Fall* at 30 %. Function 2's A → Filter cutoff.
