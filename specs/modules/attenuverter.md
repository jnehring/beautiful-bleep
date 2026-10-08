# Attenuverter

Type id `attenuverter` · category *Utility* · colour proposal `#c4b5fd`

## 1. Purpose

Four independent rows that scale, invert and offset a signal. With nothing
patched, a row is a hand-set constant, so the module also serves as four manual
controls (macro knobs). It is the dedicated, many-channel version of the
first stage of *Utility*. Use it when you want to shape several signals at once,
or when one knob should feed many destinations with the same value.

Cable amounts (`specs.md` section 7.3) already attenuate at the destination.
The Attenuverter is for scaling **once, at the source**: one knob changes the depth
for every destination, and you can modulate that depth.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In 1–4 | `control` | The signal for each row. Unpatched: a constant **+1**, so the row outputs *Scale* + *Offset* (see 4.2). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out 1–4 | `control` (bipolar) | `In × Scale + Offset` for each row, after *Clip*. |
| Sum | `control` (bipolar) | Out 1 + Out 2 + Out 3 + Out 4, after *Clip*. |

## 3. Controls

**Knobs** (modulatable floats), per row 1–4

| Knob | Range | Default | What it does |
|---|---|---|---|
| Scale *n* | −2…+2 | +1 | Gain for the row. Negative values invert. Detents at 0 and ±1; ±1…±2 boosts a weak signal. |
| Offset *n* | −1…+1 | 0 | Added after scaling. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Clip | Off, Soft (±1), Hard (±1) | Off |

## 4. Behaviour

### 4.1 Per row

`Out n = clip(In n × Scale n + Offset n)`, per sample. No smoothing beyond
the engine's usual parameter ramps, so the module works at audio rate too
(an audio signal through a row is a plain gain stage; the *Multiplier* and
*VCA* are clearer for audio, though).

### 4.2 Normalling

An unpatched *In* reads a constant +1 (`ProcessContext::inputConnected`).
So an empty row outputs `Scale + Offset`. In practice, set *Scale* to 0 and
use *Offset* as a manual control. Or leave *Offset* at 0 and *Scale* becomes
a manual knob from −2 to +2.

### 4.3 Clip

- *Off*: no limiting (the engine's float range).
- *Soft*: linear up to ±0.8, then a smooth knee into ±1 (shared with the *CV Mixer*; lives in `patch/common/dsp/`).
- *Hard*: clamp to ±1.

Clip applies to each *Out* and to *Sum* separately: Sum adds the clipped rows
and is clipped again.

## 5. Module view

Four rows, each with *Scale* and *Offset* side by side, and a small bar meter
showing the row's live output (−1…+1, centre zero). The rows' input and output
jacks sit on the left and right edges of the row they belong to.

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

None. Uses `inputConnected` for the normalling and `liveValues` for the meters.

## 8. Tests

- In = 0.5, Scale = −1, Offset = 0.25 → Out = −0.25.
- Unpatched row: Out = Scale + Offset.
- Sum equals the sum of the four outputs.
- Soft and Hard clip keep every output inside ±1; Off lets 1.5 through.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- A per-row *Polarity* switch for a unipolar knob display (0…1).
- Row chaining: an unpatched *In n* normalled to *Out n−1* instead of +1, for cascaded scaling.
