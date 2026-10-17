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
| **Clock Div: Layered Percussion** | One 16th-note clock is cut into /2, /3, /5, /8 and /16: hats on the fast outputs, a kick every eight steps, a rim every three and a cowbell every five, so the layers drift in and out of line. Edit any Div knob to retune a layer; they all realign on the downbeat of the 16-step cycle. |
| **Clock Div: Polyrhythm Chimes** | Four outputs divide an eighth-note clock by 3, 4, 5 and 7 and each rings a different bell tone, so a calm major pentatonic cluster slowly rearranges itself. Change one Div by a single step and the whole pattern shifts. |
| **Clock Div: Binary Counter Bass** | Powers of two (/1, /2, /4, /8) in Trigger mode play a kick, snare, hat and bass in a fixed, regular pattern, a bit like the bits of a counter. Change Base to 1/8T for a rolling feel, or set Realign to 4 bars to snap the layers back together on a longer cycle. |
| **Clock Div: Slow Gate Pad** | With Output set to Gate and Gate Length on Division, the slow outputs (/16, /24, /32 and /48) hold long gates that swell three chord tones in and out at different times. Narrow Width shortens the swells; try Gate Length = Base Step for short blips instead. |
| **Clock Div: Clocks for Two Melodies** | Two Step Sequencers have no clock of their own: one takes /2 and one takes /3 of the divider, so an 8-note arpeggio and a 5-note bass line run at different speeds and phase against each other. Move a Div knob to speed one of them up or down. |
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
