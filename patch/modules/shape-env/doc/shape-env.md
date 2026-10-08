# Shape Env

## Introduction

Shape Env is an **envelope and LFO that plays shapes from a library**
instead of building them from stages. There are 96 ready-made shapes
(percussive decays, plucks, swells, sustained envelopes, bounces, stairs,
rhythmic gates, classic and unusual LFO waves, organic textures) and 8 slots
for shapes you draw yourself.

Pick a shape, set how long it takes, and trigger it: a one-shot envelope.
Hold a gate and it waits at the shape's sustain point. Loop it and it's an
LFO. Shapes that no attack-decay-sustain-release could ever make (echoing
bounces, stutters, irregular gates) are one click away.

## How does it work?

**Choosing.** *Shape* picks one of 104: 0–95 are the library, 96–103 your
own (*User 1 … 8*). The knob shows the shape's name. **Browse** opens a grid
of thumbnails grouped by family; hover one to see it big, click to choose it.
With the view focused, ← and → step through the shapes.

**Morph** blends the shape into its neighbour in the list. Neighbours are
related (Short exp → Long exp, Bounce 5 → Bounce 8), so Morph moves smoothly
between them; across a family boundary it blends unlike shapes, which can be
fun too.

**Time** is how long the whole shape takes (1 ms – 60 s), or one cycle in
Loop. With *Sync* it's a note value instead. **Skew** warps time without
changing the length: + plays the start faster and the end slower (at +1 the
first half takes a quarter of the time), − the other way. **Reverse** plays
the shape backwards.

**Level** scales the output, and *Vel Amount* lets the *Velocity* input
scale it: at 0 % every start is full level, at 100 % the level follows the
velocity. Velocity is read at each start.

### Modes

- **One-shot:** *Trig* or a rising *Gate* plays the whole shape once; *End*
  fires at the end and the output stays at the last value (0 for
  envelopes). A new start while it plays restarts it with a 2 ms crossfade
  (no click), or, with *Retrigger* on *Ignore*, is ignored until it's done.
- **Gated:** like One-shot, but while the Gate is high the shape waits at its
  **sustain point** (the dashed line in the preview), and plays the rest when
  the gate falls. A short gate that ends before the sustain point just plays
  through. Shapes without a sustain point behave as One-shot; *Trig* starts
  the shape like a very short gate.
- **Loop:** the shape repeats every *Time*; *End* fires at each wrap. Trig
  or Gate restart it (crossfaded). Envelope shapes loop too: a repeating
  decay is a classic rhythmic effect. With *Sync* and the transport playing,
  the loop is locked to the song position: always at the same place in the
  bar, after loop jumps too, and every render is the same.

In One-shot and Gated a new *Shape* is picked up at the next start; in Loop
it crossfades over 5 ms. *Morph* works at any time.

*Phase* outputs where the playback is (0 … 1): a ramp for other modules.
*Active* is high while the shape plays (always in Loop). *Inv* is the upside
down shape (`1 − Out`, or `−Out` for bipolar shapes).

### Drawing your own

Select a user slot (*User 1 … 8*) and press **Draw**. Drag to draw freehand,
or choose **Line** to drag straight segments. **Smooth** softens the drawing,
**Mirror** makes it symmetric, **Snap 8 / 16** turns it into steps.
**Sustain** lets you click where Gated mode should wait (**No sustain**
removes it). **Envelope / Cycle** decides whether the shape loops seamlessly
(a cycle ends where it starts), **± Bipolar** whether it spans −1 … +1.

On a library shape, **Copy to** puts the shape as you see it (with Morph,
Skew and Reverse) into a user slot, ready to be changed. Every stroke is one
undo step. Drawn shapes are saved with the board.

## How to use it?

- **Percussive accents:** Decays or Plucks, Time 200 ms, One-shot, triggered
  by a sequencer, onto a VCA.
- **Echoing gate:** *Bounces › Echoes 1/8*, Sync 1/2, triggered on the beat:
  a VCA that echoes the note.
- **Rhythmic chopper:** *Gates* family, Loop, Sync 1 bar, onto a VCA: a
  trance gate. Morph between two patterns for variations.
- **Pad envelope in a Voice Cell:** *Sustains › Pad*, Gated, *Gate* from
  *Voice In*, *Active* into *Voice Out › Active*.
- **Breathing LFO:** *Wobbles › Breathing*, Loop, Time 4 s, onto a filter.
- **Your own groove:** draw a shape in *User 1*, Snap 16, Loop, Sync 1 bar:
  a step-like modulation drawn in seconds.

## Reference

### Knobs

| Knob | Range | Default |
|---|---|---|
| Time | 1 ms – 60 s | 500 ms |
| Shape | 104 shapes (96 library, 8 user) | Click |
| Morph | 0 – 100 % | 0 % |
| Level | 0 – 100 % | 100 % |
| Vel Amount | 0 – 100 % | 0 % |
| Skew | −1 … +1 | 0 |

Every knob is a modulation destination (a cable on *Shape* steps through the
library).

### Settings

| Setting | Values | Default |
|---|---|---|
| Mode | One-shot, Gated, Loop | One-shot |
| Sync | Off, 16 bars … 1/32T (straight, dotted, triplet) | Off |
| Reverse | Off, On | Off |
| Retrigger (One-shot, Gated) | Restart, Ignore | Restart |

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Trig | trigger | starts the shape |
| Gate | gate | starts the shape; in Gated mode holds it at the sustain point while high |
| Velocity | control | scales the level through *Vel Amount* (unpatched: full) |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out | control | the shape |
| Inv | control | the shape upside down |
| Phase | control | the playback position, 0 … 1 |
| End | trigger | the shape finished (or wrapped, in Loop) |
| Active | gate | the shape is playing |
