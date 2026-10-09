# Chart Recorder

Type id `chart-recorder` · category *Modulation* · colour proposal `#a3e635`

## 1. Purpose

A pen draws a signal onto a looping strip of paper, and the strip plays back
as modulation. The pen is a heavy, sprung mechanism: it lags, overshoots,
sticks and bangs into its end stops, so even a plain envelope comes out with
character (also live, from *Pen*). The strip replays at another speed,
backwards, locked to the song or scrubbed, and can be edited by drawing on
the paper with the mouse.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In | `control` | The signal to draw; audio is fine, the detector (4.1) turns it into a level. |
| Record | `gate` | Writes while high (*Record* = Gate); a rising edge arms one pass (*Record* = Armed). |
| Mark | `trigger` | Puts a tick on the paper edge at the write head. |
| Hold Paper | `gate` | Stops the paper while high (4.3). |
| Clear | `trigger` | Wipes the strip and its marks. |
| Reset | `trigger` | Sends the replay head to *Offset*. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Pen | `control` | The live pen position, whether or not it is writing. |
| Replay | `control` | The strip, read at the replay head (4.5). |
| Marker | `trigger` | A pulse whenever the replay head passes a mark, in either direction. |
| Position | `control` (unipolar) | The replay head, 0 at the start of the strip, 1 at the end. |

*Pen* and *Replay* are bipolar with the DC detector, unipolar otherwise.

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Gain | −24…+24 dB | 0 dB | Input gain before the detector. |
| Response | 1 ms – 2 s (exp.) | 50 ms | Averaging time of the Rectified, RMS and Log detectors; release of Peak. |
| Writing Speed | 1–1000 mm/s (exp.) | 100 mm/s | Fastest the pen can move; also sets its stiffness (4.2). |
| Damping | 0–100 % | 70 % | Low values overshoot and wiggle; high values creep. |
| Friction | 0–100 % | 0 % | Stiction: small changes don't move the pen until they add up. |
| Paper Speed | 0.25–4× (exp.) | 1× | Paper speed in Free mode, relative to *Length*. |
| Replay Speed | −4…+4× | +1× | Replay head speed; negative runs backwards, 0 parks it. |
| Offset | 0–100 % | 0 % | Added to the replay head; with Replay Speed 0 this scrubs. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Detector | DC, Rectified, RMS, Peak, Log dB | DC |
| Log Range | 10, 25, 50, 75 dB | 50 dB |
| Paper | Free, Transport | Transport |
| Length (Free) | 1 s, 2 s, 5 s, 10 s, 30 s, 1 min, 2 min, 5 min, 10 min | 10 s |
| Length (Transport) | 1, 2, 4, 8, 16, 32, 64 bars | 4 bars |
| Record | Always, Gate, Armed | Gate |
| Replay Sync | Free, Song | Song |
| Interpolation | Step, Linear, Smooth | Linear |

**Clear**, **Arm** and a **Hold Paper** toggle on the panel act like the inputs
(module buttons; Hold Paper flips on each press and lights while the paper
is held).

## 4. Behaviour

### 4.1 Detector

`x = In · 10^(Gain/20)`. With `a = exp(−1 / (Response · fs))`:

- **DC:** `y = clamp(x, −1, 1)`.
- **Rectified / RMS:** one-pole low-pass of `|x|` / `sqrt` of one of `x²`.
- **Peak:** instant attack, release `a` (`dsp::EnvelopeFollower`, attack 0).
- **Log dB:** RMS in dB, `y = clamp((dB + Log Range) / Log Range, 0, 1)`: 0 dBFS
  at the top edge, −*Log Range* at the bottom, as on a level recorder.

The detector value becomes a pen target on the paper, which is 100 mm wide
from −1 to +1: `t = y` for DC, `t = 2y − 1` for the unipolar detectors
(limited to ±1.5: Rectified, RMS and Peak are unbounded with Gain up, and
beyond the end stops a larger target only bangs the pen harder into them).

### 4.2 The pen

The pen is a mass on a spring with a damper and a velocity limit, integrated
per sample (semi-implicit Euler, double precision), position `u`, velocity
`v` in paper units (2 = full width):

