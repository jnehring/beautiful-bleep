# Rhythm Bank

Type id `rhythm-bank` · category *Sequencing* · colour proposal `#f08a5d`

## 1. Purpose

Four related rhythms from a number. A *Family* chooses how the rhythms are
built (even spacing, primes, metric levels, polyrhythms, interlocking parts,
seeded grooves); a *Pattern* knob picks one of 128 numbered patterns in that
family, and all four outputs change together, as parts of one groove. Turning
*Pattern* browses grooves instead of editing steps; modulating it with a slow
LFO or a Random makes a drum part that develops over a song and renders the
same every time. Per-output rotation and mute, and a *Complement* mode where
outputs fill each other's gaps, shape the result.

Rhythm Bank is for **browsing**: nothing is drawn or stored per step. The
*Drum Grid* is for writing patterns by hand; the planned *Clock* module sets
up each output's rhythm individually (one Euclidean pattern, probability,
swing). Rhythm Bank generates the four outputs **together**, so they relate.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Clock | `trigger` | Each pulse advances one step. Unpatched: steps follow the transport at *Rate* (4.3). |
| Reset | `trigger` | The next step played is step 1. |

Every knob is also an input (`specs.md` section 7.3). *Pattern* is the one to
modulate.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out 1 … Out 4 | `gate` (or `trigger`, see *Output*) | The four rhythms, after rotation, mute and *Complement*. Out 1 is the strongest part (think kick), Out 4 the busiest. |
| Any | `gate` | High while any of Out 1–4 is high. |
| Accent | `gate` | High on steps where two or more unmuted outputs hit **before** *Complement* is applied (so it still marks coincidences in Complement modes). |
| Cycle | `trigger` | A pulse when the pattern wraps to step 1. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Pattern | 0–127 (integer) | 0 | The pattern number within the family (4.2). Rounded after modulation. |
| Rotate 1 … Rotate 4 | −16…+16 steps (integer) | 0 | Delays (positive) or advances one output's rhythm, modulo *Length*. |
| Width | 1–100 % of a step | 50 % | Gate length. Ignored in *Trigger* mode. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Family | Even, Prime, Metric, Poly, Interlock, Seeded | Even |
| Length | 2–32 steps, or Open (a choice) | 16 |
| Rate | as the Step Sequencer's *Rate* (1/1 … 1/32, dotted, triplet) | 1/16 |
| Complement | Off, Avoid, Fill, Pairs | Off |
| Change | Step, Cycle | Cycle |
| Grid | Snap, Free (Poly family only) | Snap |
| Mute 1 … Mute 4 | on / off | off |
| Output | Gate, Trigger | Gate |

## 4. Behaviour

### 4.1 Notation

`L` is *Length*, `i` = 0…L−1 the step, `P` the pattern number, `j` = 1…4 the
output. `E(k, n)` is the even ("Euclidean") distribution of `k` hits over `n`
slots: slot `m` is a hit when `(m · k) mod n < k`. `E(3, 8)` = `x..x..x.`.

**Metric strength** `s(i)`: split `L` into its prime factors in ascending order
`f₁ ≤ f₂ ≤ …` and build the chain `m₀ = L`, `mₜ = mₜ₋₁ / fₜ` down to 1. `s(i)`
is the number of chain members that divide `i`. For L = 16: step 0 → 5, 8 → 4,
4 and 12 → 3, even steps → 2, odd steps → 1. For L = 12 (chain 12, 6, 3, 1):
step 0 → 4, 6 → 3, 3 and 9 → 2, the rest → 1. `S = s(0)` is the maximum.

With *Length* = *Open*, steps are not wrapped: `i` is the song step count
(4.3). Families that need a cycle (Even, Metric, Poly, Interlock, Seeded) use
a cycle of 16 steps then; Prime runs fully open and repeats only at the lcm of
its primes.

### 4.2 Families

Each family is a function `(P, j, L) → hits`. `a = P mod 16`, `v = floor(P / 16)`
(0–7) unless stated otherwise. Neighbouring pattern numbers are related: in
most families `a` sets the density and `v` the relation between the outputs.

**Even.** Base density `k₀ = 1 + round(a · (L − 1) / 15)`. Output j plays
`E(kⱼ, L)` rotated by `rⱼ` steps, with `v` choosing the relation:

