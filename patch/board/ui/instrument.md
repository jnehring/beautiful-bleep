# Instrument

## Introduction

*Bleep Instrument* in Live: MIDI In and Audio Out in one plugin, so a board
synth sits on one track with normal record-arm and monitoring.

## How does it work?

The node has the outputs of [MIDI In](midi-in.md), plus *Clock* and *Playing*
from Live's transport, and two audio inputs, *Audio L/R*, that play on the
track. It loads one instrument cell preset and opens on its panel.

## How to use it?

Patch *Notes* into a Voice Cell and the cell's *Out L/R* into *Audio L/R*.

## Reference

Settings: *Channel* and *CC 1–8 #*, as in MIDI In. Inputs: *Audio L*, *Audio R*.
Outputs: those of MIDI In, *Clock* (gate) and *Playing* (gate).
