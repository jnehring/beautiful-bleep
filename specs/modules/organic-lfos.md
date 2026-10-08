# Organic LFOs

Type id `organic-lfos` · category *Modulation* · colour proposal `#bef264`

## 1. Purpose

Eight slow LFOs that move like a group of living things: related, but never
quite in step. One *Rate* sets the pace, *Spread* fans the eight rates apart,
and a seeded *Drift* lets each one wander a little in speed and shape, so the
pattern never lines up exactly and never sounds mechanical. *Twist* morphs all
eight waves from soft plateaus through sines to sharp, lopsided peaks. Each
LFO has its own output and a *Sum* mixes them into one complex contour. The
master rate can lock to the song's bars, and because the drift is seeded,
every render is the same.

The planned *Drift* module is chaotic (coupled equations, no period at all);
Organic LFOs are periodic oscillators with gentle, reproducible imperfections,
and give eight outputs from three knobs. *Quad LFO* and *Six Slopes* relate
their channels by exact ratios; here the relations are deliberately inexact.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Reset | `trigger` | Restarts all eight at their scattered start phases (4.4). |

Every knob is also an input (`specs.md` section 7.3). Modulating *Rate* moves
the whole group; modulating *Spread* opens and closes the fan.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out 1 … Out 8 | `control` (follows *Polarity*) | The eight LFOs, slowest to fastest (for Spread ≥ 0). |
| Sum | `control` (follows *Polarity*) | The eight mixed and soft-limited (4.5). |
| Max | `control` (follows *Polarity*) | The highest of the eight at each moment: a restless upper contour. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Rate | 0.002–20 Hz (exponential, centre 0.2 Hz); a note value with *Lock* | 0.2 Hz | Rate of LFO 1, the anchor. |
| Spread | −1 … +1 | +0.5 | Fans the rates: + makes LFOs 2–8 faster, − slower (4.1). |
| Drift | 0–100 % | 30 % | How much each LFO wanders in rate and shape. 0 % is exact and mechanical. |
| Twist | −1 … +1 | 0 | Wave shape: −1 soft plateau, 0 sine, +1 sharp, lopsided peak (4.3). |
| Scatter | 0–100 % | 100 % | Spread of start phases after a Reset or transport start. |
| Level | 0–100 % | 100 % | Output scale of all outputs. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Lock | Free, Bars | Free |
| Anchor | On, Off | On |
| Polarity | Bipolar, Unipolar | Bipolar |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Rates

`f_k = f_1 × 2^(Spread × 4 × g_k)` for k = 1…8, with
`g_k = (k − 1) / 7 + j_k`, where `j_k` is a seeded offset in ±0.03
(`j_1 = 0`, from `uniform01(Seed, k, stream 1)`). At Spread +1 LFO 8 runs
about 16× as fast as LFO 1; at 0 all eight share the rate (and only drift and
start phases tell them apart); at −1 LFO 8 is 16× slower. The jitter keeps the
ratios irrational, so no two channels fall into a simple, repeating relation.

### 4.2 Drift

Each LFO k has two slow, seeded noise curves: `n_k(t)` for rate and `m_k(t)`
for shape, each a cubic interpolation of `uniform01(Seed, i, stream)` values
placed every `8 / f_k` seconds (rate) and `13 / f_k` (shape) — so a fast LFO
drifts faster than a slow one, always at a few-cycle timescale.

- **Rate drift:** `f_k' = f_k × 2^(Drift × 0.35 × n_k(t))`, n in −1…+1: at
  100 % between about −21 % and +27 %.
- **Shape drift:** `Twist_k = clamp(Twist + Drift × 0.25 × m_k(t), −1, 1)`.

With *Anchor* on, LFO 1 has no rate drift (shape drift only), so it can stay
locked to the bars while the others float around it.

### 4.3 Twist

With `p` the phase and `t` = Twist_k:

- `t ≥ 0`: the phase is skewed so the rise takes `0.5 − 0.4·t` of the cycle,
  then `x = sin(2π·p')` and `y = sign(x)·|x|^(1 + 2t)`: a fast rise to a
  narrow peak and a long, lazy fall.
- `t < 0`: `x = sin(2π·p)`, `y = tanh(g·x) / tanh(g)` with `g = 1 + 5|t|`: a
  rounded plateau, almost a soft square at −1.

