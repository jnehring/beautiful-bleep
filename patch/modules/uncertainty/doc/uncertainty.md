# Uncertainty

![Uncertainty in the module view](uncertainty.png)

## Introduction

Uncertainty is six random generators in one module, each with a different
character: two **Fluctuating** voltages that wander continuously, two
**Quantized** voltages that jump between a few levels, a **Stored** value
whose distribution you can skew and whose values can depend on each other,
and an **Integrated** voltage that turns the stored values into random
slopes. Whenever something in a patch should move unpredictably, one of
these six probably fits.

## How does it work?

**Fluctuating 1 and 2** are smooth curves through random points. In Free mode
the points come on average every 1 / *Rate* seconds, irregularly spaced so
there is no audible pulse. With *F Sync* on a note value and the transport
playing, the points sit on the grid and the curve is a function of the song
position. *Spread* sets the size. The two have different default rates, so
they rarely move together.

**Quantized 1 and 2** jump on each clock to one of 2, 4, 8 or 16 levels
(*Bits* 1 … 4). With *Interval Even* the levels spread evenly over 0 … 1
(1 bit is a random on/off voltage). With an interval in semitones each level
is that many semitones above the last: 3 bits with 7 semitones jumps between
eight notes a fifth apart. Few levels give a small vocabulary the ear hears as
a pattern. Quantized 2 has its own *Clock Q2* input; while it's unpatched it
follows Quantized 1's clock divided by *Q2 Divide*.

**Stored** takes a new value on each *Store* event. Three controls shape it:

- **Correlation:** how much each value depends on the previous one. 0 %:
  independent. Positive: each value stays near the last, a slow stepped
  wander. Negative: values alternate high and low, a zig-zag. The overall
  spread of values stays the same.
- **Shape:** *Uniform*, *Bell* (values gather in the middle) or *Edges* (values
  are pushed outward).
- **Distribution:** skews the values toward the top (+) or the bottom (−).

**Integrated** uses Stored as a slope: it rises while Stored is positive and
falls while it's negative, at a speed set by *Integrate*, and bounces back
from ±1. The result is a line that changes direction and speed at every Store
event. With positive Correlation it makes long sweeps; with negative
Correlation it trembles around a point.

**Clocks.** Each clock follows its input when patched, else the song position
when its *Sync* is on a note value (at the synced length while the transport
is stopped), else its *Rate*. A synced Fluctuating curve holds while the
transport is stopped.

**Repeatable.** Every value comes from *Seed*. Synced generators are a
function of the song position and render the same from any start; the free
ones and Integrated render the same from the same start.

## How to use it?

- **Slow, organic movement:** *Fluct 1* and *Fluct 2* to two filter cutoffs or
  pans.
- **A small random melody:** *Quant 1* with *Q1 Interval* 2 semitones and
  3 bits into an oscillator's pitch, *Q Sync* 1/8.
- **Random octaves:** *Q2 Interval* 12, *Q2 Bits* 2.
- **A random on/off switch:** 1 bit on Quantized 2, *Q2 Divide* /4.
- **A drifting value per note:** inside a Voice Cell, *Voice In › Trigger* into
  *Store*, *Correlation* +80 %: each note's value is near the last one.
- **Random sweeps:** *Integrated* to a filter cutoff, *Correlation* +60 %.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Uncertainty does. In the standalone app open **File → Presets…** (⌘P) and pick *Uncertainty* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Uncertainty: Fluctuating Filter** | The two fluctuating curves wander at unrelated speeds: one opens and closes the filter on a plucked line, the other changes the tone shape. Raise F1 Rate and F2 Rate to speed them up, or lower F1 Spread to shrink the sweep. |
| **Uncertainty: Stepped Levels** | Quantized outputs jump between a few evenly spaced levels (Q1 Bits sets how many): Q1 pushes the pitch up by octaves and Q2 moves the filter, both in time with the eighth notes. Try Q1 Interval at 7 st for stacked fifths or raise the bits for more levels. |
| **Uncertainty: Stored Per Note** | Each note of the line tells the Store input to take a fresh stored value, which then holds until the next note; it sets the filter, and the Store Trigger output also fires a hi-hat. Raise Correlation so each value leans on the last, or move Distribution to favour low or high settings. |
| **Uncertainty: Integrated Drift** | The Integrated output is the running total of the stored steps, so it wanders like a slow random walk; here it steers the brightness of a held pad and the stored value tilts the oscillators. Change Integrate to make the walk shorter-lived or longer, and Store Rate for how often it is nudged. |
| **Uncertainty: Extreme Moods** | Setting Shape to Edges makes the random values favour the extremes, so the filter on this bass line jumps between very closed and wide open instead of sitting in the middle. Switch Shape to Bell or Uniform to hear it settle. |
<!-- /generated -->

