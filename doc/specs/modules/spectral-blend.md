# Spectral Blend

Type id `spectral-blend` · category *Audio / Mangling* · colour `#818cf8`

## 1. Purpose

Cross-synthesis of two sounds in the frequency domain. Each sound is split into
**magnitude** (which partials are present and how loud) and **phase** (where each is in its cycle);
the output takes the magnitudes from one and the phases from the other, or any
morph between. Blur, smear, a three-region spectral gate and a freeze reshape the
result, and its own control, **Tilt**, bends the blend across the spectrum so low
bins can follow A while high bins follow B.

## 2. Jacks

Inputs *In A*, *In B* (normalled to A), *Freeze* (`gate`). Output *Out* (mono).

## 3. Controls

Blend: Magnitude 0–100 % (0 = A … 100 = B), Phase 0–100 % (100), Tilt −1…+1 (0), Pivot
100 Hz–8 kHz (1 kHz), Morph Law (Linear, Geometric). Shape: Blur, Smear 0–100 %.
Gate: Gate Low / Mid / High −90…0 dB (−90 = open), Split Low 80 Hz–2 kHz (400),
Split High 0.8–12 kHz (3 kHz), Invert Gate. Output: Freeze, FFT Size (512 … 4096; 2048),
Mix 0–100 % (100), Level ±dB.

## 4. Behaviour

Short-time Fourier transform: Hann analysis and synthesis windows, hop N/4,
overlap-add scaled by 1/1.5. A and B share one complex transform (A real, B
imaginary), separated per bin. Latency is N samples; with Mix the dry A is delayed to match.

Per bin, with magnitudes `|A|`, `|B|` and phases as unit vectors `uA`, `uB`: weights
`wm` (Magnitude) and `wp` (Phase) go through Tilt: for Tilt `t` and a ramp `r(f) = ½ + ½ tanh(1.1 log2(f/Pivot))`
(0 below the pivot, 1 above), `w' = w + |t| × (target − w)` with `target = r` for
`t > 0` and `1 − r` for `t < 0`. The magnitude is `|A| + wm'(|B| − |A|)` (Linear) or
`|A|^(1−wm') |B|^wm'` (Geometric); the phase vector is `uA + wp'(uB − uA)`, normalised.

Then, in this order: **Blur** (box average of the magnitudes over ±r bins,
`r = Blur² × 0.04 × N/2`), **Gate** (each bin's magnitude in dB against the threshold of its
region; a soft knee of one factor of two; Invert keeps what is below), **Smear** (the
magnitude can fall by at most `e^(−hop/τ)` per frame, `τ = Smear² × 4 s`), **Freeze**.
A frozen frame keeps its magnitudes and every bin keeps turning at the rate it had in the
last live frame, so tones continue as a steady drone; unfreezing resumes live
analysis in the next frame.

## 5. Implementation

`patch/modules/spectral-blend/dsp/SpectralBlendDsp.h`, FFT in `common/dsp/RealFft.h`
(radix 2, tables made in prepare, packed real pairs). Tests: `tests/test_spectral_blend.cpp`
(identity is a delay of N at four sizes, B takes over, cross-synthesis, magnitude morph
linear/geometric, tilt, blur, gate and inverted gate, freeze and release, smear,
mix/level, finiteness); `common/dsp/tests/test_real_fft.cpp`.
