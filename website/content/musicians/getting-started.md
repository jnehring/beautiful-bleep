---
title: Getting started
order: 0
---

# Getting started with Bleep Patch

Bleep Patch makes Ableton Live feel modular. All modules live on one canvas
per set, the **Bleep Board**. You connect them with cables, and small plugins
called **ports** connect the board to your tracks.

## Install

Copy the `.vst3` files to your plugin folder, then rescan plugins in Live
(Settings → Plug-Ins, with "Use VST3 Plug-In System Folders" on). The
plugins appear in Live's browser under **Plug-Ins → Bleep Patch**.

| | VST3 folder |
|---|---|
| macOS | `~/Library/Audio/Plug-Ins/VST3` |
| Windows | `C:\Program Files\Common Files\VST3` |

## Your first patch (5 minutes)

1. Put **Bleep Patch** on any track (the master track is a good place).
   Every set that uses Bleep Patch needs exactly one. Its window opens the
   board.
2. Put **Bleep Audio Insert** on a synth track, after the synth. It appears
   on the board by itself, named after the track.
3. On the board, press **Tab**, type *filter* and press Enter. Drag from the
   Insert's *Send L* to the Filter's *In L*, and from the Filter's *Out L*
   and *Out R* to the Insert's *Return L* and *Return R*.
4. Press Tab again and add a **Function**. Click the Filter to open its
   view, then drag Function's *A* onto the **Cutoff** knob. The yellow ring
   shows the cutoff the filter really uses; drag the amount chip under the
   knob to set how much.

Now modulate the modulator: add a **Random** and drag its *Out* onto
Function's **Rise** knob.

## How the board works

See [the board](board.md) for patching, cells and shortcuts, and
[ports](ports.md) for every plugin you can add in Live.

- **Ports** (MIDI In, Audio Out, …) appear on the board when you add them in
  Live. You can't delete them on the board; when a track is deactivated or
  the plugin is removed, its node turns into a grey *ghost* and keeps its
  cables.
- **The board is saved in Bleep Patch.** A second Bleep Patch in the same set
  stays inactive and shows a warning.
- **Latency.** Audio that goes from Live into the board and back is two
  audio buffers late. The output ports report this to Live, so Live's delay
  compensation lines it up with the rest of the set.
- **Undo.** The board has its own undo (⌘Z in the board window). Live's undo
  doesn't include board edits.
