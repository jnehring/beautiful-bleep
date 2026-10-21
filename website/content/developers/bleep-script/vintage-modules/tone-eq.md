---
title: Tone EQ
description: A passive, musical equaliser with three modes (interacting shelving network, tilt, guitar-amp tone stack), a valve make-up stage and slow component drift. Written in Bleep Script.
order: 10
---

# Tone EQ

## Introduction

Most equalisers are surgical: a parametric band finds a problem and removes it. The Tone EQ is the opposite. It is a **passive, interactive, musical** tone control, the kind of EQ you reach for to make a bass bigger, a vocal brighter or a bus warmer, and where moving one knob changes what the others do.

It has three modes:

- **Passive Shelf** is a network of shelves with stepped frequencies. The low boost and low attenuation are two separate knobs at the same frequency, and they overlap: used together they give a big, smooth, tight bottom with a gentle dip above it, instead of a boomy bass. The high section has a broad boost with a bandwidth control and a separate high attenuation shelf.
- **Tilt** is a two-knob seesaw: bass down and treble up, or the reverse, with broad gentle slopes around a pivot.
- **Tone Stack** is a guitar-amp style bass / mid / treble network with its characteristic mid scoop and insertion loss.

After the EQ a **valve make-up stage** adds a little level-dependent warmth, **Output** sets the level, and **Age** lets the component values wander slowly, a little differently in the left and right channel.

The module is stereo (In L / In R, Out L / Out R).

## How does it work?

The signal passes through one of three filter networks, then the make-up stage:

```text
In -> [ Passive Shelf | Tilt | Tone Stack ] -> valve make-up stage -> Output -> Out
```

**The filters are analog prototypes.** Every filter starts as the transfer function of an analog circuit and is turned into a digital filter with the bilinear transform, pre-warped so that the filter's own frequency lands exactly where the knob says. The module's tests compare the realised response with the analog curve at several settings. Below about a fifth of the sample rate the two agree within a fraction of a decibel; in the top octave the bilinear transform squeezes the curve a little (a bell at 12 kHz is narrower on its upper side than the analog one at 48 kHz) and the match is better at 96 kHz.

**Passive Shelf.** Four sections in a row:

1. *Low boost*: a second-order low shelf at the chosen frequency (20, 30, 60 or 100 Hz) with a small resonance, up to about +15 dB.
2. *Low attenuation*: a first-order (6 dB per octave) low shelf that turns over about 2.4 times higher than the boost, up to about -12 dB. Because it works higher up than the boost, the two overlap: boost and attenuation at the same setting leave a net lift at the very bottom and a dip in the octave above it, which is what keeps the low end smooth instead of boomy.
3. *High boost*: a bell at 3, 4, 5, 8, 10, 12 or 16 kHz, up to about +16 dB, with a Bandwidth control from narrow (Q 2) to very broad (Q 0.35).
4. *High attenuation*: a first-order high shelf cut at 5, 10 or 20 kHz, up to about -14 dB.

All the frequencies are stepped choices, so every position is a known, repeatable sound. Changing a step glides the filter rather than jumping.

**Tilt.** Two broad first-order shelves, a low shelf 2.5 times below the pivot and a high shelf 2.5 times above it, with opposite gains. The pivot frequency itself stays where it is; one side goes down as the other goes up, with a slope of a couple of dB per octave.

**Tone Stack.** The module solves the real circuit: a treble capacitor and pot, a bass pot with an audio taper, a mid pot, a slope resistor and two more capacitors (textbook values: 250 k, 1 M and 25 k pots, 56 k slope resistor, 250 pF and 2 x 20 nF capacitors). At block rate it builds the nodal admittance equations of the network at four values of the Laplace variable, takes the determinant (the denominator) and the output voltage times it (the numerator), and interpolates the two cubics. The result is a third-order transfer function that is then discretised. Because it is a passive network it has the real behaviour: a mid scoop whose depth and position depend on all three pots, a large **insertion loss** (everything is turned down), and interaction between the controls. A fixed make-up gain of 9 dB brings the level back up.

**Valve make-up stage.** A smooth asymmetric curve with a small bias, so it adds mainly **even harmonics** (a 2nd harmonic that grows with the input level and is much smaller than the 3rd at low levels), unity gain for small signals (so changing Drive does not change the loudness), and a bounded output for any input. The part of the curve beyond a straight line is evaluated with first-order antiderivative anti-aliasing, so the straight part keeps its flat response up to the top and loud high tones do not fold back audibly. The small DC offset an asymmetric curve makes is removed by a high-pass.

**Age.** Three slow random walkers per channel, with a time constant of a few seconds. They scale the gains of the shelves and bells by a few percent, their frequencies by a couple of percent, and in the Tone Stack the pot positions and capacitor values. The left and right generators are different, so a slightly different stereo image appears over time. With Age at 0 nothing moves and both channels are identical. The drift is deterministic: the same input gives the same output on every run.

