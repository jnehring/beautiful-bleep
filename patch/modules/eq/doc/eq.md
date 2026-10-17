# EQ

![EQ in the module view](eq.png)

## Introduction

The EQ turns parts of the spectrum up or down: more bass, less mud around 300 Hz, a cut of harsh 3 kHz, more air above 8 kHz. It has eight bands, each of which can be a bell, a shelf, a cut, a notch or a band-pass, in stereo.

## How does it work?

Every band is a *biquad* filter (the formulas of the well-known "Audio EQ Cookbook"), calculated with the band's settings and applied one after another. The display shows the spectrum going in (grey) and coming out (coloured) with the EQ curve on top, and one numbered point per band.

- **Select a band** by clicking its point in the display or its tab (1–8) under the display. The controls below show that band.
- **Drag a point** sideways to change its *Freq*, up and down to change its *Gain*. Hold Shift for fine movement, double-click a point to set its gain back to 0 dB, and turn the mouse wheel over a point to change its *Q* (or the *Slope* of a cut). Dragging a point of a band that is off switches it on.
- **Type** of a band:
  - **Bell**: boosts or cuts around *Freq* by *Gain* (±18 dB). *Q* sets the width: 0.1 is very broad (a gentle tonal tilt), 1 is a typical bell, 18 is a narrow spike for a single ringing frequency.
  - **Low Shelf** / **High Shelf**: raises or lowers everything below / above *Freq* by *Gain*. *Q* sets how steep the shelf is (0.7 is smooth; higher values overshoot a little before the corner).
  - **Low Cut** / **High Cut**: removes everything below / above *Freq*, 3 dB down at *Freq*. *Slope* sets how steeply: 6, 12, 18, 24, 36 or 48 dB per octave (Butterworth, so no ringing).
  - **Notch**: removes a narrow band around *Freq*; *Q* sets how narrow.
  - **Band Pass**: keeps a band around *Freq* and removes the rest; *Q* sets how narrow.
- **On** switches a band off without losing its settings. Bands 1 and 8 start as switched-off cuts, bands 2 and 7 as shelves and bands 3–6 as bells at 300 Hz, 800 Hz, 2 kHz and 5 kHz. A bell or shelf at 0 dB is bypassed, so unused bands cost nothing.
- **Level** (−18 to +6 dB) is the gain after the equaliser, to make up for boosts.

*Freq*, *Gain* and *Q* of every band can be modulated; the filters are updated every 16 samples, which is smooth for sweeps. Modulating the *Freq* of a bell with an LFO or envelope while boosting 10 dB gives a wah-wah. The band's type, slope and on switch, and the band being edited, are settings. With only *In L* patched, the signal feeds both sides.

## How to use it?

- **Remove rumble:** band 1 on, Low Cut at 40 Hz, 24 dB/oct.
- **Clean up mud:** a bell at 300 Hz, −4 dB, Q 1.
- **Add presence:** a bell at 3 kHz, +3 dB, Q 0.8.
- **Air:** band 7, High Shelf at 10 kHz, +4 dB.
- **Telephone voice:** Low Cut at 400 Hz and High Cut at 4 kHz, both 24 dB/oct, and a bell at 1.5 kHz, +6 dB.
- **Find a resonance:** boost a bell +12 dB with Q 6 and sweep its frequency (drag the point sideways) until the problem sticks out, then cut it, or turn the band into a Notch.
- **Wah:** a bell, +12 dB, Q 3, an envelope or LFO onto its frequency.

<!-- generated:presets -->
## Presets

The preset bar of the EQ view has 16 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Smile Curve** | Boosted lows and highs: instant polish. |
| **Bass Boost** | More weight below 80 Hz. |
| **Low Cut Lite** | Removes rumble below 90 Hz and clears a little mud. |
| **Mud Remover** | Cuts the boxy low-mids. |
| **Presence Lift** | Brings the sound forward. |
| **Air** | Open, airy top end. |
| **Warm Darkness** | Rolls off the top and warms the bottom. |
| **Vocal Clarity** | Cuts the rumble, cleans up and brightens a voice. |
| **Telephone** | Steep cuts below 400 Hz and above 4 kHz, a nasal band in between. |
| **Hollow Notch** | Two deep notches for a phase-like, hollow tone. |
| **Resonant Peaks** | Narrow, ringing boosts: formant-like colour. |
| **Kick Shaper** | Weight and click for kick drums. |
| **Lo-Fi Radio** | Small-speaker colouration. |
| **Tilt Down** | Dark tilt; tames harsh sources. |
| **Rumble Remover** | A steep cut below 35 Hz: clears sub-bass rumble and DC drift. |
| **De-Harsh** | Two narrow dips and a soft top cut tame a piercing source. |
<!-- /generated -->