*Unipolar* maps `0.5 + 0.5·y`; *Level* scales after that (towards 0).

### 4.4 Timing, lock and reset

- **Free:** each phase accumulator advances by `f_k' / sr` per sample.
  The noise curves run on the module's own sample counter (counted from the
  last Reset or transport start), so with the same Seed the same patch moves
  the same way every time it is rendered from the same start.
- **Lock = Bars:** *Rate* picks a note value for LFO 1 (1/4 … 64 bars, with
  dotted and triplet values). While the transport plays, everything is a
  function of the song position, so it's seekable and survives loop jumps:
  - LFO 1: `p_1 = frac(ppq / beats)` (+ its scatter offset);
  - LFO k: `p_k = frac(ppq × r_k / beats + s_k + Drift × 0.5 × D_k(ppq))`
    with `r_k = 2^(Spread × 4 × g_k)`, `s_k` its scatter offset, and `D_k`
    a seeded noise curve in song time (cubic, one point every 8 cycles of
    LFO k). Rate drift becomes a phase drift in this mode, which is how it
    stays a pure function of `ppq`.
  - Transport stopped: runs free at the current tempo from where it was.
- **Start phases:** `s_k = Scatter × uniform01(Seed, k, stream 3)`; LFO 1's
  is 0 with *Anchor* on. *Reset* and transport start set every phase to
  `s_k` and restart the noise clocks. With Lock = Bars and the transport
  playing, Reset only restarts the noise clocks.
- Changing *Seed* changes the jitter, the drift and the scatter; the switch
  crossfades over 50 ms.

### 4.5 Sum and Max

`Sum = tanh(1.4 × Σ y_k / √8) / tanh(1.4)` (bipolar values, before
*Polarity*), so eight unrelated waves give a full but not clipped contour;
then *Polarity* and *Level*. `Max = max_k(y_k)`, likewise mapped. Max is
always ≥ the average, so in Bipolar it mostly stays in the upper half; use it
unipolar for brightness or density controls.

### 4.6 Edge cases

- Rates are clamped to 0.002–50 Hz after spread and drift.
- Inside a Voice Cell each voice runs its own eight LFOs with the same seed;
  add *Voice In › Random* to *Rate* or *Twist* for different movement per
  voice, or leave the module outside the cell and share its outputs.

## 5. Module view

- **Eight-trace scope** over the last 4 cycles of LFO 1 (scrolling), one
  tint per LFO, with the Sum as a thicker line on top. The scope makes drift
  visible: traces that were aligned slowly part.
- A **rate strip** above it shows each LFO's live rate as a tick on a log
  axis, so you see the fan open with *Spread* and the ticks wobble with
  *Drift*.
- Knobs and settings below; with Lock = Bars the Rate knob shows note values.

## 6. Saved state

Only knob and setting values; no node data. Phases and noise clocks are
runtime state and survive recompiles (modules are reused by node id).

## 7. Engine requirements

- A cubic-interpolated seeded noise helper in `patch/common/dsp/Random.h`
  (Random's *Smooth* and the planned Drift module can use it).
- Note values up to 64 bars in the shared sync list.
- `liveValues`: the eight live rates for the rate strip.

## 8. Tests

- Drift 0, Spread 0, Scatter 0: all eight outputs identical.
- Spread +1, Drift 0: LFO 8 / LFO 1 rate is `2^(4 × (1 + j_8))`; no two channels have a rational ratio with denominator ≤ 16 (checked numerically).
- Drift: rates stay within −21 % … +27 % at 100 %; with Anchor on, LFO 1's rate is exact.
- Reproducibility: two renders from the same start with the same Seed are bit-identical; a different Seed differs.
- Lock = Bars: LFO 1 phase equals `frac(ppq / beats)`; seeking to a song position gives the same outputs as playing to it.
- Twist: −1, 0, +1 values at quarter phases match the formulas; outputs stay in range.
- Sum stays within ±1; Max ≥ every output.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Per-channel level trims and a *Tilt* across the eight.
- *Gravity*: a control that pulls the drifting LFOs gently back into phase (weak coupling).
- A *Stereo Sum* pair (odd LFOs left, even right).
- More channels (16) for large ambient patches.
