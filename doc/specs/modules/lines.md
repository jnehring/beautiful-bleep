# Lines

Type id `lines` · category *Sequencing* · colour proposal `#e0856a`

## 1. Purpose

A four-track text tracker. A pattern is 16–64 rows; a cell holds a note, a velocity, a gate length and an
effect (retrigger, slide, probability, transpose, jump, skip). An order list chains up to 32 patterns.
Every track has its own speed multiplier and length, so the tracks drift against each other and realign
after a computable number of rows. Each track has *Notes* plus pitch, gate and velocity CV.

## 2. Jacks

**Inputs**: *Clock* (`trigger`, one master row per pulse), *Reset* (`trigger`), *Transpose* (`pitch`).

**Outputs**: per track *k* = 1…4: *Notes k* (`notes`), *Pitch k* (`pitch`), *Gate k* (`gate`),
*Velocity k* (`control`); then *Pattern* (`trigger`), *End* (`trigger`), *Row* (`control`).

## 3. Controls

Knobs: Gate (5–100 % of a row), Velocity (5–100 %), per track Speed (stepped: ¼, ⅓, ½, ⅔, ¾, 1, 3⁄2, 2, 3, 4)
and Length (stepped, 1–64).
Settings: Row Rate, Tracks (Free-run / Per pattern), per track Octave and Mute, Root, Scale, Quantize,
Harmony, Seed, Sync To.

## 4. Behaviour

### 4.1 Data

`patterns[16]`: `rows` 16–64 and `tracks[4]`, each a sparse list of cells
`[row, note, velocity, gate, effect, parameter]`. Note 0 empty, 1–127 MIDI, 128 note off; velocity 0 = setting, else 1–127;
gate 0 = setting, else 1–15 eighths of a row; effect 0 none, 1 R, 2 S, 3 P, 4 T, 5 J, 6 K; parameter 0–255.
`order`: 1–32 pattern numbers. A fresh module holds a small three-track pattern.

### 4.2 Master position

Transport: `x = ppq / rowBeats − origin` (Reset: the next row boundary is the origin; silent until then); Clock:
`x = pulses + sinceClock / period` (Reset: the next pulse is 0). Master row `m = floor(x)`. A jump (m not equal to last or
last + 1) releases all notes and restarts the tracks without catching up. The order list is cut at cumulative row counts of
its patterns; `m mod total` selects the order entry and the row in the pattern. *Pattern* pulses when the entry or cycle
changes, *End* when entry 0 starts again. *Row* is the (fractional) master row divided by the pattern's rows.

### 4.3 Tracks

Track *k* has a counter `s = floor(q · speed)` with `q = x` (Free-run) or the position inside the pattern (Per pattern; offsets
and counters restart with each pattern). Whenever `s` changes the track plays row `mod(s + offset, min(length, rows))`. Speed changes
within a pattern are therefore phase-locked to the song position. Jump sets `offset` so that the next row is the target; Skip adds
to `offset`. All tracks realign after the least common multiple of their cycle lengths (`length / speed`, rational), which the view shows.

### 4.4 Notes

Each track is monophonic. A new note ends the previous one (note-off, then note-on; the gate dips for a sample) unless the cell has *Slide*, in which
case the note-on comes first and the old note-off follows on the same sample (legato) and the *Pitch* output glides over
`parameter/255 · 4 rows`. A note lasts `gate · row` samples; an empty cell leaves the sounding note alone; a note-off cell ends it.
*Retrigger* n = clamp(parameter, 2, 16) plays n evenly spaced notes in the row, each sounding `min(gate, 1)` of its share.
*Probability* skips the cell when `uniform01(seed, s·4+k) · 255 ≥ parameter`. *Transpose* adds the signed parameter in semitones.
Pitch: note + 12·track octave + round(Transpose input · 12), optionally quantised to the scale or harmony bus, clamped to 0–127.
Muted tracks play nothing. Stopping the transport or a Reset ends all notes.

## 5. Module view

The tracker grid (row numbers; per track Note, Vel, Gate, Fx, two parameter digits), keyboard entry with piano keys and hex digits, the
cursor, per-track playheads and a highlight for the master row, track headers with speed and length that mute on click, a
pattern selector with row count, octave and step, Duplicate/Clear, the order list as chips, and a drift panel with a ring per track
and the realignment length.

## 6. Saved state

```json
{ "pattern": 0, "octave": 4, "edit": 1, "order": [0],
  "patterns": [ { "rows": 16, "tracks": [ [[0, 36, 112, 6, 0, 0]], [], [], [] ] }, … 16 ] }
```

## 7. Engine requirements

Node data with `RtHandoff`, harmony reader role, several `notes` outputs, `liveValues` (`order`, `pattern`, `row`,
`row0…3`, `on0…3`), stepped knobs and toggles.

## 8. Tests

`modules/lines/tests/test_lines.cpp`: row timing and gate share; gate and velocity columns; note off; mute; octave and transpose;
speed multiples; lengths 3 and 4 realigning after 12 rows; retrigger count and spacing; slide event order; probability extremes and
seeded repeatability; transpose; jump; skip; the order list with Pattern and End pulses; Free-run against Per pattern; Clock mode and Reset;
stop and jump leave no hanging notes.

## 9. Later

Per-track effect columns beyond one, pattern-local speeds, a note-on-row copy/paste block.
