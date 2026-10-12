# Patch Bay In / Patch Bay Out

Type ids `patchbay-in`, `patchbay-out` · category *Utility* · colour `#a78bfa` · cable type `patchbay`

## 1. Purpose

A patch bay carries many signals along one cable. It keeps a board readable where a panel, a sequencer or a macro
section talks to many knobs of one module: instead of a dozen cables, one **bundle** leaves a cell and enters a Patch
Bay Out beside the module, which fans the signals out to the knobs.

## 2. Jacks

**Patch Bay In** takes the signals in; the bundle leaves it.

| Jack | Direction | Type | What it carries |
|---|---|---|---|
| c1, c2 … | in | any signal but notes | One channel per jack that has a cable, named after what is patched in ("Saw 1 Shape - Out"). |
| free | in | any signal but notes | Always one free jack. Patching it makes it a channel and a new free jack appears. |
| Bundle | out | `patchbay` | All channels, in one cable. |

**Patch Bay Out** gets the bundle; the channels leave it.

| Jack | Direction | Type | What it carries |
|---|---|---|---|
| Bundle | in | `patchbay` | The bundle of a Patch Bay In. |
| c1, c2 … | out | the type of the signal that goes in | The same channels, with the same names and numbers as at the Patch Bay In. |

The bundle's cable type `patchbay` connects only to `patchbay`: a bundle cable ends at a Patch Bay Out, at a cell's
output or input of that type, or at another cell. A bundle can go through cell outputs and inputs and through
more bays. It can also go **into a Voice Cell** (a shared input of type `patchbay`, with a Patch Bay Out inside next
to the voice's modules), so the dials of a panel outside can drive knobs inside the voice; it can't come out of one.

## 3. Behaviour

- The two ends stay in step by themselves: a Patch Bay Out shows the channels of the Patch Bay In its bundle comes
  from. Nothing is stored on it. Unplug the bundle and its outputs go; their cables are kept and come back with it.
- Cable amounts multiply along a channel: the amount into the Patch Bay In times the amount out of the Patch Bay Out.
- Several cables into one channel sum, like cables into any input.
- Removing a cable from the middle of a Patch Bay In leaves a gap in the numbering; the numbers don't change, so the
  cables out of the Patch Bay Out stay on their channels.
- Notes can't go through a bay.

## 4. Engine

The bays have no DSP. `Program::compile` runs `flattenPatchbays` first: every chain from a source into a channel,
over the bundle cables (through cell jacks and other bays), out of the same channel of a Patch Bay Out, becomes one
plain cable with the product of the amounts; the bays and the bundle cables are gone. Where a channel enters a Voice
Cell, the compiler gives the cell a shared input for it (`bay~…`, control) and the cable goes source → that input →
the Voice Cell's Cell In → the destination; the saved board does not contain these. The browser build does the same
in `graph.js`. So a patch bay costs nothing while it plays, and the engine's cycle and feedback handling see the
plain cables.

## 5. Module view

None: the node shows its jacks. Channel names come from the node and jack names at the other end of each cable.

## 6. Saved state

Nodes and cables only; the channel numbers are in the cables' jack ids (`c1`, `c2` …).

## 7. Tests

`controller_modules_test.cpp` (flatten: a chain, a bundle through a cell, bays in a row, the sanitiser keeping the
cables), `patch/web/test/patchbay-test.mjs` (the browser build), the module harness skips the two types.
