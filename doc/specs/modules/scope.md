# Scope

Type id `scope` · category *Utility/Metering* · colour `#5eead4`

## 1. Purpose

Shows two to four signals over time on a triggered display, so a waveform stands still and can be
read: its shape, its size, its period. Two cursor pairs measure time and level on the screen. What
the module measures on one trace (its amplitude and its frequency) comes out as signals. The audio
passes through, so the scope can sit anywhere in a patch.

It is a time display. For X against Y (Lissajous figures, phase) there is the XY Scope.

## 2. Jacks

**Inputs**: *In 1*, *In 2*, and with *Traces* at 3 or 4, *In 3*, *In 4* (`audio`; control signals work too).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out 1 … Out 4 | `audio` | The inputs, unchanged (Out 3, 4 shown with that many traces). |
| Amplitude | `control` (unipolar) | Half the peak-to-peak swing of the *Measure* trace, smoothed over about 30 ms. |
| Frequency | `pitch` | The frequency of the *Measure* trace, 1 V/oct with 0 = middle C. Holds its last value while Valid is low. |
| Valid | `gate` | High while the measured trace is a clear periodic signal (swing above 0.002, a rising crossing within three periods). |

## 3. Controls

**Knobs and settings**

| Control | Range | Default | Notes |
|---|---|---|---|
| Time / Div | 0.05 – 1000 ms (exponential) | 1 ms | The screen is 10 divisions wide. |
| Hold | off / on | off | Freezes the picture. The measurements go on. |
| Traces | 2 – 4 | 2 | |
| Cursors | off / on | on | |
| Trigger Level | −2 … +2 | 0 | In signal units. |
| Edge | Rising, Falling, Either | Rising | |
| Source | Trace 1 – 4 | Trace 1 | Which trace is tested against the level. |
| Mode | Auto, Normal, Free Run | Auto | |
| Scale *n* | 0.05 – 20 × (exponential) | 1 × | Display only. At 1 × a signal of ±1 fills four divisions. |
| Position *n* | −4 … +4 div | 0 | Display only. |
| Colour *n* | Mint, Amber, Sky, Rose, Lime, Violet, White, Orange | one each | Display only. |
| Measure | Trace 1 – 4 | Trace 1 | The trace the three measurement outputs follow. |

**Node data** keeps the four cursor positions: `t1`, `t2` (0 – 10 divisions from the left) and `v1`, `v2` (−4 – 4 divisions
from the centre).

## 4. Behaviour

**Capture.** The screen has 400 columns across 10 divisions. A sweep starts at a trigger and runs
for `10 × Time/Div`. Every column keeps the lowest and the highest sample that fell into it, so a
spike is never lost between columns when the sweep is slow; when the sweep is faster than one
sample per column, the skipped columns get the straight line between the neighbouring samples. A
sweep that finishes publishes its whole frame to the view.

**Trigger.** The *Source* trace crossing *Level* in the chosen direction. The crossing is placed to a
fraction of a sample (linear interpolation), so a steady wave starts every sweep at exactly the same
phase at any time base. After a sweep the trigger re-arms once the signal has been
1 % of full scale on the other side of the level, which keeps noise from retriggering. The first
sample of the sweep is the first one after the crossing; the part of the wave before the trigger
isn't shown.

- **Auto:** with no trigger within 1.1 sweeps (at least 50 ms), a sweep starts anyway, so the picture
  never goes blank. The trigger lamp is dark for such a sweep.
- **Normal:** a sweep starts only on a trigger; the last picture stays until the next.
- **Free Run:** sweeps follow one another without a trigger.

**Slow sweeps.** From 10 ms/div on (sweep longer than 0.1 s) the picture is updated 30 times a second
while the sweep runs, from the left, with a dark gap travelling ahead of the new data.

**Measurements** run on the *Measure* trace at all times, shown or not. Over blocks of 50 ms the highest and lowest
value give the swing (half of it is Amplitude) and the centre. A Schmitt trigger around the centre (±20 % of the swing) finds rising crossings; consecutive
crossings give the period (to a fraction of a sample) and the frequency, smoothed (a jump of more than 25 % replaces it at once).
Silence (swing below 0.002) or no crossing for three periods (at least 0.1 s) turns Valid off.

**Cursors** are in the view only. Δt is the distance of the two time cursors times *Time / Div*; 1/Δt is shown
as a frequency; ΔV is the distance of the level cursors in the units of the *Measure* trace. Drag a cursor line to move it.

## 5. View

A dark screen with a 10 × 8 graticule and fine ticks on the centre lines; each trace in its colour, drawn as a filled band between
column minimum and maximum with a line through the middle. The trigger level is a marker at the left edge in the source
trace's colour. Below: time/div, the measured frequency and amplitude, a trigger lamp and, with cursors on, Δt, 1/Δt and ΔV.
Controls are grouped Time, Trigger, Traces and Outputs.

## 6. Voice cells

Inside a Voice Cell every voice has its own scope state; the view shows the voice the board shows.

## 7. Performance

Four traces at 400 columns: one compare and store per sample per trace. The frame is copied to the view only when a sweep ends.

## 8. Tests

`modules/scope/tests/test_scope.cpp`: measurement of sine, offset square and silence; stable picture at two phases; falling edge; Normal / Auto /
Free Run; Hold; spike survival; no holes at the fastest time base; slow-sweep updates; determinism.
