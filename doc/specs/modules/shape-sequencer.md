# Shape Sequencer

Type id `shape-sequencer` · category *Modulation / LFOs* · colour proposal `#5eead4`

## 1. Purpose

A looping control voltage drawn from shapes. You choose a **length** (1 to 64
beats) and a number of **steps** (1 to 32): the steps divide the length into
equal cells, the grid you paint on. A shape (a saw up or down, a curve, a
plateau, a triangle or a pulse) is painted onto steps and covers them. Every
shape has its own start level, end level and curve, set with the mouse. The
loop runs on the transport, or starts from a trigger or a gate.

The step count is only the editing grid. Shapes keep their place and length in
the loop when it changes: draw four shapes on 4 steps, change to 8 steps, and
each shape now covers two steps; replace one of them with two shorter shapes and
the others stay as they were.

It only outputs control voltage. What the CV moves (volume, a filter, pan,
drive) is patched outside the module: the Shape Sequencer is the "shaper" of a
volume or filter shaper, without the effect. Where *Segments* chains envelope
pieces by time and *LFO* repeats one wave, the Shape Sequencer lays shapes on a
musical grid.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Trig / Gate | `gate` | With *Sync* Trigger: a rising edge starts the loop from the beginning. With *Sync* Gate: the loop runs while the gate is high. Ignored with *Sync* Transport. |
| Reset | `trigger` | Back to the start of the loop. With Transport: the next bar-grid of the loop counts from this moment. With Trigger or Gate: only while running. |

Every knob is also an input (`specs.md` 7.3): patch CV onto *Depth*, *Offset*,
*Slew* or *Rate*.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out | `control` | The shape, scaled by *Depth*, moved by *Offset*, smoothed by *Slew*. |
| Step | `trigger` | A 2 ms pulse at the start of each shape (and again at each start of the loop if a shape starts there). Gaps give no pulse. |
| Cycle | `trigger` | A 2 ms pulse at the start of each pass of the loop (and, with *Once*, when it ends). |

## 3. Controls

| Setting | Values | Default |
|---|---|---|
| Length | 1 – 64 beats (quarter notes; 4 = one bar) | 4 |
| Steps | 1 – 32 | 4 |
| Sync | Transport, Trigger, Gate | Transport |
| Playback | Loop, Once (only with *Sync* Trigger) | Loop |
| Polarity | Unipolar, Bipolar | Unipolar |

| Knob | Range | Default |
|---|---|---|
| Depth | 0 – 100 % | 100 % |
| Offset | −1 … +1 | 0 |
| Slew | 0 – 100 % (0 – 250 ms) | 0 |
| Rate | 1/4×, 1/2×, 1×, 2×, 4× (stepped) | 1× |

*Steps* does not change the sound: step *n* of *N* covers
`[(n−1)/N, n/N)` of the *Length* in the view, and that is where painting
snaps to. Any count works, 5 or 7 as well as 4 or 8 (step lengths of a third
of a beat and the like are stored as exact fractions of the beats).

## 4. Behaviour

### 4.1 Shapes

A shape has a type, a position `start` and a length `len` in quarter notes of
the loop, a start level `a`, an end level `b` (both 0 … 1) and a curve `c`
(−1 … +1). With `t` = the position inside the shape ((pos − start) / len, 0 … 1)
and `p = 2^(2c)`:

| Type | Value | Handles in the view |
|---|---|---|
| Ramp (saw up: a=0 b=1; saw down: a=1 b=0) | `a + (b − a) · t^p` | start, end, bend |
| Curve | `a + (b − a) · t^p / (t^p + (1 − t)^p)` (an S that is steeper for higher `c`) | start, end, bend |
| Triangle | `a + (b − a) · (1 − |2t − 1|)^p` (`a` at the edges, `b` at the peak) | start, peak, bend |
| Plateau | `a` | level |
| Pulse | `a` in the first half, `b` in the second | first half, second half |

Shapes are sorted by start and never overlap. Between two shapes (or before the
first or after the last) the value is the floor, 0: a rest. A shape that runs
past the end of the *Length* is cut off there.

### 4.2 Timing

- **Transport:** with `L` the loop in quarter notes and `r` the *Rate* factor,
  the position is `u = frac((ppq − origin) / (L / r))`; the shape at `u · L` plays. It derives from the
  song position, so loop jumps and renders land on the same value. *Reset*
  moves `origin` to the current position. While the transport is stopped the
  module is idle.
