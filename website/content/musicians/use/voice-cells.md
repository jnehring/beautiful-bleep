---
title: Voice Cells
description: Turn one patched synth voice into a polyphonic instrument with up to 16 voices.
order: 2
---

# Voice Cells: polyphonic synths

A **Voice Cell** turns one synthesizer voice into a polyphonic instrument. Inside,
you patch *one* voice, like a mono synth. The cell plays it once per note, up
to 16 voices at a time.

## Make one

- **Add → Cell → New Voice Cell** gives you a cell with a starter voice inside:
  Oscillator → VCA, with an ADSR on the VCA's gain. It makes sound right away.
- **Add → Cell → Synthesizers → Basic Poly** is a ready-made synth: Oscillator →
  Multi Filter (Rough) → VCA, one ADSR for the filter and one for the VCA.
- Right-click an ordinary cell → **Make Voice Cell** turns it into one.

## Connect it

From outside, a Voice Cell has:

| Jack | What |
|---|---|
| **Notes** | all notes, e.g. from MIDI Device *Notes* |
| **Out L / Out R** | all voices, mixed |
| your own inputs | the same signal for every voice: an LFO, a cutoff macro, pitch bend |
| your own outputs | summed over the voices |

To play it from a sequencer or any pitch + gate source, put **CV to Notes** in
between.

## Design the voice

Double-click the cell. Inside are two fixed nodes:

- **Voice In** gives *this voice* its note: *Pitch*, *Gate*, *Trigger*,
  *Velocity*, *Release*, *Pressure*, *Voice #* (0, 1, 2 …) and *Random* (a new
  value per note, for a little variation between voices).
- **Voice Out** takes the voice's audio (*Out L*, *Out R*) and *Active*: patch
  the amp ADSR's *Active* here, so the voice is freed exactly when its sound
  has faded.

A knob you turn inside changes it in every voice. Add your own shared inputs and
outputs by dropping a cable on *Cell In*'s or *Cell Out*'s "new" row.

**Pitch bend:** patch MIDI Device *Bend* into a shared input and, inside, into
the oscillator's *Pitch* with amount 2/12 for ±2 semitones (that's how Basic
Poly does it).

## Settings

Click the cell to open its view:

| Setting | What it does |
|---|---|
| Voices | 1–16 |
| Allocation | which free voice a new note gets: round robin, the lowest free one, or the voice that last played the same note |
| Stealing | when all voices are busy: take the oldest, quietest, lowest or highest note — or none (the new note is dropped) |
| Mode | Poly; Mono (one voice, every note restarts the envelopes); Legato (one voice, overlapping notes don't restart them) |
| Glide | time to slide from one pitch to the next; *Glide Mode*: always, or only when notes overlap |
| Stereo Spread | spreads the voices from left to right |
| Output | plain sum, or compensated (quieter per voice, so 8 voices don't clip) |

The dots on the node light up for the voices that play. Voices that don't play
use no CPU.

## Save it

Right-click → **Save as preset**, give it a name and a category (e.g.
*Synthesizers*). It then appears under **Add → Cell → <category>** in every
project.
