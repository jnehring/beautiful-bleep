---
title: Channel Strip
description: A console channel in one module: high-pass filter, input transformer, four-band EQ with switchable frequencies and proportional Q, and a drive stage that is warm, punchy or clean. Written in Bleep Script.
order: 60
---

# Channel Strip

## Introduction

On an analogue console the signal of a channel runs through the same few blocks in the same order: a high-pass filter to take the rumble off, an input transformer, an equaliser with a handful of switchable frequencies, and some amplifier that is always working a little. The sound of "a signal that went through a console" is the sum of those, and one detail of the order matters a lot: **an EQ boost that runs into a saturating stage pushes it harder**, so the colour follows the EQ.

The Channel Strip puts the whole channel in one module:

- a **high-pass filter** (Off, 30, 50, 80 or 120 Hz; 12 or 18 dB per octave);
- an **input transformer**, with core saturation that bites the bass first;
- a **four-band equaliser**: low shelf, low-mid bell, high-mid bell, high shelf, +-15 dB, each with four switchable frequencies and a **proportional Q**: the Q narrows as the gain grows, as on analogue consoles;
- a **drive stage** with three characters: **Warm** (round iron, even harmonics), **Punchy** (tight op-amp, odd harmonics, a lift on the attack of hits), **Clean** (tight and subtle);
- **Stage Order**: the EQ before or after the drive stage.

The module is stereo (In L / In R, Out L / Out R). It has no latency except the few samples of the Normal quality's oversampling filters, and no Mix control: it is a channel, and the EQ is meant to be heard.

## How does it work?

```text
In -> high-pass -> input transformer -> [ EQ -> Drive ]  or  [ Drive -> EQ ] -> level compensation -> Output
```

**High-pass.** The 12 dB per octave filter is a second-order Butterworth section: -3 dB exactly at the corner. The 18 dB per octave filter is a first-order section and a second-order one with Q = 1 (a third-order Butterworth), also -3 dB at the corner. Off is a straight wire. The tests measure the slope and the corner for all eight combinations.

**Input transformer.** The same kind of core as in the Preamp, in a smaller version. The flux integrates the voltage, so low frequencies reach the knee at lower levels. The magnetising current rises steeply past it and is taken from the signal, which squashes the bass and makes odd harmonics, and a lagging sign of the flux rate gives the loop a little hysteresis. **Transformer** sets how early the core saturates, from 8 Hz (0 %) to 98 Hz (100 %) for a full-scale sine, and the low corner from 4 to 18 Hz. The core sees the signal raised by up to 12 dB when Drive is up (the gain is brought back after it), so more Drive also means more iron.

**Equaliser.** Four second-order sections in series, computed once per block for both channels. The gains glide to their targets in about 10 milliseconds, so switching EQ On or turning a gain does not click. The frequency choices are:

| Band | Type | Frequencies |
| --- | --- | --- |
| LF | low shelf | 35, 60, 100, 200 Hz |
| LMF | bell | 250, 500 Hz, 1, 2 kHz |
| HMF | bell | 1.5, 3, 5, 8 kHz |
| HF | high shelf | 5, 8, 10, 12 kHz |

**Proportional Q.** The bells have Q = 0.55 at no gain, rising to 1.9 at 15 dB (a boost or a cut: both narrow). The shelves have Q = 0.55 to 1.0, so they overshoot slightly more as the gain grows. A small boost is broad and gentle, a big one is focused. The tests check the response of every band at every frequency against the analytic curve of the same filter; the worst error is 0.12 dB.

**Drive stage.** Drive runs from 0 to 24 dB of gain into a curve. The output is level-compensated, so that a -12 dBFS sine at 0 dB EQ comes out at -12 dBFS whatever the Drive or the Character.

- **Warm**: a soft clip `s / sqrt(1 + s^2)` with a bias of 0.3, so the positive and negative halves are shaped differently: strong second harmonic, then the third. A DC blocker (5 Hz) removes what the asymmetry leaves behind.
- **Punchy**: a tighter, symmetric knee `z / (1 + z^4)^(1/4)`: odd harmonics only. A fast envelope (0.4 ms) is compared with a slow one (25 ms), and the ratio lifts the signal by up to about 5 dB right after the knee: the attack of a hit, which the knee would otherwise squash, stands out.
- **Clean**: a very gentle soft clip with its knee at three times the level of Warm's: little distortion until you really push it.

**Anti-aliasing.** Warm and Clean use first-order antiderivative anti-aliasing on the non-linear part of the curve (so that the small-signal response stays flat). Punchy relies on oversampling. **Normal** runs the drive stage at twice the sample rate with all-pass half-band filters; **Eco** runs it at the base rate.

**Stage Order.** With "EQ, then Drive" a boost raises the level into the saturator, so it distorts more and the colour follows the EQ. A cut eases it. With "Drive, then EQ" the stage is the same whatever you do with the EQ, and the EQ shapes the result, including the harmonics. At low level the two orders have the same frequency response; they only differ in the colour.

**Input.** Auto uses the left input for both channels while nothing is patched into In R (R has been exactly zero for 2048 samples while L is active), and returns to true stereo, smoothly, the moment R carries signal. Stereo and Mono force one or the other.

## How to use it?

