# Drum Notes

## Introduction

Drum Notes turns the General MIDI drum notes of a MIDI track into triggers: one
output per drum. Patch *Kick* into a kick drum's trigger, *Closed Hat* into a
hat voice, and the keys of a drum pad or a MIDI clip play your kit. It is how
the drum machines in Bleep Instrument take MIDI from Live while their own
pattern keeps playing.

## How does it work?

**Notes in, triggers out.** Each note-on whose note belongs to a drum sends a
one-sample pulse to that drum's output. Note-offs are ignored: a drum is a
hit, not a held note. Notes that are not on the table below do nothing.

**Velocity.** *Velocity* carries the velocity of the last hit (0 … 1) for a
moment (about a millisecond) around the trigger, and is 0 the rest of the
time. Patch it into the *Velocity* (or *Accent*) input of a drum voice that
also gets a velocity from a sequencer: the voice then plays a key's hit at the
key's velocity and the sequencer's hits unchanged.

**Several drums on one voice.** An output can go to any number of inputs, and
an input takes any number of cables, so two drums can share one voice, for
example *Closed Hat* and *Open Hat* into one hat.

## How to use it?

- **Play a kit from the keys:** a Notes source (a MIDI input, or a drum machine
  cell's Notes input) into *Notes*; each drum output into one voice's trigger.
- **Add MIDI to a pattern:** keep the sequencer's cables and add Drum Notes
  next to them. Triggers merge, so the pattern and the keys both play.
- **Fewer voices than drums:** send *Closed Hat* and *Open Hat*, or the three
  toms, to the same voice.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Drum Notes does. In the standalone app open **File → Presets…** (⌘P) and pick *Drum Notes* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Drum Notes: Backbeat Kit** | One sequencer plays kick and snare as General MIDI note numbers, another plays closed and open hats; Drum Notes turns each note into a trigger for the right drum. Edit a step's pitch in the sequencer to move a hit to another drum. |
| **Drum Notes: Ring Kit Shuffle** | The same note-to-drum routing drives a softer, rounder kit of resonant drums on a swung sixteenth grid, with claps on the backbeat. Change the Swing on the sequencers, or swap a kit voice's Tune, and the pattern keeps its feel. |
| **Drum Notes: Percussion Circle** | Toms, a woody rim click, a cowbell and a clap are all played from note numbers: Drum Notes has an output for each. Mute one of the sequencers' steps, or tune the toms down, to open up the groove. |
| **Drum Notes: Ride and Crash** | A lazy jazz feel: the ride pattern, a pedal hi-hat, a feathered kick and one crash at the top of the bar, all as note numbers. Try the Cymbal's Voice or Decay, or lengthen the ride's pattern. |
| **Drum Notes: Ghost Notes** | Drum Notes also passes each hit's velocity, so the quiet ghost snares between the backbeats really are quiet while the accents bite. Raise or lower a step's velocity in the sequencer and hear the dynamics change. |
<!-- /generated -->

## Reference

### Notes

| Output | Drum | General MIDI notes |
|---|---|---|
| Kick | Bass drum | 35, 36 |
| Snare | Snare | 38, 40 |
| Rim | Side stick | 37 |
| Clap | Hand clap | 39 |
| Closed Hat | Closed and pedal hi-hat | 42, 44 |
| Open Hat | Open hi-hat | 46 |
| Tom | Low to high toms | 41, 43, 45, 47, 48, 50 |
| Cowbell | Cowbell | 56 |
| Ride | Ride cymbals | 51, 53, 59 |
| Crash | Crash cymbals | 49, 52, 55, 57 |

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Notes | notes | the MIDI notes to listen to, all channels |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Kick, Snare, Rim, Clap, Closed Hat, Open Hat, Tom, Cowbell, Ride, Crash | trigger | a one-sample pulse for each note-on of that drum |
| Velocity | control, 0 … 1 | the hit's velocity for about a millisecond, then 0 |

The module has no knobs.
