# Stretch

Type id `stretch` · category *Effects / Textures* · colour `#fb923c`

## 1. Purpose

Records its stereo input and plays it back faster or slower **without changing the
pitch** (×0.1 to ×8), freezes a moment, scrubs through it from a CV, and shifts the pitch
independently. Its own ideas: **Hold Range** loops a window of the recording, and the
stretch factor can be modulated so that **time itself wobbles**.

## 2. Jacks

Inputs *In L*, *In R* (normalled to L), *Position* (`control`, added to the Position knob),
*Freeze* (`gate`), *New Take* (`trigger`). Outputs *Out L*, *Out R*, *Head* (`control`,
0…1, the play head inside its window). Button *New Take*.

## 3. Controls

Time: Stretch ×0.1–×8 (1), Freeze, Reverse, Pitch ±24 st. Engine: Engine (Grains,
Smear); Grain 20–400 ms, Overlap (2×, 3×, 4×), Scatter (Grains); Window 1024 / 2048 /
4096 (Smear). Range: Hold Range, Start, Range (shown with Hold Range), Position Mode
(Offset, Scrub), Position. Wobble: Wobble 0–100 %, Wobble Rate 0.05–20 Hz, Wobble
Shape (Sine, Random, Saw). Tape: Record (Once, Rolling, Off), Length 1–30 s (8), Mix.

## 4. Behaviour

**Tape.** A stereo buffer of up to 30 s; *Length* sets the part in use. *Once* records
from the start until the length is reached, then stops (the playable part grows while it
records); the *New Take* trigger or button starts over. *Rolling* records continuously round
the length. *Off* leaves the buffer alone. Mix 0 is the live input, 1 the stretched sound.

**Head.** The head moves through the window (the whole recording, or with Hold Range the part
from Start of width Range, as shares of the recording) at `1 / factor` source samples per output
sample, backwards with Reverse, looping at the window's end; Freeze stops it. The factor is
Stretch × 2^(Wobble × 1.5 × lfo), clamped to 0.05…20; the LFO is a sine, a smooth random walk
(cosine-interpolated values, seeded) or a saw. *Position* in Offset mode shifts the head by that
share of the window (wrapping); in Scrub mode it is the head (smoothed over about 2 ms) and the
speed is ignored.

**Grains.** Every `len / overlap` samples a Hann grain (gain 2/overlap) is cut from the head and played
at the pitch ratio; its start is scattered by ±Scatter × its length and then nudged within ±8 ms (at most
a quarter grain) to where it continues the grain before it best (normalised cross-correlation, the waveform-similarity
overlap-add method), which keeps tonal material in tune. Grains never reach past the window.

**Smear.** The phase-vocoder method: every N/4 samples two frames, a hop apart, are analysed at the head
(one transform for both channels); each bin's phase advance between them gives its true frequency; the
synthesis phase of each bin turns by that advance every hop, and bins around each spectral peak keep their
analysed phase relation to it (identity phase locking, conjugated when playing backwards), so partials stay together.
With a pitch offset each bin is moved to `round(k × ratio)` (strongest wins) and its advance scaled by the ratio.
Frames are windowed (Hann), overlap-added (÷1.5) and read with a latency of N.

## 5. Implementation

`patch/modules/stretch/dsp/StretchDsp.h`, FFT in `common/dsp/RealFft.h`. Tests: `tests/test_stretch.cpp`
(take stops when full, pitch kept under ×0.25 … ×4 in both engines, chirp played slower reaches the matching
pitch, pitch offset, freeze, scrub, hold range, wobble, stereo, rolling, new take, extremes).
The module sets `memoryHeavy`.
