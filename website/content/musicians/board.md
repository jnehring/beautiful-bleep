---
title: The board
order: 1
---

# The Bleep Board

One canvas per Live set with every module, port and cable. Open it from any
Bleep plugin's window (it opens with the window, or comes to the front).

## Adding things

**Add** (top left, or right-click on empty space) opens the Add menu:

- **Module ›** one submenu per category: *Sources*, *Modulation*, *Audio*, *Effects*,
  *Utility*.
- **Cell ›** *New Cell*, *New Voice Cell*, and your cell presets by category
  (*Synthesizers › Basic Poly* comes with Bleep Patch).

Tab (or a double-click on empty space) opens a search at the cursor instead.
See [Voice Cells](voice-cells.md) for polyphonic synths.

## Patching

- **Drag from an output** (the dots on the right of a node) to an input on
  the left of another node. Inputs that can't take the signal fade out.
- **Drop on a knob** in an open module view to modulate it. Every knob is a
  destination. The modulation is an offset: the knob stays where you put it,
  and a ring shows the value really used. The chip under the knob sets the
  cable's amount (drag up or down, double-click for 100 %).
- **Drop on a node** to pick one of its knobs from a list.
- **Drop on empty space** to add a module that is connected right away.
- **Click a cable** to set its amount or delete it. Drag a cable's end at an
  input to move it; drop it on empty space to remove it.
- Several cables into one input are added up.

Cable colours: yellow control, green gate and trigger (dashed), blue pitch,
red audio, purple notes. Notes only connect to notes.

## Module views

Click a node to open its view: knobs, settings and its own displays. Views
float over the board; open as many as you like, drag them by the title, pin
them (📌) to keep them open when you enter or leave cells.

## Cells

- Select nodes and press **⌘G** to put them into a cell. Cables that cross
  the new border become the cell's jacks.
- Double-click a cell to enter it; **Esc** or the path at the top leads back
  out. Inside, *Cell In* and *Cell Out* are the cell's jacks: drop a cable on
  their *new input* / *new output* row to add one.
- **⌘⇧G** ungroups a cell again.
- Right-click a cell → **Save as preset** to keep it in the Add menu for every
  set: **Add → Cell → <category>**. Your own presets can be deleted there
  under **Delete preset**.

## Shortcuts

| Key | Action |
|---|---|
| Tab, double-click | Add a module |
| ⌘G / ⌘⇧G | Group into a cell / ungroup |
| ⌘D / ⌘⇧D | Duplicate / duplicate with incoming cables |
| Delete | Remove the selection (not ports) |
| Esc | Close a view, leave a cell, clear the selection |
| F | Fit the patch to the window |
| T | Trace: highlight what feeds and is fed by the selection |
| M | Mute: the node's outputs fall silent |
| ⌘Z / ⌘⇧Z | Undo / redo |
| Scroll, ⌘-scroll or pinch | Pan, zoom |
| Space-drag or Alt-drag | Pan |
