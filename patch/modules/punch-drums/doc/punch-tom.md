# Punch Tom

## Introduction

A tom: a sine wave that starts above its pitch and drops onto it, with a
touch of noise. Punchier than Ring Tom, with a clear pitch drop.

It belongs to the **Punch** drums: tight, hard voices built from swept sine
waves, noise and crunchy metal.

## How does it work?

Each hit restarts a sine oscillator. Its pitch starts above *Tune* and
falls: quickly at first, then slowly over the whole note. *Bend* sets how
far. A short burst of low-passed noise adds the stick; *Noise* sets its
level. The tone fades over *Decay*.

**Playing it.** A rising edge at *Trig* plays the voice. *Velocity*, when
patched, is read at that moment: 100 % is full volume, 50 % half volume.
Unpatched, every hit is at full velocity. Velocity changes only the loudness,
never the sound, so soft hits keep their character. Hitting again while the
voice still sounds restarts it.

## How to use it?

- **Tom fills:** three Punch Toms at about 90, 120 and 170 Hz.
- **Electronic toms:** *Bend* at 100 %, *Decay* long, *Noise* 0.
- **Melodic toms:** patch a sequencer's *Pitch* onto *Tune* and adjust
  the cable's amount until the intervals sound right.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Tune | 50 – 500 Hz | 110 Hz |
| Decay | 50 ms – 2 s | 450 ms |
| Bend | 0 – 100 % | 50 % |
| Noise | 0 – 100 % | 20 % |
| Level | 0 – 100 % | 80 % |

- **Tune:** the pitch the tom settles on.
- **Decay:** how long the tom lasts.
- **Bend:** how far the pitch drops; at 100 % it starts about twice as high.
- **Noise:** the level of the stick noise.
- **Level:** the output volume.

*Tune*, *Decay*, *Bend*, *Noise* and *Level* are modulation destinations.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Trig | trigger | a rising edge plays the voice (gates work too) |
| Velocity | control, 0 … 1 | the loudness of each hit, read at the trigger; unpatched = 100 % |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out | audio | the drum |
