---
title: Vinyl
description: Puts any signal through a record: RIAA cut and playback, mono bass, tracking distortion, rumble, hiss, dust, pops and scratches that come round once per turn, crosstalk and wobble. Written in Bleep Script.
order: 80
---

# Vinyl

## Introduction

A record is not just crackle on top of a clean signal. Everything that is wrong with it follows from how it is made and played: the bass is made mono and thinned out to keep the stylus in the groove, the treble is boosted and then taken down again, the stylus cannot follow loud bright sounds towards the centre of the disc, the platter rumbles, the disc is never quite round, and the dust and scratches sit at fixed places that come round every revolution. The Vinyl module models that chain.

Use it to make a sample, a loop or a whole mix sound as if it came from a record: warm bass, a darker and slightly distorted top end that gets worse with level, a gentle wobble and a believable surface.

The module is stereo (In L / In R, Out L / Out R). It adds a fixed delay of about 4.5 milliseconds (the dry signal in the Mix is delayed by the same amount).

## How does it work?

```text
In -> bass mono -> eccentricity delay -> RIAA record curve -> stylus tracking limit
   -> crosstalk -> hiss + rumble -> inner-groove roll-off -> RIAA playback curve
   -> cartridge response -> + dust, pops and scratches -> Output
```

**Bass mono.** A cutting lathe cannot cut strong out-of-phase bass (the stylus would jump out of the groove), so the stereo difference signal is high-passed (second order) at the **Bass Mono** corner and only the shared bass remains. Centred bass is untouched.

**Eccentricity.** The disc is never perfectly centred or flat, so the pitch drifts a little, once per revolution (and half as much twice per revolution). The module delays the signal by an amount that follows the revolution of the platter; the **Speed** (33 1/3, 45 or 78 rpm) sets the frequency of the wobble (0.56, 0.75 or 1.3 Hz), and **Warp** its depth (100 % is about plus and minus 14 cents).

**RIAA curves.** The record curve is the RIAA standard, built from its three time constants of 3180, 318 and 75 microseconds: the bass is cut (about -17 dB at 50 Hz relative to 1 kHz) and the treble boosted (about +14 dB at 10 kHz). The playback curve is its exact inverse, so cut followed by playback is flat. The module's tests check the curve in the groove against the standard (within 1 dB up to 10 kHz) and the round trip (flat within 0.3 dB). Each of the three corners is placed exactly by pre-warping the digital filter; the cut stage also has one more corner far above the audio band, which the playback matches, because a filter that boosts forever cannot be inverted.

**The groove limit.** Between the two curves is where the stylus can fail. The signal in the groove is bright and boosted, and the stylus can only follow so much: a soft limit (a hyperbolic tangent, at twice the sample rate to avoid aliasing) squashes loud, high-frequency passages. Since the cut curve boosts 10 kHz about five times (and 3 kHz about 1.7 times) relative to 1 kHz, this is **level- and frequency-dependent**: bass at the same level passes cleanly, a loud 3 kHz tone gets a third harmonic that is easy to measure. **Inner Groove** tightens the limit and adds an asymmetry (even harmonics) as the stylus approaches the label, and also rolls off the top end (a one-pole low-pass that moves from about 30 kHz at 0 % down to 4.8 kHz at 100 %).

**Noise.** Surface hiss and rumble are picked up *after* the cut, so the playback curve shapes them: the hiss comes out dark (more at 1 to 2 kHz than at 10 kHz) and the rumble, between about 5 and 40 Hz, is boosted by the bass lift. The part of the rumble that is the same in both channels is the horizontal motion, the part that is opposite is the vertical one.

**Crosstalk.** A real pick-up leaks a little of each channel into the other. The leak here goes through an all-pass filter at 1.8 kHz, so it arrives with a phase shift (about 58 degrees at 1 kHz) and widens or smears the image instead of just narrowing it. At 100 % the leak is 12 dB down.

**The cartridge.** After de-emphasis a small residual response models the pick-up: Hi-Fi is flat, Standard has a small rise near 11 kHz and a little bass loss, Cheap has a pronounced rise near 9 kHz and loses more bass. At the defaults the whole chain is within plus or minus 0.3 dB from 100 Hz to 10 kHz. The cartridge also sets how soon the stylus loses track: Hi-Fi tracks 40 % further, Cheap gives up at roughly half the Standard level.

**Dust, pops and scratches.** They are added after the pick-up (they are damage on the playing surface, not part of the signal). All random events are seeded, so a render is repeatable.

