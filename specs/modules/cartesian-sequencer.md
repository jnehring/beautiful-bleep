# Cartesian Seq

Type id `cartesian-sequencer` · category *Sequencing* · colour proposal `#e8c547`

## 1. Purpose

A two-dimensional sequencer: a grid of up to 8 × 8 cells, each holding a gate,
a pitch, a velocity and a modulation value. Two playheads move through it: one
along the rows (X) and one along the columns (Y), each with its own rate or
clock and direction, so short patterns combine into long, slowly shifting
ones. In *Cartesian* mode the *X* and *Y* knobs (and anything patched onto
them) pick the cell directly, turning an LFO, an XY gesture or another
sequencer into a melody. *Notes* plays a Voice Cell; *Pitch*, *Gate*,
*Velocity* and *Mod* drive anything else.

Unlike the Step Sequencer (one line of up to 32 steps with ties, variation and
a randomizer), the Cartesian Seq is about **navigation**: the same 16 or 64
cells give very different melodies depending on how the playheads move, and
cells can be removed from the path without deleting them.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| X Clock | `trigger` | Each pulse moves the X playhead one column. Unpatched: X follows the transport at *X Rate*. |
| Y Clock | `trigger` | Each pulse moves the Y playhead one row. Unpatched: Y follows *Y Rate* (which may be *Wrap*, see 4.2). |
| Reset | `trigger` | Both playheads return to their first cell (see 4.2). |
| Transpose | `pitch` | Added before quantizing, sampled at each cell start (as in the Step Sequencer). |

Every knob is also an input (`specs.md` section 7.3). In particular *X* and *Y*
are the position inputs of *Cartesian* mode: patch a `control` signal onto them.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Notes | `notes` | One note per played cell, with velocity; ties become legato. |
| Pitch | `pitch` | The current cell's quantized pitch, 1 V/oct. Holds between cells. |
| Gate | `gate` | High for *Gate Length* of each played cell; high across ties. |
| Velocity | `control` (unipolar) | The current cell's velocity, 0–1. Holds. |
| Mod | `control` (bipolar) | The current cell's modulation value, −1…+1, through *Mod Slew*. Updates on every cell, also on gate-off cells. |
| Trigger | `trigger` | A pulse when a cell starts a new note. |
| X Pos | `control` (unipolar) | Column / (Columns − 1); 0 for one column. |
| Y Pos | `control` (unipolar) | Row / (Rows − 1); 0 for one row. |
| Row End | `trigger` | A pulse when the X playhead wraps. |
| Grid End | `trigger` | A pulse when the whole path wraps (both playheads back at their first cell, or the raster path at its start). |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Gate Length | 1–100 % of a cell | 50 % | Length of each gate. Ties ignore it. |
| Swing | 50–75 % | 50 % | Delays every second X step (Transport and Clock modes). |
| X | 0–100 % | 0 % | *Cartesian*: picks the column. *Clocks*: shifts the X playhead by `floor(X · Columns)` columns. |
| Y | 0–100 % | 0 % | The same for rows. |
| Mod Slew | 0–1 s (curved: fine at the low end) | 0 s | Glide time of the *Mod* output between cells. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Columns | 1–8 | 4 |
| Rows | 1–8 | 4 |
| Mode | Clocks, Cartesian | Clocks |
| X Rate | 1/1, 1/2, 1/4 … 1/32 straight, dotted and triplet | 1/16 |
| Y Rate | Wrap, Off, and the same values as X Rate | Wrap |
| X Direction | Forward, Backward, Ping-Pong, Random | Forward |
| Y Direction | Forward, Backward, Ping-Pong, Random | Forward |
| Sample | Clock, Change (Cartesian mode only) | Clock |
| Root, Scale, Octave | as the Step Sequencer | C, Major, 0 |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Cells and layers

The grid always stores 8 × 8 = 64 cells; *Columns* and *Rows* limit the
playing area, the rest keeps its data. Each cell has:

- **Gate:** Off, On or Tie (same meaning as the Step Sequencer, 4.4 there).
- **Pitch:** −24…+36 semitones above *Root* + *Octave*.
- **Velocity:** 1–127.
- **Mod:** −100…+100 %, the value of the *Mod* output.
- **Access:** *Play* or *Skip*. A skipped cell is taken out of the path (4.3); its data stays.

Pitch, quantizing and the scale table are shared with the Step Sequencer
(`patch/common/dsp/Scales.h`): `quantize(Root + Octave·12 + pitch + Transpose·12)`.

### 4.2 Timing: Clocks mode

Each axis has its own step counter, `nx` and `ny`.

