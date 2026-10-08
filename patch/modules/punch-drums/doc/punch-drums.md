# Punch Drums

## Introduction

The Punch drums are a drum kit, one node per instrument. They are built the
way the drum machines of the mid eighties built their sounds: sine waves
that restart on every hit and sweep down fast, with a click of noise on top,
and bright metal for the hats and cymbals, with an optional crunch like the
early samplers those machines used. The result is tight, hard and forward: a
kick that punches through, a snappy snare, crisp hats.

For a deeper, rounder kit, see the Ring drums.

## The voices

| Node | What it is | Main controls |
|---|---|---|
| Punch Kick | a sine that sweeps down fast, with a click | Tune, Decay, Sweep, Attack, Drive |
| Punch Snare | two swept sines and filtered noise | Tune, Tone, Snappy, Decay |
| Punch Clap | tight bursts of noise and a roomy tail | Tone, Decay, Spread, Bursts |
| Punch Tom | a sine that drops in pitch, with a touch of noise | Tune, Decay, Bend, Noise |
| Punch Rim | a hard, bright crack | Tune, Decay |
| Punch Hats | closed and open hats; closed cuts open | Tune, Closed Decay, Open Decay, Tone, Crunch |
| Punch Cymbal | crash or ride | Voice, Tune, Decay, Tone, Crunch |

Each node has its own manual behind the **?** button in its window.

## How does it work?

Every Punch drum works the same from the outside:

- A rising edge at **Trig** plays it (Punch Hats has two inputs, *Closed* and
  *Open*). Triggers and gates both work.
- **Velocity**, when patched, sets the loudness of each hit, read at the
  moment of the trigger. Unpatched, every hit is at full velocity. Velocity
  changes the loudness only, not the sound.
- **Level** sets the output volume. It starts at 80 %, so a few drums
  mixed together leave some headroom.
- **Out** is mono audio.

**Crunch** (hats and cymbals) lowers the bit depth and sample rate of the
metal, for the gritty sheen of an early sampler. At 0 % it's clean.

Every knob is a modulation destination, as everywhere on the board.

## How to use it?

- **A basic beat:** a Step Sequencer per drum, each one's *Trigger* into a
  drum's *Trig* and its *Velocity* into the drum's *Velocity*. Patch every
  drum's *Out* into the same Audio Out port: cables into one jack add up.
- **Four on the floor:** Punch Kick on every beat, Punch Clap on 2 and 4,
  Punch Hats *Open* on the offbeats and *Closed* on the sixteenths.
- **A drum kit as one node:** select the drums and their sequencers and group
  them into a cell, with a single audio output.
- **Mix the kits:** Ring and Punch drums share the same jacks; a Punch Kick
  with Ring Hats is just as easy.

## Reference

### Inputs (every Punch drum)

| Input | Signal | What it does |
|---|---|---|
| Trig | trigger | a rising edge plays the drum (Punch Hats: *Closed* and *Open*) |
| Velocity | control, 0 … 1 | the loudness of each hit, read at the trigger; unpatched = 100 % |

### Outputs (every Punch drum)

| Output | Signal | What it does |
|---|---|---|
| Out | audio | the drum, mono |