```
ω    = 2π · Writing Speed / 20           (50 mHz … 50 Hz natural frequency)
ζ    = 0.05 · 40^Damping                 (0.05 … 2; 0.66 at the default)
vmax = Writing Speed / 50                (paper units per second; 1 unit = 50 mm)
F    = ω² · (t − u) − 2ζω · v
stick: if |v| < 1e-4 and |ω² · (t − u)| < Friction · 0.08 · ω²  →  v = 0, F = 0
v    = clamp(v + F / fs, −vmax, vmax);   u = u + v / fs
```

**End stops** at ±1.05: the pen stops there and bounces back with
`v = −0.3 · v`, so overdriven inputs draw flattened tops with a small kick.
*Pen* outputs `u` clamped to ±1 (mapped back to 0…1 for unipolar detectors).

Fast and damped, the pen follows closely; slow, it draws straight-sided
ramps (the velocity limit); underdamped, it rings around each new level.
Friction turns smooth movement into small steps (sticking until the error
exceeds up to 4 % of full scale). No randomness: the same input draws the
same line.

### 4.3 Paper and writing

The strip has `N = min(Lsec · 200, 24000)` points: `Lsec` is *Length* in
seconds, or `bars · 240 / bpm` at the tempo it was sized for (at least 16).
That is 200 points/s up to 2 minutes, coarser beyond (10 min: 40/s). Each
point is an int16 (`round(u · 32767)`), or *blank* (−32768, no ink). A strip
with no ink at all follows the current Length and tempo (there is nothing to
stretch); once inked it keeps its `N`.

The write head `p ∈ [0, 1)` moves:

- **Free:** `p += Paper Speed / (Lsec · fs)` per sample, transport or not.
- **Transport:** `p = wrap01(ppq / (4 · bars))` while playing; the paper
  stands still while stopped.
- **Hold Paper** high: `p` freezes (in Transport mode it rejoins the song on
  release); the pen keeps writing into the point under the head.

While writing, each point gets the mean of `u` over the samples the head
spent on it. Points skipped by a jump stay as they were. The pen only writes
while the paper runs (Free, or Transport while playing; held paper counts as
running), so a stopped transport writes nothing in any mode. *Record* modes:

- **Always:** writes whenever the paper moves.
- **Gate:** writes while *Record* is high (pen lifted otherwise).
- **Armed:** a rising edge on *Record* (or Arm) arms; writing starts the next
  time `p` wraps to 0 and stops after exactly one pass. The view shows Armed,
  Writing, Done.

**Mark** stores the point index under the write head (256 at most; more drop
the oldest; a point already marked is not stored twice). **Clear** blanks every point and removes the marks. Changing
*Length* resamples the strip and marks to the new `N`; a tempo change keeps
`N` (the strip stretches with the song).

### 4.4 Replay head

`r ∈ [0, 1)`, read position `q = wrap01(r + Offset)`:

- **Free:** `r += Replay Speed / (Lsec · fs)` per sample, always running.
- **Song:** `r = wrap01(Replay Speed · ppq / (4 · bars))` in Transport mode,
  with `Lsec · bpm / 60` beats in place of `4 · bars` in Free mode. A pure
  function of the song position; while stopped, `r` holds.

*Reset* sets `r = 0` (Free only). *Position* outputs `q`.

### 4.5 Reading

The strip is read at `q · N` with *Interpolation*: Step (the point),
Linear (between neighbours), Smooth (4-point cubic Hermite, wrapping at the
ends). Blank points are skipped: a blank reads the nearest inked point
before it (wrapping), and a strip with no ink reads 0. The result is
converted from paper units like *Pen*; drawn vertical edges give jumps.

**Marker** fires (one pulse per sample at most) when `floor(q · N)` enters
a marked index in either direction, the short way round across the wrap
(every index passed by a jump of up to N/2 points counts).

## 5. Module view

