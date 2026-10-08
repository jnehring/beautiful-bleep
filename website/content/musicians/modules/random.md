---
title: Random
order: 11
---

# Random

Stepped random values with a memory. One knob goes from "always new" to
"locked loop". It is seeded, so a set renders the same way every time.

| Control | Range | What it does |
|---|---|---|
| Rate | 0.05 – 50 Hz | step rate when Sync is Free and Clock is unpatched |
| Spread | 0 – 100 % | width of the random range |
| Bias | −1 … +1 | centre of the range |
| Smooth | 0 – 100 % | glide between steps |
| Loop | 0 – 100 % | 0: every step is new. 100 %: the last *Length* steps repeat forever. In between, values change now and then |
| Sync | Free, 1/32 … 8 bars | step length locked to the transport |
| Length | 2 – 32 steps | loop length |
| Semitones | on/off | quantise to semitones (for pitch, 1 V/oct) |
| Seed | 0 – 999 | a different seed is a different sequence |

**Inputs:** *Clock* (gate). When patched, each rising edge takes one step.
**Outputs:** *Out* (−1…+1), *Trig* (a trigger on every step).
