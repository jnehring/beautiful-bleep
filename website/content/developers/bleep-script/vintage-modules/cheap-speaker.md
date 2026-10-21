---
title: Cheap Speaker
description: Tonal lo-fi: the bandwidth, resonances, distortion and noise of a telephone, an AM radio, a car speaker, a cassette player, a tiny speaker or a megaphone. Written in Bleep Script.
order: 90
---

# Cheap Speaker

## Introduction

A bit crusher makes a sound digital. The Cheap Speaker does something different: it makes a sound **small**. It puts the signal through the narrow, resonant, overloaded playback of a poor device: a phone line, a car radio on a long drive, a laptop speaker, a megaphone. The character comes from the band-limiting, the peaks in the response and the way each device distorts, not from sample-rate or bit-depth tricks (use a crusher for those).

Six devices are built in. Each is a designed curve, and the controls scale it:

- **Telephone**: 300 Hz to 3.4 kHz, a nasal peak in the mids, the asymmetric harmonic distortion of a carbon microphone, line hiss and a faint mains hum.
- **AM Radio**: 120 Hz to 4.5 kHz, the uneven distortion of an envelope detector, crackling static, hiss and a heterodyne whistle between stations that drifts.
- **Car Speaker**: small cone, bass rolled off from 80 Hz, a boxy cavity resonance, cone breakup in the top, a short cabin reflection, road rumble.
- **Cassette Player**: high-frequency loss, a mild head bump, slow wow, bright tape hiss and a trace of motor hum.
- **Tiny Speaker** (laptop or phone): steep bass cut at 300 Hz, a sharp resonance near 2.2 kHz, an excursion limit that loses bass at high level, and rattle when the cone is overdriven.
- **Megaphone**: 500 Hz to 4 kHz, a horn resonance and hard clipping.

The module is stereo (In L / In R, Out L / Out R). It adds a fixed delay of about 3.7 milliseconds (the dry signal in the Mix is delayed by the same amount).

## How does it work?

```text
In -> wobble delay -> excursion limit -> non-linearity (2x oversampled)
   -> + noise -> low cut (4th order) -> two resonances -> high cut (4th order)
   -> cabin reflection (car) -> + hum and rumble -> Output
```

**Corners.** The low and high corners of each device are fourth-order Butterworth sections, so the number in the table is exactly the -3 dB point and the slope is 24 dB per octave. The tests check the realised corner of every device (within a fraction of a dB of -3 dB), at 44.1, 48 and 96 kHz. **Bandwidth** multiplies both corners at once: 200 % lowers the low corner to half and raises the high corner to double, 50 % does the reverse.

**Resonances.** Two peaking filters per device give its character: the nasal peak of the telephone, the 2.2 kHz squeal of the tiny speaker, the horn of the megaphone. **Resonance** scales their height in decibels: 50 % is as designed, 0 % is perfectly flat, 100 % is twice as high. At 0 % the response is a plain band-pass, which is how the corners are measured. In the car the same knob scales the cabin reflection (two delayed copies at 2.9 and 5.1 milliseconds, which comb the response).

**Distortion.** Each device has its own non-linearity, driven by the **Distortion** knob, and all of them depend on level, so quiet material stays clean:

- Telephone and AM radio use an asymmetric curve (a bias before a soft limit). This gives strong even harmonics, the carbon-microphone and detector sound.
- Megaphone uses hard symmetric clipping: odd harmonics only and heavy compression.
- Car and Tiny Speaker first run the bass through an **excursion limit** (the cone can only move so far): the part of the signal below about 450 Hz is soft-limited, so a loud bass note loses bass relative to the treble. On the tiny speaker, whatever the cone could not follow excites a short band-limited **rattle**.
- All curves are gently shaped polynomials, evaluated with first-order anti-derivative anti-aliasing at twice the sample rate. A hard-driven 5 kHz tone keeps its non-harmonic components about 58 dB below the tone or lower.
- The make-up gain compensates part of the drive, so more distortion does not simply mean more volume. The default loudness of all six devices is within 8 dB of the input, measured on a broadband test signal.

**Noise.** The noise knob sets the level of each device's own noise: line hiss and hum (telephone), static, hiss and a whistle (AM), road rumble (car), tape hiss (cassette), amplifier hiss and hum (tiny speaker), hiss and static (megaphone). Hiss, static and the whistle are added *before* the filters, so they take on the sound of the device (telephone hiss lives in 300 Hz to 3.4 kHz); hum and rumble are added after them. Left and right have independent hiss; hum and the whistle are common to both.

