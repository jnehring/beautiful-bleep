# Strange Osc

## Introduction

Strange Osc is an oscillator that is not a waveform at all: it is a small
system of three equations that never settles and never quite repeats,
stepped forward in time fast enough to hear (or slowly enough to use as a
modulation source). Four classic chaotic systems are built in. A *Tame* knob
bends the system toward periodic order, so one knob takes you from a
pitched, almost ordinary tone, through a wavering, rough one, to full chaos
that sounds like a living noise. The three state variables come out as *X*,
*Y* and *Z*, which makes it as much a source of unruly modulation as a voice.

## How does it work?

**The systems.** *Attractor* picks one of four systems of three coupled
differential equations: **Lorenz** (two lobes, with irregular flips between
them), **Rossler** (one slow spiral with sudden spikes), **Thomas** (smooth,
cyclically symmetric tumbling) and **Halvorsen** (a three-armed star). They
are integrated sample by sample with a fourth-order Runge-Kutta step, in
double precision, with extra sub-steps when the pitch is high.

**Pitch is time.** The pitch jack and *Pitch* knobs do not change a table
read-out speed: they change how fast time runs inside the equations
(*time-scaling*), so the whole orbit speeds up and the loops come round that
many times a second. In the tame, periodic regime this is a true 1 V/oct
pitch (within a few cents to a few percent, depending on the system). In the
chaotic regime the loops are of uneven length, so the pitch is a centre of
gravity, which is part of the sound. *Range* moves the whole thing down:
*Audio*, *Low* (÷64) and *Slow* (÷4096, from about 0.06 Hz at C4) for control.

**Tame.** Each system has one parameter whose value decides whether it is
chaotic. *Tame* slides it from the chaotic setting (0 %) to one where the orbit
is a clean periodic loop (100 %): Rossler c from 5.7 to 3, Lorenz rho from 28
to 160, Thomas b from 0.17 to 0.32, Halvorsen a from 1.89 to 3. Between the
two ends are period-doubling and intermittent regions that give the
interesting "almost a note" sounds. Every axis is centred and scaled by
measured values at both ends, so levels stay near ±1 on the whole way.

**Seed.** The start point is a pure function of *Seed*, so a render from a
reset is exactly repeatable; another seed starts on another path and, in the
chaotic regime, drifts away from the first within a few loops. A trigger in
*Reset* returns to the seed's start point at any time.

**Force.** *Force In* is added to the X equation, scaled by *Force*: an
external signal pushes the system around. A sine at a nearby frequency can
lock a chaotic orbit; noise makes it jitter.

**Output.** *Out* is *X*, *Y* or *Z* (or a blend: *Mix* sweeps X → Y → Z),
low-passed by *Tone*, times *Level*. *X*, *Y* and *Z* are always available
unfiltered. *Flip* is a gate that goes high when X is positive and low when
it is negative (with a small hysteresis): at *Low* or *Slow* range it is an
irregular clock.

## How to use it?

- **A strange lead:** *Tame* 70–95 %, *Pitch* from a sequencer, *Out* through a
  filter and VCA. The orbit is almost periodic, with a slowly wandering timbre.
- **Noise with a pitch:** *Tame* 0 %, *Attractor* Lorenz, play it from a keyboard.
- **A chaotic modulation source:** *Range* Slow, *X*, *Y* and *Z* to three
  different knobs; *Tame* sets how predictable they are.
- **Irregular clock:** *Range* Low, *Flip* into a drum or an envelope trigger.
- **Forced chaos:** an LFO or a second oscillator into *Force In*, *Force* 30 %.
- **Evolving drone:** *Tame* slowly modulated by an LFO through the whole range.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Strange Osc does. In the standalone app open **File → Presets…** (⌘P) and pick *Strange Osc* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Strange Osc: Tamed Lead** | A lead played by a chaotic orbit that has been tamed almost all the way: a clear pitch whose timbre never quite repeats. Lower Tame to roughen the note, or switch Attractor for a different grain. |
| **Strange Osc: Chaos Percussion** | Fully chaotic Lorenz noise, cut into short hits by an envelope, fills in between a kick and snare. Change the Seed for a different texture, or Tame to make the hits more tonal. |
| **Strange Osc: Tame Sweep** | One long note while a slow LFO sweeps Tame over its whole range: the voice drifts from an almost clean tone, through rough, multiplying orbits, to open chaos and back. Try another Attractor to hear where each one breaks up. |
| **Strange Osc: Chaotic Modulator** | A saw riff through a filter whose cutoff and resonance are moved by the X and Y outputs of a slow Strange Osc: a modulation that wanders and never repeats. Use Tame to make it more regular or switch Attractor for a different gait. |
| **Strange Osc: Forced Orbit** | A saw riff pushes a half-tamed orbit through Force In, so the orbit follows the riff's rhythm but keeps its own colour. Raise Force for tighter lock, or lower Tame to let it run away. |
<!-- /generated -->

<!-- generated:presets -->
## Presets

The preset bar of the Strange Osc view has 14 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Tamed Spiral** | Almost a clean periodic tone, with a slow grain from the orbit. |
| **Wobbling Lead** | Pitched, with a restless wobble in every cycle. |
| **Edge of Order** | Between a note and noise: period-doubling roughness. |
| **Lorenz Grit** | Gritty, irregular low tone from two flipping lobes. |
| **Lorenz Loop** | The tamed Lorenz orbit: a hollow, steady voice. |
| **Thomas Glass** | Smooth, lazy tumbling that rings like glass. |
| **Halvorsen Star** | A three-armed orbit with a cool, buzzy character. |
| **Chaos Noise** | Full chaos high up: noise with a pitch centre. |
| **Dark Chaos** | Slow, dark rumble for sub layers. |
| **Y Voice** | The Y axis: rounder and less spiky than X. |
| **Z Spike** | The Z axis: sharp spikes that cut through a mix. |
| **Forced Orbit** | Patch an audio signal into Force In to push the orbit. |
| **Slow Orbit** | Control-rate chaos: use X, Y and Z as modulation. |
| **Irregular Clock** | Use the Flip gate as a clock that never quite repeats. |
<!-- /generated -->

## Reference

### Inputs and outputs

| Jack | Signal | What it does |
|---|---|---|
| Pitch | pitch | 1 V/oct, 0 = C4; added to *Pitch* and *Fine* |
| Reset | trigger | returns to the seed's start point |
| Force In | audio | pushes the X equation, scaled by *Force* |
| Out | audio | the blend of X, Y, Z after *Tone* and *Level* |
| X, Y, Z | control | the three state variables, about ±1 |
| Flip | gate | high while X is positive |

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Pitch | −36 … +36 st | 0 |
| Fine | ±100 ct | 0 |
| Tame | 0 – 100 % | 30 % |
| Mix | X … Y … Z | X |
| Force | 0 – 100 % | 0 |
| Tone | 20 Hz – 20 kHz | 20 kHz (open) |
| Level | 0 – 100 % | 80 % |
| Attractor | Lorenz, Rossler, Thomas, Halvorsen | Rossler |
| Range | Audio, Low, Slow | Audio |
| Seed | 0 – 999 | 1 |

All knobs are modulation destinations; *Attractor*, *Range* and *Seed* are settings.

## Origin

The four systems are textbook mathematics (their equations are in any book
on nonlinear dynamics); the module was written from those equations and no
code was taken from elsewhere.
