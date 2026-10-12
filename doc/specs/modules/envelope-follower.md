# Envelope Follower

Type id `envelope-follower` · category *Modulation* · colour `#f0abfc`

## 1. Purpose

Turns the level of audio, or the movement of a CV, into a control signal with
independent attack and release, a gain, and a threshold gate. The *Level
Meter* also outputs a level, but only on a dB scale with one *Response* time;
this module is the modulation tool: linear, with two times.

## 2. Jacks

Input *In* (`audio`; control cables work, signal types are not enforced).
Outputs *Env* (`control`, bipolar), *Inverted* (`control`), *Gate*, *Trigger*.

## 3. Controls

Knobs: Attack 0–2 s (def 10 ms), Release 0–5 s (200 ms), Gain 0–8 (1),
Threshold 0–1 (0.3). Settings: Detector (Peak, RMS), Rectify (Full, Positive,
Negative, None; shown only for Peak).

## 4. Behaviour

Per sample, target `t` = |x| (Full), max(x,0) (Positive), max(−x,0) (Negative)
or x (None). With RMS, `t = x²` and the output is √state.
`state += (t − state) × (t > state ? aCoef : rCoef)` with
`coef = 1 − exp(−1 / (time × sr))`; a time of 0 (≤ 10 µs) jumps to the target.

`Env = detected × Gain`. `Inverted = clamp(1 − Env, 0, 1)`, or `−Env` for
Peak + None. The gate opens when |Env| ≥ Threshold and closes below
0.8 × Threshold; *Trigger* is high for the sample the gate opens.

No look-ahead, no latency, no state besides the detector and the gate. Output
is finite for any finite input; Attack and Release are read per sample.

## 5. Implementation

`patch/modules/envelope-follower/dsp/EnvelopeFollowerDsp.h`, tests in
`tests/test_envelope_follower.cpp` (63 % times, RMS of a sine, rectify modes,
gate hysteresis and trigger count, gain and finiteness).
