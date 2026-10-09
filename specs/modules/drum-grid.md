# Drum Grid

Type id `drum-grid` · category *Sequencing* · colour proposal `#fb923c`

## 1. Purpose

A drum-machine style sequencer: eight tracks (rows) by up to 32 steps
(columns), each cell *Off*, *On* or *Accent*. Every track has its own *Gate*,
*Accent* and *Velocity* outputs, so each row plays one drum module. The module
holds 16 pattern slots that can be switched live, and patterns can be saved to
and loaded from a pattern library shared by all sets.

It is the rhythmic sibling of the *Step Sequencer*: no pitch, many tracks, and
a grid you can read at a glance.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Clock | `trigger` | External tempo. Each pulse advances by 1/*Clock PPQN* of a quarter note (see 4.2). Patched, it overrides *Source*. |
| Run | `gate` | Start/stop. A rising edge starts the pattern at step 1; while low, the grid is stopped. Unpatched: always running (while the transport plays, in Transport mode). |
| Reset | `trigger` | The next step played is step 1 (as in the Step Sequencer, 4.2 there). |
| Pattern | `control` (unipolar) | Selects the pattern slot: `slot = floor(value × 16)`, clamped to 1–16. Read when a switch can happen (see 4.4). Unpatched: the slot chosen in the view. |

Every knob is also an input (`specs.md` section 7.3); this includes *Tempo*,
so the tempo itself can be modulated.

**Outputs** — for each track *n* = 1…8:

| Jack | Type | What it carries |
|---|---|---|
| Gate *n* | `gate` | High for *Gate Length* of each step that is *On* or *Accent*. Its rising edge triggers a drum module. |
| Accent *n* | `gate` | High together with Gate *n*, but only on *Accent* steps. |
| Velocity *n* | `control` (unipolar) | The current step's velocity: 1.0 on an *Accent* step, *Velocity* (knob) on an *On* step. Changes at the step start and holds until the next played step, so a drum's *Velocity* input samples the right value at the trigger. |

and, for the whole grid:

| Jack | Type | What it carries |
|---|---|---|
| Accent | `gate` | High while any track plays an *Accent* step (a common accent bus). |
| Step Clock | `trigger` | A pulse at every step, played or not. Useful to clock other sequencers in step with the grid. |
| End | `trigger` | A pulse when the pattern wraps to step 1 (also when it switches to another pattern). |
| Running | `gate` | High while the grid plays. |

Why both *Accent* and *Velocity*: the drum modules take velocity as a
`control` input (`DrumModule.h`). An *Accent* gate patched there would give
0 on normal steps, i.e. silence, so *Velocity n* is the jack to patch into a
drum, and *Accent n* is for everything else (opening a filter, raising a VCA,
switching a drum's tone).

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Tempo | 20–300 BPM | 120 | Speed in *Tempo* mode (see 4.2). Ignored in Transport and Clock mode. |
| Gate Length | 1–100 % of a step | 25 % | Length of each gate. Short by default, because drums only need the edge. |
| Swing | 50–75 % | 50 % | Delays every second step; 50 % is straight. All modes swing. |
| Velocity | 0–100 % | 70 % | Velocity of *On* steps; *Accent* steps always play at 100 %. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Source | Transport, Tempo | Transport |
| Rate | 1/4 … 1/32 each straight, dotted and triplet | 1/16 |
| Clock PPQN | 1 (a pulse per step), 2, 4, 24, 48 per quarter note | 1 (per step) |
| Switch | At End, Immediate | At End |

*Length* is stored per pattern, not as a setting (see 4.1).

## 4. Behaviour

### 4.1 Tracks, steps and patterns

A **pattern** is 8 tracks × 32 steps, a *Length* of 1–32 steps (default 16)
and a name. Each step is *Off*, *On* or *Accent*. Steps beyond *Length* keep
their data, so shortening a pattern loses nothing.

The module holds **16 pattern slots**. A new module starts with slot 1 holding
a simple four-on-the-floor pattern (kick on every beat, closed hat on the
off-beats) so it makes sound at once; the other slots are empty.

Each **track** has, shared by all patterns:

- a **name** (defaults: *Kick*, *Snare*, *Closed Hat*, *Open Hat*, *Clap*, *Low Tom*, *High Tom*, *Perc*), shown in the view;
- **Mute**: a muted track's outputs stay low; its steps still show and edit;
- **Solo**: while any track is soloed, only soloed tracks play.

Mute and Solo are node data, not knobs, so they don't take part in
modulation; flipping them doesn't recompile (like step edits).

### 4.2 Timing

The grid always plays steps of *Rate*; the three sources only differ in where
time comes from.

**Transport** (*Source* = Transport, Clock unpatched). As in the Step
Sequencer: `step = floor(ppq / stepLength)`, mapped through *Length*. The
grid is phase-locked to Live's (or Link's) bars, survives loop jumps, and
stops when the transport stops (gates fall).

**Tempo** (*Source* = Tempo, Clock unpatched). The grid runs from its own
clock at *Tempo*, independent of the transport. This is for the standalone
app without Link, for polyrhythms against the song tempo, and for modulating
the tempo itself. The step phase accumulates per sample, so a moving *Tempo*
knob speeds up and slows down smoothly without skipping steps.

**Clock** (Clock patched). Each pulse is 1/*Clock PPQN* of a quarter note;
the grid advances one step every `PPQN × stepLengthInQuarters` pulses
(e.g. 24 PPQN at 1/16 = one step every 6 pulses; at 1 = "per step", one step
per pulse whatever the *Rate*). Non-integer pulse counts (e.g. 4 PPQN at a
triplet rate) are rounded to the nearest pulse and the setting shows a warning
mark. The step duration for *Gate Length* and *Swing* is measured from the
last two steps, as in the Step Sequencer.

**Swing** delays every even step (2, 4, …) by
`(Swing − 50 %) × 2 × step duration`, in all three modes.

### 4.3 Run and Reset

- **Run patched:** a rising edge restarts at step 1 on the next step boundary
  (Clock: on the next pulse; Tempo: immediately; Transport: the song-position
  grid is offset so the next boundary is step 1, as Reset does in the Step
  Sequencer). While Run is low, nothing plays and the playhead stays put.
- **Run unpatched:** the grid runs (in Transport mode, while the transport plays).
- **Reset** returns to step 1 without stopping. Reset and a step on the same
  sample play step 1.
- Stopping (Run falling, transport stop, Reset) ends every gate at once and
  leaves Velocity outputs holding.

### 4.4 Pattern switching

The current slot is chosen in the view or by the *Pattern* input (patched
wins). A change is **queued** and happens:

- *Switch* = At End: when the current pattern wraps to step 1. In Transport
  mode the new pattern starts at its own step 1, so a 12-step pattern
  following a 16-step one still lands on the bar line only if their lengths
  allow it; the grid doesn't stretch patterns.
- *Switch* = Immediate: at the next step; the playhead keeps its position
  modulo the new *Length*.

The *Pattern* input is only read at those moments, so a noisy or moving signal
never switches mid-pattern in At End mode. Switching to an empty slot plays
silence (a deliberate break), it isn't skipped.

### 4.5 Gates

- Each played step opens Gate *n* for *Gate Length*. Two played steps in a row
  give two separate gates: if *Gate Length* is 100 %, the gate drops for one
  sample at the step start so the drum sees a new rising edge.
- A note is never "hung": a gate always closes within one step, and changing
  pattern, Length, Mute/Solo, stopping or removing the module closes it at once.

### 4.6 Presets

Patterns can be stored outside the board, in a **pattern library** shared by
all sets, like cell presets (`specs.md` section 8.1):

- **Save Pattern…** writes the shown pattern (its steps, Length and name, plus
  the track names) to the library under a name and a category.
- **Loading** a preset writes it into the shown slot (one undo step). The
  track names are only taken over if the current ones are still the defaults,
  so loading a pattern never renames a kit you've labelled.
- **Factory patterns** ship with the plugin, grouped by style (e.g. *Basics*:
  Four on the Floor, Backbeat, Half-Time; *House*, *Techno*, *Breaks*,
  *Electro*, *Hip-Hop*, *Latin*, *Odd Meters* (5/4, 7/8 lengths)). All our
  own; drum patterns are generic and carry no hardware or artist names.
- The whole module, with all 16 slots, mute/solo and knob values, is saved
  with the board, and as part of any cell preset that contains it; the pattern
  library is for moving single patterns between boards.

## 5. Module view

```
 ┌──────────────────────────────────────────────────────────────────┐
 │ Pattern [1][2][3][4][5][6][7][8][9]…[16]   Length [16]           │
 │ [Presets ▾]  [Copy] [Paste] [Clear]  [◀] [▶]                     │
 │                  1       5       9       13                      │
 │ Kick       M S  ■ · · · ■ · · · ■ · · · ■ · · ·                  │
 │ Snare      M S  · · · · ▣ · · · · · · · ▣ · · ·                  │
 │ Closed Hat M S  · · ■ · · · ■ · · · ■ · · · ■ ·                  │
 │ …                                                                │
 │                         ▲ playhead                               │
 │ (Tempo) (Gate Length) (Swing) (Velocity)  Source/Rate/PPQN/Switch│
 └──────────────────────────────────────────────────────────────────┘
   ■ On   ▣ Accent (brighter, with a mark)   · Off
```

- **Cells:** click cycles Off → On → Accent → Off. Shift-click toggles Off ↔
  Accent directly. Dragging across a row or several rows paints the value the
  first click produced. One drag is one undo step (`beginGesture`).
- **Beats:** every fourth column (for straight rates) has a darker background,
  so bars are easy to read. Steps beyond *Length* are dimmed but editable;
  dragging the *Length* edge marker in the header changes *Length*.
- **Playhead:** the playing column is highlighted; a playing cell flashes.
- **Track header:** double-click the name to rename it; **M** mutes and **S** solos.
  Hovering a row shows ◀ ▶ to rotate that row alone.
- **Pattern slots:** 16 buttons. Filled = has steps, outlined = empty,
  solid = playing, blinking = queued. Click selects (queued, see 4.4) **and**
  shows that slot for editing; Alt-click only shows it for editing without
  switching playback (the header then says *Editing 5 · Playing 2*). When
  *Pattern* is patched, the input decides what plays; the solid button
  follows it.
- **Copy / Paste** copy the shown pattern to another slot; **Clear** empties it;
  **◀ ▶** rotate all rows within *Length*. Each is one undo step.
- **Presets ▾** (see 4.6 and section 6): *Factory ›* by style, *User ›* by
  category, *Save Pattern…* (name + category), *Delete ›*.

The window is 640 px wide; 32 columns of 16 px scroll horizontally when
*Length* > 24.

## 6. Saved state

In the board document:

```json
{
  "type": "drum-grid",
  "params": { "tempo": 0.3571, "swing": 0.0, … },
  "data": {
    "tracks": [ { "name": "Kick", "mute": false, "solo": false }, … 8 … ],
    "current": 0,
    "patterns": [
      { "name": "Four on the Floor", "length": 16,
        "steps": [ "x...x...x...x...", "....X.......X...", … 8 strings … ] },
      null, … 16 entries …
    ]
  }
}
```

Each track's steps are a string of up to 32 characters: `.` Off, `x` On,
`X` Accent. Strings are compact, diff well and are easy to type for factory
patterns. `null` is an empty slot. When loading (sanitise): unknown characters
become `.`, short strings are padded with `.`, long ones cut at 32, missing
tracks/slots are padded, Length is clamped to 1–32, `current` to 0–15.

**Pattern library file** — one JSON file per preset, extension `.bleepdrums`,
in `<user app data>/Bleep Patch/Drum Patterns/` (next to `Cells/`):

```json
{ "name": "Four on the Floor",
  "preset": { "category": "My Kits", "version": 1,
              "pattern": { "name": "Four on the Floor", "length": 16,
                           "steps": [ … 8 strings … ],
                           "trackNames": [ "Kick", "Snare", … ] } } }
```

The outer `{name, preset}` is the same wrapper cell presets use. Factory
patterns use the same shape and live in the UI bundle
(`modules/drum-grid/ui/drum-grid-patterns.js`, `window.BleepDrumPatterns`),
like `BleepFactoryPresets`.

## 7. Engine requirements

1. **Node data, `setData`, state across recompiles, live values** — all exist
   (Step Sequencer, section 7 there). The Drum Grid parses the strings on the
   message thread into a fixed `uint8_t [16][8][32]` array plus lengths and
   hands it over the same way. Live values: `step`, `playing` (slot),
   `queued` (slot or −1) and `hits` (8-bit mask of tracks that fired on the
   current step) for the flashing cells.
2. **Free-running clock.** The *Tempo* source needs no transport; it uses the
   module's own phase, kept across recompiles like the playhead.
3. **Pattern library.** The board window's preset functions (`presets`,
   `savePreset`, `deletePreset` in `BoardWindow.cpp`) take an optional
   trailing *kind* argument (`"cell"`, the default → `Cells/*.bleepcell`,
   `"drums"` → `Drum Patterns/*.bleepdrums`), so later modules (Morph
   snapshots, Step Sequencer patterns) can reuse them. Module views reach
   them through `api.presets(kind)`, `api.savePreset(kind, name, preset)`
   and `api.deletePreset(kind, name)`.
4. **Many outputs.** 28 output jacks is more than any module so far. The
   node on the canvas shows the first few and collapses the rest
   (*+ 24 more*), as it does for ports; that is enough for now. A grouped
   per-track jack (*Gate · Acc · Vel*) is listed under Later.

## 8. Tests

- Transport mode: steps land on the right samples at every Rate, including dotted/triplet and after a loop jump; gates stop with the transport.
- Tempo mode: step duration matches *Tempo*; modulating *Tempo* changes speed without skipped or doubled steps.
- Clock mode: each PPQN setting advances one step per the right number of pulses; "per step" ignores Rate.
- Run: a rising edge starts at step 1; low stops and closes all gates; unpatched runs. Reset and step on the same sample play step 1.
- Swing delays even steps by the documented amount in all modes.
- Outputs: Gate on On and Accent; Accent only on Accent; Velocity = knob on On, 1.0 on Accent, held between steps; the global Accent is the OR of the tracks; back-to-back steps at 100 % Gate Length give two rising edges.
- Mute and Solo silence the right tracks; a mute mid-gate closes the gate.
- Pattern switching: At End switches on wrap, Immediate on the next step; the Pattern input maps 0–1 to slots 1–16 and is only read at switch points; an empty slot plays silence.
- Saved data round-trips; broken strings, short arrays and out-of-range values load safely.
- Pattern library: save, list, load and delete round-trip; loading keeps custom track names.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Per-track lengths (polymeter) and per-track rates.
- Per-step probability, ratchets/flams and micro-timing (nudge).
- Choke groups (e.g. closed hat closes the open hat's gate).
- Pattern chains (play 1, 1, 2, 3 …) and song mode.
- Fill: a held *Fill* gate input switches to a fill pattern for one cycle.
- A *Notes* output (one note per track, GM drum map) to play Live's Drum Racks through a MIDI Out port.
- Record from a *Notes* input or by tapping track buttons while playing.
- More than 8 tracks; track names on the node's jack labels.
- Grouped jacks on the node: one stacked *Gate · Acc · Vel* jack per track.
- The view greys out the slot buttons while *Pattern* is patched.
- A randomizer / Euclidean fill per row, like the Step Sequencer's.
