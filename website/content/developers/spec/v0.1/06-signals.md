---
title: Signals
order: 6
---

## 6. Signals

All signals are 32-bit floats, one per sample, in **virtual volts**, chosen
so that bridges to CV hardware and VCV Rack map directly.

| Type | Value | Rule | Virtual volts |
|---|---|---|---|
| `control` (0) | bipolar −1..+1 or unipolar 0..1 | Polarity declared per output | ±1 ≈ ±5 V |
| `gate` (1) | high ≥ 0.5 | | high ≈ +5 V |
| `trigger` (2) | one sample of 1.0, otherwise 0.0 | Readers that decimate MUST take the maximum of the span | |
| `pitch` (3) | 1.0 per octave | 0.0 = C4 = MIDI note 60 | 1 V/oct |
| `audio` (4) | reserved | MUST NOT be used in v0.1 | |

Types and polarity are advisory: any output may be connected to any input.
Values outside the nominal range are allowed (a sum of cables may exceed
it); receivers clamp where it matters.

### 6.1 Applying modulation to a parameter

A receiving plugin SHOULD apply an input to a parameter as an offset in the
parameter's **normalised** range (0..1), inside its DSP:

```
effective = clamp(knob_normalised + Σ source_i × amount_i, 0, 1)
```

It MUST NOT move the host-visible parameter (no automation writes, no undo
entries). Parameters with exponential mappings (cutoff, rates) are thus
modulated in octaves.
