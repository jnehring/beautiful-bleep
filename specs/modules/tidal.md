# Tidal

Type id `tidal` · category *Modulation* · colour proposal `#60a5fa`

## 1. Purpose

A slope oscillator that runs from minutes-long swells to audio-rate tones. One
cycle is a rise and a fall; *Skew* sets their ratio, *Curve* bends them and
*Smooth* either rounds the result off or folds it into richer shapes. It works
as a one-shot AD envelope, a gated AR envelope or a looping oscillator. Four
outputs carry related versions of the same slope, and their relationship is
selectable: rhythmic ratios, phase offsets, staggered levels or harmonic
frequency ratios. A *Clock* input locks the frequency to an external clock.

Compared with *Function* (rise and fall set in seconds, one curve, phase or
length spread), Tidal is set by frequency, tracks 1 V/oct pitch, reaches audio
rate, has a smoothing/folding stage and four relation modes, and can follow a
clock at a ratio.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Trig | `gate` | *AD*: rising edge starts a slope. *AR*: high = rise and stay, low = fall. *Loop*: rising edge resets the phase. |
| Clock | `trigger` | When patched, the frequency follows the clock at *Ratio* (4.4). |
| Pitch | `pitch` | Added to *Frequency* in octaves (1 V/oct). Default amount 1, so it tracks exactly. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| A | `control` | The main slope. Unipolar 0…1 in *AD* and *AR*; follows *Polarity* in *Loop*. |
| B, C, D | `control` | Related slopes, as chosen by *Relation* and *Spread* (4.3). Same range as A. |
| Rise | `gate` | High while A rises. |
| End | `trigger` | A pulse when A finishes a cycle (Loop) or reaches 0 (AD, AR). |

