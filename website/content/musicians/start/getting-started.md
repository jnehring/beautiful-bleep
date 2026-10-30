---
title: Get started in Live
description: Install the Bleep plugins in Ableton Live, play a preset, then open the board and patch across your tracks.
order: 4
---

# Get started in Live

Beautiful Bleep makes Ableton Live feel modular. All modules live on one canvas
per set, the **board**. You connect them with cables, and small plugins
called **ports** connect the board to your tracks. Bleep also runs as a
[standalone app and in your browser](ways-to-use.md).

## Install

The easiest way is through the [Bleep App](getting-started-app.md):

1. Quit Live. (Replacing a plugin that Live has loaded can crash it.)
2. In the app, open **File → Open Library… → Plugins** and click **Install or
   update the default plugins**.
3. Start Live and rescan plugins (Settings → Plug-Ins, with "Use VST3 Plug-In
   System Folders" on).

Or copy the `.vst3` files to your plugin folder yourself and rescan:

| | VST3 folder |
|---|---|
| macOS | `~/Library/Audio/Plug-Ins/VST3` |
| Windows | `C:\Program Files\Common Files\VST3` |

The plugins appear in Live's browser under **Plug-Ins → Beautiful Bleep**.
They are not signed with a paid certificate. If your system or Live refuses
to load them, see [Installing unsigned builds](unsigned-builds.md).

## Play a preset

No cables needed:

- Put **Bleep Instrument** on a MIDI track, pick a preset such as *Slate
  Stabs* and play.
- Put **Bleep FX** on an audio track, pick a preset such as *Dub Ping-Pong*
  and play audio through it.

Both open on the preset's panel of knobs. [Your first sound](first-sound.md)
has more.

## Open the board

1. Put **Bleep Board** on a MIDI track. Every set that patches with Bleep needs
   exactly one: the board is saved there, in your Live set.
2. Open its window. Every Bleep plugin in the set shows up on the board as a
   node, named after its track.
3. Press **Tab** to add a module, and drag cables between the nodes. A cable
   can go from one track to another, and onto any knob to modulate it.

[Your first patch](../learn/first-patch.md) walks through it in five minutes:
a filter on a synth track, modulated by a Function, modulated by Random.

## What next

- [Ports](../use/ports.md): every plugin you can put on a track.
- [Ableton Live goes modular](ableton-live-goes-modular.md): what Live can do
  with the board that it could not do before.
- [Connecting](../connect/connecting.md): MIDI, audio and tempo between Live,
  the Bleep App and Bleep Play.
