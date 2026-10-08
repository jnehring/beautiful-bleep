# Ring Drums

## Introduction

The Ring drums are a drum kit, one node per instrument. They are built the
way the classic analog drum machines of the early eighties built their
sounds: resonators that are struck and ring away, band-passed noise, and six
detuned square waves for everything metallic. The result is deep, round and a
little soft: long booming kicks, ringing toms, gentle hats.

For a tighter, harder kit, see the Punch drums.

## The voices

| Node | What it is | Main controls |
|---|---|---|
| Ring Kick | a struck resonator, from tight to booming | Tune, Decay, Sweep, Tone, Drive |
| Ring Snare | two ringing heads and a burst of noise | Tune, Tone, Snappy, Decay |
| Ring Clap | quick bursts of noise and a short tail | Tone, Decay, Spread, Bursts |
| Ring Tom | a ringing tone that falls in pitch; also hand drums | Tune, Decay, Bend, Noise |
| Ring Rim | rim shot or clave | Voice, Tune, Decay |
| Ring Cowbell | two squares through a band-pass | Tune, Decay, Tone |
| Ring Hats | closed and open hats; closed cuts open | Tune, Closed Decay, Open Decay, Tone |
| Ring Cymbal | a low clang and a long sizzle | Tune, Decay, Tone |

Each node has its own manual behind the **?** button in its window.

## How does it work?

Every Ring drum works the same from the outside:

- A rising edge at **Trig** plays it (Ring Hats has two inputs, *Closed* and
  *Open*). Triggers and gates both work.
- **Velocity**, when patched, sets the loudness of each hit, read at the
  moment of the trigger. Unpatched, every hit is at full velocity. Velocity
  changes the loudness only, not the sound.
- **Level** sets the output volume. It starts at 80 %, so a few drums
  mixed together leave some headroom.
- **Out** is mono audio.

Every knob is a modulation destination, as everywhere on the board.

## How to use it?

- **A basic beat:** a Step Sequencer per drum, each one's *Trigger* into a
  drum's *Trig* and its *Velocity* into the drum's *Velocity*. Patch every
  drum's *Out* into the same Audio Out port: cables into one jack add up.
- **Hats with a choke:** two sequencer patterns into Ring Hats' *Closed* and
  *Open*; the closed hits cut the open ones.
- **A drum kit as one node:** select the drums and their sequencers and group
  them into a cell, with a single audio output.
- **Bass kick:** a long Ring Kick, with a sequencer's *Pitch* on *Tune* at
  50 % amount.
- **Effects:** run a drum through a Multi Filter, or patch a Random onto a
  knob, for drums that change on every hit.

## Reference

### Inputs (every Ring drum)

| Input | Signal | What it does |
|---|---|---|
| Trig | trigger | a rising edge plays the drum (Ring Hats: *Closed* and *Open*) |
| Velocity | control, 0 … 1 | the loudness of each hit, read at the trigger; unpatched = 100 % |

### Outputs (every Ring drum)

| Output | Signal | What it does |
|---|---|---|
| Out | audio | the drum, mono |
