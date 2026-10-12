---
title: Process what your computer plays
description: Take the sound of your music player, browser or video call into the Bleep Patch app with the System node, on macOS, Windows and Linux.
order: 22
---

# Process what your computer plays

The **System** node puts everything your computer plays onto the board: a
music player, a browser tab, a video call, a game. Patch it into a filter, a
reverb or a delay network, and listen to the result. Or record it.

It is a feature of the [Bleep Patch app](../standalone.md). The plugins have
your DAW for this, and the browser board cannot see other programs.

You don't need a virtual audio driver (BlackHole, Loopback, VB-Cable). Bleep
Patch asks your operating system for the sound directly.

## Turn it on

1. Open **File → Settings → Audio**.
2. Under **System audio**, tick **Capture what this computer plays**.
3. Allow the permission if your system asks (macOS does, once).
4. On the board, choose **Add → Port → System**.

The node has two outputs, *L* and *R*, and a *Gain* dial, like the other
Audio In nodes. It stays off until you tick the box:
nothing is captured before that.

The settings show what is going on: the sample rate, whether your own sound is
left out, and whether sound arrives (*signal*) or not (*silent*).

## Recipes

- **Hear your music player through an effect.** Play something in another
  program, then patch *System L/R* → *Reverb* → *Out 1/2*. You hear the player
  itself and, a moment later, the effect. Play Bleep Patch to headphones and the
  player to speakers (or mute the player's output) to hear the effect alone.
- **A filter sweep over a song.** *System L/R* → *Filter* → *Out 1/2*, and an
  LFO on the cutoff.
- **Record what you hear.** Patch *System* and your synth into a mixer node and
  on into a recorder.

Because the captured sound reaches Bleep Patch a moment after it leaves the
other program, the effect is slightly late. See *Delay* below.

## Feedback

If Bleep Patch plays to your speakers and *System* captures your speakers, a cable
from *System* to *Out 1/2* would feed back: what comes out is captured, played,
captured again.

Bleep Patch prevents this by default: **Leave out Bleep Patch's own sound** is
on. The capture then holds everything except Bleep Patch.

| System | Own sound left out? |
|---|---|
| macOS 14.2 or later | Yes |
| Windows 10 build 20348 or later, Windows 11 | Yes |
| Older Windows | No |
| Linux | No |

Where it can't be left out, the setting is disabled and says so. Play Bleep
Patch to **another output** than the one you capture (headphones for Bleep
Patch, speakers for everything else), or don't patch *System* to an output.

Turn the setting off if you want to record Bleep Patch's own sound together
with everything else.

## macOS

You need **macOS 14.2 or later**. The first time you turn the capture on,
macOS asks if Bleep Patch may record system audio. If it doesn't ask, or you
said no, *System* stays silent. Allow it in **System Settings → Privacy &
Security → Screen & System Audio Recording** (the *System Audio Recording
Only* list), then turn the capture off and on again.

If the app is started from a terminal rather than by double-clicking it,
macOS may credit the terminal instead of Bleep Patch, and the capture stays
silent. Start the app from Finder or the Dock.

Sound that is protected against copying (some streaming services) arrives as
silence. That is the system's rule, not a setting.

On older macOS, use a loopback driver such as BlackHole as an input device
instead (File → Settings → Input).

## Windows

Windows 10 or later. No permission prompt.

With Windows 10 build 20348 or later (and Windows 11), Bleep Patch captures
everything except itself, whichever output device you use. On older versions it
captures the default output device including its own sound.

If you change the default output (plug in headphones), the capture follows
within a second.

## Linux

You need PulseAudio, or PipeWire with its PulseAudio support (`pipewire-pulse`,
the default on most desktops), and a build of the app with `libpulse` (install
`libpulse-dev` before building).

Every output has a *monitor*, a source that carries what that output plays.
The settings list them under **Output to capture**. *Default output* follows
your system's default.

Linux can't leave Bleep Patch's own sound out of a monitor: use a different
output for Bleep Patch than for the rest, as described under *Feedback*.

## Delay

The captured sound takes about **40 ms** to arrive: 30 ms is a buffer that
absorbs hiccups, and the system's own capture adds 10 to 20 ms. That doesn't
matter for processing, mixing or recording. It does matter for playing live
against the captured sound; for that, use a normal audio input (a cable or a
loopback driver).

Two sound cards never run at exactly the same speed. Bleep Patch corrects for
that continuously with a tiny pitch adjustment (well below what you can hear)
instead of dropping or repeating samples, so long sessions stay clean.

## When it doesn't work

| What you see | What to do |
|---|---|
| *silent* in Settings, but sound plays | macOS: allow Bleep Patch under Privacy & Security, then turn the capture off and on. Otherwise check that the other program plays to the output that is the system default |
| "needs macOS 14.2 or later" | Update macOS, or use a loopback driver as an input device |
| "No PulseAudio or PipeWire sound server was found" (Linux) | Start your sound server; check with `pactl info` |
| "This system cannot leave Bleep Patch out" | Not an error: see *Feedback* |
| The node is grey (a ghost) | The capture is off or failed. Tick the box in Settings again and read the message |
| A crackle once in a while | Raise the buffer size in Settings → Audio; the capture follows it |

## Notes for developers

How it is built, the clock-drift handling and the open questions are in the
specification, `doc/specs/system-audio.md` in the repository.
