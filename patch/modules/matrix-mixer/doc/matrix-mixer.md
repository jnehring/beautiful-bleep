# Matrix Mixer

![Matrix Mixer in the module view](matrix-mixer.png)

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

<!-- generated:demos -->
## Demo patches

Five whole patches show what Matrix Mixer does. In the standalone app open **File → Presets…** (⌘P) and pick *Matrix Mixer* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Matrix Mixer: Four Into Stereo** | Four sources (bass, chords, lead, drums) go into a 4 by 2 matrix, each with its own left and right gain: the bass sits in the middle, the chords lean left, the lead right and the drums are spread. Click a crosspoint to change how much of a source goes to which side. |
| **Matrix Mixer: Scene Morph** | Two stored snapshots: A is a sparse scene with bass and a pad, B adds drums and the lead on the right. A slow LFO on Morph blends smoothly between them, so the arrangement builds and thins by itself. Drag Morph by hand, or edit a snapshot's crosspoints. |
| **Matrix Mixer: Voice Swap** | A saw arpeggio and a square arpeggio enter a 2 by 2 matrix. Each output carries a mix of both, and two LFOs in opposite phase move the crossing gains, so the voices drift from one side to the other and back. Change a gain to a negative value to hear phase effects. |
| **Matrix Mixer: One to Many** | One plucked line fans out to four outputs through four crosspoints with different gains; outputs 1 and 2 go to the speakers and outputs 3 and 4 pass through delays on the other side, so a single melody turns into a stereo echo field. Raise or lower the 1 to 3 and 1 to 4 gains to place the echoes. |
| **Matrix Mixer: Soft Clip Stage** | Four loud parts are summed into one output with every crosspoint at full gain, and the Output Stage setting is Soft clip, so peaks are rounded off instead of cutting hard. Try Clean and Normalize for the other behaviours, or turn Level 1 down to rebalance. |
<!-- /generated -->

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
