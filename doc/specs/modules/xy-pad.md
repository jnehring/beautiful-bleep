# XY Pad

Type id `xy-pad` · category *Controllers* · colour `#fda4af`

## 1. Purpose

Two control signals from one point. What a panel's XY pad control drives.

## 2. Jacks

**Inputs:** none besides the knobs. **Outputs:** *X* and *Y*, `control`:
`Min + (Max − Min) × position`, each smoothed.

## 3. Controls

| Knob | Range | Default |
|---|---|---|
| X | 0…100 % | 50 % |
| Y | 0…100 % | 50 % |
| Min | −1…+1 | 0 |
| Max | −1…+1 | +1 |
| Smooth | 0…2 s | 20 ms |

## 4. Behaviour

Both axes are clamped to 0…1, mapped to the shared *Min…Max* and smoothed.
Smoothing starts at the current values.

## 5. Module view

A square pad with a point; the outputs above it. Drag to move both axes, double-click
to centre. The small *X* and *Y* knobs are hidden.

## 6. Saved state

Knob values only.

## 7. Engine requirements

None.

## 8. Tests

Range mapping on both axes, smoothing start and glide (`controller_modules_test.cpp`).
