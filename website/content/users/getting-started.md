---
title: Getting started
order: 0
---

# Getting started with Bleep Patch

Bleep Patch is a set of small modules that make Ableton Live feel modular.
Every module is a normal plugin; virtual cables connect them across tracks,
without extra tracks.

## Install

Copy the `.vst3` (and on macOS, `.component`) files to your plugin folder,
then rescan plugins in Live (Preferences → Plug-Ins).

| | VST3 | AU |
|---|---|---|
| macOS | `~/Library/Audio/Plug-Ins/VST3` | `~/Library/Audio/Plug-Ins/Components` |
| Windows | `C:\Program Files\Common Files\VST3` | — |

## Your first patch (5 minutes)

1. On a synth track, after the synth, insert **Bleep Function** and then
   **Bleep Filter**.
2. In Filter, open the menu under **Cutoff** and choose *Function › A*.
3. Drag the slider under the menu to set the amount. The yellow ring around
   the Cutoff knob shows the cutoff the filter is really using. The knob
   itself stays where you put it.
4. Turn Function's **Rise** and **Fall** to change the speed, or set
   **Sync** to *1/4*.

Now modulate the modulator: put a **Bleep Random** on any track and patch its
*Out* into Function's **Rise**.

## How cables work

- Every knob is a destination. Its menu lists every output of every Bleep
  module (and any other Bleep Bus plugin) in the set, grouped by track.
- Cables are saved with the receiving module, so they survive saving,
  reopening and duplicating devices.
- If a source module is deleted, the cable stays and shows ⚠ *missing* until
  the source comes back (for example after undo).
- Modulation arrives one audio block late (a few milliseconds). That's
  inaudible for modulation, and it makes renders identical every time.
- Rename a module with the name field at the top so cables read like
  *Bass › Wobble › A*.
