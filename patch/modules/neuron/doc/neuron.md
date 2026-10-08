# Neuron

## Introduction

Neuron holds two simple artificial neurons. Each one adds up three weighted
inputs, lets the sum charge a leaky "membrane" and fires a gate when the
membrane crosses a threshold. The two neurons listen to each other out of
the box, so with no cable at all they already play a two-voice rhythm. Patch
slow modulation in, or the outputs back into the inputs, and you get
rhythms and gestures nobody programmed.

## How does it work?

**Sum.** Each neuron computes `W1 · In 1 + W2 · In 2 + W3 · In 3`.

- *In 1* reads **+1** while nothing is patched, so *W1* works as a bias knob.
- *In 2* reads 0 while nothing is patched.
- *In 3* hears the **other** neuron while nothing is patched: its *Out* or its
  *Gate*, chosen with *Cross*, one sample late. That's a much tighter feedback
  loop than a cable could make.

**Membrane.** The membrane follows the sum with a delay set by *Leak*: a short
burst at the input moves it a little, a sustained input charges it fully.
*Leak* 0 makes the membrane equal the sum.

**Gate.** In **Compare** mode the gate is high while the membrane is above the
threshold, with *Hysteresis* as a gap between the on and off levels (no
chatter on wobbly inputs). In **Spike** mode the neuron *fires*: when the
membrane crosses the threshold, the gate goes high for *Pulse*, the membrane
drops to 0 and stays there during the pulse, then charges again. A constant
input above the threshold gives a steady rhythm: the higher the input and the
shorter the leak, the faster it fires. At or below the threshold it never
fires.

**Out.** A smooth version for modulation. In Compare mode it rises from 0 at
the threshold with a slope of *Sharp*, up to 1. In Spike mode the ramp ends at
the threshold, so *Out* shows the membrane charging and drops at each spike:
a saw locked to the neuron's rhythm. *Sharp* 1 is gentle; 100 is almost a gate.

**Logic.** *AND*, *OR* and *XOR* combine the two gates; *Diff* is A Out − B Out.

Neuron has no randomness: the same inputs always give the same outputs. With
*Reset on Start* on, both neurons are cleared when the transport starts, so
every render is identical.

## How to use it?

- **The default rhythm:** patch *A Spike* and *B Spike* to two drums. A fires
  regularly from its bias; as A charges, its *Out* pushes B down, so B fires in
  irregular gaps.
- **Rhythm from a level:** an LFO or envelope into *A In 2*: the higher the
  level, the faster A fires.
- **Velocity to density:** inside a Voice Cell, *Voice In › Velocity* into
  *In 2*: louder notes fire faster.
- **A Schmitt trigger:** *A Mode* on *Compare*, a noisy signal into *A In 2*,
  *W1* 0, *Hysteresis* up until it stops chattering.
- **Audio:** *Leak* near 0 and *Cross* on *Gate* oscillates at audio rate.

## Reference

### Knobs and settings

Per neuron (A and B):

| Control | Range | Default A / B |
|---|---|---|
| W1, W2, W3 | −2 … +2 | A: 0.6, 1, 0.5 · B: 0.9, 1, −1 |
| Threshold | −1 … +1 | 0.5 |
| Hysteresis | 0 – 100 % | 10 % |
| Leak | 0 – 5 s | 250 ms / 400 ms |
| Sharp | 1 – 100 | 4 |
| Pulse | 1 ms – 1 s | 30 ms (Spike mode only) |

| Setting | Values | Default |
|---|---|---|
| A Mode, B Mode | Compare, Spike | Spike |
| Cross | Out, Gate, Off | Out |
| Reset on Start | on / off | on |

- **W1 … W3:** the weight of each input; negative weights inhibit.
- **Threshold:** the level the membrane must cross. Drag the dashed line in the
  view to set it.
- **Hysteresis:** the gap between the on and off levels: the gate switches on
  at Threshold + Hysteresis / 4 and off at Threshold − Hysteresis / 4.
- **Leak:** the membrane's time constant. 0 = no delay.
- **Sharp:** the slope of *Out*.
- **Pulse:** the gate length in Spike mode, and the time the membrane rests after firing.
- **Cross:** what *In 3* hears from the other neuron while unpatched.
- **Reset on Start:** clear both neurons when the transport starts.

All knobs are modulation destinations.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| A In 1, B In 1 | control | weighted by W1; unpatched: +1 |
| A In 2, B In 2 | control | weighted by W2; unpatched: 0 |
| A In 3, B In 3 | control | weighted by W3; unpatched: the other neuron (see *Cross*) |
| Reset | trigger | clears both membranes and ends any spike |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| A Gate, B Gate | gate | the neuron's firing state |
| A Out, B Out | control, 0 … 1 | the sharpened membrane |
| A Spike, B Spike | trigger | a pulse each time the gate goes high |
| AND, OR, XOR | gate | logic of A Gate and B Gate |
| Diff | control, −1 … +1 | A Out − B Out |
