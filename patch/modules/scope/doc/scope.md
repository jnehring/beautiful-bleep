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
