# Link

## Introduction

Tempo, beat and bar from **Ableton Link**: the tempo you share with other apps
and devices on your network, or, in Live, with Live's own transport through
*Bleep Audio Bridge*.

## How does it work?

The node outputs the shared tempo and where in the bar you are, so modules
(LFOs, sequencers, delays) can follow the groove. *Quantum* is the length of a
bar in beats; Link keeps the bars of all participants lined up on it. *Start/Stop
Sync* lets *Playing* follow the start and stop of the other participants.

Link is switched on in **File → Settings** (or the Transport menu). A new board
has no Link node; add one from **Add → Port**, so modules can read the tempo
and position.

## How to use it?

- **Clock a sequencer:** *Clock* into a sequencer's clock input (24 pulses per beat).
- **Restart on the bar:** *Bar Trig* into a reset input.
- **Tempo-linked modulation:** *Tempo* into a control input, e.g. a delay time.

## Reference

### Settings

| Setting | Range | Default |
|---|---|---|
| Quantum | 1–16 beats | 4 |
| Start/Stop Sync | Off, On | On |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Tempo | control | Tempo, in BPM divided by 100 (120 BPM is 1.2) |
| Beat | control | Position within the beat, 0–1 |
| Bar | control | Position within the bar, 0–1 |
| Clock | gate | 24 pulses per beat while playing |
| Playing | gate | High while the transport runs |
| Beat Trig | trigger | A pulse at every beat |
| Bar Trig | trigger | A pulse at every bar |
