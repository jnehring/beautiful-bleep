# Scope

## Introduction

Scope draws up to four signals over time and holds them still. Patch an oscillator in, set the
trigger, and its wave stands on the screen. Two pairs of cursors measure how long and how tall. It
also measures for you: the **amplitude** and the **frequency** of one trace come out as signals,
so a patch can react to what the scope sees. The audio passes through unchanged.

## How does it work?

**Time.** *Time / Div* sets how much time one of the ten divisions across the screen stands for,
from 50 µs to a second. A fast setting shows single cycles of a tone; a slow one shows an envelope or
a slow modulation. From 10 ms/div on, the picture is drawn while it is being captured, from left
to right.

**Trigger.** A sweep starts when the *Source* trace crosses the *Trigger Level* in the direction of *Edge*.
Because the crossing is timed to a fraction of a sample, a steady wave starts each sweep in the same
place and appears to stand still. The marker at the left edge of the screen shows the level.
*Auto* starts a sweep anyway when nothing triggers, so the screen never goes dark;
*Normal* waits and keeps the last picture; *Free Run* sweeps without a trigger at all. *Hold*
freezes the picture (the measurements go on).

**Traces.** *Traces* chooses two, three or four inputs. Each has a *Scale* (how tall it is drawn,
1 × fills four divisions with a signal of ±1), a *Position* (shift up and down in divisions) and a *Colour*. These
only change the drawing, not the signal.

**Cursors.** With *Cursors* on, drag the two vertical lines to measure a time: the readout shows
Δt, the frequency 1/Δt and, from the two horizontal lines, the level difference ΔV in the units of
the measured trace. Their positions are saved with the patch.

**Measuring.** *Measure* picks the trace that **Amplitude**, **Frequency** and **Valid** follow. Amplitude
is half the peak-to-peak swing. Frequency is a pitch signal (1 V/oct, 0 is middle C), so it can drive
an oscillator or a quantizer directly; it holds its last value when **Valid** goes low, which happens
on silence or when the signal stops repeating.

## How to use it?

- **See a wave:** any oscillator into In 1, Time / Div 1 ms, Mode Auto.
- **Compare two:** a signal and the same signal after a filter or a delay into In 1 and 2; the shift between them
  reads off with the cursors.
- **Watch an envelope:** an envelope into In 1, Time / Div 200 ms, Mode Normal, Trigger Level at 0.1, with the gate
  wired to In 2 so you see the gate and the envelope together.
- **A tuner for a patch:** put a tone into In 1 and take **Frequency** to a Quantizer to follow its pitch,
  or compare it with a keyboard's pitch in a Math module.
- **Level follower:** **Amplitude** is a slow, smooth loudness signal, less quick than a peak meter.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Scope does. In the standalone app open **File → Presets…** (⌘P) and pick *Scope* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Scope: A Wave Standing Still** | A saw lead passes through the Scope, which holds each wave still on the screen; the Frequency and Amplitude readouts follow the notes. Turn Time / Div up to see more cycles or down to see one, and change the Edge to Falling to flip the picture. |
| **Scope: Filter In and Out** | A saw riff is drawn twice: raw on the first trace, after a swept resonant low-pass on the second. Watch the corners round off as the cutoff sinks. Change Measure to Trace 1 to read the raw pitch, or raise the filter's Resonance. |
| **Scope: Envelope in Normal Mode** | The first trace shows the envelope of each note, caught by a trigger set just above zero in Normal mode, so every sweep starts exactly when a note starts and the picture waits between notes. Raise Trigger Level to start later on the rise, or change Mode to Auto. |
| **Scope: Frequency Plays Along** | The Scope measures the pitch of a bass line and its Frequency output, snapped to a scale by a Quantizer, plays a bell an octave and a fifth above, gated by Valid: a harmony made by measuring. Change the Quantizer's Scale or Root, or turn the follower up to hear its small delay. |
| **Scope: Amplitude Opens the Bass** | A drum loop is drawn on the Scope and its Amplitude output, the size of the wave, opens the filter of a saw bass: each hit brightens the bass for a moment. Change the cable amount into Cutoff, or move the bass filter's base Cutoff. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Time / Div | 0.05 – 1000 ms | 1 ms |
| Hold | off, on | off |
| Traces | 2 – 4 | 2 |
| Cursors | off, on | on |
| Trigger Level | −2 … +2 | 0 |
| Edge | Rising, Falling, Either | Rising |
| Source | Trace 1 – 4 | Trace 1 |
| Mode | Auto, Normal, Free Run | Auto |
| Scale 1 – 4 | 0.05 – 20 × | 1 × |
| Position 1 – 4 | −4 … +4 div | 0 |
| Colour 1 – 4 | Mint, Amber, Sky, Rose, Lime, Violet, White, Orange | Mint, Amber, Sky, Rose |
| Measure | Trace 1 – 4 | Trace 1 |

### Inputs

| Input | Signal | What it does |
|---|---|---|
| In 1 – In 4 | audio | the traces (In 3 and In 4 with that many traces) |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out 1 – Out 4 | audio | the inputs, unchanged |
| Amplitude | control | half the swing of the Measure trace |
| Frequency | pitch | frequency of the Measure trace, 1 V/oct, 0 = middle C |
| Valid | gate | high while the Measure trace is a clear repeating signal |