At audio rate the outputs can be patched straight into audio inputs (`control`
→ `audio` passes unchanged, `specs.md` section 7.4).

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Frequency | depends on *Range* (exponential; Audio: exponential on each half, C4 at the centre) | 1 Hz (Medium) | Cycle rate. In *AD*/*AR* it sets the slope's total time, `1 / Frequency`. The knob is declared in the Medium range; the view relabels it for Slow and Audio, Sync and Clock (5). |
| Skew | 0–100 % | 50 % | Share of the cycle spent rising. 50 % is symmetric; 0 % a falling saw, 100 % a rising saw. |
| Curve | −1 … +1 | 0 | Bends both slopes (4.2). |
| Smooth | −1 … +1 | 0 | Below 0: low-pass rounding. Above 0: wavefolding (4.2). |
| Spread | −1 … +1 | 0 | How far B, C, D differ from A in the chosen *Relation*. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Mode | AD, Loop, AR | Loop |
| Range | Slow (0.001–1 Hz), Medium (0.02–50 Hz), Audio (8 Hz–8 kHz, centre C4) | Medium |
| Relation | Ratio, Phase, Level, Harmonic | Phase |
| Sync | Free, 8 bars … 1/32T (the shared note values, straight, dotted and triplet) | Free |
| Ratio | ÷16, ÷8, ÷6, ÷4, ÷3, ÷2, ×1, ×2, ×3, ×4, ×6, ×8, ×16 | ×1 |
| Polarity (shown in Loop) | Bipolar, Unipolar | Bipolar |

## 4. Behaviour

### 4.1 The slope

A phase `p` (0…1) advances by `f / sr` per sample, with
`f = Frequency × 2^(Pitch)` (Free), the synced rate, or the clock rate (4.4).
With `r` = *Skew* (limited to 0.5 %–99.5 % in Audio range, so there's never a
vertical jump):

```
raw(p) = p / r              while p < r     (rise)
       = (1 − p) / (1 − r)  otherwise       (fall)
```

Bipolar output is `2·shaped − 1`; unipolar is `shaped`.

### 4.2 Curve and Smooth

**Curve** morphs between four curves applied to `raw` (linear crossfades
between neighbours): −1 logarithmic `1 − (1−u)^4`, 0 linear, +0.5 cosine
`0.5 − 0.5 cos(πu)` (round, sine-like at Skew 50 %), +1 exponential `u^4`.

**Smooth < 0** passes the curved slope through a 2-pole low-pass whose cutoff
tracks the cycle frequency: `fc = f × 2^(7 × (1 + Smooth))` → at −1 the cutoff
equals `f`, turning any shape into a near-sine; near 0 it is transparent. The
filter's delay is compensated for *End* and *Rise*, which come from the
unfiltered phase. The filter lowers the level (at −1 a triangle keeps about
57 % of its swing), so in *Loop* each output's range is measured once per
cycle and the filtered curve is mapped back onto the unfiltered range (gain
1…8 and centre, gliding from cycle to cycle): a near-sine at full level. In
AD/AR there is no compensation; Smooth rounds and delays the envelope.

**Smooth > 0** folds: `x = (2·shaped − 1) × (1 + 5 × Smooth)`, reflected back
into −1…+1 as often as needed, then mapped back to 0…1 (`foldUnit` in
`dsp/Slope.h`). At +1, `x` sweeps −6…+6, so each slope is reflected six times
and the triangle's ends add a turning point each: seven peaks per cycle, a
bright, many-peaked contour at LFO rates and a harmonically rich tone at audio
rate. Folding is applied per output, on that output's slope, so every output
folds alike; *Level* (4.3) scales after the fold.

### 4.3 Relations

Outputs are numbered k = 0 (A) … 3 (D). `s` = *Spread*.

| Relation | B, C, D | At Spread 0 |
|---|---|---|
| **Ratio** | Rhythmic ratios that realign: *Spread* picks a ratio set; each output runs at its ratio of A's frequency, and all four reset together at their common period, so the pattern repeats. | all ×1 |
| **Phase** | Phase offsets: output k at `p + k·s/4` (negative s shifts backwards). At ±1: 0°, 90°, 180°, 270°. | identical |
| **Level** | Staggered levels: output k is A (after Smooth and Polarity) scaled by `1 − k·|s|/3`; for s < 0 odd k are also inverted (`−x` bipolar, `1 − x` unipolar before scaling): a "fan" that alternates. | identical |
| **Harmonic** | Frequency ratios: output k at `1 + k·s` × f for s ≥ 0 (at +1: ×1, ×2, ×3, ×4), `1 / (1 + k·|s|)` for s < 0 (undertones ×1, ×½, ×⅓, ×¼). In between the ratios are inharmonic, which beat slowly. | identical |

Ratio sets for *Ratio* (zone `round(|s| × 5)`, so |s| < 0.1 is all ×1 and
each set has an equal share of the knob; the sign chooses faster (+) or
slower (−) ratios):

| Zone | B | C | D | Repeats every |
|---|---|---|---|---|
| 1 | 2 | 3 | 4 | 1 cycle of A |
| 2 | 3/2 | 2 | 3 | 2 |
| 3 | 4/3 | 3/2 | 2 | 6 |
| 4 | 5/4 | 3/2 | 7/4 | 4 |
| 5 | 5/3 | 7/4 | 9/4 | 12 |

For negative *Spread*, the reciprocals (e.g. 2/3, 1/2, 1/3); they repeat
after the lcm of their denominators (zone 1: 1/2, 1/3, 1/4 every 12 cycles).

In *Harmonic* and *Ratio*, B…D are separate phase accumulators; a reset on
*Trig* (Loop) or a transport start resets them all. In *AD* and *AR* modes
*Ratio* and *Harmonic* scale the slope time: output k's envelope is
`1 / ratio` as long — an accent pattern from one trigger. *Phase* in AD/AR
delays the envelopes instead: output k's Trig edges arrive `k·|s|/4` of the
slope's length later (a cascade). *Level* scales as in Loop.

### 4.4 Timing: Free, Sync, Clock

- **Free:** `f = Frequency × 2^Pitch`, modulated per sample (FM is smooth).
- **Sync** (and no Clock): one cycle per sync value. With the transport
  playing, `p = frac(ppq / cycleBeats)` (Ratio-mode outputs derive from the
  same ppq, so the polyrhythm also locks to bars). Transport stopped: runs at
  the synced length and current tempo. *Frequency* is ignored; *Pitch* still
  shifts it, rounded to whole octaves so the lock holds (+1 = twice per sync
  value). *Trig* doesn't reset a locked cycle (the song position decides).
- **Clock patched:** the period `T` is the time between the last two pulses,
  smoothed over 4 pulses so a little jitter doesn't wobble the rate. The
  frequency is `Ratio / T`. For multiplications, the phase is set to 0 on every
  clock pulse (A starts each beat in step); for divisions, on every n-th pulse,
  counted from the first pulse after patching or Reset. A pulse that arrives
  more than 2 × T after the last one is treated as a new start (no wild rate
  after a pause). The first period after patching uses 0.5 s. *Frequency*
  and *Pitch* are ignored while the clock is patched. (`dsp::ClockLock`.)
- Clock overrides Sync; Sync overrides Frequency.

### 4.5 Modes

- **Loop:** cycles continuously. *Trig* rising edge resets `p` to 0.
- **AD:** idle at 0. *Trig* rising edge runs one cycle (rise then fall), from
  the current level (the phase jumps to where the rise reaches it), then stops;
  *End* fires. Retrigger during the fall restarts the rise.
- **AR:** rise while *Trig* is high, hold at 1, fall on the falling edge from
  wherever the level is. Rise time is `r / f`, fall time `(1 − r) / f`.
- In AD/AR with Clock or Sync, the times follow the clock or tempo.

### 4.6 Edge cases

- *Range* change re-maps *Frequency*'s normalised value into the new range;
  the cycle continues from the same phase.
- In Audio range, frequencies above `sr / 4` are clamped.
- Inside a Voice Cell, patch *Voice In › Pitch* to *Pitch* and use Audio range
  as a voice oscillator, or *Trig* from *Voice In › Gate* in AR mode for a
  per-voice envelope.

## 5. Module view

- A **scope** of all four outputs over two cycles of A (A bright, B–D in
  fading tints), so the relation is visible as you turn *Spread*. In AD/AR it
  shows one envelope.
- Under it, the knobs: Frequency (with a note name in Audio range, or the
  rate in Hz / bars), Skew, Curve, Smooth, Spread; then the settings.
- In *Ratio* mode the Spread knob's label shows the current set, e.g. *3/2 · 2 · 3*.
- With Clock patched, the Frequency knob shows the *Ratio* list instead and
  the measured BPM is shown under it.

## 6. Saved state

Only knob and setting values; no node data. The phase is runtime state and
survives recompiles (modules are reused by node id).

## 7. Engine requirements

- Dotted and triplet values in the shared note values (`dsp::noteValues()` in
  `Tempo.h`, done).
- The slope, curves, smoother/folder and clock follower in `dsp/Slope.h` (done).
- `liveValues`: `phase` of A for the scope's dot, `hz`, `clocked` and the
  measured `bpm`. The view computes the four traces from the knobs.

## 8. Tests

- Frequency: 2 Hz Loop gives exactly 2 *End* pulses per second; Pitch +1 doubles it.
- Skew: rise time = `r / f`; Skew 0 and 100 % give saws (in Medium range), limited in Audio range.
- Curve: values at u = 0.5 match the table for −1, 0, +0.5, +1.
- Smooth −1 on a square-ish contour (Curve −1) gives a peak-to-peak within 10 % of a full-scale sine of the same frequency, with a small 3rd harmonic; +1 folds a triangle into seven peaks per cycle.
- Relations: Phase ±1 gives quarter offsets; Harmonic +1 gives 1:2:3:4 cycle counts (−1: 12:6:4:3); Ratio zone 3 realigns every 6 cycles of A.
- Clock: ×4 gives 4 cycles per pulse and resets on each pulse; ÷3 resets every third pulse; a long pause doesn't produce a runaway rate.
- Sync with transport: `p = frac(ppq / cycleBeats)`; a loop jump returns the same values.
- AD from mid-level retrigger: no discontinuity; AR fall starts from the current level.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Band-limited corners (polyBLAMP) for cleaner audio-rate use.
- A *Quantize* option for Harmonic ratios (only integer ratios).
- Per-output *Smooth* and a stereo audio out pairing A and B.
- An *Unwrap* mode: four independent envelopes started by four rotating triggers.