- **X, Transport** (X Clock unpatched): `nx = floor(ppq / xLen)`, `xLen` the
  length of *X Rate* in quarter notes — phase-locked to the bars like the Step
  Sequencer, including after a loop jump.
- **X, Clock** (X Clock patched): `nx` counts pulses; step duration for Gate
  Length and Swing is the time between the last two pulses (fallback: 1/16 at
  120 BPM).
- **Y, Wrap**: Y moves one row each time X wraps. In Transport mode
  `ny = floor(nx / cycleX)`, where `cycleX` is the length of one X cycle
  (Columns; `2·Columns − 2` for Ping-Pong; Columns for Random). This is a
  *raster* scan: row by row through the grid.
- **Y, a note value**: `ny = floor(ppq / yLen)`, independent of X. With
  4 columns at 1/16 and Y at 1/4·, X cycles every quarter while Y changes every
  dotted quarter, so the 16-cell grid plays a pattern that repeats after 3 bars.
- **Y, Clock** (Y Clock patched): `ny` counts pulses, whatever *Y Rate* says.
- **Y, Off**: Y stays on the row chosen by the *Y* knob.

A cell plays when **either** axis moves. If both move on the same sample,
the cell plays once, at the new (x, y). Swing applies to X steps only; Y steps
landing between X steps play unswung.

Each counter is mapped through its axis *Direction*: *Forward*
`i = n mod N`, *Backward* `N − 1 − (n mod N)`, *Ping-Pong* (ends not
repeated), *Random* (`hash3(Seed, n, axis)` from `patch/common/dsp/Random.h`,
never the same index twice in a row for N > 1). Then the *X* / *Y* knob offset
is added modulo N, so modulating X rotates the row while it plays.

**Reset.** As the Step Sequencer: in Clock mode the next pulse plays index 0 on
both axes; in Transport mode the grid re-anchors so that the next X boundary is
column 0, row 0. A Reset on the same sample as a clock plays (0, 0).

### 4.3 Skipped cells

Skipping must keep the module phase-locked, so it is defined on the counters,
not on wall time:

- **Raster (Y = Wrap):** the path is the list of cells in scan order (each row
  in X Direction, rows in Y Direction), with skipped cells removed. With `K`
  cells left, the cell played is `path[n mod K]` — skipping a cell shortens the
  pattern by one step and nothing is played twice. *Grid End* fires when
  `n mod K` returns to 0. Random direction draws from the remaining K.
- **Independent axes:** both axes keep their own count. If (x, y) is skipped,
  the module plays the next playing cell in X Direction within the same row
  (wrapping). If the whole row is skipped, nothing plays and the Gate stays low.
- **Cartesian:** a skipped cell is unreachable; the position selects the
  nearest playing cell (distance in cell units, ties to the lower row, then the
  lower column).
- All cells skipped: the module is silent and *Pitch* holds.

### 4.4 Timing: Cartesian mode

`col = floor(clamp(X, 0, 0.9999) · Columns)`, same for rows. *X* and *Y* are
the knob values plus their cables (`specs.md` 7.3), so a bipolar LFO with
amount 50 % on a knob set to 50 % sweeps the full grid.

- **Sample = Clock:** the position is read at each X step (X Clock pulse or X
  Rate boundary) and that cell plays. Y Rate and Y Clock are ignored.
- **Sample = Change:** a cell plays whenever the position enters a new cell.
  To avoid chatter, a new cell is entered only when the position passes
  10 % of a cell width beyond the border (hysteresis). At most one new cell per
  1 ms. Gate Length is relative to the X Rate step in this mode.

When the transport stops, Cartesian *Change* mode keeps playing (it needs no
clock) — useful for live XY performance; Clock mode follows the transport.

### 4.5 Gates, ties and notes

As the Step Sequencer (4.4 there): ties are legato (new note-on before the old
note-off on the same sample), a tie into an Off cell ends at that cell's start,
and no note is ever left hanging: changing Columns, Rows, Mode, a cell's Gate
or Access, Reset, transport stop and removing the module all end the sounding
note. A tie whose "next" cell depends on a CV is resolved when that cell is
known: the note holds until the next cell starts.

## 5. Module view

```
 ┌──────────────────────────────────────────────────────────────┐
 │ Layer: [Gate] [Pitch] [Vel] [Mod] [Access]   [Randomize ▾]   │
 │        1     2     3     4                                   │
 │  1  ┌─────┬─────┬─────┬─────┐ ◀ ▶  (rotate row)              │
 │     │ C4 ■│ E4 ■│ G4 ━│ —  □│                               │
 │  2  ├─────┼─────┼─────┼─────┤                               │
 │     │ D4 ■│ ╳   │ A4 ■│ C5 ■│     ╳ = skipped               │
 │  3  ├─────┼─────┼─────┼─────┤                               │
 │     │ …   │ …   │[F4]■│ …   │     [ ] = playhead             │
 │  4  └─────┴─────┴─────┴─────┘                               │
 │      ▲ ▼ rotate column            ⊕ crosshair = X/Y position │
 └──────────────────────────────────────────────────────────────┘
```

