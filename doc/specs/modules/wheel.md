# Wheel

Type id `wheel` · category *Controllers* · colour `#fda4af`

## 1. Purpose

A pitch or mod wheel: one position, bipolar by default, that springs back to
the middle. The control signal for pitch bend and mod wheel, and what a panel's
Wheel control drives.

## 2. Jacks

**Inputs:** none besides the knobs. **Outputs:** *Out*, `control` (bipolar):
`Min + (Max − Min) × Value`, smoothed.

## 3. Controls

| Knob | Range | Default |
|---|---|---|
| Value | 0…100 % | 50 % |
| Min | −1…+1 | −1 |
| Max | −1…+1 | +1 |
| Smooth | 0…2 s | 20 ms |

| Setting | Values | Default |
|---|---|---|
| Spring | off, on | on |

## 4. Behaviour

*Value* (with its modulation) is clamped to 0…1, mapped to *Min…Max* and
smoothed. Smoothing starts at the current value. *Spring* is not in the engine:
the view (and a panel control) sets *Value* back to its default when the
gesture ends.

## 5. Module view

A vertical wheel with a centre line and the output value above it. Drag, or
click anywhere on the track; with *Spring* it returns to the middle on release;
double-click resets. The small *Value* knob is hidden.

## 6. Saved state

Knob and setting values only.

## 7. Engine requirements

None.

## 8. Tests

Range mapping, reversed range, smoothing start and glide (`controller_modules_test.cpp`).
