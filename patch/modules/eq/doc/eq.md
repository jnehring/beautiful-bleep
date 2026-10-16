# EQ

![EQ in the module view](eq.png)

## Introduction

The EQ turns parts of the spectrum up or down: more bass, less mud around 300 Hz, a cut of harsh 3 kHz, more air above 8 kHz. It has four bands, a low shelf, two *bell* bands in the middle and a high shelf, in stereo.

## How does it work?

Every band is a *biquad* filter (the formulas of the well-known "Audio EQ Cookbook"), calculated with the knobs' values and applied one after another.

- **Low shelf**: raises or lowers everything below *Low Freq* (30 Hz–1 kHz) by *Low Gain*.
- **Mid 1** and **Mid 2**: a bell at *Freq* that boosts or cuts around it by *Gain* (±15 dB). *Q* sets the width: 0.3 is very broad (a gentle tonal tilt), 1 is a typical bell, 8 is a narrow notch for a single ringing frequency.
- **High shelf**: raises or lowers everything above *High Freq* (1–18 kHz).
- **Level** (−18 to +6 dB) is the gain after the equaliser, to make up for boosts.

A band at 0 dB gain is bypassed, so unused bands cost nothing. The frequency and gain of every band can be modulated; the filters are updated every 16 samples, which is smooth for sweeps. Modulating *Mid 1 Freq* with an LFO or envelope while boosting 10 dB gives a wah-wah. With only *In L* patched, the signal feeds both sides.

## How to use it?

- **Clean up mud:** Mid 1 at 300 Hz, −4 dB, Q 1.
- **Add presence:** Mid 2 at 3 kHz, +3 dB, Q 0.8.
- **Air:** High shelf at 10 kHz, +4 dB.
- **Telephone voice:** Low shelf at 800 Hz, −15 dB; High shelf at 3 kHz, −15 dB; Mid 2 at 1.5 kHz, +6 dB.
- **Find a resonance:** boost Mid 2 +12 dB with Q 6 and sweep its frequency until the problem sticks out, then cut it.
- **Wah:** Mid 1 +12 dB, Q 3, an envelope or LFO onto its frequency.

<!-- generated:presets -->
## Presets

The preset bar of the EQ view has 14 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Smile Curve** | Boosted lows and highs: instant polish. |
| **Bass Boost** | More weight below 80 Hz. |
| **Low Cut Lite** | Thins the lows and clears mud. |
| **Mud Remover** | Cuts the boxy low-mids. |
| **Presence Lift** | Brings the sound forward. |
| **Air** | Open, airy top end. |
| **Warm Darkness** | Rolls off the top and warms the bottom. |
| **Vocal Clarity** | Cleans up and brightens a voice. |
| **Telephone** | Narrow, nasal band. |
| **Hollow Notch** | Two deep notches for a phase-like, hollow tone. |
| **Resonant Peaks** | Narrow, ringing boosts: formant-like colour. |
| **Kick Shaper** | Weight and click for kick drums. |
| **Lo-Fi Radio** | Small-speaker colouration. |
| **Tilt Down** | Dark tilt; tames harsh sources. |
<!-- /generated -->
