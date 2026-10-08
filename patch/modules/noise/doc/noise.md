# Noise

## Introduction

Noise is random audio: every frequency at once, with no pitch. It's the raw
material for snares, hi-hats, wind, breath, surf and risers, and a handy
random source for modulation. Noise gives you four classic colours on their
own outputs, plus a *Colour* knob that sweeps smoothly from dark to bright.

## How does it work?

All colours come from one white noise source and are filtered from it:

- **White:** equal energy at every frequency. Bright and hissy.
- **Pink:** falls by 3 dB per octave, so every octave has the same energy.
  Sounds even and natural, like rain or a waterfall.
- **Brown:** falls by 6 dB per octave. Deep and rumbling, like distant
  thunder or surf.
- **Blue:** rises by 3 dB per octave. Thin and fizzy.

Every output is about equally loud (around −10 dB RMS), so you can switch
colours without jumping in level.

*Out* follows the **Colour** knob: −100 % is brown, −50 % pink, 0 % white,
+50 % blue and +100 % violet (rising by 6 dB per octave, the brightest).
Between those points it blends the two neighbours, so turning the knob, or
modulating it, sweeps the noise from dark to bright. *Level* sets the volume
of *Out* only.

Each Noise node plays its own noise. Two nodes, or two voices of a Voice Cell,
never play the same noise.

## How to use it?

- **Snare wires or hi-hats:** Noise *Out* → Multi Filter (band-pass or
  high-pass) → VCA, with a short ADSR on the VCA's *Gain*. For ready-made
  drums, the Ring and Punch drum nodes already include their own noise.
- **Wind and surf:** brown or pink noise → a resonant low-pass filter, with
  a slow Function or Random on the cutoff.
- **Risers:** patch a long rising envelope onto *Colour*, so the noise gets
  brighter as it builds.
- **Breathy oscillator:** mix a little pink noise into an oscillator before
  the filter.
- **Random modulation:** brown noise wanders slowly; patched with a small
  amount onto a pitch or cutoff, it adds unsteady, analog-style drift.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Colour | −100 … +100 % | 0 % (white) |
| Level | 0 – 100 % | 100 % |

- **Colour:** the colour of *Out*: −100 % brown, −50 % pink, 0 % white,
  +50 % blue, +100 % violet.
- **Level:** the volume of *Out*. The fixed colour outputs always play at
  full level.

Both knobs are modulation destinations.

### Inputs

None (apart from the knobs).

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out | audio | noise in the colour set by *Colour*, at *Level* |
| White | audio | white noise, flat |
| Pink | audio | pink noise, −3 dB/oct |
| Brown | audio | brown noise, −6 dB/oct |
| Blue | audio | blue noise, +3 dB/oct |
