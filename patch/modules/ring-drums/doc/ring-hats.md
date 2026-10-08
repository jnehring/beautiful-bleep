# Ring Hats

## Introduction

Closed and open hi-hats in one node. The sound comes from six square
waves at inharmonic frequencies, a dense metallic clang, filtered down to
its top. A closed hit cuts a ringing open hat short, like a real hi-hat
pedal.

It belongs to the **Ring** drums: deep, round voices built from struck
resonators, noise and detuned square waves.

## How does it work?

Six square-wave oscillators sum to a metallic tone. A band-pass and a
high-pass keep only its bright top; *Tone* moves the high-pass up for a
thinner, crisper hat. *Closed* and *Open* share one envelope: each hit
starts it with its own decay (*Closed Decay* or *Open Decay*), so a closed
hit chokes an open one.

**Playing it.** A rising edge at *Closed* or *Open* plays the voice.
*Velocity*, when patched, is read at that moment: 100 % is full volume, 50 %
half volume. Unpatched, every hit is at full velocity. Velocity changes only
the loudness, never the sound, so soft hits keep their character. Hitting
again while the voice still sounds restarts the envelope with the decay of the
input that was hit.

## How to use it?

- **Eighth-note hats:** a sequencer's *Trigger* into *Closed*.
- **Open hat on the offbeat:** a second pattern into *Open*; the next closed
  hit cuts it.
- **Shaker:** short *Closed Decay* (around 20 ms), *Tone* high, sixteenth
  notes with varied velocity.
- **Trashy hats:** *Tune* down 5 – 12 semitones.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Tune | −12 … +12 st | 0 st |
| Closed Decay | 10 – 300 ms | 60 ms |
| Open Decay | 50 ms – 3 s | 500 ms |
| Tone | 0 – 100 % | 50 % |
| Level | 0 – 100 % | 80 % |

- **Tune:** shifts the whole voice up or down, in semitones.
- **Closed Decay:** how long a closed hit lasts.
- **Open Decay:** how long an open hit lasts.
- **Tone:** the high-pass: full … thin.
- **Level:** the output volume.

*Tune*, *Closed Decay*, *Open Decay*, *Tone* and *Level* are modulation
destinations.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Closed | trigger | plays the closed hat |
| Open | trigger | plays the open hat; a closed hit cuts it short |
| Velocity | control, 0 … 1 | the loudness of each hit, read at the trigger; unpatched = 100 % |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out | audio | the drum |
