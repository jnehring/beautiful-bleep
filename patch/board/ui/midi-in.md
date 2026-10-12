# MIDI In

## Introduction

Notes and controllers from a MIDI source into the board. In the standalone app,
the app's own MIDI ports (*Bleep App 1*, *Bleep App 2*, more in Settings)
and every enabled hardware MIDI input can have a *MIDI In* node. In Live, it is
the MIDI of the track that carries a *Bleep MIDI In* plugin.

## How does it work?

The node turns MIDI into board signals: all notes on **Notes**, the most recent
note as **Pitch**, **Gate**, **Velocity** and **Trigger**, channel **Pressure**,
**Bend**, **Mod Wheel**, and eight controllers (*CC 1–8*) whose numbers you can
choose. *Channel* picks one MIDI channel, or *All*.

A new board in the app has no MIDI node. Add one from **Add → Port**, or use
*MIDI Device* to read a hardware controller directly. In Live, set a track's
*MIDI To* to *Bleep App 1* to play the app.

## How to use it?

- **Play a Voice Cell:** *Notes* into the cell's *Notes* input.
- **Play a mono synth:** *Pitch* into an oscillator, *Gate* into an ADSR.
- **Knobs from a controller:** set a *CC* number to the controller's number and
  patch its output wherever a control signal is useful.

## Reference

### Settings

| Setting | Range | Default |
|---|---|---|
| Channel | All, 1–16 | All |
| CC 1–8 # | 0–127 | 2, 4, 7, 10, 11, 71, 74, 64 |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Notes | notes | All notes, for Voice Cells |
| Pitch | pitch | Pitch of the latest note |
| Gate | gate | High while a note is held |
| Velocity | control | Velocity of the latest note |
| Trigger | trigger | A pulse for each note |
| Pressure | control | Channel pressure |
| Bend | control | Pitch bend |
| Mod Wheel | control | Controller 1 |
| CC 1–8 | control | The chosen controllers |
