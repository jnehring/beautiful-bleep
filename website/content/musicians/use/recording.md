---
title: Recording
description: Record many channels at once with the Audio Console: arming, takes, follow transport, and where the files go.
order: 7
---

# Recording

The **Audio Console** (Add menu → Audio → Mixing) is a mixing console with a multitrack recorder. Every channel you
arm is written to its own audio file, so you can mix the stems afterwards in Live or any other editor.

## Record

1. Put sounds into the console's channels and set **Channels** to the number you need (up to 32).
2. Arm what you want with the red **R** buttons. Each channel has one; the aux buses and the master have one too.
   **Arm all** and **Unarm all** in the Record panel do all of them at once.
3. Press **Record**. Press it again to stop. The panel shows how long you can still record and where the files go.

The tracks you armed when you pressed Record are the tracks of that recording. Arm or disarm during it and the
change applies to the next one.

## What gets recorded

| Armed | The file holds |
|---|---|
| A channel | The channel as it arrives, before the filters, EQ and fader: the dry stem. Set **Channel Tap** to *Post-fader* to record it after the filters, EQ, fader and mute instead. A stereo channel makes a stereo file. |
| An aux bus | The send bus, as it leaves the console: the sum of every channel's send. |
| The master | The main output (after the master's EQ, fader and limiter). |

The files are WAV, 24-bit by default (16-bit and 32-bit float are in **Format**). Channels are named after their
strip: click the name above a channel to rename it, and the file gets that name ("Kick.wav").

## Takes: manual or with the transport

**Start and Stop** decides what a take is:

- **Manual**: one take, from Record to Stop, however often you start and stop the transport. Use it to record a Live
  session without caring about play and stop.
- **Follow Transport**: press Record once, then every play-to-stop is its own take, in new files. If the transport
  is already running, the first take starts at once.

Takes after the first are numbered: "Kick.wav", "Kick (take 2).wav".

## Where the files go

In the apps and the plugins, into the **Recordings folder**:

| System | Folder |
|---|---|
| macOS, Linux | `~/Music/Beautiful Bleep/Recordings` |
| Windows | `%USERPROFILE%\Music\Beautiful Bleep\Recordings` |

Each recording gets a folder named after the time it started, so nothing is overwritten. The Record panel shows the
folder. Change it in **Settings → Recordings**: type a path or press *Choose…*. It applies to the next recording.

**In the browser** (Bleep Play) a page cannot write into a folder, so the console records into memory. When you press Stop the
recording appears in the Record panel with **Download .zip**, which holds a WAV file for every track of every take, and
**Discard**, which frees the memory. Time left is what is left of a fixed memory budget (a quarter of what your browser
reports as its memory, between 256 MB and 1 GB), so long recordings of many channels are short there: at the 1 GB
budget a take of 8 mono tracks at 16 bit runs about 23 minutes. When the budget is used up the recording stops and keeps
what it has: download it before you start another. See the [recorder service](/docs/developers/modules/recorder-service/).

## How long can I record?

The panel shows **Time left**. It is the free space on the disk divided by how fast your armed tracks fill it: a mono
track at 24 bit and 48 kHz is about 12 GB per day, so 32 tracks make about 0.4 TB per day. If the disk cannot keep up or
a file reaches 4 GB (the limit of a WAV file), the take ends and the panel says why. What was recorded up to then is
kept.

## Tips

- **Record dry, mix later**: keep *Channel Tap* on *Input* and arm every channel; the master is a convenient
  reference of what you heard.
- **A quick stem pass**: arm only the aux buses and the master.
- The **Recording** output is high while a take is written: use it to light something up, or to start a sequence
  together with the recording.
