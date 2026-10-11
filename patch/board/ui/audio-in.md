# Audio In

## Introduction

The sound coming into the board. In the standalone app, each *Audio In* node is
one pair of inputs of your audio interface (*In 1/2*, *In 3/4* and so on). In
Live, it is the audio of the track that carries a *Bleep Audio In* plugin.

## How does it work?

The node has two outputs, *L* and *R*, carrying the input signal. With a single
input channel (a microphone on input 1), both sides carry the same signal. Nothing
is processed: what arrives is what you patch on.

A new board in the app starts with *In 1/2* and *Out 1/2*. More pairs are in
**Add → Port**; you can delete the node when you don't need it.

## How to use it?

- **Process an instrument or a microphone:** patch *L* and *R* into an effect
  (Reverb, Delay Network, Filter) and its output into an *Audio Out*.
- **Feedback:** take care with speakers and a microphone on at once. Turn the
  monitoring down first.

## Reference

### Outputs

| Output | Signal | What it does |
|---|---|---|
| L | audio | Left (or only) input channel |
| R | audio | Right input channel |
