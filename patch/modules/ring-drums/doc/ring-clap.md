# Ring Clap

## Introduction

A hand clap: band-passed noise opened by a few quick bursts, as if
several people clapped a few milliseconds apart, then a short diffuse tail
like a small room.

It belongs to the **Ring** drums: deep, round voices built from struck
resonators, noise and detuned square waves.

## How does it work?

Each hit fires *Bursts* short bursts of noise, *Spread* apart. Every
burst snaps open and fades before the next one. The last burst also starts the
tail, which fades over *Decay*. The noise passes through a band-pass filter
centred on *Tone*, which gives the clap its pitch.

**Playing it.** A rising edge at *Trig* plays the voice. *Velocity*, when
patched, is read at that moment: 100 % is full volume, 50 % half volume.
Unpatched, every hit is at full velocity. Velocity changes only the loudness,
never the sound, so soft hits keep their character. Hitting again while the
voice still sounds starts the bursts again.

## How to use it?

- **Clap on the backbeat:** with or instead of a snare, on beats 2 and 4.
- **Tighter clap:** fewer *Bursts*, smaller *Spread*.
- **Big, loose clap:** 5 or 6 *Bursts*, *Spread* around 20 ms, longer
  *Decay*.
- **Snap:** 1 burst, *Tone* around 2.5 kHz, short *Decay*.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Tone | 500 Hz – 4 kHz | 1.1 kHz |
| Decay | 50 ms – 1.5 s | 300 ms |
| Spread | 3 – 30 ms | 11 ms |
| Bursts | 1 – 6 | 4 |
| Level | 0 – 100 % | 80 % |

- **Tone:** the centre of the band-pass: the clap's pitch.
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
