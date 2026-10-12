# CV to MIDI

Type id `cv-to-midi` · category *Utility* · colour `#7dd3fc`

## 1. Purpose

Four lanes that turn control signals into MIDI control changes on a `notes`
stream. The counterpart of *CV to Notes* for continuous controllers.

## 2. Jacks

Inputs *In 1–4* (`control`). Output *Notes* (`notes`): `NoteEvent::Cc`
events with `note` = controller, `value` = data / 127, `channel` 0–15.

## 3. Controls

Per lane: CC (0–127, defaults 1, 74, 71, 91), Channel (1–16), Min and Max
(data range 0–127). Global: Input Range (0…1, −1…+1), Resolution (7 bit,
14 bit), Max Rate (10–1000 per second per lane). Button: Resend. All are
settings, not knobs: a CC number or a channel that moves under a cable has no
use.

## 4. Behaviour

Per lane and sample: `u` = input (or (input+1)/2 for bipolar), NaN → 0, clamped
to 0…1; `data = Min + u × (Max − Min)` (Min above Max inverts). 7 bit: round
to an integer. 14 bit and CC < 32: `round(data × 16383 / 127)`, MSB (v ≫ 7) on
CC, LSB (v & 127) on CC + 32, both at the same sample. CC ≥ 32 stays 7 bit.

A message goes out when the quantised value differs from the last sent value
and at least `sampleRate / MaxRate` samples have passed since the last send
(1000/s: no limit). A held-back change is sent as soon as the gap is over, so
the last value always arrives. A lane's first value after it is patched, after
`reset()` and after *Resend* goes out at once. Unpatched lanes send nothing.

Events are pushed with `pushController`, so CC floods never crowd out notes.

## 5. Implementation

`patch/modules/cv-to-midi/dsp/CvToMidiDsp.h`, tests in
`tests/test_cv_to_midi.cpp`.