- Cells are 56 px squares; the visible grid follows Columns × Rows (cells
  outside are hidden, not dimmed; a *Show all* toggle reveals the full 8 × 8).
- Every cell always shows its note name, a gate glyph, a velocity bar along
  the bottom and a mod tint in the corner. The **Layer** buttons choose what a
  drag edits: Gate (click cycles Off → On → Tie, drag paints), Pitch and
  Velocity and Mod (vertical drag on a cell; scale snap, Shift for semitones
  or fine), Access (click toggles; skipped cells draw crossed out).
- Alt-drag across cells in any layer paints the first cell's value.
- Arrows beside each row and column rotate that row or column by one; one undo
  step each. Right-click a cell: copy, paste, reset.
- In Cartesian mode a crosshair shows the live X/Y position, so you can see
  how a patched LFO travels.
- **Randomize** works per layer, with the Step Sequencer's options plus
  *Skip density* (0–50 %, default 0) for the Access layer.
- The playhead cell is outlined; the path order (Raster) is drawn as faint
  numbers on hover over the Y Rate setting.

## 6. Saved state

```json
{
  "type": "cartesian-sequencer",
  "params": { "columns": 0.4286, "rows": 0.4286, "mode": 0.0, … },
  "data": {
    "cells": [ { "g": 1, "p": 0, "v": 100, "m": 0, "a": 1 }, … 64 entries … ],
    "randomize": { "layers": ["gate", "pitch", "velocity"], "density": 0.6,
                   "octaves": 1, "velocity": [0.6, 1.0], "skip": 0.0 }
  }
}
```

Cells are row-major: `cells[row · 8 + column]`. `g` 0/1/2 = Off/On/Tie, `m`
−100…100, `a` 0 = Skip, 1 = Play. Short arrays are padded with
Off/0/100/0/Play; out-of-range values are clamped. A new module fills the
4 × 4 area with On cells on the scale degrees 0, 2, 4, 7, … read row-major,
so it plays an ascending figure right away.

## 7. Engine requirements

1. Node data, data hand-over and live values exist (Step Sequencer, section 7
   there). Live values: `x`, `y`, `cell`, `sounding`, `pos` (the Cartesian
   position, for the crosshair).
2. **Shared sequencer helpers.** Move the transport step clock (ppq → step,
   Reset anchoring, Clock-mode duration estimate, swing) and the tie/no-hanging-
   notes note emitter out of the Step Sequencer's DSP into
   `patch/common/dsp/` (e.g. `SeqClock.h`, `SeqNotes.h`) and use them in both.
   The Stage Seq and Gate Sequencer reuse them too.
3. A rate list with dotted and triplet values in `Tempo.h` (the Step
   Sequencer's list) shared by all sequencers.

## 8. Tests

- Raster: 4 × 4 Forward plays cells 0…15 in order and fires Row End every 4
  and Grid End every 16 steps; Backward and Ping-Pong per axis give the
  documented orders.
- Independent: X 1/16 × 4, Y 1/4· × 4 → the output repeats after exactly
  3 bars; a loop jump lands on the same cell as playing from the start.
- Both axes moving on one sample play exactly one note.
- Skip: raster with 3 skipped cells has period 13 and never plays a skipped
  cell; independent mode borrows the next cell in the row; a fully skipped row
  stays silent; all skipped → silent, no hanging note.
- Cartesian Clock: a ramp 0…1 on X over one bar plays columns in order;
  Change mode: hysteresis stops chatter for a position dithering on a border.
- X / Y knobs in Clocks mode rotate the playhead by the right number of cells.
- Mod output reaches the cell's value after Mod Slew; updates on Off cells.
- Ties legato, no hanging notes after stop, Reset, resize, Access change, Mode
  change and removal.
- Same Seed → identical render with Random directions.
- Saved data round-trips; short or broken `cells` arrays load safely.

## 9. Later

- Per-row or per-column lengths (ragged grids) and a third axis (pages, Z).
- Path shapes beyond raster: snake, spiral, diagonal, knight's move.
- Per-cell probability and ratchets (shared with the Gate Sequencer).
- Two Mod layers, or a Mod layer per axis.
- Record notes from a *Notes* input into the cell under the playhead.
