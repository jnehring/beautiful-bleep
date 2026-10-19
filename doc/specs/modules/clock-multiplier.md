# Clock Mult

Type id `clock-multiplier` · category *Sequencing* · colour `#e9b44c`

## 1. Purpose

Six faster (or slower) clocks from one. Each output has its own rational
ratio *p/q* of the input clock, a chance to skip ticks, and shares one Swing
and one Humanize control that move only the ticks that do not coincide with
an input clock. A Phase Lock decides how tightly the outputs follow the
incoming pulses. Clock Div (`clock-divider.md`) is the slower-only sibling.

## 2. Jacks

| Jack | Type | What it does |
|---|---|---|
| Clock (in) | `trigger` | Each pulse is one input clock. Unpatched: one input clock is *Base* at the transport's tempo. |
| Reset (in) | `trigger` | The next input clock is the first of a new count (x = 0). |
| Out 1 … Out 6 | `gate` (or trigger pulse) | Output *k* ticks at its ratio. |
| Any (out) | `gate` | High while any output is high. |

## 3. Controls

Knobs: *Ratio 1 … 6* (stepped choice from 1/8 … 32; defaults 2, 3, 4, 3/2,
5/4, 8), *Skip 1 … 6* (0–100 %), *Swing* (0–100 %), *Humanize* (0–100 %),
*Phase Lock* (0–100 %, 100 %), *Width* (1–99 %, shown for Gate output).
Settings: *Base* (the Step Sequencer's rates, default 1/4), *Output* (Gate,
Trigger), *Keep Beat* (on), *Seed* (0–999), *Sync To* (Auto, Clock, Transport).

## 4. Behaviour

Everything is a function of a position *x* in input clocks.

- **Transport mode:** `x = (ppq − off) / base`. A pure function of the song
  position (no state beyond a Reset offset), so loop jumps and renders agree.
  Per sample the interval `(x − dx, x]` is checked for ticks.
- **Clock mode:** a pulse counter *n* (0 on the first pulse after Reset) and a
  running phase advancing `1 / period` per sample. At a pulse the phase is
  pulled onto *n* by *Phase Lock* (100 %: snapped; below: partially; the
  period estimate follows the measured interval by `0.1 + 0.9 · lock`). At full
  lock the phase waits just below *n + 1* until the next pulse; below it keeps
  running (flywheel). A tick index only fires once, even if the phase is pulled back.
- **Ticks:** output *k* has ratio *p/q* in lowest terms and interval
  `iv = q/p`. Tick *m* is nominally at `m · iv`; it is an *anchor* when
  `m · q mod p = 0` (it coincides with an input clock).
- **Feel:** for a tick that is not an anchor, delay (in intervals) =
  `0.5 · Swing` if *m* is odd, plus `0.4 · Humanize · u(seed, m, k)` with `u`
  a counter-based uniform. Delays are never negative and below one interval, so
  order is kept and anchors never move.
- **Skips:** tick *m* is dropped when `u(seed, m, k) < Skip`, except anchors
  while *Keep Beat* is on.
- **Gates:** high for *Width* of the interval (at least one sample); a new tick on a
  high gate drops it for one sample. Trigger output: one sample.
- Transport stopped: all outputs low, Reset offset cleared.

## 5. Module view

The generic view, grouped *Ratios*, *Skips* and *Feel*.

## 6. Saved state

Knob and setting values only.

## 7. Tests

`patch/modules/clock-multiplier/tests/test_clock_multiplier.cpp`: tick counts
and positions for whole and fractional ratios, loop jumps, skips (Keep Beat,
seeds), Swing and Humanize (anchors fixed, bounded delays), Clock mode,
Phase Lock (stop, flywheel, re-alignment), Reset, Width, Trigger, stop.
