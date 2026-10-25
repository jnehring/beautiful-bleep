# Segments

Type id `segments` · category *Modulation* · colour proposal `#ca8a04`

## 1. Purpose

A chain of up to 8 segments, each a ramp, a step or a hold with its own time,
level and curve. Chained, they draw any envelope: AD, ADSR, AHDSR, a
multi-stage swell with a second peak. Mark some segments as a loop and the
chain becomes an LFO of any shape, or an envelope with a looping sustain
section. Per-segment gate inputs and outputs let segments wait for events and
announce when they run. Where *ADSR* is a fixed four-stage envelope and
*Function* is one rise and one fall, Segments is the general case, drawn in a
breakpoint editor.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Gate | `gate` | Rising edge starts the chain at segment 1; falling edge jumps to the release part (4.3). |
| Velocity | `control` (unipolar) | Scales every segment's level through *Vel Amount*. Unpatched counts as 1. Sampled at each Gate rising edge. |
| Seg 1 … Seg 8 | `trigger` | Per-segment events: ends a *Hold* that waits for a trigger, or jumps to that segment (see *Seg In* in 3). Jack ids `segin1` … `segin8` (the outputs are `seg1` … `seg8`). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out | `control` (bipolar, −1…+1; unipolar when all levels are ≥ 0) | The chain. |
| Inv | `control` | −Out. |
| Seg 1 … Seg 8 | `gate` | High while that segment runs. |
| Loop | `trigger` | A pulse each time the loop region starts a new pass. |
| End | `trigger` | A pulse when the last segment finishes. |
| Active | `gate` | High from the Gate rising edge (or transport start in *Free*) until *End*. For a Voice Cell's *Voice Out › Active*. |

Jacks for segments beyond *Count* stay on the node (dimmed), so cables are not
lost when *Count* is lowered; their outputs are 0 and their inputs ignored.

## 3. Controls

**Knobs** (modulatable floats), one set per segment, `n` = 1…8:

| Knob | Range | Default | What it does |
|---|---|---|---|
| Time n | 0.5 ms – 30 s (skewed, centre 250 ms) | see 4.6 | Duration of the segment. With *Sync* on, the segment's note value (node data) is used instead (4.4). |
| Level n | −1 … +1 | see 4.6 | Target level (Ramp, Step). Ignored by Hold. |
| Shape n | −1 … +1 | 0 | Ramp: curve (the Function curve, 4.2). Step: glide share. Hold: ignored. |

Global knobs:

