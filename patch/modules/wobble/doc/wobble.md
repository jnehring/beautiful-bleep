# Wobble

![Wobble in the module view](wobble.png)

## Introduction

Wobble turns one stream of random values into three shapes of movement.
**Stepped** jumps to each new value, **Smooth** glides to it, and **Wobble**
glides with momentum: it overshoots, wobbles around the value and settles.
Patch them to related destinations (Stepped to pitch, Wobble to the filter)
and the movements belong together. Around them sit bursts of quick
triggers, a step clock, a *Compare* gate and a *Chaos* knob that feeds the
module back into itself.

## How does it work?

**Steps.** Wobble takes a new random value on each step. Steps come from:

1. **Clock patched:** every rising edge.
2. **Sync on a note value:** one step per note value. While the transport plays
   the steps are locked to the song position.
3. **Sync on Free:** steps at *Rate*.

Each step fires *Clock*. With *Sample* patched, each step samples that signal
instead of taking a random value: a sample and hold with three output shapes.
While *Hold* is high no new values are taken (and *Clock* stays quiet), but
Smooth and Wobble keep settling.

**Smooth** follows Stepped through a smooth low-pass filter. *Smooth* sets how
slowly: at 0 % it almost jumps, at 50 % it arrives just in time for the next
step, at 100 % it barely moves before the next value comes. The filter follows
the step length, so the character is the same at any rate or tempo.

**Wobble** uses the same filter with resonance. *Wobble* 0 % behaves like
Smooth; higher values overshoot each new value and ring around it. When the
next step comes before it settles, the wobbles overlap: that's where the
bouncing comes from. Beyond ±1 the output is softly limited to ±1.5.

**Burst.** On each step, with the chance *Burst*, a burst of 2 … *Burst Size*
quick triggers fires over the first half of the step: rolls for drums or
quick re-triggers of an envelope.

**Compare** is high while Stepped is above Smooth: an irregular gate whose
rhythm follows the movement.

**Chaos** feeds the module back into itself. The new values are bent toward
the current Smooth value and folded, so above about 40 % they cluster, run in
streaks and break away. In Free mode fast wobbles also speed up the steps, and
burst spacing gets irregular. Steps that follow the song position stay on the
grid.

**Repeatable.** The random values come from *Seed* and the step number. With
*Chaos* at 0 and *Sync* on a note value, Stepped is a function of the song
position. With *Chaos* up, a render from the same start position is always
identical.

## How to use it?

- **Three related movements:** *Stepped* to an oscillator's pitch (through a
  quantizer), *Wobble* to the filter cutoff, *Smooth* to the pan.
- **Bouncy filter:** *Wobble* 80 %, *Smooth* 40 %, Sync 1/8, into a filter's cutoff.
- **Slow drift:** *Smooth* 100 %, *Rate* 0.1 Hz: a wandering line.
- **One value per note:** inside a Voice Cell, *Voice In › Trigger* into *Clock*:
  every note gets a new value that wobbles into place.
- **Drum rolls:** *Burst* into a drum's trigger, *Burst* 30 %, Sync 1/4.
- **A sample and hold:** patch a signal into *Sample* and a clock into *Clock*.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Wobble does. In the standalone app open **File → Presets…** (⌘P) and pick *Wobble* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Wobble: Three Shapes** | One random stream, three ways: Stepped jumps the filter, Smooth glides the tone and Wobble overshoots and rings on the reverb. All three follow the same underlying values, so they feel related. Change Smooth and Wobble on the module to reshape the glides and overshoots. |
| **Wobble: Ringing Filter** | With Wobble high, every jump of the random value overshoots and rings before it settles, so the filter on this held chord seems to bounce. Reduce Wobble for a plain glide, or increase Chaos for a more unstable movement. |
| **Wobble: Burst Percussion** | The Burst output fires a quick run of triggers every so often: here they flutter a hi-hat and clap while the clock output keeps the kick steady. Raise Burst for more frequent runs, and change Burst Size for longer flutters. |
| **Wobble: Quantised Tune** | The Stepped output goes through a Quantizer to become a melody in a scale, and the Compare output decides when a note plays, so both pitch and rhythm are random but musical. Raise Wobble's Rate for a busier tune or change the Quantizer's Scale. |
| **Wobble: Sample and Hold** | A triangle LFO patched into Sample is read at each tick of the Wobble clock, and the Stepped output holds the value in between: a classic sample-and-hold filter pattern that stays related to the LFO. Change the LFO rate or the Wobble Sync to change the pattern. |
<!-- /generated -->

<!-- generated:presets -->
## Presets

The preset bar of the Wobble view has 15 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Gentle Wander** | Slow smooth random movement: gentle, subtle drift. |
| **Classic Sample and Hold** | Use the stepped output for random sample-and-hold steps. |
| **Lazy Steps** | Slow random jumps for evolving filter changes. |
| **Silky Glide** | Fully smoothed glides between random values. |
| **Springy Overshoot** | Wobble output overshoots and rings after each jump. |
| **Jelly Wobble** | Heavy ringing wobble: gelatinous pitch and filter motion. |
| **Synced Eighths** | Random steps locked to eighth notes. |
| **Synced Bars** | One new value per bar: slow, tempo-locked changes. |
| **Burst Trigger** | Frequently fires bursts of triggers: fills and rolls. |
| **Rapid Burst Roll** | Long fast trigger rolls from the burst output. |
| **Chaotic Stream** | Chaos adds unpredictable behavior to the stream. |
| **Fast Jitter** | Fast small-depth jitter: adds life to pitch or pan. |
| **Unipolar Level** | Positive-only random values: for levels and mixes. |
| **Quiet Shimmer** | Low-depth random flutter for subtle shimmer. |
| **Seeded Pattern** | Steps from another seed: a different random pattern. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Rate | 0.02 – 40 Hz | 1 Hz |
| Smooth | 0 – 100 % | 50 % |
| Wobble | 0 – 100 % | 60 % |
| Chaos | 0 – 100 % | 0 % |
| Burst | 0 – 100 % | 25 % |
| Level | 0 – 100 % | 100 % |
| Sync | Free, 1/32, 1/16, 1/8, 1/4, 1/2, 1 bar, 2 bars, 4 bars, 8 bars | Free |
| Burst Size | 2 – 8 | 4 |
| Polarity | Bipolar, Unipolar | Bipolar |
| Seed | 0 – 999 | 1 |

- **Rate:** steps per second, when *Sync* is *Free* and *Clock* is unpatched.
- **Smooth:** how slowly Smooth and Wobble follow the steps.
- **Wobble:** the resonance of the Wobble output.
- **Chaos:** feedback from the outputs into the values, the clock and the bursts.
- **Burst:** the chance of a burst on each step.
- **Level:** the size of Stepped, Smooth and Wobble.
- **Burst Size:** the most pulses a burst can have.
- **Polarity:** Bipolar −1 … +1, Unipolar 0 … 1.
- **Seed:** picks the sequence of values.

*Rate*, *Smooth*, *Wobble*, *Chaos*, *Burst* and *Level* are modulation destinations.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Clock | trigger | each pulse is a step; overrides *Rate* and *Sync* |
| Sample | control | when patched, each step samples it instead of a random value |
| Hold | gate | while high, no new values and no Clock pulses |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Stepped | control | the current value |
| Smooth | control | the values, glided without overshoot |
| Wobble | control | the values, glided with overshoot and ringing (±1.5 at most) |
| Burst | trigger | clusters of quick pulses |
| Clock | trigger | one pulse per step |
| Compare | gate | high while Stepped is above Smooth |
