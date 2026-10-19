# Note Looper

Type id `note-looper` · category *Sequencing/Melodic* · colour `#f28b82`

## 1. Purpose

Records the notes of a `notes` stream (not audio) for 1–16 bars and loops
them. Overdub, undo, per-pass probability, half/double speed and quantize
strength work on the stored notes.

## 2. Jacks

| Jack | Type | |
|---|---|---|
| Notes (in) | `notes` | notes to record (and pass, Thru) |
| Rec | `gate` | while patched: high Overdub, low Play |
| Notes (out) | `notes` | the input (Thru) and the loop |
| Pass | `trigger` | pulse at each pass start |
| Recording | `gate` | high in Record/Overdub |
| Phase | `control` | 0…1 over the loop |

## 3. Controls

Mode (Play, Record, Overdub), Bars (stepped 1–16), Beats Per Bar (1–8), Speed
(Half, Normal, Double), Probability, Strength (0–100 %), Quantize (Off, 1/4,
1/8, 1/16, 1/32, 1/8T, 1/16T), Thru (Pass, Mute), Seed. Buttons: Clear, Undo.

## 4. Behaviour

### 4.1 The head

Loop length L = Bars·Beats Per Bar quarter notes. Transport playing with a
valid position: head = `fmod(ppq·speed, L)` (Half 0.5, Double 2); otherwise it
advances `bpm/60/sr·speed` per sample. Head is counted in ticks (960 per
quarter note); a forward step over half a quarter note (a song-position jump,
or a loop length change) ends the loop's sounding notes and re-syncs.

### 4.2 Recording

Record and Overdub store each note-on at the head position, its length from
the note-off (capped to L, counting passes). Entering Record clears the loop;
entering Record or Overdub from Play starts a new layer. Mode Play records
nothing. 256 notes at most.

### 4.3 Playback

For every tick the head passes: first the note-offs due, then the note-ons
whose start (after Quantize: `start + (round(start/grid)·grid − start)·Strength`,
wrapped into L) falls on it. Notes at or beyond L are skipped, not deleted.
Probability: a note plays when `uniform01(Seed, pass, index) < Probability`.
Length ≥ 1 tick, < L.

### 4.4 Edit

Clear empties the loop; Undo removes the notes of the newest layer. Both end
the loop's sounding notes first.

### 4.5 Note ownership

`dsp::NoteOwner`, as in the other note-stream modules. Removing the Notes
cable ends everything sounding.

## 5. Module view

A piano-roll strip: bars and beats, notes at their pitch (older layers
paler), the head, a red frame while recording.

## 6. Saved state

Knobs and settings, and the loop as node data
`{"notes": [[start, length, note, velocity, layer], …]}` in quarter notes. The
module hands a changed loop to the board with `takeData` and loads one with
`setData`.

## 7. Engine requirements

`sanitiseData`, `takeData`, `setData` with `RtHandoff`, buttons, a lock-free
snapshot for the view and the data, `liveValues` (pos, loop, mode, count,
running), `liveArrays` (notes).

## 8. Tests

`patch/modules/note-looper/tests/test_note_looper.cpp`: record and loop,
overdub vs record, probability (repeatable), quantize, speeds, undo and
clear, position jump, free-running, held note across the wrap, shorter loop.

## 9. Later

Per-note editing in the view, a fixed end-of-take auto-switch to Play,
punch in/out by bars, multiple loop slots.
