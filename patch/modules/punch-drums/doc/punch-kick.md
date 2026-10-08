# Punch Kick

## Introduction

A hard, tight bass drum: a sine wave that starts high and sweeps down
fast onto *Tune*, with a click of noise on top. It cuts through a busy mix.

It belongs to the **Punch** drums: tight, hard voices built from swept sine
waves, noise and crunchy metal.

## How does it work?

Each hit restarts a sine oscillator at the top of its cycle and drops
its pitch from far above *Tune*: a very fast fall in the first few
milliseconds, then a slower settle. *Sweep* sets how far it falls. *Attack*
adds a short burst of noise and a thump, the beater hitting the skin. The
body fades over *Decay*. *Drive* saturates the sound, rounding the sine
toward a square for a harder, louder kick.

**Playing it.** A rising edge at *Trig* plays the voice. *Velocity*, when
patched, is read at that moment: 100 % is full volume, 50 % half volume.
Unpatched, every hit is at full velocity. Velocity changes only the loudness,
never the sound, so soft hits keep their character. Hitting again while the
voice still sounds restarts it; the previous hit is cut off.

## How to use it?

- **Four on the floor:** the defaults on every beat.
- **Long, booming kick:** *Decay* 1 s or more, *Drive* up.
- **Soft, round kick:** *Sweep* and *Attack* low, *Drive* 0.
- **Accents:** patch the sequencer's *Velocity* into *Velocity*.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Tune | 30 – 120 Hz | 50 Hz |
| Decay | 50 ms – 2.5 s | 600 ms |
| Sweep | 0 – 100 % | 50 % |
| Attack | 0 – 100 % | 50 % |
| Drive | 0 – 100 % | 30 % |
| Level | 0 – 100 % | 80 % |

- **Tune:** the pitch the kick settles on.
- **Decay:** how long the body lasts.
- **Sweep:** how far the pitch falls at the start. At 100 % it starts more than six times higher.
- **Attack:** the level of the click.
- **Drive:** saturation. The peak level stays the same.
- **Level:** the output volume.

*Tune*, *Decay*, *Sweep*, *Attack*, *Drive* and *Level* are modulation
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