```
 ┌───────────────────────────────────────────────────────────────┐
 │ ▼   ▼            ▼                        marks               │
 │┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊│
 │┊   ╭─╮      ╭╮_╭~~────╮       ┃                 ╱‾╲  ◀═╪═▶ pen │
 │┊ __╯ ╰╮╭~~──╯         ╰──╮    ┃ replay      ___╱   ╲__╱ ┃      │
 │┊┊┊┊┊┊┊╰╯┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊╰────┃──────────╯┊┊┊┊┊┊┊┊┊┊┊┊┊┃┊┊┊┊┊┊│
 │ 0:00        Detector RMS · 50 dB · 4 bars           ● WRITING  │
 │ Gain Resp  Speed Damp Frict  Paper  Replay Offset  [Clear][Arm]│
 └───────────────────────────────────────────────────────────────┘
```

Graph paper (grid, time ticks, a dB or value scale) scrolls right to left
under a fixed pen carriage near the right edge; the pen is drawn lowered
while writing. Red ink on the paper, marks as triangles on the top edge, the
replay head as a thin line. A strip overview below shows the whole loop.

**Editing:** dragging on the paper draws ink (straight lines between mouse
events); Shift-drag draws one segment; right-drag erases; Alt-click adds or
removes a mark. Each drag is one undo step (`beginGesture`, then `setData`).

## 6. Saved state

Node data, checked by `sanitiseData`:

```json
{ "v": 1, "n": 4000, "pcm16": "<base64, n little-endian int16>", "marks": [120, 1800] }
```

`n` ≤ 24,000 (48 KB, 64 KB as base64); a bad `pcm16` is padded with blank or
truncated to `n`; bad or duplicate marks are dropped, 256 kept. Pen, heads
and Armed state are not saved.

## 7. Engine requirements

1. **Node data, `setData`, live values** exist (see `step-sequencer.md`).
2. **Data written by the audio thread:** `Module::takeData()`, polled on the
   message thread, returns a strip snapshot when writing stops, a pass ends,
   on Clear, on a new mark, after a Length resample and every 5 s of
   writing; the board stores it without an undo entry and hands it back
   through `setData`, which the module recognises as its own and ignores.
   View edits still use `setData` with undo.
3. `liveValues`: `p`, `q`, `u`, `rec` (0 idle, 1 armed, 2 writing, 3 done),
   `writing`, `held`, `n`, `seconds`. `liveArrays`: `ink` (`[index, value, …]`
   for the points written since the last read, from a 4096-entry ring),
   `strip` (every point, −2 = blank) after a load, Clear, resize, a ring
   overflow or the view's `sync` command (sent when it opens and when the
   node data changes), and `marks`.
4. Detector: `dsp::OnePole`, `dsp::EnvelopeFollower` (`Smoothing.h`);
   `dsp::wrap01` (`Tempo.h`). The pen is new, small and local to the module.
5. **Inside Voice Cells** (simplified): each voice has its own pen, replay
   head and copy of the strip from the node data; only voice 0 writes, into
   its own copy, and Clear and Mark only act there. Voices do not share
   what voice 0 records, and it is not saved (the engine polls `takeData`
   on top-level modules only). A shared strip needs engine support.

## 8. Tests

- Detectors: a full-scale sine gives RMS 0.707, Peak 1, Log `(Range − 3) / Range`.
- Pen: a step with Damping 100 % never overshoots; Damping 0 % overshoots by
  more than 50 %; slope never exceeds `vmax`; Friction 100 % ignores a 2 %
  step and follows a 10 % step; end stops hold ±1.05 and bounce.
- Paper: Transport `p` is a pure function of `ppq`; Hold freezes it; Gate
  writes only while high; Armed writes exactly one pass from the wrap.
- A written ramp replays at +1× (Song) within one point, reversed at −1×.
- Interpolation: Step, Linear and Smooth match their formulas; blank points
  read the previous ink; an empty strip reads 0.
- Marker fires once per mark crossing in both directions and on wrap.
- `sanitiseData`: round-trips bit-exact; truncated base64, wrong `n` and bad
  marks load safely; resizing *Length* rescales marks.
- The demo types file includes the module (`patch.ui-types`): needs
  `bleep_dump_types --write patch/board/ui/demo-types.json`, a shared file
  regenerated when the module is merged.

## 9. Later

- Two pens on one strip (red and blue ink); Overdub instead of Replace.
- Paper wander: seeded slow speed drift of the paper drive.
- Per-voice strips inside Voice Cells; export the strip as CSV or an image.
