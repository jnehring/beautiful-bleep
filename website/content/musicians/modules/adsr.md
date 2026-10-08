---
title: ADSR
order: 11
---

# ADSR

The classic envelope: attack, decay, sustain, release.

| Control | Range | What it does |
|---|---|---|
| Attack | 1 ms – 10 s | rise to the peak |
| Decay | 1 ms – 10 s | fall to the sustain level |
| Sustain | 0 – 100 % | level while the gate stays high |
| Release | 1 ms – 20 s | fall to silence after the gate |
| Velocity | 0 – 100 % | how much the *Velocity* input lowers the peak (0 %: ignored) |

**Inputs:** *Gate*, *Retrigger* (restarts the attack from the current level),
*Velocity* (0–1; unpatched = full).
**Outputs:** *Env* (0–1), *End* (a trigger when the release is over), *Active*
(high while the envelope runs — patch it into a Voice Cell's *Voice Out*).
