# Strange Osc

Type id `strange-osc` · category *Sources/Oscillators* · colour `#f472b6`

## 1. Purpose

An oscillator whose waveform is the orbit of a continuous chaotic system.
Four attractors, pitch by time-scaling, a *Tame* knob that moves a
bifurcation parameter toward periodic behaviour, X/Y/Z outputs, a seeded
start state, audio and control ranges and an external force input.

## 2. Jacks

| Jack | Type | Direction | Notes |
|---|---|---|---|
| Pitch | pitch | in | 1 V/oct, 0 = C4 |
| Reset | trigger | in | back to the seed's start |
| Force In | audio | in | added to x′ × Force |
| Out | audio | out | blend of X/Y/Z, Tone, Level |
| X, Y, Z | control | out | normalised state, about ±1 (clamped ±1.5) |
| Flip | gate | out | X > +0.1 high, X < −0.1 low |

## 3. Controls

Pitch (st), Fine (ct), Tame, Mix, Force, Tone, Level are modulatable;
Attractor (Lorenz, Rossler, Thomas, Halvorsen), Range (Audio, Low ÷64,
Slow ÷4096) and Seed (0–999) are settings.

## 4. Behaviour

4.1 State and integration. s′ = f(s; p) with p = p₀ + (p₁ − p₀)·Tame. RK4 in
double; per sample the time step is dτ = f_hz / (rate(Tame) · sampleRate),
split into at most 24 sub-steps of at most the system's stable step.
`rate` (zero crossings of the mean per time unit) is measured at both ends
of Tame and interpolated.

4.2 Systems (p₀ → p₁): Lorenz ρ 28 → 160; Rossler c 5.7 → 3.0; Thomas
b 0.17 → 0.32; Halvorsen a 1.89 → 3.0. Centre and half-range per axis were
measured at both ends and interpolated, so outputs stay about ±1.

4.3 Seed. Start = nominal point + ±10 % of the half-range by `uniform01(seed)`;
4000 RK4 steps settle it onto the attractor; the result is cached per
(attractor, seed) and restored on reset and on a trigger in *Reset*.

4.4 Force: x′ += Force × ForceIn × rate × halfX.

4.5 A non-finite or runaway state (|s|₁ > 1e5) rebuilds the start state.

## 5. Module view

Phase portrait (X over Y with a fading trail, the head as a dot) and X/Y over
time. Layout: Pitch (Attractor, Range, Pitch, Fine), Chaos (Tame, Force,
Seed), Output (Mix, Tone, Level).

## 6. Saved state

Knobs only.

## 7. Engine requirements

None.

## 8. Tests

`tests/test_strange_osc.cpp`: bounded and finite for every system, Tame and
rate; exact repeat for one seed, divergence for another; pitch tracking at
Tame 100 % (Rossler within 5 % at 110, 440, 1760 Hz); Tame raises
periodicity; Force changes the orbit.

## 9. Later

More systems (a forced pendulum, a double scroll), a Poincare-section output,
stereo from two coupled copies.
