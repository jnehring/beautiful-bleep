# MIDI Device

## Introduction

A connected MIDI controller (a keyboard, a pad controller), read directly by the
standalone app. It exists only in the app.

## How does it work?

Add it (*Add → Module → Sources*), open its view and choose the controller. The
node then gives you the played notes on **Notes** (for Voice Cells), plus
**Pitch**, **Gate**, **Velocity**, **Trigger**, **Pressure**, **Bend**,
**Mod Wheel** and eight controllers. *Channel* picks one MIDI channel or *All*.

It behaves like [MIDI In](midi-in.md), but you don't have to enable the device
in Settings first. The choice is stored in the project.

## How to use it?

- **Play a synth:** *Notes* into a Voice Cell, the cell's *Out L/R* into *Out 1/2*.
- **Knobs:** set a *CC* number to the number your controller sends.

## Reference

The settings and outputs are the same as those of MIDI In: *Channel*, *CC 1–8 #*,
and the outputs *Notes*, *Pitch*, *Gate*, *Velocity*, *Trigger*, *Pressure*,
*Bend*, *Mod Wheel*, *CC 1–8*.