- **Kick drum:** HPF 30 Hz (12 dB), Transformer 60 %, Drive 20 %, Warm. LF +4 dB at 60 Hz, LMF -4 dB at 250 Hz, HMF +3 dB at 5 kHz, order "EQ, then Drive": the boosts push the iron.
- **Snare:** HPF 80 Hz, Drive 40 %, Punchy. HMF +4 dB at 3 kHz, HF +2 dB at 10 kHz. Punchy lifts the crack.
- **Bass:** HPF 30 Hz (18 dB), Transformer 70 %, Drive 25 %, Warm. LF +3 dB at 100 Hz, LMF -3 dB at 500 Hz.
- **Vocal:** HPF 80 Hz (12 dB), Transformer 30 %, Drive 15 %, Clean. LMF -3 dB at 250 Hz, HMF +2 dB at 3 kHz, HF +3 dB at 12 kHz. Order "Drive, then EQ" keeps the colour constant while you shape the tone.
- **Mix bus tone:** all gains in small steps (below 3 dB, where the Q is broad), Drive 10 %, Clean.
- **Colour that follows the EQ:** Warm, Drive 50 %, "EQ, then Drive", LMF +10 dB at 1 kHz: the boosted band drives the stage hard and the sound thickens as you boost. Switch the order and the same boost gets cleaner.
- **Sweeping with frequency switches:** the frequency choices are stepped, as on a console. Set the gain first and then step through the frequencies to find the spot.
- **Bypass the tone but keep the colour:** EQ On off. The EQ bands are bypassed and the transformer and drive stage remain.
- **CPU:** Eco for sessions with many channels.

## The module's own UI

The Channel Strip draws its **real frequency response** from the knobs, using the same filter formulas as the module (the high-pass, the four bands and the proportional Q), with a handle on each band. **Drag** a handle up or down for its gain; drag it sideways and it snaps to the band's stepped frequencies. A bar on the right glows with the Saturation probe, with a thin level bar beside it. A test checks that the drawn curve matches the module's measured response to within 1.5 dB. The file is `src/channel-strip.view.js`.

Tricks it demonstrates:

- recomputing the maths of a module in the UI for a picture (a log frequency axis, an analytic filter response);
- hit testing handles by distance, then snapping a drag to a list of steps by the nearest value on a log scale;
- setting stepped (choice) and continuous knobs from the same gesture;
- the glow of a meter driven by a smoothed probe.

## Reference

### Inputs and outputs

| Jack | Type | Meaning |
| --- | --- | --- |
| In L | audio | Left input. |
| In R | audio | Right input. With Input set to Auto, nothing patched here means the left input feeds both channels. |
| Out L | audio | Left output. |
| Out R | audio | Right output. |

### Knobs and switches

| Control | Range | Default | Meaning |
| --- | --- | --- | --- |
| HPF | Off, 30, 50, 80, 120 Hz | Off | High-pass corner. |
| HPF Slope | 12 dB/oct, 18 dB/oct | 12 dB/oct | High-pass slope. |
| Transformer | 0 to 100 % | 35 % | How early the input core saturates (8 to 98 Hz knee for a full-scale sine). |
| Drive | 0 to 100 % | 25 % | Gain into the drive stage, 0 to 24 dB (level-compensated). |
| Character | Warm, Punchy, Clean | Warm | The curve of the drive stage. |
| Stage Order | EQ then Drive, Drive then EQ | EQ then Drive | Where the EQ sits relative to the drive stage. |
| EQ On | on, off | on | All four bands. |
| LF Gain / LF Freq | -15 to +15 dB / 35, 60, 100, 200 Hz | 0 dB / 100 Hz | Low shelf. |
| LMF Gain / LMF Freq | -15 to +15 dB / 250, 500 Hz, 1, 2 kHz | 0 dB / 500 Hz | Low-mid bell. |
| HMF Gain / HMF Freq | -15 to +15 dB / 1.5, 3, 5, 8 kHz | 0 dB / 3 kHz | High-mid bell. |
| HF Gain / HF Freq | -15 to +15 dB / 5, 8, 10, 12 kHz | 0 dB / 8 kHz | High shelf. |
| Output | -24 to +12 dB | 0 dB | Output level, after the level compensation. |
| Input | Auto, Stereo, Mono | Auto | Where the right channel gets its signal. |
| Quality | Eco, Normal | Normal | Drive stage at the base rate or at 2 times oversampling. |

### Probes

| Probe | Meaning |
| --- | --- |
| Saturation | How far the drive stage bends the signal: 0 is linear, 1 is fully squashed. |
| Level | The output level (peak, falling slowly). |

### Numbers worth knowing

- Cost: about 88,000 operations per 32-sample chunk at the heaviest setting (Normal, both channels); the checker warns above 60,000 and refuses above 400,000.
- With Drive 0 % and Clean, the strip is transparent: a flat sweep within 0.1 dB from 100 Hz up (the DC blocker and the 4 Hz transformer corner cost 0.4 dB at 20 Hz).
- A 15 dB boost at 1 kHz keeps 39 % of its gain half an octave away (1.4 kHz); a 5 dB boost keeps 68 %.
- Transformer 100 %, 40 Hz at -6 dBFS: third harmonic at -15 dBc; the same level at 1 kHz: -49 dBc. At Transformer 0 % both are at -49 dBc.
- With Warm, Drive 50 %, a +12 dB bell at 1 kHz and a -20 dBFS tone at 1 kHz, the harmonics add up to -16 dB relative to the tone with the EQ first and -34 dB with the drive stage first.
- A 7 kHz tone at -6 dBFS at Drive 100 %: non-harmonic energy of -33 dBc (Warm, Eco), -43 dBc (Warm, Normal), -37 dBc (Clean, Eco), -60 dBc (Clean, Normal), -20 dBc (Punchy, Eco), -43 dBc (Punchy, Normal; Drive 60 %).
