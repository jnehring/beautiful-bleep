# Drum Map

Type id `drum-map` · category *Sequencing* · colour proposal `#f08a4b`

## 1. Purpose

A drum pattern generator for three voices — **kick**, **snare** and **hats** —
played from a two-dimensional **map** of patterns. Moving the *X* and *Y*
knobs travels smoothly between rhythms (straight to syncopated, sparse to
busy), one *Density* knob per voice thins or fills each part, and *Chaos* adds
seeded variation that comes back the same in every render. It is locked to
the transport, needs no drawing, and its outputs plug straight into the drum
modules (*Trig* and *Velocity*) or, through *Notes*, into a drum rack in Live.

Where the Step Sequencer and Gate Sequencer play patterns you draw, the Drum
Map **performs**: patterns come from the map and change with a gesture or an
LFO on X/Y and Density.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Clock | `trigger` | Each pulse advances one step. Unpatched: steps follow the transport at *Rate*. |
| Reset | `trigger` | The next step is step 1. |
| Fill | `gate` | While high, every Density is raised by *Fill Amount* (4.4). |

Every knob is also an input (`specs.md` section 7.3); patching an LFO or a
Random onto *X* and *Y* is the main way to play the module.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Kick, Snare, Hats | `trigger` | One pulse per hit of that voice. |
| Kick Acc, Snare Acc, Hats Acc | `trigger` | A pulse with the voice's trigger when the hit is accented. |
| Kick Vel, Snare Vel, Hats Vel | `control` (unipolar) | The hit's velocity, 0–1, set on the trigger's sample and held. Patch into a drum module's *Velocity*. |
| Notes | `notes` | All hits as notes (4.6), for a drum rack via a MIDI Out port, or a Voice Cell. |
| Step | `control` (unipolar) | Step index / (Length − 1). |
| End | `trigger` | A pulse when the pattern wraps to step 1. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| X | 0–100 % | 25 % | Map position, roughly *straight* (0) → *syncopated, broken* (100). |
| Y | 0–100 % | 25 % | Map position, roughly *sparse* (0) → *busy, ornamented* (100). |
| Kick Density | 0–100 % | 50 % | How many of the kick's possible hits play (4.3). |
| Snare Density | 0–100 % | 50 % | The same for the snare. |
| Hats Density | 0–100 % | 50 % | The same for the hats. |
| Fill Amount | 0–100 % | 35 % | Added to every Density while *Fill* is high. |
| Chaos | 0–100 % | 0 % | Size of the seeded random change to every step's level (4.5). |
| Accent | 50–100 % | 78 % | Level above which a hit is accented. |
| Swing | 50–75 % | 50 % | Delays every second step. |
| Note Length | 10–100 % of a step | 50 % | Length of the notes on *Notes* (a knob, so it can be modulated). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Length | 1–32 steps | 32 |
| Rate | 1/8, 1/8T, 1/16, 1/16T, 1/32 | 1/16 |
| Chaos Rate | every bar, every 2 / 4 / 8 bars, Frozen | every bar |
| Seed | 0–999 | 1 |
| Kick Note, Snare Note, Hats Note | 0–127 (shown as numbers) | 36 (C1), 38 (D1), 42 (F♯1) |

## 4. Behaviour

### 4.1 The map

The map is a 5 × 5 grid of **nodes**. Each node holds, for each of the three
voices, 32 **levels** (0–255), one per 16th note over two bars. A level is how
strongly that step "wants" to be a hit: 0 never plays, low levels are
ghost notes and fills, high levels are the backbone.

At each step start the module reads the map at `gx = X · 4`, `gy = Y · 4` and
interpolates bilinearly between the four surrounding nodes, per voice and
step: `L = lerp(lerp(L00, L10, fx), lerp(L01, L11, fx), fy)`. X and Y are
sampled once per step, so a fast LFO on them changes the pattern step by step
but never mid-step.

### 4.2 Building our own map

The factory map is **generated in code**: `drumFactoryNode(column, row)` in
the module's `dsp/DrumMapDsp.h` builds each node from the rules below, and
`drumFactoryMap()` makes the 25-node table (2400 bytes) once. There is no
separate script or checked-in table to keep in sync; the rules are tuned by
listening and by the test's ASCII print. The recipe, for a node at map
position (u, v) ∈ [0, 1]²:

1. **Metric weights.** Every 16th step gets a weight from its place in the
   bar: downbeat 1.0, half-bar 0.85, other quarter notes 0.7, off-beat 8ths
   0.45, 16ths 0.25. Bar 2 copies bar 1, with its last quarter left open for
   fills (kick and snare × 0.8, hats × 0.75 there, so the backbone still
   plays at 50 % density, plus the pickups of step 4).
2. **Kick.** Starts from the quarter notes (u = 0: steady on every beat:
   255, 170, 215, 170 — beats 2 and 4 stay below the spacing threshold so
   the backbeat survives). Toward u = 1, weight moves from beats 2 and 4 to 16ths just before
   or after them and to a 3 + 3 + 2 grouping of 8ths. v adds 8th and 16th
   pickups at levels 60–140, rising with v.
3. **Snare.** A backbone on beats 2 and 4 (level 230). Toward u = 1 it moves to
   a half-time placement (beat 3 only, strongest around u = 0.6) and then a
   displaced backbeat (16ths 8 and 13, 16 lightly), blended by overlapping
   crossfades taken by maximum, so no point of the map loses its snare
   backbone at 50 % density. v adds ghost notes (40–110) on the 16ths next to the
   backbone.
4. **Pickups and fills.** In the last quarter of bar 2, both kick and snare get
   rising levels (80–170, scaled by v), so raising Density or Fill reveals a fill.
5. **Hats.** v = 0: quarter notes (210) with off-beat 8ths at 90; the 8ths
   rise to 210 by v = 0.5, the remaining 16ths from 40 to 160 by v = 1, with
   alternating strong/weak levels. Toward u = 1, the strong hats move to the
   off-beats.
6. **Spacing.** Where the kick level is above 180, the snare level on the same
   step is multiplied by 0.4, so the two rarely collide at medium density.
7. Levels are clamped to 0–255 and rounded. The test prints an ASCII grid of
   every node at three densities for review (`DRUM_MAP_PRINT=1
   bleep_test_drum_map`).

**User map.** Any node can be edited in the module view (section 5). Edited nodes are
saved in the node's data and override the factory node; *Reset node* removes
the override.

### 4.3 Density

A voice's threshold is `T = (1 − D) · 255`, with `D = clamp(Density + Fill, 0, 1)`.
The step is a hit when its level after Chaos is `L' > T` and `L' > 0`. At 0 %
nothing plays; at 100 % every step with a level above 0 plays. Because levels
are ordered by importance, raising Density adds hits from the backbone
outward.

Velocity is `0.3 + 0.7 · L' / 255`. A hit is accented when `L' ≥ Accent · 255`.

### 4.4 Fill

While *Fill* is high, *Fill Amount* is added to all three Densities. Patch the
Gate Sequencer, a Clock division or another Drum Map's *End* through a
Utility to get a fill every 4th or 8th bar.

### 4.5 Chaos

Each step's level gets a seeded offset:
`L' = clamp(L + Chaos · 255 · (u − 0.5), 0, 255)`, with
`u = uniform01(Seed, block · 32 + step, voice)` (`patch/common/dsp/Random.h`)
and `block = floor(bar / N)` for *Chaos Rate* every N bars (block 0 when
*Frozen*). The perturbation is the same for every render and every loop pass
of the same bar, and changes only at block boundaries. Since Chaos moves
levels, not hits directly, strong hits survive and weak ones come and go.

### 4.6 Timing and notes

- **Transport** (Clock unpatched): `n = floor(ppq / stepLen)`, step
  `n mod Length`; phase-locked to the bars like the Step Sequencer. Bars for
  Chaos are counted from the song position. Transport stop ends notes.
- **Clock**: one step per pulse, Swing from the time between pulses; Chaos
  bars are counted as `floor(steps / 16)` since Reset (at 1/16).
- With *Rate* other than 1/16 the map's 32 steps are read at that rate (1/8
  makes a 4-bar pattern of the same shape; 1/32 a double-time one).
- **Reset** works as in the Step Sequencer.
- **Notes:** each hit is a note-on at the voice's note number with its
  velocity, and a note-off after *Note Length*. If a voice hits while its
  previous note still sounds, the old note-off comes first on the same sample.
  No hanging notes on stop, Reset, note-number change or removal.

## 5. Module view

