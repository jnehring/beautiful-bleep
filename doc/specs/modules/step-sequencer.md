# Step Sequencer

Type id `step-sequencer` · category *Sequencing* · colour proposal `#f6c453`

## 1. Purpose

A melodic step sequencer: up to 32 steps, each with a gate, a pitch and a
velocity, drawn in three lanes. Pitches are quantized to a scale, a randomizer
writes new patterns in one click, and a *Variation* knob adds live, seeded
variation without touching the pattern. Its *Notes* output plays a Voice Cell
directly; its *Pitch*, *Gate* and *Velocity* outputs drive anything else.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Clock | `trigger` | Each pulse advances one step. Unpatched: the sequencer follows the transport at *Rate*. |
| Reset | `trigger` | The next step played is step 1 (see 4.2). |
| Transpose | `pitch` | Added to every step's pitch **before** quantizing, so a transposed melody stays in the scale. Sampled at each step start. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Notes | `notes` | One note per played step, with velocity. Ties become legato (see 4.4). Patch it into a Voice Cell. |
| Pitch | `pitch` | The current step's quantized pitch, 1 V/oct. Holds between steps. |
| Gate | `gate` | High for *Gate Length* of each played step; stays high across ties. |
| Velocity | `control` (unipolar) | The current step's velocity, 0–1. Holds between steps. |
| Trigger | `trigger` | A pulse when a step starts a new note (On, or the first step of a tie; not a tie's continuation). |
| End | `trigger` | A pulse when the pattern wraps to its first step. |
| Step | `control` (unipolar) | Playhead position, step index / (Length − 1); 0 for Length 1. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Gate Length | 1–100 % of a step | 50 % | Length of each gate. Ties ignore it. |
| Swing | 50–75 % | 50 % | Delays every second step; 50 % is straight. Transport and Clock modes both swing. |
| Variation | 0–100 % | 0 % | Chance per step that its pitch (and velocity, see 4.5) is replaced by a random note from the scale while playing. The pattern itself is unchanged. |
| Var. Range | 0–24 semitones | 12 | How far a varied note may move from the stored pitch. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Length | 1–32 steps | 16 |
| Rate | 1/1, 1/2, and 1/4 … 1/32 each straight, dotted (`1/4.`) and triplet (`1/4T`) | 1/16 |
| Direction | Forward, Backward, Ping-Pong, Random | Forward |
| Root | C, C♯, D, … B | C |
| Scale | the scales in 4.3 | Major |
| Octave | −3…+3 | 0 |
| Seed | 0–999 | 1 |
| Harmony | Off, Bus A–D: follow a Harmony Master; while its bus is active, the bus key replaces *Root* and the bus scale replaces *Scale* (steps stay relative to the root, so the melody follows key changes). A silent bus keeps *Root* and *Scale*. | Off |

## 4. Behaviour

### 4.1 Steps and lanes

Each of the 32 steps stores:

- **Gate:** *Off* (silent), *On* (plays a note), or *Tie* (plays and holds into the next step, legato).
- **Pitch:** −24…+36 semitones above *Root* + *Octave* (0 = the root).
- **Velocity:** 1–127, shown as 1–100 %.

*Length* only limits playback. Steps beyond it keep their data, so shortening
and lengthening a pattern loses nothing.

The output pitch of a step is
`quantize(Root + Octave·12 + step pitch + Transpose·12)`, in semitones from C4,
divided by 12 (1 V/oct, 0.0 = C4, `specs.md` section 7.1).

### 4.2 Timing

**Transport mode** (Clock unpatched). The step position is derived from the
song position: `step = floor(ppq / stepLength)`, then mapped through
*Length* and *Direction*. The sequencer is therefore always phase-locked to
Live's (or Link's) bars, stays in place after a loop jump, and two sequencers
with the same Rate and Length line up. When the transport stops, gates fall and
notes end; the Pitch and Velocity outputs hold.

