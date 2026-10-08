# Noise

Type id `noise` · category *Sources* · colour `#cbd5e1`

## 1. Purpose

A noise source: white, pink, brown and blue noise on their own outputs, and a
*Colour* knob that sweeps one output continuously from brown to violet. The
raw material for percussion, wind, breath and risers, and a random source for
modulation.

## 2. Jacks

**Inputs:** none besides the knobs (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out | `audio` | Noise in the colour set by *Colour*, scaled by *Level*. |
| White | `audio` | Flat spectrum. |
| Pink | `audio` | −3 dB/oct. |
| Brown | `audio` | −6 dB/oct above 16 Hz. |
| Blue | `audio` | +3 dB/oct. |

## 3. Controls

| Knob | Range | Default | What it does |
|---|---|---|---|
| Colour | −100…+100 % | 0 % | −100 % brown, −50 % pink, 0 % white, +50 % blue, +100 % violet (+6 dB/oct); linear blend in between. |
| Level | 0–100 % | 100 % | Volume of *Out* only. |

No settings.

## 4. Behaviour

- All colours derive from one uniform white source (xorshift32): pink by a
  sum of one-pole low-passes, brown by a leaky integrator (16 Hz floor), blue
  and violet as the first difference of pink and white.
- Every output is normalised to an RMS of about 0.3 (≈ −10 dB), so switching
  colours or sweeping *Colour* keeps the level roughly constant.
- Each instance gets its own seed from a process-wide counter, so two Noise
  nodes, or the voices of a Voice Cell, never correlate. Noise is not
  reproducible between renders; it doesn't need to be (unlike Random, whose
  values are musical content).

## 5. Module view

The generic view: two knobs and the output jacks. No custom view.

## 6. Saved state

Knob values only.

## 7. Engine requirements

None.

## 8. Tests

- `test_dsp` *noise*: every colour at RMS 0.3 ± 0.04; *Colour* at −1, 0, +1
  equals brown, white, violet exactly; each colour step carries more low end
  relative to top than the next brighter one; two instances are uncorrelated.
- `engine_test` *noise node*: the node outputs noise, *Level* 0 silences
  *Out* but not the fixed colours.

## 9. Later

- A stereo pair of outputs (decorrelated L/R).
- A *Seed* setting for reproducible noise, if a use appears.
