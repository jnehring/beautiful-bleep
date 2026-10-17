# Limiter

## Introduction

A limiter keeps a signal under a ceiling, whatever comes in. Where the Compressor shapes dynamics, the Limiter is a safety: put it at the end of a patch, in a feedback loop or before a loud effect, and nothing gets past the **Ceiling**.

## How does it work?

The Limiter looks a few milliseconds ahead. When a peak is coming, it turns the gain down gradually so that the gain has reached the right value exactly when the peak arrives, then lets go again over the **Release** time. The sound is delayed by the lookahead to make this possible. Both channels always get the same gain, so the stereo image doesn't move.

- **Ceiling** (−12 to 0 dB) is the level nothing passes. The default of −0.3 dB leaves a little room.
- **Release** (10 ms to 1 s) is how fast the gain comes back. Short releases are loud but can pump; long ones are smooth.
- **Input** (0 to 24 dB) turns the signal up before it is limited. This is how you make something louder: raise *Input* until the *Reduction* output shows the amount you want.
- **Lookahead** is *Off*, *1 ms*, *2 ms* or *5 ms*. Longer lookahead gives gentler, cleaner limiting and adds the same delay to the sound. With *Off* there is no delay and the gain follows the signal instantly, which can sound harsher on low notes.

The **Reduction** output is a control signal from 0 (no limiting) to 1 (12 dB of reduction or more). Use it to light a lamp or to open a filter when the sound is being squashed.

## The display

The view shows an **IN** and an **OUT** level meter, with the controls beside them:

- Each meter shows the peak (light bar), the RMS level (solid bar) and a held peak line per channel, with the held peak in dB below. The red mark at the top is a clip light (a sample over 0 dBFS). Click a meter to reset it.
- The orange **limit** line across the IN meter is the level the input has to reach before the limiter turns it down: the *Ceiling* minus the *Input* gain. The part of the input bar above it is what the limiter takes off. It moves when you change either knob.
- With the ceiling below 0 dB the OUT meter should never reach it.
- *Gain reduction* under the meters is the amount the limiter is turning down, in dB. It changes four times a second, showing the deepest reduction since the last change, so it can be read.

## How to use it?

- **Safety at the end of a patch:** Ceiling −1 dB, Release 100 ms, Lookahead 2 ms.
- **Louder, not clipped:** raise Input by 3 to 6 dB, Lookahead 5 ms, Release 200 ms.
- **Inside a feedback loop:** Lookahead *Off*, so the loop gets no extra delay.
