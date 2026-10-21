---
title: Preamp
description: A transformer-coupled preamp: input transformer, gain stage, output transformer. The iron thickens and saturates the bass, more the harder you push it. Written in Bleep Script.
order: 40
---

# Preamp

## Introduction

A transformer-coupled preamp does not sound the way it does because of its gain stage alone. Most of the character is in the two **transformers**, one at the input and one at the output. A transformer has an iron core, and the core can only carry so much magnetic flux. Low frequencies carry the most flux for a given level, so a hard-pushed transformer squashes and thickens the bass long before it touches the treble. It also has a little memory (hysteresis), it rolls off the top end through its leakage inductance and winding capacitance, and it interacts with the source that feeds it.

The Preamp models exactly that chain: **input transformer, gain stage, output transformer**. The part that makes it different from a clipper is that the distortion depends on **frequency and level together**. Play a bass note at a low level and nothing happens. Play it louder and it fattens, with odd harmonics that sit above the note. Play a hi-hat at the same level and it stays clean.

The module is stereo (In L / In R, Out L / Out R). It oversamples its gain stage and delays the dry signal by the same amount, so the Mix knob is phase-correct.

## How does it work?

```text
In -> Trim -> bass weight bell -> input core -> gain stage (Class A / AB, oversampled)
   -> coupling capacitor -> output core -> leakage roll-off (Air) -> level compensation -> Mix -> Out
```

**The cores.** Each transformer is a small simulation of its magnetising branch. The state is the **flux**, which is the integral of the voltage across the branch, so for a sine of a given level it is proportional to the level divided by the frequency: a note an octave lower carries twice the flux. The magnetising current is proportional to the flux until the core approaches saturation, and then it rises steeply (with the fifth power of the flux). That current flows through the source impedance and is subtracted from the signal. At low level the result is a plain high-pass filter (the corner is set by **Impedance**, between 10 and 32 Hz). When the flux gets near the knee, the current climbs and the output flattens out: a soft, level-dependent compressor for the bass with odd harmonics. The simulation is stable however hard it is driven.

**Iron** sets how early the cores saturate. It is the frequency below which a full-scale sine reaches the knee: from 6 Hz at 0 % to about 126 Hz at 100 %. At Iron 100 % a 50 Hz tone at -6 dBFS is past the knee, a 1 kHz tone at the same level is at one twentieth of it.

**Hysteresis.** A lagging, smoothed sign of the flux rate shifts the saturation curve a little to the right while the flux rises and to the left while it falls. The loop pinches closed at small flux, so a quiet signal does not see it. Its width grows with Iron. The result is that the output is not a function of the input alone: the core remembers where it has been.

**Impedance** sets the source: a higher impedance moves the high-pass corner up, adds a bump of up to 8 dB around 62 Hz (the bass weight, in front of the core, so that the core sees it and saturates earlier), and adds a gentle resonance (Q from 0.6 to 1.05) to the roll-off at the top.

