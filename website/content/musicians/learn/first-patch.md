---
title: Your first patch
description: Five minutes on the board: add a filter, modulate its cutoff and modulate the modulator.
order: 1
---

# Your first patch

This is a five-minute tour of the board in Ableton Live. You need the plugins
installed ([Get started in Live](../start/getting-started.md)) and a synth on a track.
The board is the same in the [Bleep App and in Bleep Play](../start/ways-to-use.md);
only the first two steps are specific to Live.

## The patch (5 minutes)

1. Put **Bleep Board** on a MIDI track (it is an instrument, so it can't go on the master or a return track).
   Every set that uses Bleep Board needs exactly one. Its window opens the
   board.
2. Put **Bleep FX** on a synth track, after the synth. It appears
   on the board by itself, named after the track.

   ![The board with one node, Synth, of type Bleep FX: Return L and Return R on the left, Send L and Send R on the right.](/img/first-patch-1.png)

3. On the board, press **Tab**, type *filter* and press Enter.

   ![The search box after pressing Tab and typing filter: Multi Filter is the first result.](/img/first-patch-2.png)

   Drag from the Insert's *Send L* to the Filter's *In L*, and from the Filter's
   *Out L* and *Out R* to the Insert's *Return L* and *Return R*.

   ![The Filter is cabled between the Insert's sends and returns: the audio of the track now goes through it.](/img/first-patch-4.png)

4. Press Tab again and add a **Function**.

   ![The search box with function typed: Function is the first result.](/img/first-patch-5.png)

   Click the Filter to open its view, then drag Function's *A* onto the **Cutoff**
   knob. The yellow ring shows the cutoff the filter really uses; drag the amount
   chip under the knob to set how much.

   ![The Filter's view. A cable runs from Function's A output to the Cutoff knob; the knob has a yellow ring and an amount chip showing 100%.](/img/first-patch-7.png)

Now modulate the modulator: add a **Random** and drag its *Out* onto
Function's **Rise** knob.

![Function's view with Random's Out cabled to the Rise knob, which now has a yellow ring.](/img/first-patch-9.png)

You have now used the three ideas the rest of Bleep is built on: modules joined
by cables, a knob that is also a modulation destination, and a modulator that can
itself be modulated.

## Good to know

- **Ports** (MIDI In, Audio Out, …) appear on the board when you add them in
  Live. You can't delete them on the board; when a track is deactivated or
  the plugin is removed, its node turns into a grey *ghost* and keeps its
  cables.
- **The board is saved in Bleep Board.** A second Bleep Board in the same set
  stays inactive and shows a warning.
- **Latency.** Audio that goes from Live into the board and back is two
  audio buffers late. The output ports report this to Live, so Live's delay
  compensation lines it up with the rest of the set.
- **Undo.** The board has its own undo (⌘Z in the board window). Live's undo
  doesn't include board edits.

## Next

- [Modulation](modulation.md): what the rings, chips and cable colours mean.
- [Cells and panels](cells-and-panels.md): keep a patch tidy and turn it into an instrument.
- [The board](../use/board.md): the full reference for patching.