**Wobble.** A seeded slow random drift moves the level a little and the high corner a few percent; on the cassette player it also bends the pitch (up to about 7 cents of slow wow at 100 %), on the radio only slightly (the station is drifting) and moves the whistle.

## How to use it?

- **Phone call:** Telephone, Bandwidth 100 %, Resonance 50 %, Distortion 25 %, Noise 20 %, Wobble 0 %. Use it on a vocal for an intro or a breakdown.
- **Distant radio:** AM Radio, Noise 50 %, Wobble 40 %, Distortion 40 %. The static and the whistle give it a station-between-stations feel.
- **Car stereo:** Car Speaker, Resonance 60 %, Distortion 40 %, Noise 15 %. Bass is thin and boxy, the room is small.
- **Old tape deck:** Cassette Player, Noise 40 %, Wobble 50 %. Dull, wobbly and hissy.
- **Laptop playback:** Tiny Speaker, Distortion 50 %, Resonance 50 %. Turn the signal up and the bass pumps away as the cone runs out of travel.
- **Bullhorn:** Megaphone, Distortion 70 %, Resonance 70 %.
- **Wider or narrower:** Bandwidth 140 % opens any device up (a "better" telephone); 60 % squeezes it.
- **Parallel lo-fi:** Mix 30 % keeps the original body and adds the device's mids and grit. The dry signal is time-aligned.

## Reference

### Inputs and outputs

| Jack | Type | Meaning |
| --- | --- | --- |
| In L | audio | Left input. |
| In R | audio | Right input. With Input set to Auto, nothing patched here means the left input feeds both channels. |
| Out L | audio | Left output. |
| Out R | audio | Right output. |

### Devices

| Device | Low corner | High corner | Peaks | Distortion |
| --- | --- | --- | --- | --- |
| Telephone | 300 Hz | 3.4 kHz | 1.2 kHz (+6 dB), 2.4 kHz (+2.5 dB) | asymmetric, strong even harmonics |
| AM Radio | 120 Hz | 4.5 kHz | 1.8 kHz (+2.5 dB), 300 Hz (+2.5 dB) | asymmetric (detector) |
| Car Speaker | 80 Hz | 7.5 kHz | 300 Hz (+4 dB), 5.5 kHz (+4 dB) | mild, bass excursion limit |
| Cassette Player | 50 Hz | 9 kHz | 100 Hz (+2.5 dB), 6.5 kHz (-3 dB) | light tape saturation |
| Tiny Speaker | 300 Hz | 9.5 kHz | 2.2 kHz (+9 dB, Q 5), 900 Hz (+3 dB) | medium, excursion limit, rattle |
| Megaphone | 500 Hz | 4 kHz | 1.5 kHz (+8 dB), 2.7 kHz (+4 dB) | hard clipping |

The peak heights are at Resonance 50 %.

### Knobs and settings

| Control | Range | Default | Meaning |
| --- | --- | --- | --- |
| Device | Telephone, AM Radio, Car Speaker, Cassette Player, Tiny Speaker, Megaphone | Telephone | The device. |
| Bandwidth | 50 to 200 % | 100 % | Scales both corners. |
| Resonance | 0 to 100 % | 50 % | Height of the characteristic peaks (and the cabin reflection of the car). |
| Distortion | 0 to 100 % | 40 % | How hard the device is driven. |
| Noise | 0 to 100 % | 30 % | Level of the device's noise. The level follows the square of the knob. |
| Wobble | 0 to 100 % | 20 % | Slow level and top-end drift; pitch wobble on the cassette and the radio. |
| Output | -24 to +12 dB | 0 dB | Output level, after the device's make-up gain. |
| Mix | 0 to 100 % | 100 % | Dry against processed. |
| Input (setup) | Auto / Stereo / Mono | Auto | Auto uses the left input for both channels when the right input has been silent (exactly zero) for 2048 samples. |

### Probes

| Probe | Meaning |
| --- | --- |
| Level | The output level. |

### Things to know

- Changing the device mid-note switches the filters at once and can click; set it before playing.
- The cost estimate is about 130,000 per 32-sample chunk, below the 150,000 this project allows for the heaviest modules.
- The output is limited to plus and minus 16 so that extreme settings cannot produce huge values.
