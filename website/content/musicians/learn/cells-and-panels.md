---
title: Cells and panels
description: Group a patch into a cell, then give the cell a front panel so it plays like an instrument.
order: 3
---

# Cells and panels

A patch with forty modules is hard to read and harder to play. Two ideas fix
that: a **cell** hides a part of the patch behind a few jacks, and a **panel**
puts the dozen controls that matter on a front panel.

## Make a cell

1. Select some nodes.
2. Right-click and choose **Create cell** (**⌘G**).
3. Cables that cross the cell's border become its **jacks**.

Double-click a cell to go inside; **Esc** takes you back out. Inside, *Cell In*
and *Cell Out* are the cell's jacks, and you can add more. **⌘⇧G** ungroups it again.

For a polyphonic synth, make a [Voice Cell](../use/voice-cells.md): you patch one
voice and the cell plays it up to 16 times.

**Save as preset** (right-click the cell) keeps it under **Add → Cell** in every
project, so a patch you build once becomes a module you reuse.

## Give it a panel

A panel is the front of a cell: dials, faders, buttons, a keyboard, an XY pad,
meters, labels and the views of modules inside. Right-click a cell:

- **Build panel from cell** makes a first panel from what is inside.
- **New panel** starts an empty one.
- **Open panel** and **Edit panel** open it.

A panel has two views. **Interface** is for playing: only the controls, nothing
else. **Wiring** is for building: every control shows what it is connected to, and
you connect it to a knob, a jack, a button or a note input and set its range.
Layout (adding, moving and resizing controls) happens in the Interface view,
behind an unlock.

To put a knob on a panel, right-click it (or its module) and choose **Add to
panel**. A control can also load another panel, which is how large panels are
split into tabs.

For more control over how a panel knob moves a sound, put a
[Dial](/docs/musicians/modules/dial/) inside the cell, add the Dial to the panel, and
patch its *Out* onto the parameter. The Dial's **Min** and **Max** set how far
the parameter moves from one end of the knob to the other. Between the Dial and
the parameter you can add other modules to change the curve: a
[Math](/docs/musicians/modules/math/) row set to *Power* makes the knob gentle at one end
and steep at the other, and a [Shape Table](/docs/musicians/modules/shape-table/) lets you
draw any curve you like. A [Function](/docs/musicians/modules/function/) patched into the
Dial's *Value* adds movement of its own around the position you set.

A panel shows what you play with, not everything. The rest stays one right-click
away: a control's menu has **Open module view**.

## Where this leads

A cell with a panel, saved as a preset, is how Bleep Instrument and Bleep FX
presets are made. You are building the same thing the factory presets are.

Reference: [the board](../use/board.md), [Voice Cells](../use/voice-cells.md).
