# Clock Mult

## Introduction

One clock in, six faster (or slower) clocks out. Every output has its own
ratio: 2, 3 or 4 ticks per input clock, but also fractions such as 3/2, 5/4
or 2/3 that drift against the beat and meet it again every few clocks. Each
output can skip ticks by chance, and one *Swing* and one *Humanize* knob move
only the in-between ticks, so the beat itself stays exactly where the clock
puts it.

Patch a trigger into *Clock*, or leave it empty and the module follows the
song: it reads the song position, so it stays on the grid after loop jumps
and in renders. For the opposite job (slower outputs from a clock) see Clock
Div.

## How does it work?

**Ratios.** *Ratio 1 … Ratio 6* are chosen from 1/8, 1/4, 1/3, 1/2, 2/3, 3/4,
1, 5/4, 4/3, 3/2, 5/3, 7/4, 2, 5/2, 3, 7/2, 4, 5, 6, 7, 8, 12, 16, 24 and
32. A ratio of *p/q* ticks *p* times in *q* input clocks. Output *k* ticks at
0, then every *q/p* clocks. Ticks that land exactly on an input clock are the
**anchors**; the others are the **in-between ticks**.

**Swing and Humanize.** *Swing* delays every second in-between tick by up to
half an interval. *Humanize* delays every in-between tick by its own random
amount, up to 40 % of an interval. Anchors never move, and a tick is never
moved earlier, so nothing can arrive before the clock that causes it. The
random amounts come from *Seed*: the same seed always plays the same feel.

**Skips.** *Skip 1 … Skip 6* is the chance that an output drops a tick. With
*Keep Beat* on (the default) the anchors are never dropped, so a heavily
thinned output still marks the beat; turn it off and the pulse itself can go.

**Phase Lock.** With a patched clock the module measures the time between
pulses and runs its ticks inside it. *Phase Lock* at 100 % pulls the phase
onto the incoming pulse every time: the outputs follow a drifting or jittery
clock, and wait for it when it stops. At 0 % the phase is never pulled: the
outputs run on as a flywheel at the learned tempo, even if the clock stops.
In between the clock is followed more loosely. Reset starts a new count: the
next pulse is the first beat. On the song position (no clock patched) the
phase is exact, so *Phase Lock* has no effect there; Reset makes the next
base step the start.

**Base.** Unpatched, one input clock is *Base* (a quarter note by default) at
the song's tempo.

**Gates.** *Gate* output holds each tick for *Width* of its interval;
*Trigger* output sends a one-sample pulse. *Any* is high whenever any output is.

## How to use it?

- **Layered percussion from one pulse:** ratios 4, 3/2 and 5/4 into three
  drums; the 3/2 and 5/4 drift against the beat and line up again every few bars.
- **A swung hat that keeps the kick honest:** a ratio-4 output into the hats
  with *Swing* at 60 %, a ratio-1 output into the kick.
- **Ghost notes:** a fast output with *Skip* at 50 % and a little *Humanize*.
- **A clock for a sequencer:** an output into a Step Sequencer's *Clock* makes
  it run at a fraction of a step, with a swing it does not have by itself.
- **Slow gates:** ratios 1/2, 1/4 or 2/3 for chord changes and slow modulation.
- **Tempo that stays:** *Phase Lock* at 0 keeps a patch moving through a
  gap in the incoming clock.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Clock Mult does. In the standalone app open **File → Presets…** (⌘P) and pick *Clock Mult* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Clock Mult: Drifting Percussion** | One quarter-note clock becomes a kick on the beat, hats at four per beat, a rim at 3/2 and a cowbell at 5/4: the last two drift against the kick and meet it again every few beats. Change a Ratio knob and the layer re-tunes. |
| **Clock Mult: Swung Hats** | Swing on a Clock Mult output moves only the in-between ticks: the kick and the snare sit on the beat while the sixteenth hats lean late. Turn Swing up for a harder shuffle, Humanize for a looser hand, or raise Skip 3 for fewer ghost hats. |
| **Clock Mult: Clock for a Line** | A Step Sequencer has no clock of its own: it takes Out 1 of Clock Mult at four ticks per beat with a late swing, and the bass takes Out 2 at one per beat. Change Ratio 1 to 3 or 3/2 for a different gait; the line follows the multiplier. |
| **Clock Mult: Fractional Bells** | Four bell tones ring at 2/3, 3/4, 5/4 and 7/4 of the clock with Skip on the busy ones, so a calm pentatonic cloud never quite repeats. Move one Ratio by a step and the whole constellation shifts. |
| **Clock Mult: Chained from a Divider** | Clock Div turns the 16th grid into a slow beat-rate pulse, and Clock Mult's Clock jack counts those pulses and multiplies them back up: tight at full Phase Lock, and a flywheel that keeps going at zero. Try 3 and 5/4 against the divider's own outputs. |
<!-- /generated -->

<!-- generated:presets -->
## Presets

The preset bar of the Clock Mult view has 16 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Ratio Ladder** | Whole and fractional ratios side by side: 2, 3, 4, 3/2, 5/4 and 8 per clock. |
| **Straight Doubles** | Powers of two up from the clock, plus a half-speed output: everything lines up. |
| **Triplet Roll** | Threes in every size, from a lazy 3/4 to a rolling 12 per clock. |
| **Five Against Four** | Fifths over a four-beat feel: the odd outputs slide against the plain ones. |
| **Seven Over** | Septuplets against halves and quarters; the anchors meet on every clock. |
| **Shuffled Sixteenths** | Swing on the in-between ticks only: the beat stays put, the offbeats lean late. |
| **Loose Hands** | Every in-between tick lands a little late, differently each time round; anchors stay tight. |
| **Thinning Out** | The same fast clock, each output losing more ticks than the one before. |
| **Ghost Hats** | Half the eighths and most of the sixteenths drop out; what is left feels played. |
| **Free Skips** | Keep Beat off: even the ticks on the clock can drop, so the pulse itself gets loose. |
| **Half-Time Pulses** | Slower than the clock: gates for pads, chord changes and slow modulation. |
| **Dotted Feel** | Ratios of three over two give dotted spacing; a little swing leans the in-betweens. |
| **Flywheel** | Phase Lock at zero: the outputs keep running on the learned tempo when the clock stops. |
| **Soft Lock** | A partial lock: a wobbly input clock is smoothed instead of followed tick for tick. |
| **Long Gates** | Gate output at 80 % of each interval: legato gates for envelopes and holds. |
| **Swung Everything** | Heavy swing, a hint of humanize and an occasional dropped tick on the busy output. |
<!-- /generated -->

## Reference

### Knobs

| Knob | Range | Default |
|---|---|---|
| Ratio 1 … Ratio 6 | 1/8 … 32 (see above) | 2, 3, 4, 3/2, 5/4, 8 |
| Skip 1 … Skip 6 | 0 – 100 % | 0 % |
| Swing | 0 – 100 % | 0 % |
| Humanize | 0 – 100 % | 0 % |
| Phase Lock | 0 – 100 % | 100 % |
| Width | 1 – 99 % (Gate output) | 50 % |

### Settings

| Setting | Values | Default |
|---|---|---|
| Base | 1/1 … 1/32, dotted and triplet | 1/4 |
| Output | Gate, Trigger | Gate |
| Keep Beat | Off, On | On |
| Seed | 0 – 999 | 1 |
| Sync To | Auto, Clock, Transport | Auto |

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Clock | trigger | patched: each pulse is one input clock |
| Reset | trigger | the next input clock is the first of a new count |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out 1 … Out 6 | gate | ticks at its ratio of the input clock |
| Any | gate | high while any output is high |
