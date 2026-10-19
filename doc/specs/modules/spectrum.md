# Spectrum

Type id `spectrum` · category *Utility/Metering* · colour `#f0abfc`

## 1. Purpose

Shows which frequencies a sound contains, on a logarithmic axis, and turns three facts about the
spectrum into signals: the **strongest partial** (as a pitch), the **centroid** (the spectrum's centre of
gravity, a measure of brightness, as a pitch) and the **flux** (a trigger when new energy appears).
The audio passes through unchanged.

## 2. Jacks

**Inputs**: *In L*, *In R* (`audio`). The analysis hears L + R halved; with R unpatched it hears L.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | The inputs, unchanged. |
| Dominant | `pitch` | The frequency of the strongest partial, 1 V/oct, 0 = middle C. Holds while the input is quieter than −60 dBFS. |
| Centroid | `pitch` | The spectral centroid, same scale. |
| Flux | `trigger` | A 2 ms pulse when the spectrum gains energy faster than usual. |
| Flux Amount | `control` (unipolar) | How much of the spectrum is new since the last analysis, 0 – 1, smoothed. |

## 3. Controls

| Control | Range | Default | Notes |
|---|---|---|---|
| Resolution | 1024, 2048, 4096, 8192 | 4096 | FFT size. A new analysis every quarter of it. |
| Average | 0 – 3 s (centre 0.3 s) | 0.15 s | Time constant of the power average that is shown and measured. |
| Tilt | −6 … +9 dB/oct | 0 | Display only, about 1 kHz. +4.5 makes pink noise look flat. |
| Peak Line | Off, Falling, Hold | Falling | Falling: 12 dB per second. Hold: until Reset Peaks. |
| Flux Sensitivity | 0 – 100 % | 50 % | |
| Floor | −120 … −30 dB | −90 | The bottom of the display. |

Button: *Reset Peaks*.

## 4. Behaviour

**Analysis.** The input is kept in a ring. Every N/4 samples the newest N samples are multiplied with a
Hann window and transformed. Amplitudes are scaled so a full-scale sine reads 0 dB at its frequency. The power in every bin is averaged
with *Average* (a one-pole filter per analysis step). All displayed and measured values come from this average, except Flux.

**Display.** 256 columns from 20 Hz to the top of the axis (20 kHz, or 95 % of Nyquist at low sample rates), evenly spaced in
log frequency. A column that covers several FFT bins shows the largest; one narrower than a bin is interpolated between its
neighbours. Tilt adds `Tilt · log2(f / 1 kHz)` dB. The peak line follows the display (Falling: it falls 12 dB per second; Hold:
it only rises).

**Dominant.** The strongest bin between 20 Hz and 95 % of Nyquist, refined by a parabola through the logarithms of it and its
neighbours. Silence (below −60 dBFS) keeps the last value. The output glides to a new value over about 10 ms.

**Centroid.** Σ f·a / Σ a over the same range from the averaged amplitudes, glided like Dominant.

**Flux.** On every analysis step (not averaged): Σ max(0, a − a_previous) / Σ a, over the same range. A slow running mean follows it; a
pulse is sent when the flux exceeds `mean × (1 + 4 · (1 − Sensitivity)) + 0.05`, the input is above −54 dBFS and at least 60 ms passed since
the last pulse. The first four analyses after loading or a Resolution change are ignored.

## 5. View

The averaged spectrum as a filled curve with a glowing edge, the peak line over it, a dB grid down to *Floor*, frequency marks at
50 Hz – 10 kHz, a dashed line at the strongest partial and a triangle at the centroid. The readout gives the strongest partial in Hz and as a
note name.

## 6. Tests

`modules/spectrum/tests/test_spectrum.cpp`: dominant frequency of sines from 110 Hz to 12 kHz within 0.4 %; the stronger of two partials;
silence; centroid of dull vs bright; level and axis of the display; tilt is display-only; peak line; averaging; flux on onsets and not on a
steady tone; sensitivity; determinism.