- a *bed* of tiny crackle, about `1400 x Dust` events a second at 33 1/3 rpm;
- *ticks*, small sharp clicks, `50 x Dust^2` a second;
- *pops*, rare loud clicks with a low thump, `12 x Dust^2` a second (so about one a second at 30 %, about four at 60 %);
- *scratches*: from 40 % Dust there is one, from 65 % two, from 85 % three. Each sits at a **fixed place on the revolution** and has the same waveform every time round, so you hear it come round once per turn (every 1.8 s at 33 1/3 rpm, 1.33 s at 45, 0.77 s at 78).

Faster records are busier: the rates are multiplied by (rpm / 33.3) to the power 0.7.

## How to use it?

- **A used record, subtle:** Speed 33 1/3, Cartridge Standard, Inner Groove 20 %, Dust 30 %, Noise 40 %, Rumble 25 %, Warp 25 %, Crosstalk 30 %, Bass Mono 120 Hz (the defaults). Warm bass, a hint of crackle, a gentle wobble.
- **Pristine pressing:** Dust 0 %, Noise 15 %, Rumble 10 %, Warp 10 %, Cartridge Hi-Fi. Only the groove and the curve are left.
- **Beaten-up charity-shop record:** Dust 85 %, Noise 70 %, Rumble 50 %, Warp 55 %, Cartridge Cheap, Inner Groove 60 %. Three scratches come round every turn.
- **Old 78:** Speed 78 rpm, Inner Groove 80 %, Cartridge Cheap, Dust 60 %, Bass Mono 300 Hz. The wobble is fast (1.3 Hz) and the highs are gone.
- **Tighten the bass of a loop:** Bass Mono 200 Hz with everything else at 0 % and Mix 100 %.
- **Wobble only:** Dust, Noise and Rumble at 0, Warp 70 %, Inner Groove 0 %, Bass Mono 0.
- **Keep the punch:** Mix 50 %. The dry signal is delayed to line up.

## Reference

### Inputs and outputs

| Jack | Type | Meaning |
| --- | --- | --- |
| In L | audio | Left input. |
| In R | audio | Right input. With Input set to Auto, nothing patched here means the left input feeds both channels. |
| Out L | audio | Left output. |
| Out R | audio | Right output. |

### Knobs and settings

| Control | Range | Default | Meaning |
| --- | --- | --- | --- |
| Speed | 33 1/3 / 45 / 78 rpm | 33 1/3 rpm | Wobble frequency, scratch period, how busy the surface is. |
| Cartridge | Hi-Fi / Standard / Cheap | Standard | Response residual and tracking ability. |
| Inner Groove | 0 to 100 % | 20 % | Tracking distortion (with asymmetry) and high-frequency roll-off. |
| Dust | 0 to 100 % | 30 % | Condition of the record: bed, ticks, pops, scratches. 0 is silent. |
| Noise | 0 to 100 % | 40 % | Level of the surface hiss and of the crackle bed. Hiss at 100 % is about -34 dBFS, at 40 % about -46 dBFS. |
| Rumble | 0 to 100 % | 25 % | Turntable rumble, 5 to 40 Hz. At 100 % it is about -28 dBFS. |
| Warp | 0 to 100 % | 25 % | Eccentricity wobble, once per revolution. 100 % is about plus and minus 14 cents. |
| Crosstalk | 0 to 100 % | 30 % | Channel leak: 0 is perfect separation, 100 % a leak at -12 dB. |
| Bass Mono | 0 to 400 Hz | 120 Hz | Corner below which the stereo difference is removed. Below 10 Hz it is off. |
| Output | -24 to +12 dB | 0 dB | Output level. |
| Mix | 0 to 100 % | 100 % | Dry against processed. |
| Input (setup) | Auto / Stereo / Mono | Auto | Auto uses the left input for both channels when the right input has been silent (exactly zero) for 2048 samples. |

### Probes

| Probe | Meaning |
| --- | --- |
| Groove | The peak signal in the groove after the cut curve: 1.0 is a full-scale 1 kHz tone. Bright, loud passages push it up. |
| Level | The output level. |

### Things to know

- The cost estimate is about 140,000 per 32-sample chunk, below the 150,000 this project allows for the heaviest modules.
- The record curve in the groove sits up to 1 dB above the strict standard near 10 kHz at 48 kHz, because of the way the digital filter is mapped; cut and playback still cancel exactly.
- The warp wobble is real pitch modulation: a bright tone sounds slightly blurred if you look at its spectrum, which is why measuring its level takes in the sidebands.
