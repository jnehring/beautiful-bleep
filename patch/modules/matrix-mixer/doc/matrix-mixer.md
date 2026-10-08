# Matrix Mixer

## Introduction

A grid of up to **8 inputs by 8 outputs**. Every crosspoint is a gain from −1
to +1, so each output is its own mix of all the inputs. It mixes audio
(send and return busses, feedback networks, spreading one sound to several
effects) and control signals (blending LFOs into many related movements).
Every crosspoint is a knob you can modulate, and whole matrices can be stored
as **snapshots** and **morphed**.

## How does it work?

**The mix.** `Out j = Level j × Σ (gain i→j × In i)`. *Inputs* and *Outputs*
set how many rows and columns are in use; jacks beyond them are hidden (their
cables stay) and carry nothing. An unpatched input is 0, or 1 with
*Unpatched* = 1, so its row becomes a set of fixed offsets.

**Crosspoints.** In the grid a circle's size is the gain, warm colours are
positive, cool ones negative. Click an empty crosspoint for +1, a set one for
0; Alt-click for −1; drag up and down to set it (Shift: fine); double-click
to type a value. Every crosspoint is also a knob: cables can modulate it, even
at audio rate (ring modulation). Changes ramp over 20 ms, so recalling a
snapshot doesn't click.

**Mutes** silence a row with a 5 ms ramp. **Level** sets each output from
silent to +6 dB.

**Output Stage.** *Clean* passes everything (limited to ±10). *Soft clip*
rounds peaks above 0.9 smoothly towards ±1. *Normalize* divides each output by
the sum of its gains when that is above 1, so a column never gets louder than
its loudest input: feedback patches stay tame.

**Snapshots.** The eight buttons below the grid hold whole matrices (gains,
levels, mutes). Click recalls one, Shift-click stores the current matrix,
right-click renames, clears or makes it morph end A or B.

**Morph.** With *Morph* on, the gains blend from snapshot A to snapshot B as
the *Morph* knob turns (*Morph Curve*: Linear, Smooth, Equal power); levels
blend too, mutes switch halfway. Cables on crosspoints still add on top.
Editing a crosspoint then edits the snapshot nearest the Morph position, so
move Morph to 0 % or 100 % to shape either end.

**Feedback.** Patching an output back into an input works (one 32-sample
delay); with *Normalize* such loops stay stable.

## How to use it?

- **Effect sends:** inputs are sounds, outputs go to a delay and a reverb;
  each crosspoint is a send amount.
- **A feedback network:** outputs through delays or filters back into the
  inputs, *Normalize* on, gains around ±0.5.
- **Modulation blender:** four LFOs in, eight related modulations out.
- **Scene changes:** store snapshots, patch a slow LFO into *Morph*.

## Reference

### Knobs

| Knob | Range | Default |
|---|---|---|
| i → j (64) | −1 … +1 | 1 on the diagonal, else 0 |
| Level 1 … 8 | 0 – 200 % | 100 % |
| Morph | 0 – 100 % | 0 % |

Every knob is a modulation destination. The knob list shows only the rows and
columns in use.

### Settings

| Setting | Values | Default |
|---|---|---|
| Inputs | 1 – 8 | 4 |
| Outputs | 1 – 8 | 4 |
| Mute 1 … 8 | on / off | off |
| Output Stage | Clean, Soft clip, Normalize | Clean |
| Unpatched | 0, 1 | 0 |
| Morph | Off, On | Off |
| Morph Curve | Linear, Smooth, Equal power | Linear |

### Inputs

| Input | Signal | What it does |
|---|---|---|
| In 1 … In 8 | audio (any signal) | the sources |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out 1 … Out 8 | audio | Level × the weighted sum of the inputs, after the output stage |
