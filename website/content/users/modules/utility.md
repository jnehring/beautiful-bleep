---
title: Utility
order: 12
---

# Utility

The glue: attenuverter, offset, mixer, shaper, slew and comparator in one.

`Out = slew( mode( X × Scale X + Y × Scale Y + Offset ) )`

| Control | Range | What it does |
|---|---|---|
| Scale X / Scale Y | −1 … +1 | attenuate or invert the inputs (the Y knob mixes Y in) |
| Offset | −1 … +1 | adds a constant. With nothing patched, Utility is a modulatable constant |
| Slew | 0 – 5 s | smooths the output |
| Threshold | −1 … +1 | the *Gate* output is high while Out > Threshold |
| Mode | Through, Rectify, Fold, Quantize, Sample & Hold | Rectify: absolute value. Fold: reflects values beyond ±1. Quantize: semitones. S&H: samples on each *Clock* edge |

**Inputs:** *X*, *Y* (control), *Clock* (gate). **Outputs:** *Out*, *Gate*,
*Inv* (−Out).
