# Crossfader

Type id `crossfader` · category *Audio* · colour proposal `#fb7185`

## 1. Purpose

Blends between two stereo signals with one knob: dry/wet for an effect chain,
a morph between two oscillators, or a fade between two modulators. Equal-power
or linear curves, so it works for audio and control signals alike. The
*Fade* knob is the point of the module: patch an LFO or envelope onto it and
one source turns into the other.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| A L, A R | `audio` | Source A. *A R* unpatched copies *A L*. |
| B L, B R | `audio` | Source B. *B R* unpatched copies *B L*. |

`audio` inputs accept `control` and `pitch` directly (`specs.md` section 7.4).

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | The blend. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Fade | 0 (A)…1 (B) | 0.5 | Position of the blend. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Curve | Equal power, Linear | Equal power |

## 4. Behaviour

With `f` = *Fade*, clamped to 0…1:

| Curve | A gain | B gain | Use |
|---|---|---|---|
| Equal power | `cos(f · π/2)` | `sin(f · π/2)` | Uncorrelated audio (two different sounds): the loudness stays even across the fade. |
| Linear | `1 − f` | `f` | Correlated audio (dry/wet of the same signal, where equal power would bulge by 3 dB in the middle), and control and pitch signals, where the output should be the exact weighted average. |

Gains are computed per sample, so audio-rate modulation of *Fade* works (a
form of amplitude modulation between two sources).

## 5. Module view

The *Fade* knob as a wide horizontal slider with *A* and *B* at its ends, the
*Curve* setting, and two small level bars showing the current A and B gains.

The first version uses the generic module view (knobs and settings); the
displays described here come later.

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

None.

## 8. Tests

- Fade 0 → A only; 1 → B only; both curves.
- Equal power at 0.5: both gains 0.7071; A² + B² = 1 across the range.
- Linear at 0.25: 0.75 A + 0.25 B exactly.
- Mono inputs (R unpatched) appear on both outputs.
- A Fade value outside 0…1 (from modulation) is clamped.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- A third curve with a flat middle ("DJ cut").
- Four-source vector blending (XY pad).