```
 ┌─────────────────────────────────────────────────────────────┐
 │  ┌───────────────┐   Kick  ■ □ □ □ ■ □ □ ▪ ■ □ □ □ ■ □ ▪ □ …│
 │  │ ·  ·  ·  ·  · │   Snare □ □ □ □ ■ □ ▪ □ □ □ □ □ ■ □ □ ▪ …│
 │  │ ·  ·  ·  ·  · │   Hats  ■ ▪ ■ ▪ ■ ▪ ■ ▪ ■ ▪ ■ ▪ ■ ▪ ■ ▪ …│
 │  │ ·  ·  ⊕  ·  · │         ▲ playhead                        │
 │  │ ·  ·  ·  ·  · │   level bars ▁▃▇ under each lane;         │
 │  │ ·  ·  ·  ·  · │   threshold line per voice                │
 │  └───────────────┘   [Edit node ▾]  [Reset node]            │
 └─────────────────────────────────────────────────────────────┘
```

- **The map pad** (160 × 160 px): drag the puck to set X and Y (one undo step
  per drag). With cables on X/Y, the puck shows the modulated position and a
  short trail; the knob position is a hollow ring. Edited nodes show a dot.
- **Lanes** show the 32 interpolated levels per voice as bars, the threshold
  as a line, hits as filled squares (accents bolder). The playhead is
  highlighted. (The bars already include Chaos.)
- **Edit node** (a toggle): click a node on the pad, then drag levels in its
  lanes; the lanes then show that node instead of the interpolated pattern.
  The first edit copies the whole node into the data. **Reset node** removes
  the override.
- The knobs and settings sit below the map and lanes; the window is 600 px wide.

## 6. Saved state

```json
{
  "type": "drum-map",
  "params": { "x": 0.25, "y": 0.25, "kickdensity": 0.5, … },
  "data": {
    "nodes": {
      "2,3": { "kick": [255, 0, 0, 40, …32], "snare": [ …32 ], "hats": [ …32 ] }
    }
  }
}
```

Only edited nodes are stored (key `"column,row"`, 0–4). Lanes that are missing
fall back to the factory node; short arrays are padded from it; values are
clamped to 0–255. A new module has no edits.

## 7. Engine requirements

1. Node data and live values exist (Step Sequencer section 7). The data is
   parsed into a full 25-node table on the message thread and handed over
   with `RtHandoff`. Live values: `step`, `hits` (bit per sounding voice),
   `px`, `py` (X/Y after modulation), `kd`, `sd`, `hd` (the effective
   densities, Fill included), `accent`, `edited` (bit per edited node). Live
   arrays: `levels` (3 × 32 levels of the current interpolated pattern after
   Chaos, computed on the message thread from the published table) and, while
   the view edits a node (command `editnode` with the node index, −1 to stop),
   `node` (that node's 3 × 32 levels).
2. Shared sequencer clock (`SeqClock.h`, see the Cartesian Seq spec).
3. The generator (4.2), in the module's DSP header.
4. Bar counting from the song position for Chaos blocks (time signature
   from the host; 4/4 assumed when unknown).

## 8. Tests

- Interpolation: at node positions the pattern equals the node; halfway
  between two nodes each level is their mean (±1).
- Density 0 % plays nothing, 100 % plays every step with level > 0; raising
  Density never removes a hit (monotonic) with Chaos 0.
- Accent and velocity formulas on a table of levels.
- Fill raises density only while high.
- Chaos 0 reproduces the map exactly; the same Seed gives the same hits twice;
  with Chaos Rate *every 4 bars*, bars 1–4 repeat the same perturbation and
  bar 5 differs; Frozen never changes.
- Transport: steps land on the right samples for each Rate and after a loop
  jump; Clock mode one step per pulse; Reset.
- Notes: correct note numbers and velocities; retrigger order; no hanging
  notes after stop, Reset, note-number change, removal.
- User nodes round-trip; broken `nodes` entries load safely.
- The generated map: the default node at 50 % has kick on beats 1 and 3,
  snare on 2 and 4 and 8th hats; straight/sparse/busy/broken edges have their
  character; neighbouring nodes differ.

## 9. Later

- More voices (open hat, percussion, clap) and a fourth density.
- Several factory maps (styles) behind a *Map* setting.
- Per-voice X/Y offsets so parts drift apart on the map.
- Learn a node from a *Notes* input or a Gate Sequencer track.
- Triplet-feel maps (24 steps per node).
