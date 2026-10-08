# Dial

Type id `dial` · category *Controllers* · colour `#fda4af`

## 1. Purpose

One big knob whose position is a control signal. Patch it onto several
destinations at different cable amounts and it becomes a macro: one gesture
moves a filter, a mix and a decay together. *Min* and *Max* set the range,
*Steps* turns it into a selector, *Smooth* takes the zipper out of fast turns.

## 2. Jacks

**Inputs:** none besides the knobs (every knob is an input, `specs.md` section 7.3).
A cable into *Value* moves the dial like a hand would.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out | `control` (bipolar) | `Min + (Max − Min) × Value`, stepped, then smoothed. |

## 3. Controls

**Knobs**

| Knob | Range | Default | What it does |
|---|---|---|---|
| Value | 0…100 % | 50 % | The dial. Shown as the big dial in the view. |
| Min | −1…+1 | 0 | *Out* with the dial fully left. |
| Max | −1…+1 | +1 | *Out* with the dial fully right. *Max* below *Min* reverses the dial. |
| Smooth | 0…2 s | 20 ms | One-pole smoothing of *Out* (63 % rise time). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Steps | 0 (continuous), 2…24 | 0 |

## 4. Behaviour

- *Value* (with its modulation) is clamped to 0…1, rounded to the nearest of
  *Steps* evenly spaced positions when *Steps* ≥ 2 (1 counts as continuous),
  mapped to *Min…Max* and smoothed.
- Smoothing starts at the current value when the module starts, so a saved
  set doesn't glide up from 0 on load.

## 5. Module view

A large dial (150 px) for *Value* with an arc, a pointer, tick marks for the
steps and the modulation ring when *Value* is modulated; the output value
above it. Drag vertically (Shift for fine), wheel (one notch is one step when
*Steps* ≥ 2), double-click resets. The small *Value* knob is hidden because the
big dial replaces it. *Min*, *Max*, *Smooth* and *Steps* sit below.

## 6. Saved state

Only knob and setting values; no node data. Turning the dial is an undoable
knob change like any other.

## 7. Engine requirements

None.

## 8. Tests

- Value maps to the range; reversed range; detents round to the nearest step.
- Smoothing starts without a glide and settles after a change.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Show the dial on the node itself, so it can be turned without opening the view.
- Panel control (`specs.md` section 9.7) and MIDI learn.
- Curves (exponential, S-shaped) and a bipolar centre detent.
