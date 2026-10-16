# Limiter

## 1. Purpose

A brickwall stereo limiter: no output sample exceeds the ceiling. Lookahead gives clean limiting; with the lookahead off it adds no delay and is safe in feedback loops.

## 2. Jacks

| Jack | Direction | Signal |
|---|---|---|
| In L, In R | in | Audio (R normalled to L) |
| Out L, Out R | out | Audio |
| Reduction | out | Control, 0 … 1 = 0 … 12 dB of gain reduction |

## 3. Controls

| Control | Range | Default |
|---|---|---|
| Ceiling | −12 … 0 dB | −0.3 |
| Release | 10 … 1000 ms | 100 |
| Input | 0 … 24 dB | 0 |
| Lookahead (setting) | Off, 1, 2, 5 ms | 2 ms |

## 4. Behaviour

The gain needed per sample is `ceiling / peak` of the louder channel, after Input. It is min-filtered over the lookahead window, released with a one-pole (falls at once, rises over Release) and averaged over the same window. The signal is delayed by window − 1 samples, so the gain ramp ends exactly on the peak. The output is clamped to the ceiling as a guard against float rounding. Changing Lookahead clears the state.

## 5. Module view

The standard knob view; the Reduction output is shown live.

## 6. Saved state

Knob values and the lookahead setting only.

## 7. Engine requirements

None. The lookahead delay is not reported to the engine (there is no latency compensation).

## 8. Tests

`patch/modules/limiter/tests/test_limiter.cpp`: the ceiling is never exceeded (several lookaheads, bursts, a single-sample spike), quiet signals pass unchanged apart from the delay, the gain releases over about the Release time.

## 9. Later

True-peak (oversampled) detection; a stereo-unlinked mode; reporting the delay to the engine.
