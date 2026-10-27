# 3-Band EQ

## Introduction

The 3-Band EQ is the quick, no-fuss tone control: a **low shelf**, a **mid bell** and a **high shelf**. Turn a gain knob up to boost that part of the sound, down to cut it. Use it to add weight to a bass, take the mud out of a mix, or brighten a dull sample.

The module is stereo (In L / In R, Out L / Out R). Both channels use the same settings.

## Controls

| Control | What it does |
|---|---|
| **Low** | Gain of the low shelf, -15 to +15 dB. Affects everything below **Low Freq**. |
| **Low Freq** | Where the low shelf turns over, 40 to 400 Hz. |
| **Mid** | Gain of the mid bell, -15 to +15 dB. |
| **Mid Freq** | Centre of the mid bell, 200 Hz to 5 kHz. |
| **Mid Q** | Width of the mid bell, 0.3 (very broad) to 4 (narrow). |
| **High** | Gain of the high shelf, -15 to +15 dB. Affects everything above **High Freq**. |
| **High Freq** | Where the high shelf turns over, 1 to 12 kHz. |
| **Output** | Level after the three bands, -12 to +12 dB. |

With all three gains at 0 dB the module passes the signal through unchanged.

## How does it work?

Each channel runs through three biquad filters in a row:

![Signal flow: In, low shelf, mid bell, high shelf, Output, Out](three-band-eq-flow.png)

The filters are the standard RBJ designs (shelves with a slope of 1, a peaking bell with the chosen Q). The knobs are smoothed once per block of 32 samples, so moving them does not click. Frequencies are kept below 45 % of the sample rate.

## How to use it?

- **More weight:** raise *Low* by 3–6 dB and set *Low Freq* around 100 Hz.
- **Less mud:** lower *Mid* by 3–5 dB, *Mid Freq* around 300 Hz, *Mid Q* 1–2.
- **Brighter:** raise *High* by 2–4 dB with *High Freq* around 8 kHz.
- **Take out a harsh note:** a narrow cut: *Mid Q* 3–4, *Mid* -6 dB, and sweep *Mid Freq* until it disappears.
- **Watch the level:** boosts make the sound louder, so turn *Output* down by about as much as you boosted.
- **Check it:** with all three gains at 0 dB the signal passes unchanged, so you can compare against the original.
