# Recorder

Type id `recorder` · category *Utility* · colour `#fca5a5`

## 1. Purpose

Bounces the stereo signal it hears into a file. Where the Splice and the Sampler record into the board to be played
again, the Recorder makes a plain audio file: arm it, play, and the take starts by itself when the sound
begins, with a pre-roll so the beginning is not cut off. The take is a stereo 32-bit float WAV file in the
media folder, and the view can show it in the computer's file manager. The audio passes through.

## 2. Jacks

**Inputs**: *In L*, *In R* (`audio`; R unpatched: L is recorded to both channels), *Gate* (`gate`).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | The inputs, unchanged. |
| Recording | `gate` | High while a take is being recorded. |
| Done | `trigger` | A 2 ms pulse when a take ends. |
| Progress | `control` (unipolar) | How much of the length limit the take (or the finished take) fills, 0 – 1. |

## 3. Controls

| Control | Values | Default | Notes |
|---|---|---|---|
| Length Limit | 10 s, 30 s, 60 s, 90 s, 2 min | 30 s | The take ends when it is full. |
| Armed Start | By Hand, On Signal | On Signal | What starts an armed recorder. |
| Signal Level | −60 … −6 dB | −36 dB | Threshold of *On Signal* (the louder channel's magnitude). |
| Pre-roll | 0 – 2 s | 0.25 s | Kept while armed; starts the take before the signal. |
| Gate Input | Ignored, Starts and Ends | Ignored | A rising Gate starts a take (armed or not), a falling one ends it. |
| Save When Done | off / on | on | The view saves the finished take at once (see §5). |

Buttons: *Arm*, *Record*, *Stop*, *Clear*.

**Node data**: `take` (media id of the last saved take) and `seconds`.

## 4. Behaviour

- **States:** *Idle*, *Armed*, *Recording*, *Take ready*. *Arm* puts an idle or finished recorder in Armed; *Record* starts a take at once from any
  state but Recording; *Stop* ends a take; *Clear* forgets a finished take (ignored while recording).
- **Armed:** the last `Pre-roll` of input is kept in a ring. The take starts on *Record*, on a signal at or above *Signal Level* (with *Armed Start* = On
  Signal) or on a rising Gate (with *Gate Input* on). It then begins with the pre-roll and the sample that started it.
- **Recording:** samples are stored without conversion; the take ends at *Stop*, at the length limit, or, if it was started by the Gate,
  when the gate falls (that sample is not stored). Done pulses and the state becomes *Take ready*. A take shorter than one sample is discarded.
- **A new take** replaces the previous one when it starts.
- **Memory.** 120 seconds of stereo float are allocated when the module is prepared (about 46 MB at 48 kHz); the system only commits the pages a take
  reaches. The module is marked as memory-heavy.
- **Reading the take** (`exportMedia("take")`) works while the recorder is not recording; while a take is being read out, a new take waits.

## 5. View

State lamp and name, elapsed time over limit, a level bar, the take's waveform filling from the left across the limit, buttons *Save Take* and *Show File*.
Save writes the take to the media folder (`Media.h`; the id is the hash of the content) and keeps the id in the node's data; with *Save When Done* on, the view
does it when a take finishes **while the view is open**; otherwise press *Save Take*. *Show File* asks the app to reveal the file
(`api.revealMedia(id)`, a native function of the board: `revealMedia`).

## 6. Tests

`modules/recorder/tests/test_recorder.cpp`: the recorded samples equal the input, the limit, start on signal with exact pre-roll, no start without
signal or in By Hand, gate start and end, new take replaces old, clear, read-out blocks a new take, no read-out while recording, peaks.
