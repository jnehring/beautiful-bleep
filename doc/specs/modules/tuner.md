# Tuner

Type id `tuner` · category *Utility / Metering* · colour `#a3e635`

## 1. Purpose

A chromatic tuner on the board: the note being played, how many cents it is off,
a needle, the heard and the target frequency. It also outputs the error as a CV
and an *In Tune* gate, so a patch can react to a well-tuned note (light, trigger,
open a gate) or a sound can be tuned by ear while patched.

## 2. Jacks

Input *In* (`audio`). Outputs *Cents* (`control`, −1…+1 for −50…+50 cents),
*In Tune* (`gate`), *Pitch* (`pitch`, V/oct of the smoothed frequency, held).

## 3. Controls

Knobs: Reference A 400–480 Hz (440), In Tune 1–25 ct (5), Damping 10–600 ms
(80 ms), Low 25–400 Hz (40), High 200–4000 Hz (1400). Settings: Names (Sharps,
Flats), Octave Guard (Off, Light, Firm; default Light).

## 4. Behaviour

The pitch comes from the shared tracker in `common/dsp/PitchTrack.h` (the same
core as the Pitch Follower, with a vote of 3 and confidence 0.8). The reading is
smoothed in log-frequency with the Damping time, except that a jump of more than
60 cents is shown at once, so a new note does not slide in from the old one.
The nearest note of equal temperament around the Reference A and the error in
cents (−50…+50) are computed from the smoothed value. *Cents* is the error / 50.

*In Tune* opens when the error has stayed within the In Tune window for 60 ms
and closes when it leaves 1.4 × that window (hysteresis) or when nothing has
been heard for 180 ms. The display keeps the last note, dimmed, after the sound
stops.

## 5. View

`ui/tuner.js`: note name and octave, a needle over a −50…+50 cent arc with the
In Tune window in green, the cents number, the heard frequency, the frequency of
the target note and a strip with the last five seconds of the error.

## 6. Implementation

`patch/modules/tuner/dsp/TunerDsp.h`; tests in `tests/test_tuner.cpp` (note
arithmetic, notes and cents on pure tones from 82 Hz to 1.2 kHz, the reference,
the gate, noise, change of note).
