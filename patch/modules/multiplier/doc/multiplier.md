# Multiplier

## Introduction

Two multipliers that compute X × Y, with both signals allowed to be negative.
With audio it's a ring modulator: metallic, bell-like tones from two
oscillators. With modulation it lets one signal control the depth of
another, for example an LFO whose depth follows an envelope.

## How does it work?

Each section computes

    Out = (X + Bias X) × (Y + Bias Y) × Gain

- An unpatched **Y** reads +1, so the section simply passes X at *Gain*.
- An unpatched **X2** takes **Out 1**. Patch three signals into X1, Y1 and Y2
  to multiply all three together.
- **Bias** adds a constant before multiplying. With *Bias Y* at 1, a
  bipolar Y gives amplitude modulation (the original tone stays); at 0 it's
  ring modulation (the original tone disappears, only sum and difference
  tones remain).

Unlike the VCA, the Multiplier treats both inputs the same, has no
response curve, and lets the gain go negative.

Multiplying two audio signals creates new frequencies, which can fold back as
aliasing. *Oversampling* computes the product at 2× or 4× the sample rate and
filters it. This adds a short latency, so leave it off for modulation.

## How to use it?

- **Ring modulator:** two oscillators into *X1* and *Y1*, *Out 1* to an output.
  Detune one oscillator for bell tones; set *Oversampling* to 4× for high notes.
- **Tremolo with character:** audio into *X1*, an LFO into *Y1*, *Bias Y1*
  at 1.
- **Depth from an envelope:** LFO into *X1*, envelope into *Y1*: the LFO
  only moves while the envelope is open.
- **Squaring:** the same signal into X and Y. A sine becomes a sine at twice
  the frequency, an LFO gets a rounder, always-positive shape.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Bias X1, Bias X2 | −1 … +1 | 0 |
| Bias Y1, Bias Y2 | −1 … +1 | 0 |
| Gain 1, Gain 2 | −2 … +2 | +1 |
| Oversampling | Off, 2x, 4x | Off |

### Inputs

| Input | Signal | What it does |
|---|---|---|
| X1, Y1 | control | First multiplier. Y1 unpatched reads +1. |
| X2, Y2 | control | Second multiplier. X2 unpatched takes Out 1; Y2 unpatched reads +1. |

The inputs accept audio and pitch signals too.

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out 1 | control | (X1 + Bias X1) × (Y1 + Bias Y1) × Gain 1 |
| Out 2 | control | the same for the second section |
