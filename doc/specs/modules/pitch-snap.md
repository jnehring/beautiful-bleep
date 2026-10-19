# Pitch Snap

Type id `pitch-snap` · category *Effects / Movement* · colour `#f472b6`

## 1. Purpose

A real-time pitch corrector for a voice or a single instrument. It tracks the
input pitch, picks the nearest note of a scale (its own, or the board's harmony
bus) and shifts the sound toward it, anywhere from hard to natural, by any
amount. Its own idea is **Drift**: instead of flattening every wobble, it can
correct the *average* pitch and let the fast movement around it, the vibrato,
through. A **Target** output tells the rest of the patch which note it is aiming at.

## 2. Jacks

Inputs *In* (`audio`, mono) and *Offset* (`pitch`, V/oct, added to the target in
semitones: 1 V = 12 st). Outputs *Out* (`audio`), *Target* (`pitch`, V/oct of the
note aimed at including the offset, held while nothing is heard), *Pitch* (`pitch`,
the detected input pitch, held) and *Shift* (`control`, the applied shift in
octaves).

## 3. Controls

Correction: Amount 0–100 % (100), Speed 0–100 % (85; 100 = hard), Drift 0–100 % (0),
Drift Time 50 ms–1 s (300 ms), Offset ±24 st (0), Formant Preserve (on).
Notes: Root, Scale (the 17 scales of `Scales.h`), Harmony (Off, Bus A–D),
Target (Scale, Chord, Chord + Scale; shown with a bus). Tracking: Low 30–400 Hz
(70), High 200–2000 Hz (900), Tracking (Fast, Steady, Rock Solid), Latency
(Aligned, Quick).

## 4. Behaviour

**Notes.** With Harmony Off the allowed notes are Scale in Root. With a bus that
carries a valid harmony they are the bus's scale, its chord tones, or chord tones
within a semitone with the scale otherwise. The note is chosen from the input
pitch smoothed over 60 ms (so vibrato does not flip it), with 0.2 st of stickiness:
the current note stays until another one is clearly closer.

**Correction.** `want = Amount × (note − reference)` in semitones, where the
reference is the input pitch (smoothed over 2 ms) blended with its average over
Drift Time by Drift. The applied shift `corr` follows `want` with a one-pole of
`0.6 s × (1 − Speed)²` (hard at Speed 100 %). A new voiced section starts with
`corr = 0`. The Offset (knob + 12 × CV, semitones) is added after the correction.

**Shifting.** The tracker (`common/dsp/PitchTrack.h`, Tracking sets its guard and
vote) gives the input period `Tin`. Grains of two periods, Hann-windowed, are laid
down one output period `Tout = Tin / ratio` apart; each is cut from the input a
whole number of input periods after the one before (skipping or repeating a
period when the read position has to catch up), so the grains line up and add
without a seam. With Formant Preserve the grains are copied as they are, so the
vowel does not move with the pitch; without it each grain is resampled by the
ratio. Amplitude is corrected for the grain density; the shift is limited to
±2 octaves. Where nothing pitched has been heard for 45 ms the input passes
through, delayed to match, with 6 ms / 20 ms crossfades.

**Latency.** *Aligned* delays the audio by the tracker's lag so a correction lands
on the audio it was measured on (flattening a 5.5 Hz vibrato to under a quarter
of its depth); latency is about the tracker window plus a grain (20–30 ms at
Low = 70 Hz, 12 ms at 150 Hz). *Quick* cuts grains at the freshest input
(about 1.5 periods) and lets fast vibrato through partly uncorrected.

## 5. Implementation

`patch/modules/pitch-snap/dsp/PitchSnapDsp.h`; tests in `tests/test_pitch_snap.cpp`
(pitch within 6 cents after correction at five pitches, scale choice, amount, speed,
drift depth against a 5.5 Hz vibrato, offset, both formant modes on a saw, noise
passthrough, finiteness).