| Knob | Range | Default | What it does |
|---|---|---|---|
| Time Scale | ×0.1 … ×10 (exponential, centre ×1) | ×1 | Multiplies every free time. Modulate it for an envelope that gets faster with velocity or pitch. Ignored by synced times. |
| Vel Amount | 0–100 % | 0 % | Peak scale `1 − VelAmount × (1 − Velocity)`, as in *ADSR*. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Count | 1–8 segments (a setting; the view's − / + change it) | 4 |
| Run | Gated, Free | Gated |
| Release | Jump, Finish | Jump |
| Sync | Off, On | Off |

Per segment (stored in node data, edited in the view, 6):

| Setting | Values | Default |
|---|---|---|
| Type | Ramp, Step, Hold | see 4.6 |
| Loop | on/off | off |
| Wait (Hold only) | Time, Gate, Trigger | Gate |
| Seg In | Advance, Jump | Advance |
| Sync value | 8 bars … 1/64T, straight, dotted, triplet (`dsp::noteValues()` 1 … 24, saved by name) | 1/4 |

## 4. Behaviour

### 4.1 Segment types

Each segment starts from the level the output has when it begins (`start`),
never from a stored value, so jumps and retriggers never click.

- **Ramp** moves from `start` to *Level* over *Time*:
  `out = start + (Level·peak − start) · curve(u, Shape)`, `u` = elapsed / Time.
- **Step** jumps to *Level*·peak and stays for *Time*. *Shape* > 0 glides there
  over `Shape × Time` (linear); *Shape* ≤ 0 jumps. Several Steps in a loop give
  a stepped sequence of up to 8 values.
- **Hold** keeps `start`. *Wait* decides when it ends:
  - *Time*: after *Time* (a pause, as in an AHDSR's hold);
  - *Gate*: while Gate is high (a sustain). With Gate low on arrival it ends at once;
  - *Trigger*: at the next pulse on its *Seg n* input (or on Gate's falling edge).

`peak` = `1 − VelAmount × (1 − Velocity)`. A segment with Time below 0.5 ms
(after Time Scale) lasts 0.5 ms. The chain is not band-limited; at its
shortest it reaches audio rates and aliases, which is accepted.

### 4.2 Curves

`curve(u, s)` is the Function curve: `u^(1+3s)` for `s ≥ 0`,
`1 − (1−u)^(1−3s)` for `s < 0`. For a falling ramp the curve is applied to
the distance travelled, so *Shape* +1 gives the same snappy, exponential feel
in both directions as Function's fall.

### 4.3 Gates, loops and release

- **Gate rising edge:** restart at segment 1 from the current level; *Active*
  goes high.
- **Loop region:** the segments from the first to the last with *Loop* on.
  When playback leaves the last loop segment it returns to the first one and
  *Loop* fires. One looped segment loops alone (a Step on its own is a
  constant; a Ramp on its own is a saw: a lone looping Ramp restarts each
  pass from the level of the last non-Hold segment before it, or 0).
- **Sustain point:** the last Hold with *Wait* = *Gate*, or else the end of the
  loop region. The **release part** is everything after it.
- **Gate falling edge**, *Release* = *Jump*: if playback is before or at the
  sustain point, it jumps to the first release segment, starting from the
  current level (like any ADSR whose gate ends early). *Release* = *Finish*:
  the loop finishes its current pass, earlier segments play out, then the
  release follows. Either way the chain is *releasing* until the next rising
  edge: a loop is left at the end of its pass, so a loop placed after the
  sustain point (in the release part) plays once. A Hold with *Wait* =
  *Trigger* also ends on the falling edge.
- **No sustain point and no loop:** the chain is a one-shot; the gate's
  length doesn't matter.
- **End** fires when the last of *Count* segments finishes; the output keeps
  that segment's level and *Active* falls.
- **Seg n** input, *Seg In* = *Advance*: ends segment n if it is running
  (any type; a Hold with *Wait* = *Trigger* waits for exactly this).
  *Jump*: playback jumps to segment n from the current level, wherever it is.
  A Gate edge and a Seg pulse on the same sample: the Gate is handled first.

### 4.4 Timing and transport

- **Free times:** `Time n × Time Scale`, modulation read per sample, so an
  LFO on a Time knob bends the segment while it runs (the elapsed share `u`
  is integrated: `u += 1 / (Time·sr)` each sample).
- **Sync on:** each segment's length is its *Sync value* in beats at the
  current tempo; *Time n* and *Time Scale* are not used (the view shows the
  note values on the Time knobs, which turn into note-value pickers).
- **Run = Free:** no gate needed; the chain starts on its own (at the
  module's start, when switched to Free, and at every transport start) and
  loops (or ends). The Gate's falling edge is ignored (a loop never
  releases), but Holds with *Wait* = *Gate* still read the Gate's level. With
  Sync on and the transport playing, the position is derived from the song:
  the intro (segments before the loop region) is placed at the last
  transport start `ppqStart`; the loop's position is
  `(ppq − anchor) mod loopBeats` with
  `anchor = round(ppqStart / 4) × 4 + introBeats`, so a looping chain sits on
  the bar grid, survives loop jumps and renders identically. In this mode
  every segment lasts its note value (Holds too), segment 1 starts from 0, the
  loop start from the intro's end level in the first pass and from the loop
  end's level in later passes; *Loop* fires when the pass number grows. A
  Gate rising edge or a Seg pulse restarts the chain and drops the lock until
  the next transport start.
- **Run = Gated with Sync:** times follow the tempo, but the start follows the
  gate, as for an envelope.
- **Transport start** restarts a Free chain; **transport stop** leaves it
  running free at the current tempo.

### 4.5 Edge cases

- *Count* lowered while a higher segment runs: playback jumps to the release
  part (or ends if there is none).
- Loop flags only on segments beyond *Count* are ignored.
- A loop of only Holds with *Wait* = *Gate* would spin with zero length; a
  loop pass must take ≥ 0.5 ms, enforced by giving such holds 0.5 ms.
- Inside a Voice Cell each voice runs its own chain; patch *Voice In › Gate*
  and *Velocity*, and *Active* to *Voice Out › Active*.

### 4.6 New module and templates

A new module is an ADSR: Count 4; 1 Ramp 5 ms → 1.0; 2 Ramp 300 ms → 0.7,
Shape +0.5; 3 Hold, Wait Gate; 4 Ramp 400 ms → 0, Shape +0.5. Unused segments
default to Ramp 250 ms → 0.

The view's **Templates** menu rewrites the segments (one undo step):
AD, ADSR, AHDSR, Swell (two peaks), Ramp LFO, Triangle LFO, 4-step loop,
8-step loop, Gated burst (looping attack/decay while the gate is held, then
release).

## 5. Module view

```
 ┌ Segments ───────────────────────────────────────────── [Templates ▾] ┐
 │  1.0 ┤   ●                                                          │
 │      │  ╱ ╲___●━━━━━━━━━━━━●                                         │
 │      │ ╱                    ╲                                       │
 │  0.0 ┼●──────────────────────●───────                               │
 │      │ 1 R │ 2 R │ 3 H gate │ 4 R │       [↺ loop bracket]           │
 │ Type [Ramp▾]  Wait [Gate▾]  Loop [ ]  Seg In [Advance▾]              │
 │ Time ◯  Level ◯  Shape ◯      (selected segment)   Time Scale ◯ …   │
 └──────────────────────────────────────────────────────────────────────┘
```

- **Breakpoint editor:** one node per segment end. Drag a node vertically for
  *Level*, horizontally for *Time* (log-scaled x axis: each segment's width
  grows with log₂(1 + t / 4 ms); a drag doubles the time per 40 px; with
  Sync, it steps through the note values). Drag a curve vertically for
  *Shape*. A drag is one undo step. The drawing starts from 0 and uses the
  live (modulated) knob values.
- Click a segment to select it; the row below edits its Type, Wait, Loop,
  Seg In, the note value (with Sync) and its three knobs (these are the same
  params that cables can modulate, with their mod rings; the view moves the
  knob elements into the row and shows only the selected segment's; Time is
  hidden with Sync, Level and Shape for Holds).
- The loop region is drawn as a bracket in a strip above the segments;
  dragging across the strip sets the Loop flags on that range, clicking a lone
  looped segment clears them.
- **+ / −** buttons at the right end change *Count*.
- A playhead dot follows the live output; each segment's header lights while
  its *Seg* gate is high. Modulated knobs draw their live, modulated shape.

## 6. Saved state

Knobs and global settings are params. The per-segment choices are node data:

```json
{
  "type": "segments",
  "params": { "time1": 0.12, "level1": 1.0, "shape1": 0.5, …, "count": 0.43 },
  "data": {
    "segments": [
      { "type": "ramp", "loop": false, "wait": "gate", "segIn": "advance", "sync": "1/4" },
      … 8 entries …
    ]
  }
}
```

`sanitiseData` pads to 8 entries, replaces unknown strings with the defaults
and accepts only sync values from the list.

## 7. Engine requirements

- Node data and `setData`: the segment table is parsed on the message thread
  and handed over with `RtHandoff` (done).
- The shared note values with dotted and triplet values (`dsp::noteValues()`,
  done).
- `liveValues`: `segment`, `u` (elapsed share) and `level` for the view.
- Dynamic visibility of jacks beyond *Count* (`.when("count", n, 8)`, done);
  the per-segment knobs carry the same condition.

## 8. Tests

- Default ADSR: with a 1 s gate, levels at segment ends match 1.0 / 0.7 / 0.7 / 0, and *End* fires 400 ms after the gate falls.
- Ramp curves: `u = 0.5` gives the Function curve values for Shape −1, 0, +1, rising and falling.
- Retrigger mid-release starts segment 1 from the current level (no discontinuity larger than one sample's slope).
- Release *Jump* vs *Finish*: early gate-off during the attack jumps vs plays through.
- Loop region: two-segment loop of 10 ms + 10 ms fires *Loop* every 20 ms; gate-off leaves the loop into the release.
- Hold Wait *Trigger* ends exactly on the *Seg n* pulse sample; *Jump* lands on segment n.
- Sync + Free run + transport: the value at bar 5 is the same on two renders and after a loop jump.
- Segment gates: exactly one *Seg n* is high at a time while running.
- Saved data round-trips; short or broken `segments` arrays load safely (`sanitiseData` stability and broken documents are checked by `patch.modules`).
- Count lowered below the running segment goes to the release part (or ends).
- A lone looping Ramp is a saw.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Per-segment probability (skip a segment by chance, seeded).
- A *Random* segment type: a seeded random level per pass.
- Up to 16 segments, and several chains in one module sharing a Gate.
- Per-segment level inputs as `pitch`, for a looping melody with glide.
- Drawing a segment's shape freehand (shared table code with *Contour*).
