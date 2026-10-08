# Multiplier

Type id `multiplier` · category *Utility* · colour proposal `#c4b5fd`

## 1. Purpose

Two four-quadrant multipliers: `X × Y`, with both signals allowed to be
negative. At audio rate it is a ring modulator; with control signals it scales
one modulator by another (an LFO whose depth follows an envelope), or squares
a signal to bend its shape. Unlike the *VCA*, it has no response curve, never
clamps the gain to 0…1 and treats both inputs the same.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| X1, Y1 | `control` | First multiplier. Y1 unpatched reads **+1**, so the section passes X1 at *Gain 1*. |
| X2, Y2 | `control` | Second multiplier. X2 unpatched reads **Out 1** (chaining, see 4.2); Y2 unpatched reads +1. |

`control` inputs accept `audio` and `pitch` directly (`specs.md` section 7.4),
so the module serves audio and modulation alike.

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out 1 | `control` (bipolar) | `(X1 + Bias X1) × (Y1 + Bias Y1) × Gain 1` |
| Out 2 | `control` (bipolar) | Same for section 2. |

## 3. Controls

**Knobs** (modulatable floats), per section 1–2

| Knob | Range | Default | What it does |
|---|---|---|---|
| Bias X *n* | −1…+1 | 0 | Added to X before multiplying. |
| Bias Y *n* | −1…+1 | 0 | Added to Y before multiplying. With Y bipolar and *Bias Y* at 1, the product is amplitude modulation (carrier kept) rather than ring modulation. |
| Gain *n* | −2…+2 | +1 | Output gain; negative inverts. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Oversampling | Off, 2×, 4× | Off |

## 4. Behaviour

### 4.1 Product

Per sample: `Out n = (X n + Bias X n) × (Y n + Bias Y n) × Gain n`. No
clipping: two full-scale signals multiply to within ±1, and anything beyond
comes from *Bias* or *Gain*, set on purpose.

### 4.2 Chaining

*X2* unpatched takes *Out 1*, so (with the biases at 0)
`Out 2 = Out 1 × Y2 × Gain 2`: the product
of three signals without extra patching. Patching *X2* breaks the chain and
the two sections are independent.

### 4.3 Oversampling

Ring modulation of two audio signals produces sum and difference frequencies,
so the sum can alias. *Oversampling* runs the multiplication at 2× or 4× with
the engine's shared half-band filters (a short FIR, a few samples of latency on
both outputs). *Off* is exact and latency-free, and right for control signals.

## 5. Module view

Two sections stacked vertically, each with *Bias X*, *Bias Y* and *Gain*, and
a small XY scope (X horizontal, Y vertical, the product as brightness) showing
the last 50 ms. The *Oversampling* dropdown sits at the bottom.

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

- A half-band up/down-sampler in `patch/common/dsp/`, shared with future
  nonlinear modules (wavefolder, distortion). If the Multi Filter's drive
  stages already have one, reuse it.
- Reported latency per output when oversampling is on; until the engine has
  latency compensation inside the board, the latency is listed in the docs.

## 8. Tests

- X = 0.5, Y = −0.5 → Out = −0.25; all four sign quadrants are correct.
- Y unpatched passes X × Gain.
- X2 unpatched (biases 0) equals Out 1 × Y2 × Gain 2; patched X2 is independent.
- Bias Y = 1 with Y a sine: the carrier remains in the spectrum (AM); Bias Y = 0: carrier suppressed (ring mod).
- Sines at 18 kHz and 10 kHz, 48 kHz sample rate: the sum (28 kHz) folds to 20 kHz without oversampling; at 4× that alias is at least 40 dB lower, and the 8 kHz difference tone is unchanged.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- A *Divide* mode (X / Y, with a safe floor near Y = 0).
- A dedicated audio *Ring Mod* with a built-in carrier oscillator.
