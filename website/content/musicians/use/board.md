---
title: The board
description: Everything about the board: adding modules, patching cables, grouping and panels.
order: 1
---

# The board

One canvas per Live set with every module, port and cable. Open it from any
Bleep plugin's window (it opens with the window, or comes to the front).

## Adding things

Right-click on empty space opens the **Add** menu:

- **Module ›** one submenu per category: *Sources*, *Modulation*, *Audio*, *Effects*,
  *Utility*, *Controllers*, *Sequencing* and *Drums*. Each has subcategories, e.g.
  *Sequencing › Melodic* and *Sequencing › Drum*.
- **Cell ›** *New Cell*, *New Voice Cell*, and your cell presets by category
  (*Synthesizers › Slate Stabs* comes with Beautiful Bleep).

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

### Module presets

Most modules with sound-shaping knobs (oscillators, filters, effects,
envelopes, drums, …) have a **preset bar** at the top of their view. It looks
the same in every module:

- **‹ ›** step to the previous or next preset. The name in the middle opens the
  list, which has two parts: **Factory** presets that ship with Beautiful Bleep,
  and **User** presets that you saved yourself. A dot (●) next to the name means
  you changed a knob after loading the preset.
- **Save** keeps the current settings as a preset of your own: type a name and
  press Enter. If the loaded preset is one of yours and you changed it, **Save**
  overwrites it. In the menu, **×** (click twice) deletes one of your presets.
- **Factory presets can't be changed or deleted.** To build on one, load it,
  change it and save it under a new name.
- **Reset to defaults** (at the bottom of the list) puts every knob back.

A preset sets the module's own knobs and settings, never its cables. Modules
that keep a pattern or other content in their view (sequencers, for example)
save that content in your own presets too. Modules like the Patch Bay, meters
and mixers have no presets. Your presets are shared by all your boards and
live next to your cell presets (in the folder *Module Presets*).

## Cells

- **Add → Cell → New Cell** or **New Voice Cell** places an empty cell.
- Select nodes, right-click and choose **Create cell** (**⌘G**) or **Create
  voice cell**. Cables that cross the new border become the cell's jacks.
- Drag nodes onto a cell to move them into it; the cell lights up when it
  takes them. Cables to the rest of the board become cell jacks (an input
  that already carries the same signal is reused).
- Inside a cell, right-click a node → **Remove from cell** moves it out next to
  the cell; its cables are rerouted over cell jacks. Cables to *Voice In* and
  *Voice Out* can't be kept.
- Double-click a cell to enter it; **Esc** or the path at the top leads back
  out. Inside, *Cell In* and *Cell Out* are the cell's jacks: drop a cable on
  their *new input* / *new output* row to add one.
- **⌘⇧G** ungroups a cell again.
- Right-click a cell → **Save as preset** to keep it in the Add menu for every
  set: **Add → Cell → <category>**. Your own presets can be deleted there
  under **Delete preset**.

Keyboard shortcuts are listed under [Shortcuts](../reference/shortcuts.md).
