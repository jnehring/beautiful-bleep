# Audio Out

## Introduction

The sound leaving the board. In the standalone app, each *Audio Out* node is one
pair of outputs of your audio interface (*Out 1/2*, *Out 3/4* and so on). In
Live, it is the track that carries a *Bleep Audio Out* plugin.

## How does it work?

The node has two inputs, *L* and *R*. Everything patched into them is summed and
sent to the outputs. Patch only *L* and the sound plays on the left only. The
**Volume** dial sets the level of the output, from silence (−60 dB) to +6 dB; 0 dB
(unchanged) sits at about 80 % of the travel. The node does not limit: keep an eye
on the loudness, for example with the limiter of an Audio Mixer.

The board adds a short fixed delay between its modules and the outputs, so the
timing stays steady however large the audio buffer is. In Live, Audio Out reports
it, and delay compensation lines the track up.

A new board in the app starts with *In 1/2* and *Out 1/2*. More pairs are in
**Add → Port**; you can delete the node when you don't need it.

## How to use it?

- **Play a synth:** a Voice Cell's *Out L/R* into *L/R* of *Out 1/2*.
- **Several outputs:** add *Out 3/4* and send, for example, the drums to it, to
  mix them on your interface.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Volume | −60 dB (silence) … +6 dB | 0 dB |

### Inputs

| Input | Signal | What it does |
|---|---|---|
| L | audio | Left output channel |
| R | audio | Right output channel |
