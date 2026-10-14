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

## Demo patches

Five whole patches show what Clock Div does. In the standalone app open **File → Presets…** (⌘P) and pick *Clock Div* under *Demos by module*; loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Clock Div: Basic Kit** | Six divisions of a 16th clock drive a small kit; *Realign* every bar keeps the odd ones landing on the downbeat. |
| **Clock Div: Three Against Four** | Four toms on /3, /4, /5 and /7 with *Realign* off drift against each other for 420 steps. |
| **Clock Div: Slow Chimes** | Divisions with no common factors (/5 … /29) strike six bells in a pattern that takes minutes to repeat. |
| **Clock Div: Gate Pad** | *Gate* output with long divisions swells six chord notes in and out at different rates. |
| **Clock Div: Half-Time Melody** | Out 1 (/2) clocks a step sequencer in half time while Out 2 (/32) resets it every two bars. |

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
