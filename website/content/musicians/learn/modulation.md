---
title: Modulation
description: How cables move knobs: offsets, the ring and the amount chip, cable colours, and tools for following a signal.
order: 2
---

# Modulation

On the board, almost everything is a cable. A cable from a module's output to a
knob **modulates** that knob, and **every knob can be a destination**. There is
no special modulation matrix and no list of what you are allowed to modulate.

## How a modulated knob works

- Drag from an output and **drop it on a knob** in an open module view.
- The modulation is an **offset**: the knob stays where you put it, and the cable
  adds to it.
- A **ring** around the knob shows the value the module really uses.
- The **amount chip** under the knob sets how much the cable counts. Drag it up
  or down; double-click for 100 %.
- Several cables into one input are **added up**.

You can also drop a cable on a node (a list of its knobs appears), or on empty
space, which adds a module and connects it right away.

## Cable colours

| Colour | Carries |
|---|---|
| Yellow | control |
| Green (dashed) | gate and trigger |
| Blue | pitch |
| Red | audio |
| Purple | notes |

Inputs that cannot take the signal you are dragging fade out. Notes only connect
to notes.

## Modulating the modulator

A modulator is a module like any other, so its knobs take cables too. In
[Your first patch](first-patch.md) a Random module drives the Rise of a Function
that drives a filter's cutoff. Patches get musical when slow and fast movements
meet this way.

## Following a signal

- **T** (trace) highlights what feeds and is fed by the selection.
- **M** (mute) silences the node's outputs, to hear what the rest does without it.
- Click a cable to change its amount or delete it. Drag its end at an input to move it.

## Next

[Cells and panels](cells-and-panels.md): group a patch, then give it a front panel.
Every module and its knobs are in the [module manuals](/store/?kind=module).
