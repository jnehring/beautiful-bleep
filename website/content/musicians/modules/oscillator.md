---
title: Oscillator
order: 9
---

# Oscillator

A triangle-core oscillator: the classic sound source of an analog synth voice,
with waveform morph, through-zero FM and hard sync.

| Control | Range | What it does |
|---|---|---|
| Octave | −3 … +3 | in octaves |
| Coarse | ±12 semitones | |
| Fine | ±100 cents | |
| Shape | 0 – 100 % | morphs *Out*: sine → triangle → saw → square |
| Pulse Width | 5 – 95 % | for the square |
| FM Depth | 0 – 100 % | how far *FM* bends the frequency — through zero: the core runs backwards, so deep FM stays in tune |

**Inputs:** *Pitch* (1 V/oct, 0 = C4), *FM* (audio), *Sync* (a rising edge
restarts the cycle).
**Outputs:** *Out* (the morph), *Sine*, *Triangle*, *Saw*, *Square*, *Sub*
(square, one octave down). Saw and square are band-limited.
