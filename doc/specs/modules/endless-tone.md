# Endless Tone

Type id `endless-tone` · category *Sources/Generators* · colour `#38bdf8`

## 1. Purpose

A rising/falling tone illusion generator: octave-spaced partials under a
fixed log-frequency window that glide together.

## 2. Jacks

Inputs: Pitch (pitch), Reset (trigger). Outputs: Out L, Out R (audio), Loop
(control 0–1), Wrap (trigger).

## 3. Controls

Pitch, Fine, Rate (0–2 oct/s), Direction (−1…+1), Width, Count (stepped
6–12), Timbre, Spread, Phase, Level — all modulatable.

## 4. Behaviour

4.1 Position. total = φ + Phase with φ += Rate × Direction / sampleRate. Partial
k sits at pos = k + frac(total), i.e. at centre × 2^(pos − Count/2).

4.2 Window. w(pos) = exp(−½ ((pos − N/2)/σ)²) × sin²(π pos / N) for 0 < pos < N,
else 0; σ = 0.6 + Width × 0.35 N. A constant normalisation (from the sum of
the window at pos offsets 0 and ½) keeps the level steady (within 0.5 dB in the test).
Partials above 0.45 × sampleRate are silenced. Amplitudes are smoothed over 2 ms.

4.3 Wrap. Whenever floor(total) changes, the oscillator phases and amplitudes
are rotated by one slot (up: slot k takes slot k−1's; down: k+1's) so each
partial continues where its frequency now sits; the partial that wraps is at
window zero. A phase jump of several octaves rotates that many times.

4.4 Partial = sine blended to a band-limited saw (PolyBLEP) by Timbre. Alternate
partials are panned ± Spread/2 with equal sum. Loop = frac(total); Wrap is one
sample.

## 5. Module view

The window curve over the octave axis with a line per partial at its live
position.

## 6. Saved state

Knobs only.

## 7. Engine requirements

None.

## 8. Tests

`tests/test_endless_tone.cpp`: the partial glides at Rate (peak tracking up and
down); no sample-to-sample jump across wraps for speeds, widths, timbres and
counts; steady RMS; Loop and Wrap behaviour, Rate 0, Phase; Spread; extremes
finite.

## 9. Later

Independent left/right rates, formant-style window shapes, a "frozen
cluster" mode.
