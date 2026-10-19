# Shape Table

Type id `shape-table` · category *Effects/Distortion* · colour `#f59e0b`

## 1. Purpose

A waveshaper whose transfer curve is drawn in a custom view and stored as node
data, with curve presets, drive, bias, dry/wet, edge behaviour (clip, fold, wrap),
oversampling plus antiderivative anti-aliasing and a harmonic read-out.

## 2. Jacks

Inputs: In L, In R (audio), Func In (control). Outputs: Out L, Out R (audio), Func Out (control).

## 3. Controls

Drive (−12…+36 dB), Bias, Mix, Out (dB) are modulatable; Edge (Clip, Fold, Wrap),
Quality (Off, 2×, 4×), DC Block are settings.

## 4. Behaviour

4.1 Curve. 65 control points on x = −1…+1, y ∈ [−1, 1] (data), a Catmull-Rom
spline (ends extended linearly) sampled at 1024 cells into a piecewise-linear
table, clamped to ±1.5; its exact antiderivative is tabulated with it.

4.2 Edge. Clip: the curve holds its end values (antiderivative continues
linearly). Fold: period-4 mirror (F over [1, 3] = 2F(1) − F(2 − x)). Wrap: period 2.

4.3 Processing. x = in × 10^(Drive/20) + Bias; upsample (half-band stages, 1, 2 or 4×);
per oversampled sample y = (F(xₙ) − F(xₙ₋₁))/(xₙ − xₙ₋₁) (the midpoint value when the
difference is below 1e-6); downsample; an optional one-pole DC blocker (8 Hz);
mix with the dry signal delayed by oversampler latency + 0.5/factor samples.

4.4 Func In → table value (linear), no oversampling, no gain or bias.

4.5 Read-out (message thread): 512 points of a sine of amplitude Drive plus Bias
through the table without ADAA, DFT harmonics 1–16.

## 5. Module view

Curve editor (drag to draw, preset buttons, live operating point), a bar chart
of the 16 harmonics.

## 6. Saved state

Node data `{"curve": [65 numbers in −1…1]}`; the default is the *Soft* preset.

## 7. Engine requirements

None.

## 8. Tests

`tests/test_shape_table.cpp`: presets and spline (identity, symmetry, passes
through its points); the antiderivative differentiates back to the curve in
all edge modes; edge behaviour; aliasing falls with quality (below −45 dB at 4×);
identity and dry/wet phase; bias and DC; harmonic read-out against measurement;
wild settings bounded.

## 9. Later

Per-channel curves, a spectral-domain curve mode, importing a curve from a sample.
