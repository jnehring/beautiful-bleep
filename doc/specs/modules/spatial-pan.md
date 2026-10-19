# Spatial Pan

Type id `spatial-pan` · category *Audio/Mixing* · colour `#2dd4bf`

## 1. Purpose

A binaural panner built from synthesised cues only (no measured response
data): interaural time and level differences, head shadow, a pinna notch,
rear roll-off, distance, Doppler and early reflections.

## 2. Jacks

Inputs: In L, In R (audio; both patched: summed; one: that one). Outputs: Out
L, Out R (audio), Side (control −1…+1).

## 3. Controls

Azimuth, Distance (0.25 m × 100^x), Elevation, Orbit, Doppler, Room, Size, Air,
Head (7–11 cm), Level — all modulatable.

## 4. Behaviour

4.1 Geometry: direction (sin az cos el, cos az cos el, sin el); lateral
cosine = sin az cos el for the right ear.

4.2 ITD = (a/c)(θ + sin θ), θ = asin|lateral|; the far ear's delay line read is
later by that, both ears by Doppler × d/c; delays glide with a 4 ms one-pole;
cubic Hermite reads.

4.3 Head shadow per ear: H(s) = (1 + α s τ)/(1 + s τ), τ = a/(2c), α = 1.05 +
0.95 cos(θ_ear × 180/150), bilinear transform.

4.4 Pinna: RBJ peaking filter at 7.5 kHz + 2.5 kHz × sin el, Q 2.5, −(2 + 7|sin el|) dB.
Rear: one-pole low-pass, 16 kHz − 10.5 kHz × max(0, −cos az cos el).

4.5 Distance: gain 1/(1 + 1.5(d − 0.25)); air low-pass 20 kHz / (1 + 0.7 Air (d − 0.25)).

4.6 Early reflections: six taps at 6.1…31.7 ms × (0.6 + Size), gains 0.5…0.18,
panned equal-power at fixed azimuths (−70, 60, −130, 140, −25, 30) + az/2,
through a one-pole low-pass; level Room × (0.35 + 0.65 √gain) × 1.2.

4.7 Control values update every 16 samples; the delays, gain and state glide.

## 5. Module view

Top view of the listener with the source (drag to set azimuth and
distance) and a side view for elevation.

## 6. Saved state

Knobs only.

## 7. Engine requirements

None.

## 8. Tests

`tests/test_spatial_pan.cpp`: ITD value and growth with angle and head size;
head shadow level difference at 250 Hz vs 6 kHz; exact mirror symmetry; rear and
distance roll-off; Doppler pitch ratio at 34.3 m/s; Room adds reflections; wild
automation bounded.

## 9. Later

Speaker-compatible crosstalk cancellation, per-ear pinna notch variation,
a multi-source mode.