**Clock mode** (Clock patched). Each Clock pulse advances one step. The step
duration used for *Gate Length* and *Swing* is the time between the last two
pulses (the first step after a pause uses the previous duration, or a 1/16
note at 120 BPM if there's none). Swing delays every second step by
`(Swing − 50 %) × 2 × step duration`.

**Reset.** In Clock mode, the step after a Reset pulse is step 1; a Reset and a
Clock on the same sample play step 1. In Transport mode, Reset offsets the
song-position grid so that the next step boundary becomes step 1.

**Direction.**
- *Forward*: 1, 2, … Length, 1, …
- *Backward*: Length, … 1, Length, …
- *Ping-Pong*: 1 … Length … 2, 1 … (end steps are not repeated).
- *Random*: a seeded random step each time, never the same twice in a row (unless Length is 1).

*End* fires whenever the playhead returns to the first step of its cycle.

### 4.3 Scales

Quantizing picks the nearest note of the scale (relative to *Root*);
ties between two scale notes go **down**. Steps are quantized when they start,
so a moving *Transpose* signal never produces glitches inside a step.

| Scale | Intervals (semitones from the root) |
|---|---|
| Chromatic | 0 1 2 3 4 5 6 7 8 9 10 11 (no quantizing) |
| Major | 0 2 4 5 7 9 11 |
| Natural Minor | 0 2 3 5 7 8 10 |
| Harmonic Minor | 0 2 3 5 7 8 11 |
| Melodic Minor | 0 2 3 5 7 9 11 |
| Dorian | 0 2 3 5 7 9 10 |
| Phrygian | 0 1 3 5 7 8 10 |
| Lydian | 0 2 4 6 7 9 11 |
| Mixolydian | 0 2 4 5 7 9 10 |
| Locrian | 0 1 3 5 6 8 10 |
| Phrygian Dominant | 0 1 4 5 7 8 10 |
| Major Pentatonic | 0 2 4 7 9 |
| Minor Pentatonic | 0 3 5 7 10 |
| Blues | 0 3 5 6 7 10 |
| Whole Tone | 0 2 4 6 8 10 |
| Diminished (whole–half) | 0 2 3 5 6 8 9 11 |
| Hirajoshi | 0 2 3 7 8 |

The scale table lives in `patch/common/` so the Utility quantizer and Random's
*Quantize* can share it later.

### 4.4 Gates, ties and notes

- **On:** a note-on at the step start, a note-off after *Gate Length*. The Gate output follows.
- **Tie:** the note holds through to the next step. If the next step is *On* or
  *Tie* with a **different** pitch, the new note-on comes first and the old
  note-off follows on the same sample, so a Voice Cell in legato mode glides
  instead of retriggering; the Gate output stays high. With the **same** pitch,
  the note simply continues. A tie into an *Off* step ends at that step's start.
- **Off:** nothing plays; Pitch and Velocity hold their last values.
- **Step gate length** (1–100 %) scales *Gate Length* for that step.
- **Ratchet** (1–16): the step is split into that many equal parts (by its swung length), each playing the step's note again with its own gate (*Gate Length* × step gate length × the part's length). A tie does not carry over a ratcheted step. Trigger fires for every part.
- A note is never left hanging: changing Length or Direction, removing the
  step's gate, stopping the transport, Reset and removing the module all end
  the sounding note.

### 4.5 Randomizer

Two tools, one for writing patterns and one for playing them:

**Randomize** rewrites the pattern, one lane at a time or all at once: each
lane has a dice button (⚄) next to its name (Gate: new gates and ties; Pitch:
new pitches; Vel: new velocities; Ratchet: new ratchet counts), and **Randomize all** in the toolbar
rewrites all four. A panel opened with **▾** holds the density; each lane has a
two-handle **range slider** next to its dice. All are remembered per module:

- **Density:** 0–100 %, the share of steps that get a gate (default 60 %); about one in eight gated steps becomes a Tie.
- **Gate length range** (Gate lane, default 50–100 %), **Pitch range** (semitones from the root, −24…36, default 0–12; drawn from the current scale), **Velocity range** (1–127, default 76–127), **Ratchet range** (1–16, default 1–2).
- Dragging a handle past the other pushes it; with both on one value the dice sets every step to it.

It writes all 32 steps (not only up to Length) and is one undo step. Each
click gives a new pattern; it uses a UI-side random source, not *Seed*.

**Variation** (a knob) changes the pattern only while it plays. At each step
start, with probability *Variation*, the step plays a random scale note within
*Variation Range* of its stored pitch, and a velocity varied by up to ±25 %.
Variation never adds or removes gates. The random choices come from *Seed* and
the step's position in the song (Transport mode) or a step counter that Reset
clears (Clock mode), so a render is repeatable, and modulating *Variation*
with an LFO or envelope gives patterns that evolve and come back.

## 5. Module view

The view has the usual knobs and settings (`specs.md` section 9.4) and a lane
editor above them:

```
 ┌───────────────────────────────────────────────────────────────┐
 │  [Randomize all] [▾]  [◀ shift]  [shift ▶]   [Clear]          │
 │ Gate⚄ ■ ■ □ ━ ■ □ ■ ■ │ ■ □ ■ ■ ━ ■ □ ■   (state, then length)│
 │ [range]▇ ▅ ▇ ▃ ▇ ▅ ▆ ▇ │ …                                   │
 │ Pitch⚄▁ ▃ ▁ ▅ ▇ ▁ ▃ ▂ │ …       (note names on hover/drag)   │
 │ Vel⚄  ▇ ▅ ▇ ▃ ▇ ▅ ▆ ▇ │ …                                    │
 │ Ratchet⚄ 1 2 1 4 1 3 1 1 │ …                                 │
 │       1       ▲       8                                       │
 └───────────────────────────────────────────────────────────────┘
```