- **Trigger:** a rising edge starts at `u = 0` (also while running). The loop
  advances by `bpm / 60 / sampleRate / (L / r)` per sample. *Loop* wraps; *Once*
  stops at `u = 1` and holds the last value of the last shape.
- **Gate:** like Trigger with *Loop*, but only while the gate is high. When it
  falls the module is idle.
- **Idle** outputs the shape floor: 0 unipolar, the centre (0) bipolar, then
  *Offset*.

### 4.3 Output stage

`shaped` is the shape value (0 … 1). Unipolar: `out = offset + depth · shaped`;
bipolar: `out = offset + depth · (2 · shaped − 1)`. The result is clamped to
−1 … +1, then smoothed by a one-pole with a time constant of `slew² · 250 ms`.

CPU: one `pow` or two per sample while running; no allocation.

## 5. Module view

```
 ┌ Shape Sequencer ───────────────────────────────────────────────────┐
 │ [Select] [Saw up] [Saw dn] [Plateau] [Curve] [Triangle] [Pulse] [Erase] │
 │  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐                 │
 │  │  ╱  │  ╱  │ ■━━━━━■   │ ╲   │  ╲  │   ╱‾‾     │                 │
 │  └─────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┘                 │
 │ 4 beats in 8 steps · Plateau at step 3 (2 steps) · 60%  [Flip][Reset] │
 │ Timing: Length Steps Sync (Playback) Rate     Output: Polarity Depth … │
 └─────────────────────────────────────────────────────────────────────┘
```

- **Palette:** the active tool. *Select* only selects shapes. A shape paints
  onto every step you click or drag over until you pick *Select* again. *Erase*
  removes what is on a step.
- **Painting** puts the new shape over exactly that step. Shapes under it are
  replaced; one that only partly lies under it is cut to the part that is left
  (and a shape that spans the step on both sides leaves two pieces). Cut
  shapes keep their type, levels and curve over their shorter span.
- **Editor:** the loop divided into *Steps* cells. The selected shape shows its
  handles: yellow squares drag the levels vertically, the white dot drags the
  curve. A drag is one undo step.
- **Inspector line:** the length in steps, the selected shape, the step it
  starts on, how many steps it covers, its levels and curve. *Flip* swaps start
  and end; *Reset shape* straightens the curve.
- A white playhead follows the live position while the loop runs.

## 6. Saved state

Knobs and settings are params. The shapes are node data:

```json
{
  "type": "shape-sequencer",
  "params": { "length": 0.0476, "steps": 0.0968, … },
  "data": {
    "shapes": [
      { "t": "ramp", "s": 0.0, "n": 1.0, "a": 0.0, "b": 1.0, "c": 0.0 },
      { "t": "plat", "s": 1.0, "n": 1.0, "a": 0.6, "b": 0.6, "c": 0.0 },
      …
    ]
  }
}
```

`t` is one of `ramp`, `curve`, `tri`, `plat`, `pulse`; `s` is the start and `n` the
length in quarter notes. `sanitiseData` keeps at most 64 shapes, drops unknown
types and shapes shorter than 0.1 ms of a beat, clamps levels to 0 … 1 and the curve
to −1 … +1, makes a plateau's `b` equal to `a`, sorts by `s` and cuts each shape
at the start of the next so none overlap. A document without `shapes` gets the
default loop (saw up, plateau, saw down, curve, one beat each).

## 7. Engine requirements

- Node data and `setData` with `RtHandoff` (done).
- `liveValues`: `phase`, `active`, `out` for the view.
- `ParamSpec::choice(...).when("sync", 1, 1)` for *Playback* (done).

## 8. Tests

`modules/shape-sequencer/tests/test_shape_sequencer.cpp`:

- Shape values at 0, ½ and 1 for every type, and the curve exponent.
- Finding the shape at a position: inside, at the edges, in a gap, past the end, an empty table.
- Transport lock: the value half way up the first shape, one Cycle per bar, one Step pulse per shape, and the same value after a loop jump; idle when stopped.
- A loop of 3 beats; a gap plays the floor; one shape replaced by two shorter ones leaves the others untouched.
- *Rate* doubles the speed; *Reset* moves the loop start.
- Trigger: idle until fired, loops, *Once* holds the end, a new trigger restarts.
- Gate: runs while high, idle after.
- Depth and offset, bipolar, clamping and slew.
- `sanitiseData` and the module on a compiled board are covered by `patch.modules`; the demo types file includes the module (`patch.ui-types`).

## 9. Later

- Dragging the edge of a shape to change its length.
- A random shape and per-shape probability.
- Shape start/end that follow a second input (a sampled CV).
