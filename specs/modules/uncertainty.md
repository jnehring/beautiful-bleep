# Uncertainty

Type id `uncertainty` · category *Modulation* · colour proposal `#db2777`

## 1. Purpose

A bank of six random generators in one module, each a different kind of
randomness: two **Fluctuating** voltages that wander continuously, two
**Quantized** voltages that jump between 2, 4, 8 or 16 levels, a **Stored**
value whose distribution you can skew and whose successive values you can
correlate, and an **Integrated** voltage that turns the stored values into
random slopes. One module covers most of a patch's "something should move
unpredictably here" needs.

It differs from *Random*: Random is one stepped generator built around a
looping memory. Uncertainty has no loops; it is about the **character** of
randomness: continuous versus stepped, the number of levels, the shape of the
distribution and how much each value depends on the last.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Clock Q1 | `trigger` | Each pulse steps Quantized 1. Unpatched: *Q Rate*. |
| Clock Q2 | `trigger` | Each pulse steps Quantized 2. Unpatched: normalled to Clock Q1 (and Q1's internal clock, divided by *Q2 Divide*). |
| Store | `trigger` | Each pulse takes a new Stored value. Unpatched: *Store Rate*. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Fluct 1, Fluct 2 | `control` (bipolar) | Continuously varying random voltages (4.1). |
| Quant 1, Quant 2 | `control` (unipolar) or `pitch` | Stepped random on 2ⁿ levels (4.2). |
| Stored | `control` (bipolar) | The stored random value (4.3). |
| Integrated | `control` (bipolar) | Random slopes from the stored values (4.4). |
| Store Trig | `trigger` | A pulse when Stored takes a new value. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| F1 Rate, F2 Rate | 0.01–20 Hz (exp.) | 0.5 Hz, 0.17 Hz | Average rate of change of each Fluctuating output. |
| F1 Spread, F2 Spread | 0–100 % | 100 % | Amplitude of each Fluctuating output. |
| Q Rate | 0.05–40 Hz (exp.) | 2 Hz | Internal clock of Quantized 1 when *Q Sync* is *Free*. |
| Store Rate | 0.05–40 Hz (exp.) | 1 Hz | Internal clock of Stored when *Store Sync* is *Free*. |
| Distribution | −100…+100 % | 0 % | Skews Stored toward low (−) or high (+) values (4.3). |
| Correlation | −95…+95 % | 0 % | How much each Stored value depends on the previous one (4.3). |
| Integrate | 0.01–10 /s (exp.) | 0.5 /s | Slope scale of the Integrated output (4.4). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| F Sync | Free, 1/16 … 8 bars (shared list) | Free |
| Q Sync, Store Sync | Free, 1/32 … 8 bars (shared list) | 1/8, 1/4 |
| Q1 Bits, Q2 Bits | 1–4 (2, 4, 8, 16 levels) | 3, 2 |
| Q1 Interval, Q2 Interval | Even, 1, 2, 5, 7, 12 semitones | Even |
| Q2 Divide | 1, 2, 3, 4, 8 | 2 |
| Shape | Uniform, Bell, Edges | Uniform |
| Seed | 0–999 | 1 |

Each generator uses its own random stream of the one *Seed*.

## 4. Behaviour

### 4.1 Fluctuating

Each Fluctuating output is a smooth curve through random points:

- **Free:** point `j` lies `T · (0.5 + uniform01(Seed, j, s_t))` after point
  `j − 1`, with `T = 1 / Rate`. The irregular spacing avoids the regular
  pulse of a plain smoothed random. Point values are
  `Spread · (2 · uniform01(Seed, j, s_v) − 1)`.
- **Synced (transport playing):** points sit on the grid,
  `j = floor(ppq / syncBeats)`, so the curve is a pure function of the
  song position and two Fluctuating outputs synced to 1 bar and 4 bars move in
  musical proportion.

The curve between points is a Catmull-Rom spline (continuous slope, no
corners), clamped to ±1. Changing *Rate* while running stretches the current
segment; it never jumps.

Fluct 1 and Fluct 2 are independent, with different default rates so that,
patched to two destinations, they rarely move together.

### 4.2 Quantized

On each clock, Quantized `q` takes `level = floor(u · 2^Bits)` (0 … 2^Bits − 1)
from a fresh uniform `u`, and outputs:

- *Interval Even:* `level / (2^Bits − 1)`, so 1 bit gives 0 or 1 (a random
  gate-like voltage), 4 bits give 16 even levels in 0…1.
- *Interval n semitones:* `level · n / 12` (1 V/oct), so 3 bits with
  *Interval 7* jumps between 8 notes a fifth apart (stacked fifths), 2 bits
  with *Interval 12* between four octaves. The output is clamped to ±10.

Quantized 2 has its own *Bits* and *Interval*; its clock is Clock Q2, or
Q1's clock divided by *Q2 Divide*. A division of 2 with 1 bit gives a slow
random flip-flop next to Q1's faster melody.

Unlike Random's *Semitones*, the number of levels is part of the sound: few
levels give a small, repeated vocabulary that the ear hears as a pattern.

### 4.3 Stored

On each Store event the module draws a new value. Successive values are made
in a Gaussian domain, so *Correlation* changes the sequence without changing
the overall distribution:

```
z_k = c · z_{k−1} + √(1 − c²) · n_k     // n_k: standard normal (Box–Muller, seeded)
u_k = Φ(z_k)                             // back to uniform 0…1
```

- *Correlation* 0 %: independent values.
- Positive: each value stays near the last; at +95 % the sequence becomes a
  slow, stepped wander.
- Negative: values alternate high and low; at −95 % it zig-zags.

Then *Shape* and *Distribution* turn `u` into the output:

- **Shape:** *Uniform* uses `u`; *Bell* concentrates values around the centre
  (inverse of a smooth-step on `u`); *Edges* pushes them outward (smooth-step).
- **Distribution:** `u' = u^γ`, `γ = 4^(−Distribution)`; +100 % crowds values
  near the top, −100 % near the bottom.
- **Stored** = `2u' − 1`.

To keep it a pure function, `z_k` is defined as the truncated sum
`√(1 − c²) · Σ_{j=0..511} c^j · n_{k−j}` (the error against the endless sum is
below 10⁻¹¹ for |c| ≤ 0.95). The running recursion produces the same values
during playback; on a seek the module evaluates the sum directly.

### 4.4 Integrated

Integrated treats each Stored value as a **slope**: per sample,
`I += Stored · Integrate · dt`, and when `I` passes ±1 it reflects back
(folds). The result is a piecewise-linear line that changes direction and
speed at every Store event: rising, falling, levelling off. With a positive
*Correlation* the slopes persist and the line makes long sweeps; with a
negative one it trembles around a point.

On transport start `I` starts at 0. On a jump it is rebuilt by integrating the
last 64 Store intervals from 0, so a render from a given start is always the
same.

### 4.5 Timing and determinism

Clocks follow the usual order: input patched, then transport-locked sync,
then free rate. Every fresh value is `uniform01(Seed, index, stream)`, with
the index from the song position when synced, or a counter from the last
transport start otherwise. Fluct (synced), Quantized and Stored are pure
functions of the song position and render identically from any start;
Integrated and free-running Fluct are identical from the same start. On
transport stop all outputs hold, and free-running Fluct keeps moving.

## 5. Module view

Six small lanes, one per output, each a 4-second scope of its output. Next to
*Stored*, a histogram of the current *Shape* and *Distribution* (computed
analytically) with a marker at the current value, and a scatter plot of the
last 64 pairs (value, next value), which shows *Correlation* as a diagonal
cloud (positive) or an anti-diagonal one (negative). Next to each Quantized
lane, its levels as horizontal lines, labelled with note names when
*Interval* is in semitones.

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

1. **Shared helpers in `patch/common/dsp/`:** a seeded standard normal
   (`normal(seed, index, stream)` from two uniforms) and Φ (via `erfc`), next
   to `Random.h`. Recall and later modules can use them too.
2. **Live values** (exists) for the scopes and the scatter plot.
3. **Inside Voice Cells:** each voice runs its own generators with
   `stream + voice index`. Patch *Voice In › Trigger* into *Store* for a
   skewed, correlated per-note random value (unlike *Voice In › Random*,
   which is plain uniform).

## 8. Tests

- Fluct: continuous (no step above the slope limit), within ±Spread, synced
  curve equal for two renders and after a loop jump; average point spacing
  ≈ 1 / Rate in free mode.
- Quantized: only `2^Bits` distinct values appear; all levels appear over 10,000
  steps; Interval 7 with 3 bits outputs multiples of 7/12; Q2 Divide 2
  steps Q2 on every second Q1 step.
- Stored: Correlation 0 → lag-1 correlation ≈ 0; +90 % → ≈ +0.9 (in the z
  domain); −90 % → ≈ −0.9. The histogram of `u` stays uniform for every
  Correlation. Distribution +100 % moves the mean up; Bell/Edges shift mass
  as documented.
- Seek: Stored at index k computed directly equals the value after playing
  0…k (within 10⁻⁹).
- Integrated: stays within ±1; slope equals `Stored · Integrate` between
  events; same start → identical output.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- A *Link* control that blends Fluct 2 toward Fluct 1 (partly shared movement).
- Quantized levels from a scale instead of an interval.
- Sample & hold of an external signal into *Stored*, with the same shaping.
