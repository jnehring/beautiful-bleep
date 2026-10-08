# Ring Cowbell

## Introduction

A cowbell: two square waves, a fifth-ish apart, through a band-pass
filter, with a sharp initial hit and a softer tail.

It belongs to the **Ring** drums: deep, round voices built from struck
resonators, noise and detuned square waves.

## How does it work?

Two square-wave oscillators run at an inharmonic interval. A band-pass
filter, set by *Tone*, picks out the clang. The envelope has two parts: a
loud hit that fades in a few tens of milliseconds, and a quieter tail that
lasts *Decay*.

**Playing it.** A rising edge at *Trig* plays the voice. *Velocity*, when
patched, is read at that moment: 100 % is full volume, 50 % half volume.
Unpatched, every hit is at full velocity. Velocity changes only the loudness,
never the sound, so soft hits keep their character. Hitting again while the
voice still sounds restarts both parts of the envelope.

## How to use it?

- **Accent pattern:** a few syncopated hits per bar.
- **Darker bell:** *Tone* low, *Tune* down a few semitones.
- **Melodic cowbell:** patch a sequencer's *Pitch* onto *Tune* at 50 %
  amount. *Tune* spans 24 semitones, so the bell follows the notes in tune.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Tune | −12 … +12 st | 0 st |
| Decay | 50 ms – 2 s | 400 ms |
| Tone | 0 – 100 % | 50 % |
| Level | 0 – 100 % | 80 % |

- **Tune:** shifts the whole voice up or down, in semitones.
- **Decay:** how long the tail lasts.
- **Tone:** the band-pass centre: dark … bright.
- **Level:** the output volume.

*Tune*, *Decay*, *Tone* and *Level* are modulation destinations.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Trig | trigger | a rising edge plays the voice (gates work too) |
| Velocity | control, 0 … 1 | the loudness of each hit, read at the trigger; unpatched = 100 % |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out | audio | the drum |
