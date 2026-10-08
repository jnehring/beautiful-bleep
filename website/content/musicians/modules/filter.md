---
title: Filter
order: 13
---

# Filter

A stereo state-variable filter that stays stable and click-free under fast
modulation, even at audio rate.

| Control | Range | What it does |
|---|---|---|
| Cutoff | 20 Hz – 20 kHz | modulation works in octaves: amount 10 % ≈ one octave |
| Resonance | 0 – 100 % | |
| Drive | 0 – 100 % | soft saturation before the filter |
| Mode | LP → BP → HP → Notch | continuous morph between the four responses |
| Mix | 0 – 100 % | dry/wet |
| Key Track | 0 – 100 % | how far cutoff follows the *Pitch* input (100 % = one octave per octave) |

**Inputs:** *Pitch* (1 V/oct), plus every control.
**Outputs:** *Env*, an envelope follower on the filtered signal. Patch it
anywhere, e.g. the filtered bass pumping another track's filter.
