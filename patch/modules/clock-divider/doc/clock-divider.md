# Clock Div

## Introduction

Eight clock dividers on one clock, each with its own division. Set *Div 1* to
2 and Out 1 fires every second step; set *Div 4* to 7 and Out 4 fires every
seventh. Patch a clock in, or leave *Clock* empty and it follows the song:
everything is worked out from the song position, so it stays on the bars,
after loop jumps and in renders.

For eight divisions that are a family and move together with one knob, see
Rotating Div.

## How does it work?

**The base step.** Unpatched, one step is *Base* (1/16 by default) at the
song's tempo. Patch a trigger into *Clock* and every pulse is a step instead.

**Divisions.** *Div 1 … Div 8* are whole numbers from 1 to 64. Output *k*
fires on step 0 and then every *Div k* steps. The defaults are the classic
/2 /3 /4 /5 /6 /8 /16 /32. A new division takes effect at that output's next
cycle; a gate that is already high always finishes its length.

**Realign.** Odd divisions drift against the bar: /3 of 1/16 notes repeats
only every 3 bars. *Realign* restarts every output every 1, 2, 4 or 8 bars;
the last cycle before the restart is shortened, and its gate ends at least
1 ms before the next one starts. With a patched clock there is no bar, so
*Realign* has no effect: patch a bar-rate trigger into *Reset* instead.

**Gates.** In *Gate* output, an output is high for *Width* of its own period
(*Gate Length* = *Division*) or of one base step (*Base Step*). *Trigger*
output sends a one-sample pulse instead.

**Reset** makes the next base step the start of every output's cycle (with a
clock: the next pulse). When the transport stops, every output goes low; on
play, nothing fires until the next due step.

## How to use it?

- **Drum rhythms from one clock:** Out 1 … 8 into drum triggers, set to
  /2, /3, /4 and /16 for a hat, a clap, a kick and a crash.
- **Phrases:** /16 or /32 into a sequencer's *Reset*, or into a Harmony
  Master to change chord every two bars.
- **Odd against even:** /3 and /4 together, *Realign* 1 bar so they meet on
  every downbeat.
- **Slow modulation:** *Trigger* output of a long division into a Random or
  a Shift Register.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Clock Div does. In the standalone app open **File → Presets…** (⌘P) and pick *Clock Div* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Clock Div: Basic Kit** | One 16th-note clock divided six ways: a kick every 4 steps, hats every 2, a rim every 3, a cowbell every 5 and a clap once a bar. Realign restarts the odd divisions on every downbeat so they keep landing on the one; set it to Never and listen to them drift. |
| **Clock Div: Three Against Four** | Four tuned toms on /3, /4, /5 and /7 of an 8th-note clock, with Realign off: the pattern slides against itself and only comes round again after 420 steps. Set Realign to 1 bar and the same divisions lock to the bar line instead. |
| **Clock Div: Slow Chimes** | Long divisions of an 8th-note clock (/5, /8, /11, /13, /19 and /29) strike six bells of a D minor-pentatonic chord. Because the numbers share no factors, the same combination of bells takes minutes to come round. Change a Div knob and that bell shifts into a new rhythm. |
| **Clock Div: Gate Pad** | Gate output on quarter notes with Div 1 to 6 at 4, 6, 8, 12, 16 and 24: six notes of an A minor-nine chord swell in and out at different rates, so the harmony thickens and thins over a few bars. Width sets how long each note is held. |
| **Clock Div: Half-Time Melody** | A drum beat plays at full speed while a step sequencer is clocked by Out 1 (/2) of the same 16th clock, so its melody runs in half time. Out 2 (/32) resets the sequencer every two bars, keeping it in step with the drums. Change Div 1 to 3 or 4 for a slower, odder line. |
<!-- /generated -->

<!-- generated:presets -->
## Presets

The preset bar of the Clock Div view has 12 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Default Ladder** | A mix of even and odd divisions for polyrhythmic gates. |
| **Powers of Two** | Classic binary divisions: everything lines up on the downbeat. |
| **Even Grid** | Even divisions only: steady, interlocking pulses. |
| **Odd Primes** | Primes: the outputs rarely coincide, so the rhythm takes ages to repeat. |
| **Triggers Only** | Short triggers instead of gates, for drums and envelopes. |
| **Short Pulses** | Narrow gates: staccato hits on every output. |
| **Long Gates** | Nearly full-width gates that sustain between pulses. |
| **Base Step Gates** | Every gate is one base step long, whatever the division. |
| **Eighth Base Slow** | The base clock at eighths: a slower, more spacious set. |
| **Triplet Base** | Triplet base clock for shuffling cross-rhythms. |
| **Bar Realign** | Odd divisions snapped back together every bar. |
| **Four-Bar Polyrhythm** | Complex divisions that resync every four bars. |
<!-- /generated -->

## Reference

### Knobs

| Knob | Range | Default |
|---|---|---|
| Div 1 … Div 8 | 1 – 64 | 2, 3, 4, 5, 6, 8, 16, 32 |
| Width | 1 – 99 % | 50 % |

### Settings

| Setting | Values | Default |
|---|---|---|
| Base | 1/1 … 1/32, dotted (.) and triplet (T) | 1/16 |
| Realign | Never, 1, 2, 4, 8 bars | Never |
| Output | Gate, Trigger | Gate |
| Gate Length | Division, Base Step | Division |
| Sync To | Auto, Clock, Transport | Auto |

- **Sync To:** what steps the module. *Auto*: the clock pulses while *Clock* is patched, otherwise the transport. *Clock*: only the pulses step it. *Transport*: the song position steps it, and a patched *Clock* is ignored.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Clock | trigger | patched: each pulse is one base step |
| Reset | trigger | every output starts a new cycle on the next base step |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out 1 … Out 8 | gate | fires every *Div k* base steps |
