# Ring Cymbal

## Introduction

A cymbal from the same six square waves as Ring Hats, split into two
bands: a low clang that fades first and a long, high sizzle.

It belongs to the **Ring** drums: deep, round voices built from struck
resonators, noise and detuned square waves.

## How does it work?

The metallic source is split by a band-pass (the low clang) and a
high-pass (the sizzle). The sizzle lasts *Decay*; the clang lasts less than
half of that. *Tone* balances the two bands.

**Playing it.** A rising edge at *Trig* plays the voice. *Velocity*, when
patched, is read at that moment: 100 % is full volume, 50 % half volume.
Unpatched, every hit is at full velocity. Velocity changes only the loudness,
never the sound, so soft hits keep their character. Hitting again while the
voice still sounds restarts both bands.

## How to use it?

- **Crash on the one:** the first beat of a new section, *Decay* 2 – 4 s.
- **Ride-like pattern:** quarter notes, *Decay* around 1 s, *Tone* high.
- **Gong-ish:** *Tune* down 12 semitones, *Tone* low, *Decay* at maximum.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Tune | −12 … +12 st | 0 st |
| Decay | 300 ms – 8 s | 2 s |
| Tone | 0 – 100 % | 50 % |
| Level | 0 – 100 % | 80 % |

- **Tune:** shifts the whole voice up or down, in semitones.
- **Decay:** how long the sizzle lasts; the clang dies sooner.
- **Tone:** the balance of the two bands: clang … sizzle.
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
