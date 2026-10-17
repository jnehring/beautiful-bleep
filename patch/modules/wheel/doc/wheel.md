# Wheel

![Wheel in the module view](wheel.png)

## Introduction

The Wheel is a **pitch or mod wheel** as a control signal. Drag it up and down
and *Out* follows; with **Spring** on it returns to the middle when you let
go, like the wheel on a keyboard. Patch *Out* onto an Oscillator's **Pitch** for
a pitch bend, or onto a filter's cutoff for a mod wheel.

## How does it work?

*Out* goes from **Min** at the bottom of the wheel to **Max** at the top. The
default range is −1 to +1 with the wheel centred, so at rest *Out* is 0. For a
mod wheel that rests at the bottom, set *Min* to 0 and turn *Spring* off.

**Spring** (on by default) moves the wheel back to the middle when you let go.
Off, it stays where you leave it.

**Smooth** glides *Out* to a new position instead of jumping.

A cable into *Value* moves the wheel like a hand would. In a panel, a Wheel
control drives this module.

## How to use it?

- **Pitch bend:** *Out* onto an Oscillator's **Pitch**, cable amount ±2 semitones.
- **Mod wheel:** *Min* 0, *Max* 1, *Spring* off, *Out* onto a filter's **Cutoff**.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Wheel does. In the standalone app open **File → Presets…** (⌘P) and pick *Wheel* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Wheel: Pitch Bend** | A lead line plays while the Wheel sits at rest in the middle (zero) and feeds the sequencer's Transpose input at a small amount: push it up or down and the whole line bends by a couple of notes, then springs back when you let go. Turn Spring off to leave it where you put it. |
| **Wheel: Fold Wheel** | Min is 0 and Spring is off, so this Wheel behaves like a mod wheel that stays where you leave it: it raises the wavefolder inside a dual oscillator, turning a plain tone into a bright, buzzing one. Drag it slowly across the tune and listen to the overtones appear. |
| **Wheel: Crunch Ride** | The Wheel rides the Drive and bit depth of a Crunch effect on a whole beat and bass: at rest the groove is clean and warm, pushed up it breaks into grit. Min is 0 here, so the wheel only adds grit; set it to -1 and the lower half takes the drive below the starting point. |
| **Wheel: Phaser Sweep** | A chord-like arpeggio passes through a slow phaser whose Centre frequency is steered by the Wheel instead of its LFO: roll it up and the notches climb, down and they sink. Raise the phaser's Feedback to make the sweep more vocal. |
| **Wheel: Tape Bend** | The Wheel pushes the delay time of a tape-style echo while a pluck melody plays: nudge it and the echoes slide in pitch as the tape speeds up or slows down, then settle when the wheel springs home. Turn Smooth up for lazier moves. |
<!-- /generated -->

## Reference

### Knobs

| Knob | Range | Default |
|---|---|---|
| Value | 0 – 100 % | 50 % |
| Min | −1 – +1 | −1 |
| Max | −1 – +1 | +1 |
| Smooth | 0 – 2 s | 20 ms |

Every knob is a modulation destination.

### Settings

| Setting | Values | Default |
|---|---|---|
| Spring | off, on | on |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out | control | the wheel's position, scaled from *Min* to *Max* |
