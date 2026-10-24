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

```text
In -> low shelf -> mid bell -> high shelf -> Output -> Out
```

The filters are the standard RBJ designs (shelves with a slope of 1, a peaking bell with the chosen Q). The knobs are smoothed once per block of 32 samples, so moving them does not click. Frequencies are kept below 45 % of the sample rate.
