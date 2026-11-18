# Dial

Type id `dial` · category *Controllers* · colour `#fda4af`

## 1. Purpose

One knob whose position is a control signal. Patch it onto several
destinations at different cable amounts and it becomes a macro: one gesture
moves a filter, a mix and a decay together. *Min* and *Max* set the range, *Curve* bends it,
*Steps* turns it into a selector, *Smooth* takes the zipper out of fast turns.

## 2. Jacks

**Inputs:** none besides the knobs (every knob is an input, `specs.md` section 7.3).
A cable into *Value* moves the dial like a hand would.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out | `control` (bipolar) | `Min + (Max − Min) × curve(Value)`, stepped, then smoothed. |

## 3. Controls

**Knobs**

| Knob | Range | Default | What it does |
|---|---|---|---|
| Value | 0…100 % | 50 % | The dial. |
| Min | −1…+1 | 0 | *Out* with the dial fully left. |
| Max | −1…+1 | +1 | *Out* with the dial fully right. *Max* below *Min* reverses the dial. |
| Smooth | 0…2 s | 20 ms | One-pole smoothing of *Out* (63 % rise time). |
| Curve | 0…100 % | 50 % | 50 % linear; right towards exponential, left towards logarithmic. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Steps | 0 (continuous), 2…24 | 0 |

## 4. Behaviour

- *Value* (with its modulation) is clamped to 0…1, rounded to the nearest of
  *Steps* evenly spaced positions when *Steps* ≥ 2 (1 counts as continuous),
  bent by the curve, mapped to *Min…Max* and smoothed.
- The curve on a position *v* (0…1) is `(e^(k·v) − 1) / (e^k − 1)` with
  `k = (Curve − 0.5) × 12`: −6 (logarithmic) through 0 (linear, the identity)
  to +6 (exponential). 0 and 1 map to themselves, so *Min* and *Max* stay the
  ends. The steps come before the curve: detents sit evenly on the dial and
  their outputs on the curve.
- Smoothing starts at the current value when the module starts, so a saved
  set doesn't glide up from 0 on load.

## 5. Module view

A *Curve* display on top: the dial's position left to right, *Out* −1…+1
bottom to top, *Min* and *Max* as dashed lines with their values, the curve
(a staircase with a dot per detent when *Steps* ≥ 2, over the continuous
curve dimmed), a dot at the current position (with modulation) and a mark on
the right edge at the live *Out* (after smoothing). Below it the standard
knobs: *Value* in its own *Dial* section, then *Min*, *Max* and *Curve*
(*Range*) and *Steps* and *Smooth* (*Feel*). *Value* is a normal knob
(drag, wheel, double-click resets) with the usual modulation ring when a
cable drives it; *Steps* rounds the output, not the knob.

## 6. Saved state

Only knob and setting values; no node data. Turning the dial is an undoable
knob change like any other.

## 7. Engine requirements

None.

## 8. Tests

- Value maps to the range; reversed range; detents round to the nearest step.
- Curve: 50 % is linear, 0 % and 100 % bend log and exp with the ends fixed;
  steps come before the curve.
- Smoothing starts without a glide and settles after a change.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Show the dial on the node itself, so it can be turned without opening the view.
- Panel control (`specs.md` section 9.7) and MIDI learn.
- An S-shaped curve and a bipolar centre detent.
