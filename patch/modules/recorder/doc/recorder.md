# Recorder

## Introduction

Recorder bounces what you play to a file. Arm it, play, and the take starts by itself when the sound begins;
a short pre-roll catches the attack that crossed the threshold. When the take ends it is saved as a stereo WAV
file in the media folder, and a button shows you the file. The audio passes through, so the Recorder can sit at the
end of a patch, or in the middle of it to catch one voice.

## How does it work?

**Starting.** Press **Arm**: the Recorder listens. With *Armed Start* on *On Signal* the take begins when the input
passes *Signal Level*, and *Pre-roll* seconds from before that moment are included. With *By Hand* press **Record**.
A **Gate** cable can start and stop takes too (set *Gate Input* to *Starts and Ends*): the take lasts as long as the gate is
high. **Record** works from any state and starts at once.

**Stopping.** **Stop**, the end of the gate, or the *Length Limit*; whichever comes first. The **Recording** output is
high during a take and **Done** pulses at its end; **Progress** shows how much of the limit is used, which
is handy for a patch that should do something at the end of a take.

**Saving.** The take lives in memory until you save it. With *Save When Done* on, the view saves it as soon as
the take ends; for that the Recorder's view has to be open. Otherwise press **Save Take**. The file is a 32-bit float
WAV in the media folder (on a Mac under Music / Beautiful Bleep / Media); **Show File** opens that folder with the file
selected. Saving the same sound twice makes one file. A new take replaces the old one in memory (the saved files stay).

**Memory.** The Recorder reserves room for two minutes of stereo audio when it is created. A Voice Cell
should not contain one.

## How to use it?

- **Catch an idea:** Arm, play; the take starts with your first note. Press Stop, then Show File and drag the file into your session.
- **Bounce a pattern:** a pattern's gate into **Gate** with *Starts and Ends*; every run of the pattern is a take.
- **Take and loop:** **Done** into a Sampler's trigger, with the saved file loaded into it.
- **A fixed length:** Length Limit 10 s and Armed Start By Hand: **Record** takes exactly ten seconds.

## Reference

### Settings

| Setting | Values | Default |
|---|---|---|
| Length Limit | 10 s, 30 s, 60 s, 90 s, 2 min | 30 s |
| Armed Start | By Hand, On Signal | On Signal |
| Signal Level | −60 … −6 dB | −36 dB |
| Pre-roll | 0 – 2 s | 0.25 s |
| Gate Input | Ignored, Starts and Ends | Ignored |
| Save When Done | off, on | on |

Buttons: **Arm**, **Record**, **Stop**, **Clear**.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| In L, In R | audio | what is recorded (R unpatched: L to both) |
| Gate | gate | starts and ends takes with *Gate Input* on |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out L, Out R | audio | the inputs, unchanged |
| Recording | gate | high during a take |
| Done | trigger | a pulse when a take ends |
| Progress | control | how much of the limit the take fills |
