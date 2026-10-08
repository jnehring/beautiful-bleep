# Punch Clap

## Introduction

A bright, roomy hand clap: tight bursts of noise and a louder tail
than Ring Clap.

It belongs to the **Punch** drums: tight, hard voices built from swept sine
waves, noise and crunchy metal.

## How does it work?

Each hit fires *Bursts* short bursts of noise, *Spread* apart; the last
one starts the tail, which fades over *Decay*. The noise passes through a
wide band-pass centred on *Tone* and a high-pass, for a bright, open clap.

**Playing it.** A rising edge at *Trig* plays the voice. *Velocity*, when
patched, is read at that moment: 100 % is full volume, 50 % half volume.
Unpatched, every hit is at full velocity. Velocity changes only the loudness,
never the sound, so soft hits keep their character. Hitting again while the
voice still sounds starts the bursts again.

## How to use it?

- **Clap on the backbeat:** layered with Punch Snare, or on its own.
- **Big room clap:** *Decay* 600 ms or more.
- **Tight clap:** 2 – 3 *Bursts*, *Spread* around 5 ms.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Tone | 500 Hz – 4 kHz | 1.5 kHz |
| Decay | 50 ms – 1.5 s | 350 ms |
| Spread | 3 – 30 ms | 8 ms |
| Bursts | 1 – 6 | 4 |
| Level | 0 – 100 % | 80 % |

- **Tone:** the centre of the band-pass.
- **Decay:** how long the tail lasts.
- **Spread:** the time between bursts.
- **Bursts:** how many bursts play before the tail. A setting, not a knob.
- **Level:** the output volume.

*Tone*, *Decay*, *Spread* and *Level* are modulation destinations.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Trig | trigger | a rising edge plays the voice (gates work too) |
| Velocity | control, 0 … 1 | the loudness of each hit, read at the trigger; unpatched = 100 % |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out | audio | the drum |
