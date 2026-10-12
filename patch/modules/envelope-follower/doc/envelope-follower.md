# Envelope Follower

![Envelope Follower in the module view](envelope-follower.png)

## Introduction

The Envelope Follower turns **how loud a signal is** into a smooth control
signal. Patch a drum loop or a voice in, and the *Env* output rises with every
hit and falls back between them, ready to move a filter, a VCA or anything
else. It works on **audio** and on **CV** alike: followed CV becomes a slew
limiter with separate rise and fall times.

For a meter with bars and a clip light use the *Level Meter*; the Envelope
Follower is the tool when you want the shape of the signal, with your own
attack and release.

## How does it work?

The detector looks at the size of each sample. When the signal gets bigger
than the current envelope, the envelope rises with the **Attack** time; when it
gets smaller, it falls with the **Release** time. Times are the time to cover
63 % of the way, as on any one-pole smoother. Short attack and release follow
every wave; a short attack with a long release follows the peaks of a drum
pattern.

**Detector** picks how the size is measured:

- **Peak** follows the absolute value of the signal (or one half of it, see
  *Rectify*): fast and punchy.
- **RMS** follows the average power: smoother and closer to how loud the
  signal sounds. Attack and Release apply to the power, and *Rectify* has no
  effect.

**Gain** multiplies the result, so a quiet source can still reach 1.

The **Gate** output opens when *Env* reaches **Threshold** and closes again
when it falls under 80 % of it, so a hovering level does not chatter. *Trigger*
sends one short pulse every time the gate opens.

## How to use it?

- **Ducking:** a kick into *In*, *Inverted* into a VCA's *Gain* on the pad. A
  short attack and a release of 150–300 ms gives the pump.
- **Loudness to brightness:** *Env* into a filter's **Cutoff**.
- **Audio to triggers:** a drum loop into *In*, *Trigger* into another
  module's trigger input: it plays on every hit above *Threshold*.
- **Slew a CV:** set *Rectify* to *None (signed)* and patch a stepped CV in:
  *Env* follows it with *Attack* going up and *Release* going down, and
  *Inverted* is the same signal upside down.
- **Only the positive part of an LFO:** *Rectify* = *Positive*.

## Reference

### Knobs

| Knob | Range | Default |
|---|---|---|
| Attack | 0 – 2 s | 10 ms |
| Release | 0 – 5 s | 200 ms |
| Gain | 0 – 8 × | 1 × |
| Threshold | 0 – 100 % | 30 % |

Every knob is a modulation destination.

### Settings

| Setting | Values | Default |
|---|---|---|
| Detector | Peak, RMS | Peak |
| Rectify (Peak only) | Full, Positive, Negative, None (signed) | Full |

### Inputs

| Input | Signal | What it does |
|---|---|---|
| In | audio | the signal to follow; control signals work as well |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Env | control | the followed level times *Gain*; with *None (signed)* it can go negative |
| Inverted | control | 1 − *Env*, limited to 0…1; with *None (signed)*, −*Env* |
| Gate | gate | high from *Threshold* up (closes at 80 % of it) |
| Trigger | trigger | one sample when the gate opens |
