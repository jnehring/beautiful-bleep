# Note Gate

Type id `note-gate` · category *Sequencing/Melodic* · colour `#e0a458`

## 1. Purpose

A filter, remapper and velocity shaper for a `notes` stream, with a gate
input and rule lanes. Decides per note-on whether it passes and what it
becomes; note-offs follow their note-on.

## 2. Jacks

| Jack | Type | |
|---|---|---|
| Notes (in) | `notes` | the stream; controller events pass |
| Gate | `gate` | opens/closes the gate (unpatched: open) |
| Notes (out) | `notes` | notes that passed |
| Passed | `trigger` | 2 ms pulse per passed note-on |
| Blocked | `trigger` | 2 ms pulse per stopped note-on |

## 3. Controls

Range: Low Note, High Note (stepped 0–127), Window (Pass Inside, Block
Inside). Velocity: Floor, Ceiling (0–100 %), Below Floor (Drop, Lift), Curve
(Knob, Drawn), Bend (−100…+100 %, with Curve Knob). Remap (Off, On). Gate
Input (Pass When High, Block When High). Rules: Step Lane (Off, On), Beats Per
Bar (1–8), Every Nth (1–8), Nth Offset (0–7), Density Limit (0 off–16),
Density Window (1 beat, 2 beats, 1 bar, 2 bars).

## 4. Behaviour

### 4.1 Order of checks

Gate → range (reversed Low/High still make a window) → velocity floor (Drop
or Lift) and ceiling → rule lanes → remap → velocity curve. The first
failure stops the note.

### 4.2 Rule lanes

- Step lane: step = round(position in the bar · 16) mod 16, the bar being
  Beats Per Bar quarter notes of the song position; the note passes if the
  step is lit. Without a valid song position the lane passes everything.
- Every Nth: counts the note-ons that reached the lane; passes when
  `count mod N == Offset (mod N)`.
- Density: passed note-ons are remembered; a note is stopped when `Limit`
  notes passed within the window (beats at the transport tempo).

### 4.3 Remap and curve

Remap sends pitch class *p* to `remap[p]` of the same octave (−1 blocks).
Curve Knob: `v^(2^(−2·Bend))`; Drawn: linear interpolation of 17 points. Output
velocity is at least 0.008.

### 4.4 Note-offs

`dsp::NoteOwner` tokens per input note: an off is sent only for a note that
passed and only while it still owns its output number. Two inputs remapped to
one number retrigger instead of cutting each other. Removing the Notes cable
ends everything.

## 5. Module view

Remap table (twelve keys, click to cycle target, shift-click back, right-click
reset, last stop blocks), velocity curve editor with the last passed velocity,
sixteen-step lane with the step of the last note.

## 6. Saved state

Node data: `remap` (12 ints −1…11), `curve` (17 floats), `steps` (16 flags).

## 7. Engine requirements

`sanitiseData`, `setData` with `RtHandoff`; `liveValues`: passed, blocked,
why, step, open, lastvel.

## 8. Tests

`patch/modules/note-gate/tests/test_note_gate.cpp`: range, floor/ceiling/lift,
curve (knob and drawn), remap and collisions, gate input, step lane, every
Nth, density, no hanging notes.

## 9. Later

Per-pitch-class velocity trims, a chance lane, a rule lane driven by a
pattern from the Gate Sequencer.
