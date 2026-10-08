# Crossfader

## Introduction

The Crossfader blends between two stereo signals with one knob: dry and wet
of an effect, two oscillators, two drum loops, or two modulators. Patch an
LFO or an envelope onto *Fade* and one sound turns into the other.

## How does it work?

*Fade* at 0 plays only **A**, at 1 only **B**; in between, both are mixed.
*Curve* decides how:

- **Equal Power:** the loudness stays even across the fade. Use it for two
  different sounds.
- **Linear:** the gains add up to exactly 1. Use it for dry/wet of the same
  sound (where equal power would be 3 dB louder in the middle) and for
  modulation and pitch signals, where the output should be the exact average.

If only the left input of a pair is patched, it feeds both sides.

## How to use it?

- **Dry/wet:** the dry signal into *A*, the effect's output into *B*, *Curve*
  *Linear*.
- **Morph two oscillators:** two different oscillators into *A L* and *B L*, a
  slow LFO onto *Fade*.
- **Blend two modulators:** two LFOs into *A L* and *B L*, *Curve* *Linear*;
  *Out L* is a modulation source that moves between them.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Fade | 0 (A) … 1 (B) | 0.5 |
| Curve | Equal Power, Linear | Equal Power |

### Inputs

| Input | Signal | What it does |
|---|---|---|
| A L, A R | audio | Source A; A R unpatched copies A L |
| B L, B R | audio | Source B; B R unpatched copies B L |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out L, Out R | audio | The blend |
