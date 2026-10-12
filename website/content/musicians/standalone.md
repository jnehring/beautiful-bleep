---
title: The standalone app
description: Use Bleep without a DAW: audio setup, projects and settings of the app.
order: 3
---

# The Bleep App

The board without a DAW: for playing and sound design on its own, or next to
Live. It is one of [three places to use Bleep](overview.md) (plugin, app, web). Open the app, add modules with Tab, and patch as in Live. Projects are
saved as `.bleepboard` files (File → Save).

## Audio

Choose your audio interface in **File → Settings**. A new board starts with just
*In 1/2* and *Out 1/2*. More pairs of your interface, the MIDI ports and the
Link node are there when you need them: **Add → Port**. Delete the ones you
don't use.

## What your computer plays

The **System** node carries everything your computer plays: a music player, a
browser, a video call. Patch it into effects, or into an *Audio Out* to
process it. No virtual audio driver is needed.

Turn it on in **File → Settings → Audio → System audio → Capture what this
computer plays**. It is off until you do, because capturing sound needs your
permission. Then add the node from **Add → Port**, like the other inputs.

- **Your own sound is left out** by default, so patching *System* to an output
  does not feed back. Where the system cannot do that (Linux, older Windows),
  play Bleep App to a different output than the one you capture.
- **macOS 14.2 or later.** The first time, macOS asks to allow Bleep App to
  record system audio. If *System* stays silent, allow it under *System Settings
  → Privacy & Security → Screen & System Audio Recording*.
- **Windows 10 or later.** Leaving your own sound out needs Windows 10 build
  20348 or later.
- **Linux** with PulseAudio or PipeWire. Settings lists the outputs you can
  capture.

The capture adds about 40 ms of delay. It is meant for processing and
recording, not for playing live against it. More, with the setup for each system
and what to do when it stays silent: [Process what your computer
plays](guides/system-audio.md).

## A MIDI keyboard

Add **MIDI Device** (*Add → Module → Sources*), click it and choose your
controller. Patch its *Notes* into a Voice Cell — e.g. *Basic Poly* — and the
cell's *Out L/R* into *Out 1/2*. MIDI Device also has mono *Pitch*, *Gate*,
*Velocity*, *Bend*, *Mod Wheel* and CCs. It exists only in the app.

## MIDI to and from Live

The app has its own MIDI ports, **Bleep App 1** and **Bleep App 2** (more in
Settings). No loopback tool needed. Add their nodes from **Add → Port**.

- **Play the app from Live:** on a MIDI track, set *MIDI To* to *Bleep App 1*.
  On the board, the *Bleep App 1* MIDI In node gets the notes.
- **Play Live from the app:** patch into the *Bleep App 1* MIDI Out node; on a
  MIDI track in Live, set *MIDI From* to *Bleep App 1* and *Monitor* to *In*.

## Audio to and from Live: Bleep Audio Bridge

Put **Bleep Audio Bridge** on any track in Live while the app runs. In the app
it appears as a node named after the track:

- **Send L/R:** the track's audio, into the board.
- **Return L/R:** audio from the board, back to the track.

The plugin's **Monitor** setting chooses what the track plays: *Send* (its own
audio), *Return* (the app's audio) or *Mix*. With nothing patched into the
return, the track's audio passes through.

While bridges are connected, Live sets the pace: the app follows Live's audio,
so nothing drifts. The bridge delays audio by two audio buffers and tells Live,
so Live's delay compensation keeps everything in time. Exports include the app.

## Tempo and transport: Ableton Link

Turn on **Transport → Ableton Link** in the app and the Link button in Live:
both share tempo, beat and (with Start/Stop Sync) play and stop. The **Link**
node puts tempo, beat, bar, clock and play state on the board.
