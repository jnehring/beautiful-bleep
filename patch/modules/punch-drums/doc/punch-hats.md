# Punch Hats

## Introduction

Bright, crunchy closed and open hi-hats in one node, with the slightly
gritty sheen of the early samplers that drum machines of the eighties used
for their cymbals. A closed hit cuts a ringing open hat short.

It belongs to the **Punch** drums: tight, hard voices built from swept sine
waves, noise and crunchy metal.

## How does it work?

Six square waves at inharmonic frequencies are mixed with white noise
and high-passed; *Tone* moves the high-pass up for a thinner hat. *Crunch*
lowers the bit depth and sample rate of the sound before the envelope, for
grit; at 0 % it's clean. *Closed* and *Open* share one envelope, each with its
own decay, so a closed hit chokes an open one.

**Playing it.** A rising edge at *Closed* or *Open* plays the voice.
*Velocity*, when patched, is read at that moment: 100 % is full volume, 50 %
half volume. Unpatched, every hit is at full velocity. Velocity changes only
the loudness, never the sound, so soft hits keep their character. Hitting
again while the voice still sounds restarts the envelope with the decay of the
input that was hit.

## How to use it?

- **Sixteenth hats:** a sequencer's *Trigger* into *Closed*, with
  velocity on *Velocity* for groove.
- **Offbeat open hat:** a second pattern into *Open*.
- **Clean, modern hats:** *Crunch* 0, *Tone* high.
- **Dirty hats:** *Crunch* 100 %.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Tune | −12 … +12 st | 0 st |
| Closed Decay | 10 – 300 ms | 50 ms |
| Open Decay | 50 ms – 3 s | 400 ms |
| Tone | 0 – 100 % | 50 % |
| Crunch | 0 – 100 % | 40 % |
| Level | 0 – 100 % | 80 % |

- **Tune:** shifts the whole voice up or down, in semitones.
- **Closed Decay:** how long a closed hit lasts.
- **Open Decay:** how long an open hit lasts.
- **Tone:** the high-pass: full … thin.
- **Crunch:** bit and sample-rate reduction: clean … gritty.
- **Level:** the output volume.

*Tune*, *Closed Decay*, *Open Decay*, *Tone*, *Crunch* and *Level* are
modulation destinations.

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