**The gain stage.** It runs at 2 times (Eco) or 4 times (Normal) the sample rate, between polyphase all-pass half-band filters. It is anti-aliased in two ways: the oversampling, and first-order antiderivative anti-aliasing on the non-linear part of the curve. **Class A** is a soft clip that is biased off-centre (a bias of 0.3 in units of the curve's knee): the positive and negative halves are shaped differently, so it makes even harmonics in the first place (H2 and H4), then odd. **Class AB** is a pair of devices that each conduct only past a small threshold (a smooth dead zone of 0.06 around zero), so the harmonics are odd only and the crossing makes a little grit at low level. A coupling capacitor (8 Hz) removes the DC the asymmetry leaves behind.

**Air** sets the roll-off of the leakage inductance and winding capacitance: a second-order low-pass from 4 kHz (0 %) to 24 kHz (100 %, clamped below 0.45 of the sample rate).

**Level compensation.** The gain stage is compensated so that a -12 dBFS sine at the input comes out at -12 dBFS whatever the Drive and Trim. Louder passages are squeezed, quieter ones lifted, so you can compare settings at the same loudness. Output adds to that.

**Age.** A seeded, very slow random drift (a few tens of seconds per cycle), different for left and right. It moves the gain by up to 0.5 dB, the bias by 9 %, the core threshold by 8 % and the roll-off by 4 %. Nothing about it depends on the clock: two renders are identical.

**Latency.** The oversampling filters delay the signal by about 3.2 samples (Eco) or 3.9 samples (Normal) at 48 kHz at low frequencies. The dry path of Mix is delayed by the same amount with a fractional delay.

**Input.** Auto uses the left input for both channels while nothing is patched into In R (R has been exactly zero for 2048 samples while L is active), and returns to true stereo, smoothly, the moment R carries signal. Stereo and Mono force one or the other.

## How to use it?

- **Bass guitar, weight and glue:** Iron 70 %, Impedance 60 %, Drive 20 %, Class A, Air 50 %, Age 25 %. Play a low note hard and listen to it grow harmonics that lift it out on small speakers.
- **Kick that needs body:** Iron 85 %, Impedance 50 %, Drive 15 %, Class AB, Trim +3 dB. The click on top stays clean; the thump is rounded and denser.
- **Warmth on a bus:** Drive 25 %, Iron 50 %, Class A, Air 60 %, Mix 100 %. Level compensation means you can switch it in and out without a jump.
- **Vocal presence:** Drive 35 %, Iron 25 %, Class A, Air 85 %, Impedance 30 %. Mostly the gain stage; the transformers contribute a small amount of low-end weight.
- **Gritty drums:** Class AB, Drive 70 %, Iron 60 %, Mix 40 %. The dry signal keeps the transients, the wet one adds the crossover edge.
- **Stereo width without drift:** Age 0 % makes left and right identical for a mono source. A little Age (20 to 30 %) makes the sides differ by the slight amount that two real channels would.
- **CPU:** Eco halves the oversampling of the gain stage. The aliasing stays below -55 dBc even at Drive 100 %.

## Reference

### Inputs and outputs

| Jack | Type | Meaning |
| --- | --- | --- |
| In L | audio | Left input. |
| In R | audio | Right input. With Input set to Auto, nothing patched here means the left input feeds both channels. |
| Out L | audio | Left output. |
| Out R | audio | Right output. |

### Knobs

| Knob | Range | Default | Meaning |
| --- | --- | --- | --- |
| Trim | -12 to +12 dB | 0 dB | Level into the first transformer. |
| Drive | 0 to 100 % | 20 % | Gain of the gain stage, 0 to 36 dB. The output is level-compensated. |
| Iron | 0 to 100 % | 60 % | How early the cores saturate (6 to 126 Hz knee for a full-scale sine). Also the width of the hysteresis loop. |
| Impedance | 0 to 100 % | 40 % | Source impedance: the low corner (10 to 32 Hz), the bass bump (up to +8 dB at 62 Hz) and the resonance of the top. |
| Class | A, AB | A | The gain stage: asymmetric, even harmonics (A) or dead zone, odd harmonics (AB). |
| Air | 0 to 100 % | 60 % | High roll-off, 4 kHz to 24 kHz. |
| Output | -24 to +12 dB | 0 dB | Output level, after the level compensation. |
| Mix | 0 to 100 % | 100 % | Dry against processed. The dry signal is delayed to stay in phase. |
| Age | 0 to 100 % | 25 % | Slow drift, different for left and right. |
| Input | Auto, Stereo, Mono | Auto | Where the right channel gets its signal. |
| Quality | Eco, Normal | Normal | 2 times or 4 times oversampling of the gain stage. |

### Probes

| Probe | Meaning |
| --- | --- |
| Core | How close the transformer cores are to saturation (1 is the knee). |
| Level | The output level (peak, falling slowly). |

### Numbers worth knowing

- Cost: about 122,000 operations per 32-sample chunk at the heaviest setting (4 times oversampling, both channels). The checker reports a warning above 60,000; the limit is 400,000.
- Class AB, Drive 0 %, Iron 100 %: a 40 Hz tone at -6 dBFS has a third harmonic at -5.7 dBc (the core is deep in saturation), at -12 dBFS -17 dBc, at -26 dBFS -43 dBc. The same tone at 1 kHz and -6 dBFS has its third harmonic at -37 dBc, and that is the gain stage's own crossover, not the iron.
- A 7 kHz tone at -6 dBFS driven hard leaves about -68 dBc of non-harmonic energy at Normal and -61 dBc at Eco (Drive 50 %); -64 and -56 dBc at Drive 100 %.