- **Columns** are steps; steps beyond *Length* are dimmed but editable. The playhead column is highlighted.
- **Gate lane:** the strip on top cycles Off → On → Tie on click; dragging across steps paints the value of the first step clicked. The bars below set each step's gate length by height (an Off step turns On).
- **Ratchet lane:** the bar height is the note count, 1–16. Double-click resets a bar (also in the gate-length bars and the pitch lane).
- **Pitch lane:** click or drag to set the pitch at the pointer's height; dragging across steps draws a line. The value snaps to the current scale (Shift: single semitones, even outside it). A row under the lane shows each step's note name (e.g. *E4*). Double-click resets to the root.
- **Velocity lane:** drag across steps to draw a curve; with Shift, dragging moves the value relative to where it started (fine).
- **Shift ◀ ▶** rotates the steps within Length by one; **Clear** sets all gates to Off. Both are one undo step each.
- A drag is one undo step (`beginGesture`, `specs.md` section 9.10).
- Steps whose last play was varied (4.5) show a dot in the pitch lane, so you can see what Variation does.

The lane editor sits above the knobs. The window is 1180 px wide so all four knob sections fit in one row; the 32 columns (22 px each) scroll horizontally if it is narrower.

## 6. Saved state

Besides its knob and setting values, the node stores its steps and the
randomizer options in the board document:

```json
{
  "type": "step-sequencer",
  "params": { "length": 0.4839, "scale": 0.0625, … },
  "data": {
    "steps": [ { "g": 1, "p": 0, "v": 100, "l": 100, "r": 1 }, … 32 entries … ],
    "randomize": { "density": 0.6, "range": { "pitch": [0, 12], "velocity": [76, 127], "gatelen": [50, 100], "ratchet": [1, 2] } }
  }
}
```

`g` is 0 = Off, 1 = On, 2 = Tie; `l` is the gate length in % (1–100) and `r` the ratchet count (1–16); both are optional (100 and 1). Missing or short `steps` arrays are padded
with Off/0/100 when loading; values out of range are clamped (sanitise).
A new module starts with 16 steps, all On, pitch 0, velocity 100, so it plays
the root right away.

## 7. Engine requirements

Implemented for this module, and available to any module:

1. **Node data.** Nodes may carry a free-form `data` object. A module type
   opts in with `ModuleSpec::sanitiseData` (JSON in, valid JSON out, defaults
   for a new node); `board::sanitise` runs it, so the data is kept, copied with
   the node (copy/paste, cells, presets) and part of undo.
2. **Data to the audio thread.** `Module::setData(json)` is called when the
   program is compiled and when the board calls `setData(node, data)` (like
   `setParam`: no recompile, no undo entry of its own; the view calls
   `beginGesture` first). The sequencer parses the steps on the message thread
   and hands them over through a spin lock the audio thread only try-locks.
   The playhead doesn't move.
3. **State across recompiles.** Modules are reused by node id, so the playhead,
   clock timing and sounding note survive patching elsewhere.
4. **Live values.** `Module::liveValues` adds `step`, `varied` (bit mask) and
   `sounding` to the node's state for open views.
5. **Inside Voice Cells:** works per voice like any module (each voice runs
   its own sequence), but the usual place is outside, feeding the cell's
   notes input. A Voice Cell releases its notes when what feeds its *Notes*
   input changes (`specs.md` section 8.3.1), so deleting or unpatching a
   sequencer never leaves a note hanging.

## 8. Tests

- Transport mode: steps land on the right samples for each Rate, including dotted and triplet, and after a loop jump.
- Clock mode: one step per pulse; Reset and Clock on the same sample play step 1; Swing delays even steps by the right amount.
- Each Direction produces the documented order; Random never repeats a step (Length > 1).
- Quantizing: every scale against a table of inputs, including ties going down and negative pitches.
- Ties: legato order (new note-on before old note-off), same-pitch continuation, tie into Off.
- No hanging notes: after stop, Reset, Length change and removal, every note-on has a note-off.
- Variation 0 % plays the pattern exactly; the same Seed gives the same output twice; Variation never changes gates.
- Saved data round-trips; short or broken `steps` arrays load safely.
- The demo types file includes the module (`patch.ui-types`).
- Engine: data is padded and clamped; a step edit changes the sound without a commit or an undo entry; ties play legato through a Voice Cell; deleting the sequencer releases the held note.

## 9. Later

- Per-lane lengths (polymeter) and per-lane directions.
- Per-step probability, ratchets (repeats within a step) and micro-timing.
- More lanes: a modulation lane (`control` output) and per-step slide.
- Pattern slots switched by a control input.
- User scales (12 toggles) and scales with more or fewer than 12 notes per octave.
- Record notes from a *Notes* input into the steps.