| v | Name | kⱼ (j = 1…4) | rⱼ |
|---|---|---|---|
| 0 | Canon | k₀, k₀, k₀, k₀ | 0, L/4, L/2, 3L/4 |
| 1 | Ladder | k₀, k₀+1, k₀+2, k₀+3 | 0 |
| 2 | Halves | k₀, ⌈k₀/2⌉, 2k₀, 4k₀ | 0 |
| 3 | Mirror | k₀, L−k₀, ⌈k₀/2⌉, L−⌈k₀/2⌉ | 0, 1, 0, 1 |
| 4 | Offbeat | k₀, k₀, 2k₀, 2k₀ | 0, ⌊L/(2k₀)⌋, 0, ⌊L/(4k₀)⌋ |
| 5 | Sparse | ⌈k₀/3⌉, ⌈k₀/2⌉, k₀, 2k₀ | 0, L/2, 0, 1 |
| 6 | Pulse | 1, 2, k₀, L | 0, L/2, 0, 0 |
| 7 | Spread | k₀, k₀+2, k₀+4, k₀+6 | 0, 1, 2, 3 |

All k are clamped to 1…L, rotations rounded down.

**Prime.** The primes `Q = {2, 3, 5, 7, 11, 13}`. `P mod 15` selects one of the
15 four-element subsets of Q (lexicographic order: 0 = {2,3,5,7}, 14 =
{5,7,11,13}), assigned ascending to Out 1–4. `u = floor(P / 15) mod 8` is the
offset scheme: output j hits on steps where `(i + u · j) mod qⱼ = 0`. Inside a
finite *Length* each output restarts at step 0, so a /5 in 16 steps plays 0, 5,
10, 15; with *Open* the primes drift against each other. P 120–127 repeat
P 0–7.

**Metric.** Hits follow the metric strength. `a` sets the levels:
`ℓⱼ = clamp(S − (j − 1) · g − o, 1, S)` with spacing `g = 1 + floor(a / 8)` and
density offset `o = a mod 8`. The three bits of `v` switch Out 2, 3, 4 (bit 0,
1, 2) from *at or above* to *exactly*:

- *at or above*: hit where `s(i) ≥ ℓⱼ` (the level and everything stronger);
- *exactly*: hit where `s(i) = ℓⱼ` (the off-beats of the level above).

So P 0 is kick on 1, snare on 1 and 3, hats on quarters, eighths for Out 4;
P 16 moves Out 2 to beat 3 only, P 32 moves Out 3 to beats 2 and 4
(the backbeat). Short lengths with few levels clamp and
can make neighbouring numbers equal.

**Poly.** (Two hits falling into one step keep the first.) Each output plays `nⱼ` evenly spaced hits per cycle of `L` steps,
not tied to the step grid. The table is all ascending four-number
combinations of {2, …, 9}, sorted by their lcm, then lexicographically, and
keeping the 64 simplest of the 70: index `P mod 64` (0 = {2,3,4,6}, lcm 12;
the six dropped have lcm 630–2520). `h = floor(P / 64)` places hits on the beat (`h = 0`, hit m at
`m / nⱼ` of the cycle) or half a spacing late (`h = 1`, at `(m + ½) / nⱼ`).
*Grid* = *Free* plays each hit at its exact time (derived from the song
position, so it is sample-accurate and repeatable); *Snap* rounds it to the
nearest step.

