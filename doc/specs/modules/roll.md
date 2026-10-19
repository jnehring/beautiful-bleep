# Roll

Type id `roll` · category *Sequencing* · colour proposal `#7cc4a4`

## 1. Purpose

A note-based sequencer with free-length notes: each note has its own start,
length, pitch, velocity, chance and ratchet count, notes may overlap, and a
pattern is 1–8 bars long. Eight pattern slots can be switched or *morphed*
note by note. *Notes* plays a Voice Cell polyphonically; mono CV outputs follow
the lowest, the highest and the latest sounding note.

It differs from the step-based sequencers in that nothing snaps to a step
count: notes sit on a 96-ticks-per-beat grid (the editor's *Snap* is only an
editing aid), and any number of them can sound at once.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Clock | `trigger` | Each pulse advances the playhead by *Clock Step* ticks. Unpatched: the transport. |
| Reset | `trigger` | Playhead to the start of the loop region, all notes end. |
| Transpose | `pitch` | Added to every note (rounded to semitones at the note's start). |
| Pattern | `control` | 0–1 over the eight slots; when patched it replaces the *Slot* knob. |

**Outputs**: *Notes* (`notes`); *Low*, *High*, *Last* Pitch (`pitch`) and Gate (`gate`);
*Velocity* (`control`); *Trigger*, *Loop* (`trigger`); *Position* (`control`).

## 3. Controls

Knobs: Morph, Humanise, Length (10–200 %), Swing (50–75 %), Slot (1–8, stepped), Morph To (1–8, stepped).
Settings: Speed (¼ … ×4), Clock Step, Root, Scale, Octave, Quantize, Harmony, Slot Change, Seed, Sync To.
Ranges and defaults are in the module's manual.

## 4. Behaviour

### 4.1 Data model

Per slot: `bars` (1–8), a loop region `[start, end)` in ticks (96 per beat, 384 per
bar) and up to 256 notes `[start, length, pitch, velocity, chance, ratchet]`:
start 0 … bars·384−1, length ≥ 1 (clipped to the pattern end), MIDI pitch 0–127, velocity 1–127,
chance 0–100, ratchet 1–8. Notes are sorted by start, then pitch, on loading.
Fresh modules hold a four-note line in slot 1.

### 4.2 Timing

The playhead is a tick count `n`. *Transport mode*: `n = floor(ppq · 96 · speed) − origin`, a pure
function of the song position, so loop jumps and renders land on the same tick; a jump releases all
notes and plays the new tick. *Reset* sets the origin to the current tick. *Clock mode*: each pulse
plays `Clock Step` consecutive ticks, the first of them on the pulse's sample; a tick lasts
`pulse period / ticks per pulse` samples. The position in the pattern is
`loopStart + mod(n − base, loopEnd − loopStart)`. A note starts when the position equals its start.

### 4.3 Voices

A note becomes one voice (a ratchet of *r* becomes *r* voices spaced evenly over the length, each
sounding 75 % of its share). A voice has a delay (humanise, swing, ratchet offset), a length in
samples (`length · Length · samples per tick`) and ends by itself. At most 48 voices; further ones
are dropped. A note-on for a pitch that still sounds restarts it (note-off, note-on on one sample);
the older voice then ends silently, so note-ons and note-offs always pair up.

*Humanise* delays a note by up to 30 ms · amount and varies velocity by up to ±25 % · amount.
*Swing* delays notes starting on an odd sixteenth by the Step Sequencer's swing share of a sixteenth.
*Chance* and the humanise draws come from `uniform01(seed, loopCount·4096 + noteIndex, stream)`.

### 4.4 Mono outputs

Low/High: the lowest/highest sounding note (a tie goes to the later one); Last: the latest started.
Each gate is high while the output's note sounds and drops for one sample when another note takes the
output over; pitch holds when nothing sounds. *Velocity* holds the latest note's velocity.

### 4.5 Slots, Ghost and Morph

The playing slot is *Pattern* (floor(x·8)) or *Slot*. A change applies *Immediately*, on the next bar line
of the playing pattern or at its loop end; the new slot then starts at its loop start (except
*Immediate*, which keeps the position). The previous slot is remembered for the view's ghost.

Morph *m* (quantised to 1/64) between A (playing) and B (*Morph To*): notes are paired by index in the
sorted order; a pair becomes one note with start, length, pitch, velocity and chance interpolated and the
ratchet taken from the nearer slot. Unpaired notes of A play if `uniform01(seed, i, 21) < 1−m`, those of B if
`uniform01(seed, i, 22) < m`. At *m* = 0 the playing notes are slot A unchanged. The blended list is
rebuilt on the audio thread when slot, target or the quantised amount changes (no allocation, ≤256 notes).

### 4.6 Pitch

`pitch + 12·Octave + round(Transpose·12)`, optionally quantised to Root/Scale (or the harmony bus) around
the root, clamped 0–127.

## 5. Module view

A piano roll: key column, rows shaded with the scale (the harmony bus's scale if one is followed), the
notes with ratchet marks and chance labels, a ruler with the loop region, the playhead, a lane for
velocity / chance / ratchet, slot buttons (editing, playing, previous), bars, snap, ghost toggle, and the
tools Double, Copy →, Dice, Clear and Fit. The ghost slot is drawn as faint blocks, the Morph target as
dashed outlines. Draw, move, resize, delete with the pointer; arrows and Delete from the keyboard.

## 6. Saved state

```json
{ "slot": 0, "grid": 24, "ghost": true,
  "slots": [ { "bars": 2, "loop": [0, 768], "notes": [[0, 36, 60, 100, 100, 1]] }, … 8 ] }
```

`sanitiseData` clamps everything, sorts notes and always returns eight slots.

## 7. Engine requirements

Node data with `RtHandoff`, the harmony reader role, `liveValues` for the view (`pos`, `slot`, `prev`,
`voices`, `root`, `mask`), stepped integer knobs. No new engine features.

## 8. Tests

`modules/roll/tests/test_roll.cpp`: note timing and lengths; octave/transpose; repeat and loop count;
loop region; jump and stop leave no hanging notes; overlapping notes with the low/high/last outputs and the
retrigger dip; the same pitch twice; ratchet count and spacing; seeded chance; humanise bounds and repeatability;
swing; Morph at 0, ½, 1 and for unpaired notes; slot change at the bar and immediately; the Pattern input;
Clock mode and Reset.

## 9. Later

Per-note pitch bend lanes, a selection copy/paste, other time signatures.