<!-- generated:presets -->
## Presets

The preset bar of the Uncertainty view has 16 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Slow Random Drift** | Two lazy fluctuating curves: gentle analogue-style drift. |
| **Lively Fluctuation** | Faster, wider random curves for obvious movement. |
| **Synced Fluctuation** | Fluctuations that move in step with the tempo. |
| **Eighth Note Steps** | Two random step sequences: eighths and quarters. |
| **Sixteenth Chaos** | Dense sixteenth-note random steps with many levels. |
| **Octave Jumps** | Random steps in octave leaps: wild but tonal pitch jumps. |
| **Fifths and Fourths** | Random steps in fifths and fourths: open, melodic. |
| **Whole-Tone Walk** | Whole-tone random steps for a floating melody. |
| **Bell Distribution** | Values cluster near the middle, with rare extremes. |
| **Edge Seeker** | Values favour the extremes: dramatic jumps. |
| **Biased High** | Stored value skewed upward: mostly high, occasionally low. |
| **Correlated Walk** | Each stored value resembles the last: a gradual random walk. |
| **Anti-Correlated** | Stored values alternate high and low: a zigzag. |
| **Integrator Wander** | The integrated output smooths the stored value into slow glides. |
| **Slow Store** | Everything stretched over bars for evolving ambient control. |
| **Free Clocked Chaos** | All generators unsynced and fast: loose, jittery movement. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| F1 Rate, F2 Rate | 0.01 – 20 Hz | 0.5 Hz, 0.17 Hz |
| F1 Spread, F2 Spread | 0 – 100 % | 100 % |
| Q Rate | 0.05 – 40 Hz | 2 Hz |
| Store Rate | 0.05 – 40 Hz | 1 Hz |
| Distribution | −100 … +100 % | 0 % |
| Correlation | −95 … +95 % | 0 % |
| Integrate | 0.01 – 10 /s | 0.5 /s |
| F Sync | Free, 1/32 … 8 bars | Free |
| Q Sync | Free, 1/32 … 8 bars | 1/8 |
| Store Sync | Free, 1/32 … 8 bars | 1/4 |
| Q1 Bits, Q2 Bits | 1 – 4 | 3, 2 |
| Q1 Interval, Q2 Interval | Even, 1, 2, 5, 7, 12 st | Even |
| Q2 Divide | /1, /2, /3, /4, /8 | /2 |
| Shape | Uniform, Bell, Edges | Uniform |
| Seed | 0 – 999 | 1 |

- **F Rate:** the average number of points per second of a Fluctuating curve
  (Free mode). Changing it stretches the curve; it never jumps.
- **F Spread:** the size of a Fluctuating output.
- **Q Rate / Store Rate:** the free clocks of Quantized 1 and Stored (shown
  while their *Sync* is *Free*).
- **Distribution, Correlation, Shape:** shape Stored (see above).
- **Integrate:** the speed of Integrated per unit of Stored.
- **Bits:** 2^Bits levels. **Interval:** Even spreads them over 0 … 1;
  semitones stack them at 1 V/oct.
- **Q2 Divide:** while *Clock Q2* is unpatched, Quantized 2 steps on every
  n-th step of Quantized 1.
- **Seed:** one seed; each generator has its own stream of it.

All knobs are modulation destinations.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Clock Q1 | trigger | each pulse steps Quantized 1 |
| Clock Q2 | trigger | each pulse steps Quantized 2; unpatched: Quantized 1's clock / *Q2 Divide* |
| Store | trigger | each pulse takes a new Stored value |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Fluct 1, Fluct 2 | control, −1 … +1 | continuously wandering voltages |
| Quant 1, Quant 2 | control (0 … 1, or 1 V/oct) | stepped random on 2^Bits levels |
| Stored | control, −1 … +1 | the stored value |
| Integrated | control, −1 … +1 | random slopes from the stored values |
| Store Trig | trigger | a pulse when Stored takes a new value |
