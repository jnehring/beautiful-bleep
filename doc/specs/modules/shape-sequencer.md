# Shape Sequencer

Type id `shape-sequencer` · category *Modulation / LFOs* · colour proposal `#5eead4`

## 1. Purpose

A looping control voltage drawn from shapes. You choose a **length** (a quarter
of a bar to 8 bars) and a **grid** (1/1 to 1/32); together they make up to 32
slots. Each slot holds one shape: a saw up or down, a curve, a plateau, a
triangle or a pulse. Every shape has its own start level, end level and curve,
set with the mouse. The loop runs on the transport, or starts from a trigger or a gate.

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
| Slot | `trigger` | A 2 ms pulse at the start of each slot, empty ones included. |
| Cycle | `trigger` | A 2 ms pulse at the start of each pass of the loop (and, with *Once*, when it ends). |

## 3. Controls

| Setting | Values | Default |
|---|---|---|
| Length | 1/4 bar, 1/2 bar, 1 bar, 2 bars, 4 bars, 8 bars | 1 bar |
| Grid | 1/1, 1/2, 1/4, 1/8, 1/16, 1/32 | 1/4 |
| Sync | Transport, Trigger, Gate | Transport |
| Playback | Loop, Once (only with *Sync* Trigger) | Loop |
| Polarity | Unipolar, Bipolar | Unipolar |

| Knob | Range | Default |
|---|---|---|
| Depth | 0 – 100 % | 100 % |
| Offset | −1 … +1 | 0 |
| Slew | 0 – 100 % (0 – 250 ms) | 0 |
| Rate | 1/4×, 1/2×, 1×, 2×, 4× (stepped) | 1× |

Slots = round(length × grid per bar), at most 32; a longer length on a finer
grid than that is cut to 32 slots (the grid gets coarser). Slot *n* of *N*
covers `[(n−1)/N, n/N)` of the loop.

## 4. Behaviour

### 4.1 Shapes

A slot has a type, a start level `a`, an end level `b` (both 0 … 1) and a curve
`c` (−1 … +1). With `t` = the position inside the slot (0 … 1) and
`p = 2^(2c)`:

| Type | Value | Handles in the view |
|---|---|---|
| Ramp (saw up: a=0 b=1; saw down: a=1 b=0) | `a + (b − a) · t^p` | start, end, bend |
| Curve | `a + (b − a) · t^p / (t^p + (1 − t)^p)` (an S that is steeper for higher `c`) | start, end, bend |
| Triangle | `a + (b − a) · (1 − |2t − 1|)^p` (`a` at the edges, `b` at the peak) | start, peak, bend |
| Plateau | `a` | level |
| Pulse | `a` in the first half, `b` in the second | first half, second half |
| Empty | 0 | none |

### 4.2 Timing

- **Transport:** with `L` the loop in quarter notes and `r` the *Rate* factor,
  the position is `u = frac((ppq − origin) / (L / r))`. It derives from the
  song position, so loop jumps and renders land on the same value. *Reset*
  moves `origin` to the current position. While the transport is stopped the
  module is idle.
- **Trigger:** a rising edge starts at `u = 0` (also while running). The loop
  advances by `bpm / 60 / sampleRate / (L / r)` per sample. *Loop* wraps; *Once*
  stops at `u = 1` and holds the last value of the last slot.
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
 │  ┌───────────┬───────────┬───────────┬───────────┐                 │
 │  │   ╱│      │  ■━━━━━■  │ ╲         │   ╱‾‾     │                 │
 │  │  ╱ │      │           │   ╲_      │ _╱        │                 │
 │  └───────────┴───────────┴───────────┴───────────┘                 │
 │ Slot 2 of 4 · Plateau · 60%                          [Flip][Reset]  │
 │ Timing: Length Grid Sync (Playback) Rate     Output: Polarity Depth … │
 └─────────────────────────────────────────────────────────────────────┘
```

- **Palette:** the active tool. *Select* only selects slots. A shape paints
  into every slot you click until you pick *Select* again. *Erase* empties a
  slot.
- **Editor:** one cell per slot. The selected slot shows its handles: yellow
  squares drag the levels vertically, the white dot drags the curve. A drag is
  one undo step.
- **Inspector line:** the selected slot's shape, levels and curve. *Flip*
  swaps start and end; *Reset shape* straightens the curve.
- A white playhead follows the live position while the loop runs.

## 6. Saved state

Knobs and settings are params. The slots are node data:

```json
{
  "type": "shape-sequencer",
  "params": { "length": 0.4, "grid": 0.4, … },
  "data": {
    "slots": [
      { "t": "ramp", "a": 0.0, "b": 1.0, "c": 0.0 },
      { "t": "plat", "a": 0.6, "b": 0.6, "c": 0.0 },
      … 32 entries …
    ]
  }
}
```

`t` is one of `empty`, `ramp`, `curve`, `tri`, `plat`, `pulse`. `sanitiseData`
pads to 32 entries, turns unknown types into `empty`, clamps levels to 0 … 1 and
the curve to −1 … +1, and makes a plateau's `b` equal to `a`. A document with
no slots gets the default loop (saw up, plateau, saw down, curve).

## 7. Engine requirements

- Node data and `setData` with `RtHandoff` (done).
- `liveValues`: `phase`, `active`, `out` for the view.
- `ParamSpec::choice(...).when("sync", 1, 1)` for *Playback* (done).

## 8. Tests

`modules/shape-sequencer/tests/test_shape_sequencer.cpp`:

- Shape values at 0, ½ and 1 for every type, and the curve exponent.
- Slot count for length and grid, capped at 32 and at least 1.
- Transport lock: the value half way up the first slot, one Cycle per bar, one Slot pulse per slot, and the same value after a loop jump; idle when stopped.
- *Rate* doubles the speed; *Reset* moves the loop start.
- Trigger: idle until fired, loops, *Once* holds the end, a new trigger restarts.
- Gate: runs while high, idle after.
- Depth and offset, bipolar, clamping and slew.
- `sanitiseData` and the module on a compiled board are covered by `patch.modules`; the demo types file includes the module (`patch.ui-types`).

## 9. Later

- Triplet and dotted grids.
- A random shape and per-slot probability.
- Shape start/end that follow a second input (a sampled CV).
