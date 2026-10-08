# Punch Snare

## Introduction

A snare with a hard, forward body: two sine waves that drop slightly in
pitch, and filtered noise for the snare wires.

It belongs to the **Punch** drums: tight, hard voices built from swept sine
waves, noise and crunchy metal.

## How does it work?

Two sine oscillators, at *Tune* and about 1.6 × *Tune*, restart on each
hit and fall a little in pitch, then fade quickly. White noise passes
through a low-pass, set by *Tone*, and a high-pass that keeps it out of the
body; *Snappy* sets its level and *Decay* its length.

**Playing it.** A rising edge at *Trig* plays the voice. *Velocity*, when
patched, is read at that moment: 100 % is full volume, 50 % half volume.
Unpatched, every hit is at full velocity. Velocity changes only the loudness,
never the sound, so soft hits keep their character. Hitting again while the
voice still sounds restarts it.

## How to use it?

- **Backbeat:** the defaults on beats 2 and 4.
- **Crisp snare:** *Tone* high, *Snappy* 80 %, *Decay* around 200 ms.
- **Fat snare:** *Tune* low, *Decay* 500 ms.
- **Rolls:** fast hits with rising velocity.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Tune | 120 – 400 Hz | 200 Hz |
| Tone | 0 – 100 % | 50 % |
| Snappy | 0 – 100 % | 60 % |
| Decay | 50 ms – 1 s | 300 ms |
| Level | 0 – 100 % | 80 % |

- **Tune:** the pitch of the body.
- **Tone:** the brightness of the noise (its low-pass).
- **Snappy:** the level of the noise.
- **Decay:** how long the noise lasts.
- **Level:** the output volume.

*Tune*, *Tone*, *Snappy*, *Decay* and *Level* are modulation destinations.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Trig | trigger | a rising edge plays the voice (gates work too) |
| Velocity | control, 0 … 1 | the loudness of each hit, read at the trigger; unpatched = 100 % |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out | audio | the drum |
