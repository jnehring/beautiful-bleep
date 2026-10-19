# Note Echo

Type id `note-echo` · category *Sequencing/Melodic* · colour `#7dd3c0`

## 1. Purpose

A note-stream effect: each note-on of a `notes` stream is followed by up to 16
repeats, later, softer and moved along the board's scale. Unlike an audio
delay the repeats are notes, so they can change pitch, be dropped, fan into
chord tones and be pulled to a grid. Notes out play a Voice Cell.

## 2. Jacks

| Jack | Type | |
|---|---|---|
| Notes (in) | `notes` | the notes to echo; controller events pass through |
| Notes (out) | `notes` | original (unless muted) and repeats |
| Tap | `trigger` | 2 ms pulse at every repeat that starts |

## 3. Controls

Knobs (modulatable): Repeats (stepped 1–16, 4), Time (10 ms–2 s, 250 ms, only
with Rate Free), Decay (0–90 %, 30 %), Scale Steps (stepped −7…+7, 0), Drop
(0–100 %), Length (5–98 %, 50 %), Spread (0–100 %), Gravity (−100…+100 %).

Settings: Rate (Free, 1/1…1/32T; 1/8), Fan (Up, Down, Up-Down, Random), Grid
(1/4, 1/8, 1/16, 1/32; 1/16), Original (Pass, Mute), Seed (0–999), Root,
Scale, Harmony (Off, Bus A–D). Root/Scale are ignored while the chosen bus
publishes a key.

## 4. Behaviour

### 4.1 Planning

At a note-on the module reads its knobs (at that sample) and schedules every
repeat. Spacing is `Rate` in quarter notes at the transport tempo, or Time in
seconds. Repeat *k* (1…Repeats):

- velocity `v·(1−Decay)^k`; the train ends when it falls under 0.004;
- dropped when `uniform01(Seed, noteCount, k) < Drop`;
- pitch: scale walk of `Scale Steps·k + 2·tone` scale steps (`dsp::scaleWalk`),
  `tone` from the fan; a chromatic scale uses semitones, and chord-tone offsets
  {0, 4, 7, 11, 14} for Spread; repeats outside MIDI 0…127 are skipped;
- length `min(Length, 0.98)·spacing`, so a repeat ends before the next starts.

The detune of the played note carries over (pitch = pitch + Δnote/12).

### 4.2 Spread and Fan

`n = 1 + floor(4·Spread)` tones (1 = off). Tone *t* is a stack of thirds in
the scale: *2t* scale steps above the played note. Fan chooses the tone of
repeat *k*: Up `k mod n`, Down `(n − k mod n) mod n`, Up-Down a ping-pong of
period `2n−2`, Random `hash(Seed, noteCount, k) mod n`. The played note is
tone 0, so repeats continue the arpeggio from it.

### 4.3 Gravity

With the song position valid, repeat *k*'s time `b = ppq + k·spacing` (quarter
notes) moves by `|Gravity|` of the way to a target: for Gravity > 0 the nearest
grid line, for Gravity < 0 the nearest midpoint between two lines. Times stay
increasing. Without a valid position Gravity does nothing.

### 4.4 Notes of the same number

`dsp::NoteOwner`: a note-on of a number that sounds ends it first
(note-off, note-on); a note-off only ends the note-on it belongs to. The
original's note-off therefore never ends a repeat of the same pitch.

### 4.5 Housekeeping

Removing the Notes cable ends everything sounding and forgets pending
repeats. Pending repeats keep running when the transport stops (they are
counted in samples). At most 256 events wait; further repeats are skipped.
Output buffer nearly full: repeats wait one more sample.

## 5. Module view

A strip drawing the repeat train for the current knobs (height = velocity,
row = scale steps and fan, position = time with Gravity, faint = may drop) and
a flash for every repeat played.

## 6. Saved state

Knob and setting values only.

## 7. Engine requirements

`HarmonyRole::Reader`; `liveValues`: `pending`, `sounding`, `hits`.

## 8. Tests

`patch/modules/note-echo/tests/test_note_echo.cpp`: spacing and decay,
free time, scale walk up/down/chromatic, out-of-range repeats, Drop (all, half,
seeded), Spread fans (Up, Down, Up-Down), Gravity to and off the grid, muted
original, same-number note-offs, flush.

## 9. Later

Per-repeat panning/CC lanes, a pitch-bend shaped glide between repeats,
feedback from the output back into the input of the same module.
