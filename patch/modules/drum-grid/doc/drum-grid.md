# Drum Grid

## Introduction

The Drum Grid is a drum machine's step sequencer: **8 tracks** by up to
**32 steps**, and each step is off, on or **accented**. Every track has its own
*Gate*, *Accent* and *Velocity* outputs, so each row plays one drum module.

The module holds **16 pattern slots** that you can switch while it plays, and
single patterns can be saved to a **pattern library** shared by all your sets.
A set of factory patterns gets you started.

## How does it work?

**Timing.** The grid plays steps of *Rate*. Time comes from one of three places:
- **Transport** (the default): the step is worked out from the song position, so
  the grid stays in time with the bars and after loop jumps. It stops with the
  transport.
- **Tempo:** set *Source* to *Tempo* and the grid runs from its own *Tempo*
  knob, transport or not. *Tempo* is a knob, so you can modulate it.
- **Clock:** patch a clock into *Clock* and it takes over. *Clock PPQN* says how
  many pulses make a quarter note (24 and 48 are common), or *1 per step* for
  one pulse per step whatever the Rate. If the pulses don't divide the Rate
  evenly, the view shows **⚠ PPQN** and steps are rounded to whole pulses.

**Run and Reset.** A gate into *Run* starts and stops the grid: a rising edge
starts again at step 1, low stops it. Without a cable the grid just runs.
*Reset* jumps to step 1 without stopping.

**Steps.** *On* steps open the track's gate for *Gate Length*. *Accent* steps
do too and also open the track's *Accent* gate. *Velocity* is 100 % on an
accented step and the *Velocity* knob on a normal one, and holds until the
track plays again, so a drum's *Velocity* input reads the right value at the
hit. Two steps in a row always make two separate hits, even at 100 % Gate Length.

**Patterns.** Each slot has its own pattern and *Length*. Choosing another slot
switches at the end of the current pattern (*Switch: At End*) or at the next
step (*Immediate*). A cable into *Pattern* chooses the slot instead
(0 … 1 covers slots 1 … 16). An empty slot plays silence: a break.

## How to use it?

- **A drum kit:** patch *Gate 1* into a kick's *Trig* and *Velocity 1* into its
  *Velocity*; the same for the other tracks. Press play.
- **Drawing:** click a step to cycle off → on → accent; Shift-click toggles
  accent directly. Drag across steps to paint. Drag the marker on the ruler, or
  type in *Length*, to set the pattern's length.
- **Tracks:** click a name to rename it. **M** mutes, **S** solos. Hover a row
  for ‹ › to rotate just that row; ◀ ▶ rotate them all.
- **Slots:** click a number to play it (it blinks until it starts) and edit it.
  Alt-click edits a slot without playing it. **Copy** and **Paste** move a
  pattern between slots; **Clear** empties one.
- **Presets:** **Presets ▾** loads a factory or saved pattern into the slot
  you're editing. **Save Pattern…** stores the slot in your library. Loading a
  pattern only renames tracks that still have their default names.
- **Accents elsewhere:** *Accent n* or the shared *Accent* output can open a
  filter, push a VCA or switch a drum's tone on the accented hits.
- **Chaining:** *Step Clock* clocks other sequencers in step with the grid;
  *End* fires when a pattern starts over.

## Reference

### Knobs

| Knob | Range | Default |
|---|---|---|
| Tempo | 20 – 300 BPM | 120 |
| Gate Length | 1 – 100 % of a step | 25 % |
| Swing | 50 – 75 % | 50 % |
| Velocity | 0 – 100 % | 70 % |

- **Tempo:** the speed when *Source* is *Tempo*.
- **Gate Length:** how long each hit's gate stays high.
- **Swing:** delays every second step; 50 % is straight, 75 % a heavy shuffle.
- **Velocity:** the velocity of normal steps; accented steps are always 100 %.

Every knob is a modulation destination.

### Settings

| Setting | Values | Default |
|---|---|---|
| Source | Transport, Tempo | Transport |
| Rate | 1/4 … 1/32, dotted (.) and triplet (T) | 1/16 |
| Clock PPQN | 1 per step, 2, 4, 24, 48 | 1 per step |
| Switch | At End, Immediate | At End |

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Clock | trigger | external clock; overrides *Source* |
| Run | gate | rising: start at step 1; low: stopped; unpatched: running |
| Reset | trigger | the next step is step 1 |
| Pattern | control, 0 – 1 | chooses the slot, read when a switch can happen |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Gate 1 … 8 | gate | high for *Gate Length* on each on or accented step |
| Accent 1 … 8 | gate | the same, on accented steps only |
| Velocity 1 … 8 | control, 0 – 1 | the step's velocity, held between hits |
| Accent | gate | high while any track plays an accent |
| Step Clock | trigger | a pulse at every step |
| End | trigger | a pulse when the pattern starts over or switches |
| Running | gate | high while the grid plays |
