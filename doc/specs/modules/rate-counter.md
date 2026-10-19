# Rate Counter

Type id `rate-counter` · category *Utility/Metering* · colour `#fdba74`

## 1. Purpose

Counts how often something repeats and says it as a number: the frequency of a wave, or the tempo
of a train of pulses (a clock, a drum track, a hand-tapped rhythm). The rate comes out as a pitch
signal and as a tempo signal, a gate tells when the rhythm is steady, and an average over the last few
intervals smooths out a shaky source. A Tap button lets you add taps by hand.

## 2. Jacks

**Inputs**: *In* (`audio`; a gate or trigger works in Pulse Train mode).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Rate | `pitch` | The latest rate in Hz as 1 V/oct, 0 = middle C (clamped to ±10 octaves). Holds after the input stops. |
| BPM | `control` | The latest rate as beats per minute ÷ 240 (120 BPM = 0.5), at most 4. |
| Average BPM | `control` | The BPM of the mean of the last *Average Of* intervals, ÷ 240. |
| Steady | `gate` | High while the last four intervals are within *Steady Within* of their mean. |
| Edge | `trigger` | A 2 ms pulse on every edge found. |

## 3. Controls

| Control | Values | Default | Notes |
|---|---|---|---|
| Input Is | Wave, Pulse Train | Wave | How edges are found. |
| Per Beat | 1, 2, 3, 4, 6, 8, 12, 16, 24 | 1 | Edges (or cycles) that make one beat. 4 for sixteenth notes, 24 for a MIDI clock. |
| Average Of | 2 – 16 | 4 | Intervals in the average. |
| Steady Within | 0.5 – 25 % | 5 % | |
| Start Over After | 1 – 20 s | 4 s | Without an edge for this long the count is cleared. |

Buttons: *Tap* (counts as an edge; momentary), *Clear*.

## 4. Behaviour

**Edges.** *Pulse Train*: a rising crossing of 0.5 (it must fall below 0.3 before the next). *Wave*: the signal's range
is tracked (its top and bottom approach each other with a time constant of 0.5 s); an edge is a rising crossing
of the centre + 20 % of the swing, re-armed below the centre − 20 %. A swing below 0.01 finds no edges. The time
of an edge is interpolated to a fraction of a sample.

**Intervals.** The last 16 intervals between edges are kept (a first edge only starts the count). The latest rate is smoothed (halfway to each new rate)
for Rate and BPM. The average is `60 / (mean · Per Beat)` of the newest *Average Of* intervals.

**Steady.** At least four intervals, each within *Steady Within* of the mean of the newest four.

**Timeout.** *Start Over After* seconds without an edge clear the history; Steady goes low; Rate, BPM and Average BPM hold. The next edge starts a fresh count.

**Tap.** The button acts as an edge at the next sample, in any mode; tapping at a tempo gives its average after the second tap.

## 5. View

The average BPM as a large number (a dash while nothing is counted), the latest BPM and Hz beside it, the Steady lamp, the number of intervals
and a row of 16 bars: the newest interval at the right, each above or below the centre line by how much it differs from the average.

## 6. Tests

`modules/rate-counter/tests/test_rate_counter.cpp`: frequency of waves from 2 Hz to 4 kHz (0.2 %); a noise floor; BPM of gate trains; Per Beat; Steady with
steady and uneven trains; the length of the average; timeout and a fresh count; taps; determinism.
