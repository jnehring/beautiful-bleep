# MIDI Out

## Introduction

Sends notes, controllers and pitch bend from the board to something else: a
hardware synth, or another app or track. In the standalone app, the app's own
MIDI ports and the default hardware MIDI output can have a *MIDI Out* node. In
Live, it is a *Bleep MIDI Out* plugin on a track.

## How does it work?

Patch *Notes* from a sequencer or a MIDI In, or build notes from *Pitch* and
*Gate*. *Velocity* sets the note velocity, *Channel* the MIDI channel, and
*Transpose* shifts all notes by semitones. Eight CC inputs send the controller
numbers you choose, and *Bend* sends pitch bend.

A new board in the app has no MIDI node. Add one from **Add → Port**.

## How to use it?

- **Drive a hardware synth** from a sequencer: *Notes* in, set *Channel*.
- **Send modulation:** an LFO into *CC 1*, with *CC 1 #* set to what your synth
  listens to.

## Reference

### Settings

| Setting | Range | Default |
|---|---|---|
| Velocity | 0–100 % | 80 % |
| Channel | 1–16 | 1 |
| Transpose | −24 … +24 semitones | 0 |
| CC 1–8 # | 0–127 | 2, 4, 7, 10, 11, 71, 74, 64 |

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Notes | notes | Notes to send |
| Gate | gate | With *Pitch*: a note while high |
| Pitch | pitch | The note to play with *Gate* |
| CC 1–8 | control | Sent as controller values |
| Bend | control | Sent as pitch bend |
