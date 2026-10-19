# Pitch Follower

Type id `pitch-follower` · category *Modulation / Followers* · colour `#34d399`

## 1. Purpose

Finds the pitch of a single voice or instrument and outputs it as V/oct, with a
gate, a confidence signal and an envelope. The *Envelope Follower* follows
loudness; this module follows pitch, so a sung line can play a synth, a bass can
drive a quantizer or a voice can steer a filter. Two stabilisers make it usable
on real material: an **Octave Guard** that resists octave jumps, and a **Vote**
that outputs the median of the last few estimates.

## 2. Jacks

Input *In* (`audio`, mono, one note at a time). Outputs *Pitch* (`pitch`, V/oct,
0 V = middle C), *Gate*, *Confidence* (`control`, 0…1) and *Env* (`control`, 0…).

## 3. Controls

Knobs: Low 30–500 Hz (60), High 200–5000 Hz (1500), Glide 0–2 s (30 ms), Hold
0–2 s (250 ms), Confidence 30–98 % (75 %), Env Release 5 ms–2 s (150 ms), Vote
(stepped: Off, 3, 5, 7, 9). Setting: Octave Guard (Off, Light, Firm; default Light).

## 4. Behaviour

The tracker is the shared `common/dsp/PitchTrack.h` (also used by Pitch Snap and
Tuner). The input is low-passed and decimated to about 24 kHz, and every 2–10 ms
(a third of the longest period looked for) a normalised difference function over
one window is searched: the first dip below the absolute threshold `1 − Confidence`
is taken (else the deepest one), refined by a parabola through three points and
turned into Hz. The *clarity* `1 − value at the dip` is the confidence. Frames
quieter than about −56 dB, or with a pitch outside Low/High, are unvoiced.

**Octave Guard.** A new estimate more than 0.4 octave away from the pitch the
tracker has settled on is not believed at once: it has to be heard again and
again, within 5 % of itself, for the guard time (Light 30 ms, Firm 80 ms). A
real leap goes through after the delay; a one-frame mistake on a strong harmonic
never does. After about 12 unvoiced frames the guard forgets the old pitch, so a
new note after a gap is not held back.

**Vote.** The result is the median, in log-frequency, of the last 3, 5, 7 or 9
accepted estimates.

**Outputs.** *Pitch* is the stabilised pitch in V/oct, glided with a one-pole of
the Glide time (at least 2 ms, which also smooths the 2–10 ms steps). While no
pitch is known it **holds** its last value; a note that starts after the gate
has closed begins at its own pitch (no glide from the old note). *Gate* opens
at the first voiced estimate and closes when none has come for Hold plus 1.5
hops. *Confidence* is the latest clarity, fading to 0 after a gap. *Env* is a
peak follower (2 ms attack, Env Release).

Latency is about one analysis window plus a hop (14 + 5 ms at Low = 70 Hz, 7 + 2
ms at 150 Hz): raise *Low* for faster tracking.

## 5. Implementation

`patch/modules/pitch-follower/dsp/PitchFollowerDsp.h` (output stage),
`patch/common/dsp/PitchTrack.h` (tracker). Tests: `common/dsp/tests/test_pitch_track.cpp`
(sines 55 Hz–2 kHz at three sample rates, saws, weak fundamentals, noise,
silence, glide, guard, vote) and `tests/test_pitch_follower.cpp` (V/oct scale,
hold, glide, gate, envelope, jitter, finiteness).
