# Melody Mirror

Type id `melody-mirror` · category *Sequencing/Melodic* · colour `#b69cf5`

## 1. Purpose

Remembers the last N notes of a `notes` stream with their timing and plays them
turned around: reversed, inverted, rotated or mirrored, or, in Answer mode, as
a reply after a pause.

## 2. Jacks

| Jack | Type | |
|---|---|---|
| Notes (in) | `notes` | the notes to listen to |
| Trig | `trigger` | plays the phrase now |
| Notes (out) | `notes` | the input (Thru) and the turned phrase |
| Playing | `gate` | high while a turned phrase sounds |
| Phrase | `trigger` | pulse when a turned phrase starts |

## 3. Controls

Mode (stepped, modulatable: Reverse, Invert, Rotate, Mirror, Answer), Reply
(Reverse, Invert, Rotate, Mirror; shown in Answer), Length (stepped 2–16),
Axis (First Note, Mean, Fixed), Axis Note (stepped 0–127), Rotate (stepped
−8…+8), Start (Trigger, After Gap), Gap (1/2 beat … 2 bars), Speed (0.25–4×),
Transpose (−24…+24), Velocity, Gate Length (25–200 %), Thru (Pass, Mute), Snap
To Scale with Root, Scale, Harmony. Buttons: Replay, Clear.

## 4. Behaviour

### 4.1 Phrase

Note-ons are stored (note, pitch, velocity, onset in samples, length from the
note-off) in a ring of 16. The phrase is the last Length notes; a note still
held counts with its length so far. In After Gap start and Answer mode only the
notes heard since the last phrase count ("fresh").

### 4.2 Turns

Onsets are relative to the first note; `end` = latest onset + length.

| Turn | Result |
|---|---|
| Reverse | onset′ = end − (onset + length), sorted; pitches unchanged |
| Invert | note′ = 2·axis − note, folded into 0…127 by octaves; times unchanged |
| Rotate | pitch and note of note *i* come from note *(i + Rotate) mod n*; times and velocities stay |
| Mirror | Reverse then Invert |

Axis: the first note played, the rounded mean, or Axis Note. Answer plays the
turn named by Reply (Answer as reply means Mirror).

### 4.3 Playback

Times divide by Speed; lengths scale by Gate Length; Transpose is added
after the turn; Snap pulls each note to the scale (Harmony bus key if valid);
velocity is scaled and kept in 0.01…1. Starting while a phrase plays drops its
unstarted notes (started ones end on schedule) and begins the new one.

### 4.4 Starting

Trigger edge or Replay: plays the last Length notes (needs at least one).
Start After Gap and Answer: when new notes were heard, none is held and Gap
has passed since the last note event, the phrase of the fresh notes starts
once. Answer ignores (does not record) input while it plays; Thru still passes
it.

### 4.5 Note ownership

`dsp::NoteOwner`: input and playback share note numbers without cutting each
other short. Removing the Notes cable ends everything sounding.

## 5. Module view

Two piano-roll strips: what it heard and what it plays now with the current
Mode; a head runs along the lower one while it plays; text shows listening /
answering.

## 6. Saved state

Knobs and settings only (the phrase is not saved).

## 7. Engine requirements

`HarmonyRole::Reader`, buttons, `liveValues` (count, playing, pos, mode,
fresh), `liveArrays` (src, out).

## 8. Tests

`patch/modules/melody-mirror/tests/test_melody_mirror.cpp`: each turn, twice
reversed/inverted = original, axes, speed/transpose/velocity/gate/snap, start
after a gap and by trigger, window length, Answer, no hanging notes.

## 9. Later

Several stored phrases, a Dorian/diatonic inversion, a swing/humanise stage.