## How to use it?

- **Big, tight bass:** Passive Shelf, Low Freq 60 Hz, Low Boost 6, Low Atten 5. The bottom gets heavier and the low mids above it get cleaner.
- **Kick weight without boom:** Low Freq 100 Hz, Low Boost 4, Low Atten 4.
- **Silky top on a vocal or a mix bus:** High Freq 10 kHz, High Boost 3, Bandwidth 7. Add High Atten 2 at 20 kHz to take the edge off the very top.
- **Presence on a guitar:** High Freq 5 kHz, High Boost 4, Bandwidth 3.
- **Darker, warmer master:** Tilt mode, Tilt -2 dB, Pivot 650 Hz.
- **Brighter without EQ harshness:** Tilt +3 dB, Pivot 1 kHz.
- **Guitar amp tone:** Tone Stack, Bass 6, Mid 4, Treble 6, Drive 50 %. Turn Mid down for the classic scoop; Mid at 10 fills it in.
- **Warmth on a bus:** any mode, Drive 25 %, Output set so the level matches the bypassed signal.
- **Wider, living stereo:** Age 50 %, from a mono source with Input set to Mono.

Because a passive EQ interacts, move the controls against each other: boost a little, listen, then add attenuation at the same frequency and listen to the bottom tighten.

## The module's own UI

The Tone EQ draws the network you are hearing. In Passive Shelf mode the boost (amber) and the attenuation (red) are two ghost curves, and the white curve is their sum, so you can watch them interact. A dot sweeps along the curve and glows with the output level.

- Drag a round handle: up and down set its amount, left and right snap its stepped frequency.
- Click a mode pill (Passive Shelf, Tilt, Tone Stack) to switch mode.
- In Tilt mode drag the diamond: vertical is Tilt, horizontal snaps Pivot.
- In Tone Stack mode drag a dial up or down.

Tricks it demonstrates: the curve is computed in the UI with the same analog formulas the module designs from (and checked against the module's measured response in its test); curves are cached and recomputed only when a knob moved; the polled `level` probe is eased with `1 - Math.exp(-dt * k)` so the glow is smooth at any frame rate; hit testing picks the nearest handle; a pointer is captured while dragging, and a continuous drag is snapped to a list of steps.

## Reference

### Inputs and outputs

| Jack | Type | Meaning |
| --- | --- | --- |
| In L | audio | Left input |
| In R | audio | Right input (in Auto mode, the left signal is used for both channels while nothing is patched here) |
| Out L | audio | Left output |
| Out R | audio | Right output |

### Controls

| Control | Range | Default | Meaning |
| --- | --- | --- | --- |
| Mode | Passive Shelf, Tilt, Tone Stack | Passive Shelf | The filter network (the change fades out and in) |
| Low Freq | 20, 30, 60, 100 Hz | 60 Hz | Turnover of the low boost and the low attenuation |
| Low Boost | 0 to 10 | 3 | About 1.5 dB per step, up to +15 dB |
| Low Atten | 0 to 10 | 1.5 | About 1.2 dB per step, up to -12 dB, turning over 2.4 times higher than the boost |
| High Freq | 3, 4, 5, 8, 10, 12, 16 kHz | 8 kHz | Centre of the high boost |
| High Boost | 0 to 10 | 2 | About 1.6 dB per step, up to +16 dB |
| Bandwidth | 0 to 10 | 5 | Width of the high boost: 0 is narrow (Q 2), 10 is very broad (Q 0.35) |
| Atten Freq | 5, 10, 20 kHz | 10 kHz | Turnover of the high attenuation shelf |
| High Atten | 0 to 10 | 1 | About 1.4 dB per step, up to -14 dB |
| Tilt | -6 to +6 dB | 0 | Positive brightens (bass down, treble up), negative darkens |
| Pivot | 250 Hz, 400 Hz, 650 Hz, 1 kHz, 1.6 kHz, 2.5 kHz | 650 Hz | The frequency the tilt turns around |
| Bass | 0 to 10 | 5 | Tone Stack bass pot (audio taper) |
| Mid | 0 to 10 | 5 | Tone Stack mid pot; low settings dig the scoop deeper |
| Treble | 0 to 10 | 5 | Tone Stack treble pot |
| Drive | 0 to 1 | 0.3 | Valve make-up stage drive: a small, level-dependent warmth |
| Output | -12 to +12 dB | 0 | Level after the make-up stage |
| Age | 0 to 1 | 0.2 | Slow random drift of the component values, different left and right |
| Input | Auto, Stereo, Mono | Auto | Auto: the left input feeds both channels while the right one is unpatched (exactly 0 for 2048 samples); Stereo: both inputs; Mono: left to both |

### Probes

| Probe | Meaning |
| --- | --- |
| Level | Peak level of the output |

### Notes

- The module has no latency.
- Cost: about 44,000 operations per 32-sample block by the Bleep Script checker's conservative count, below the 60,000 warning bound.
