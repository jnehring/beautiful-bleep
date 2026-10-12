# Patch Bay Out

## Introduction

The Patch Bay Out gives you the channels of a bundle back as separate outputs, named like the signals that went into the Patch Bay In at the other end. Cable them to knobs or inputs as you would any other output.

## How does it work?

A Patch Bay In and a Patch Bay Out are a pair. They stay in step by themselves: the Patch Bay Out always shows the channels of the Patch Bay In its bundle comes from. Nothing is processed: the engine turns every channel into a plain cable, so a patch bay costs nothing while it plays.

## How to use it?

- **A panel for a module:** put the dials that control a module in a cell, collect them in a Patch Bay In, send the bundle out of the cell, and put a Patch Bay Out next to the module. One bundle replaces a cable per dial. The Warm Saws preset is built this way.
- **A long way across the board:** one bundle cable instead of several parallel ones.

## Reference

The jacks, the signal types and how the bundle is resolved are in the design, `doc/specs/modules/patchbay.md`. A bundle carries any signal except notes.
