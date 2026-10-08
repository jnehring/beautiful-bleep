# Ring Kick

## Introduction

A deep, round bass drum. A resonator is struck and rings at *Tune*,
dying away over *Decay*: short and tight, or a long booming tone you can play
bass lines with.

It belongs to the **Ring** drums: deep, round voices built from struck
resonators, noise and detuned square waves.

## How does it work?

The body is a resonator, a circuit that rings like a bell when struck.
Each hit starts the ring with a soft, rounded attack. *Sweep* starts the pitch
higher and lets it settle onto *Tune* within the first few tens of
milliseconds, for more punch. *Tone* adds the click of the strike itself, a
short thump on top of the body; higher values make it louder and brighter.
*Drive* saturates the whole sound, from warm to distorted.

**Playing it.** A rising edge at *Trig* plays the voice. *Velocity*, when
patched, is read at that moment: 100 % is full volume, 50 % half volume.
Unpatched, every hit is at full velocity. Velocity changes only the loudness,
never the sound, so soft hits keep their character. Hitting again while the
voice still sounds adds to the ringing, like hitting a real drum twice.

## How to use it?

- **Classic kick:** the defaults on every beat (a Step Sequencer's
  *Trigger* into *Trig*).
- **Long bass kick:** *Decay* at 1.5 s or more, *Drive* around 30 %. To
  play bass lines, patch a sequencer's *Pitch* onto *Tune* at 50 % amount:
  *Tune* spans two octaves, so the kick then follows the notes in tune.
- **Tight kick:** *Decay* around 200 ms, *Tone* up for more click.
- **Accents:** patch the sequencer's *Velocity* into *Velocity*.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Tune | 30 – 120 Hz | 50 Hz |
| Decay | 50 ms – 3 s | 800 ms |
| Sweep | 0 – 100 % | 30 % |
| Tone | 0 – 100 % | 30 % |
| Drive | 0 – 100 % | 0 % |
| Level | 0 – 100 % | 80 % |

- **Tune:** the pitch the body rings at.
- **Decay:** how long the body rings (until it has fallen by 60 dB).
- **Sweep:** how far above *Tune* the pitch starts. At 100 % it starts 2.5 times higher.
- **Tone:** the click of the strike: louder and brighter as you turn it up.
- **Drive:** saturation, from clean to heavily distorted. The peak level stays the same.
- **Level:** the output volume.

*Tune*, *Decay*, *Sweep*, *Tone*, *Drive* and *Level* are modulation
destinations.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Trig | trigger | a rising edge plays the voice (gates work too) |
| Velocity | control, 0 … 1 | the loudness of each hit, read at the trigger; unpatched = 100 % |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out | audio | the drum |