**Interlock.** Parts that never collide. Out 1 plays
`E(k₁, L)` with `k₁ = 1 + round(a · (L/2 − 1) / 15)`. Let `G₁` be the steps
Out 1 leaves free, in order. Out 2 plays `E(⌈ρ₂ · |G₁|⌉, |G₁|)` laid over `G₁`
(the m-th free step is a hit when the distribution's slot m is). Out 3 does the
same over the steps still free (`G₂`) with `ρ₃`. Out 4 takes all of `G₃` (v
even) or `E(⌈|G₃|/2⌉, |G₃|)` over it (v odd). `ρ₂, ρ₃` per `floor(v / 2)`:
(½, ½), (⅓, ½), (⅔, ⅓), (¼, ⅔).

**Seeded.** Weighted random grooves; `P` is the seed (neighbours are not
related here). Each output has a density `δ = (0.30, 0.20, 0.45, 0.35)` and a
metric preference `γ = (2, 1, 0.5, 0)`. The weight of step i is
`wⱼ(i) = (s(i) / S)^γⱼ`; the hit probability is
`pⱼ(i) = min(1, δⱼ · L · wⱼ(i) / Σᵢ wⱼ(i))`, and step i hits when
`uniform01(P, i, j) < pⱼ(i)` (the counter-based random of `Random.h`). Out 1
always hits step 0.

### 4.3 Timing

Exactly the Step Sequencer's model (`step-sequencer.md` 4.2): in transport
mode `step = floor((ppq − off) / stepLength)`, `i = step mod L`, phase-locked
to the bars and correct after a loop jump; in clock mode each pulse is one
step and gate lengths use the measured step duration. Reset works the same.
When the transport stops, all gates fall.

*Poly* with *Grid* = *Free* in clock mode places a hit at fraction `f` inside a
step `f · T` after that step's pulse (`T` the measured duration), so hits can
be late by the tempo drift of one step; *Snap* avoids this.

### 4.4 Rotation, mute and complement

Applied per step in this order:

1. Generate the four raw rhythms (4.2).
2. **Rotate:** output j plays raw step `(i − Rotate j) mod L`.
3. **Mute:** muted outputs are empty (they no longer count below).
4. **Accent** is computed here (≥ 2 hits on the step).
5. **Complement**, over the unmuted outputs in order 1 → 4:
   - *Off*: unchanged.
   - *Avoid*: an output hits only where no lower-numbered output hits.
     Patterns stay recognisable but never collide (a choke group).
   - *Fill*: outputs as *Avoid*, except the highest unmuted output, which
     plays **every** step no other output plays. The four parts add up to a
     continuous stream of steps.
   - *Pairs*: Out 2 = every step Out 1 doesn't play, Out 4 = every step Out 3
     doesn't play (their own rhythms are ignored). Two call-and-response pairs.

With Poly in *Free* grid, collisions are judged by the step each hit falls in;
the hit still plays at its exact time.

### 4.5 Pattern changes

*Change* = *Cycle* (default): a new *Pattern* (or *Family*, *Length*,
*Complement*, *Grid*) takes effect at step 1 of the next cycle (judged on the
old Length; *Open*: every 16 steps); a slow modulator then switches grooves
on the bar. *Step*: it takes effect at the next step. Rotate and Mute always
apply at the next step. A gate already high finishes its *Width*; a hit on an
output that is still high drops it for one sample so every hit is a new rise.
*Cycle* fires at every step 1, the first one included.

## 5. Module view

The usual knobs and settings, with a **pattern display** above them: four rows
(one per output) by *Length* columns, hits as blocks, muted rows dimmed, the
playhead highlighted, and Accent steps marked under the grid. Poly hits in
*Free* grid are drawn at their exact horizontal position. A large pattern
number with ◀ ▶ buttons (one undo step each) and the family name sit on the
left; when *Change* = *Cycle* and a change is pending, the next pattern is
drawn ghosted. Clicking a row's label toggles its mute.

## 6. Saved state

Only knob and setting values; no node data. Patterns are fully defined by
(Family, Pattern, Length), so a board shared between machines plays the same.

## 7. Engine requirements

None beyond what exists: transport position (the shared `SeqClock`),
`Random.h` (`uniform01`) and `liveValues` / `liveArrays` (step, four gate
states, active and pending pattern, the playing rows and Accent row). The audio
thread computes a pattern itself when a change applies (every family is O(L)
per output, no allocation); the two small tables (Prime subsets, Poly sets) are
built when the module type registers. The view's rows are computed on the
message thread from the active pattern.

## 8. Tests

- Every family: for a table of (Family, P, L), the four rows equal hand-checked
  strings (`E(3,8)` = `x..x..x.`; Metric P 0 at L 16; Prime {2,3,5,7};
  Interlock outputs never overlap).
- Every family and P 0–127 at L 2…32: no crash, no allocation, deterministic
  (two computations identical).
- Metric strength for L = 16, 12, 7 matches 4.1.
- Poly *Free*: hits land on the exact samples of `m / n` of the cycle; *Snap*
  rounds to the nearest step.
- Rotation (positive and negative, modulo L), Mute, and every Complement mode
  against small examples; Fill covers every step exactly once.
- Accent ignores Complement and muted outputs.
- Change = Cycle applies a modulated Pattern exactly at step 1.
- Transport mode lands on the right steps after a loop jump; clock mode and
  Reset as in the Step Sequencer tests.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Favourites per family (node data) and a *Favourite* knob that browses only
  those.
- Velocity / accent outputs per row from metric strength.
- *Send to Drum Grid*: copy the current pattern into a Drum Grid slot.
- A *Density* knob that thins or thickens every family (probability per hit,
  seeded).
- More families (rhythmic necklaces, ternary feels for triplet rates).
