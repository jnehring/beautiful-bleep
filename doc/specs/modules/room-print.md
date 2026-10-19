# Room Print

Type id `room-print` · category *Effects/Space & Time* · colour `#818cf8`

## 1. Purpose

A zero-latency partitioned convolution reverb that loads an impulse response
from a WAV (media drop) or one of ten responses synthesised in code, with
predelay, stretch, trim, low/high damping and an early/late balance.

## 2. Jacks

Inputs: In L, In R (audio). Outputs: Out L, Out R (audio).

## 3. Controls

Modulatable: Mix, Predelay (0–0.5 s), Early/Late, Width (0–200 %), Level.
Settings: Impulse (Room, Hall, Cathedral, Plate, Spring, Tank, Cave, Swell, Gate,
Echoes, Sample), Stretch (0.5–2), Trim Start (0–0.9), Trim End (0.05–1),
Damp Low, Damp High. `memoryHeavy`.

## 4. Behaviour

4.1 Convolver. Head: the first 512 samples as a direct FIR over a doubled
history. Tail: partitions of 512 samples with 1024-point FFTs, a frequency-
domain delay line of the input's spectra (overlap-save), and the
accumulated product for block m+1 computed when block m completes, so the tail
joins the head with no latency. Mono input shares one delay line for both
output channels.

4.2 Preparing a response (message thread, `buildIr`): resample by Stretch ×
fileRate / engineRate with cubic Hermite; trim; 0.5 ms fade-in after a trimmed
start and 15 ms fade-out; Damp: bands below 220 Hz (two-pole low-pass), above
3 kHz and the middle, the outer ones multiplied by exp(−4.6 · damp · t); energy
normalised to 1 (mean over channels); at most 4 s; spectra computed for the
partitions. A silent or empty response gives an empty Ir (dry only).

4.3 Synthetic responses (`makeSynthetic`): noise tails with exponential decay and
a closing low-pass, early taps, chirped echoes (Spring), 48 modes (Tank), a
reversed tail (Swell), a gated burst, ping-pong taps; seeded by counter-based
hashes, so they are identical on every machine.

4.4 Early/Late. A gain per partition: early above, late below a smoothstep
between 60 and 120 ms; early 2(1 − b) clamped to 1, late 2b clamped to 1; the head
uses the early gain. Gains glide over about 10 ms.

4.5 Rebuilding. `setData` (clip) and `prepare` rebuild; `takeData`
(polled ten times a second) rebuilds when the shaping settings or the rate
changed, and publishes with `RtHandoff<Ir>`. A new Ir clears the convolver state.

## 5. Module view

The prepared response as a min/max envelope with the early/late boundary marked,
the response length, and a drop target for a sample.

## 6. Saved state

Node data `{"clip": "<media id>", "name": "<file name>"}`.

## 7. Engine requirements

Media folder and `RtHandoff` (both present).

## 8. Tests

`tests/test_room_print.cpp`: FFT against a DFT; the convolver against direct
convolution (error below 1e-6, no latency, with both channels); stereo input
routing; early/late balance; predelay and Mix 0; all ten built-in responses
(finite, normalised, decaying, repeatable, different); stretch, trim,
resampling from 44.1 kHz and damping; empty responses; bounds with loud noise.

## 9. Later

Non-uniform partitions for lower cost on very long responses; true stereo
(four-way) convolution; crossfading when the response changes.
