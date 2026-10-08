# Recall

Type id `recall` · category *Sequencing* · colour proposal `#e11d48`

## 1. Purpose

A random rhythm and melody generator in two sections that share one clock.
**T** makes random gates: coin tosses between two outputs, random divisions
and ratchets, or drum-like patterns weighted by the bar. **X** makes three
random voltages whose distribution you shape (width, skew) and whose steps
you take from smooth glides to notes of a scale. Each section has a
**Recall** knob that makes it repeat its own recent past: from always new,
through "variations on what just happened", to a locked loop that you can
capture into the board.

It differs from *Random*: Random is one stepped value whose loop is a fixed
function of the seed and the song position. Recall remembers what you
**just heard** (the last N decisions), works on gates as well as voltages,
stores the raw random numbers rather than the shaped results (so a locked
loop can still be re-shaped live), and keeps separate memories for rhythm and
pitch.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Clock | `trigger` | Each pulse is a tick. Unpatched: the internal clock follows the transport at *Rate*. |
| Reset | `trigger` | The next tick is tick 0 (loops restart at their first slot). |
| X Clock | `trigger` | When patched and *X Source* is *External*, each pulse draws new X values. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| T1, T2 | `gate` | The random gates (4.2), *Gate Length* long. |
| Clock | `trigger` | The master tick (internal or external), unaffected by *Jitter*. |
| X1, X2, X3 | `control` (or `pitch`, see *X Range*) | The random voltages (4.3). |
| X Trig | `trigger` | A pulse whenever X values are drawn. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| T Bias | 0–100 % | 50 % | Coin: chance of T1 vs T2. Ratchet: divisions (left) vs multiplications (right). Drums/Chance: density. |
| T Jitter | 0–100 % | 0 % | Random delay of each T gate, up to ½ tick at 100 %. |
| T Recall | 0–100 % | 0 % | Chance that a tick repeats the decision from *T Loop* ticks ago (4.4). |
| Gate Length | 1–100 % of a tick | 50 % | Length of T1 and T2 gates (of each sub-pulse when ratcheting). |
| X Spread | 0–100 % | 60 % | Width of the X distribution (4.3). |
| X Bias | 0–100 % | 50 % | Skew: values pulled down (left) or up (right). |
| X Steps | 0–100 % | 50 % | Left half: smooth to stepped; right half: quantized, ever coarser (4.3). |
| X Recall | 0–100 % | 0 % | As *T Recall*, for the X values. |
| Rate | 0.1–40 Hz (exp.) | 4 Hz | Tick rate when *Sync* is *Free* and Clock is unpatched. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Sync | Free, 1/32 … 1/1 straight, dotted and triplet (the Step Sequencer's *Rate* list), 2 bars | 1/16 |
| T Mode | Coin, Chance, Ratchet, Drums | Coin |
| T Loop | 1–16 ticks | 8 |
| X Source | Tick, T1, T2, External | Tick |
| X Mode | Independent, Sorted | Independent |
| X Range | Bipolar (−1…+1), Unipolar (0…1), Wide (−2…+2) | Bipolar |
| X Loop | 1–16 draws | 8 |
| Root | C … B | C |
| Scale | the shared scale list (`patch/common/dsp/Scales.h`) | Major |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Clock

Ticks come from *Clock* if patched, else from the transport: with the
transport playing, `tick = floor(ppq / tickBeats)`, phase-locked to the bars;
stopped, the clock runs at the synced length and the current tempo (or at
*Rate* when *Sync* is *Free*). The tick duration (needed for *Jitter*,
*Gate Length* and ratchets) is known in transport mode; in Clock mode it is
the last measured period (first: 1/16 at the current tempo).

### 4.2 T section

On every tick the section takes a **decision**: four raw uniforms `u0…u3`
(fresh or remembered, 4.4). *T Mode* turns them into gates:

| Mode | T1 | T2 |
|---|---|---|
| Coin | fires if `u0 < Bias` | fires otherwise: exactly one of the pair per tick |
| Chance | fires if `u0 < Bias` | fires if `u1 < Bias` (independent) |
| Ratchet | `u0` picks a rate from ÷4, ÷3, ÷2, ×1, ×2, ×3, ×4, weighted toward divisions left of 50 % *Bias* and multiplications right of it; a division fires on the first tick of its group | same with `u1` |
| Drums | fires if `u0 < Bias × w_kick(pos)` | fires if `u1 < Bias × w_snare(pos)` |

In *Drums*, `pos` is the tick's position in a 16-tick bar and the weights
come from a fixed metric table: `w_kick` is high on 1 and 9, medium on 5 and
13, low elsewhere; `w_snare` is high on 5 and 13, medium on the off-beat
eighths, low on the rest. At *Bias* 50 % you get a plain backbeat with
occasional ghost hits; higher fills in, lower thins out. (The weights are our
own table, listed in the implementation.)

**Jitter** delays each gate by `u2 × Jitter × ½ tick` (never early, so it
works in real time). Ratchet sub-pulses keep their spacing and are delayed
together. *Clock* is never jittered.

### 4.3 X section

X draws three values on each event of *X Source* (every tick, every T1 or T2
gate, or each pulse at *X Clock*). Each value starts from three raw uniforms.

**Spread** sets the distribution shape on −1…+1 around the centre:

- 0 %: every value is the centre.
- 0–50 %: a bell (mean of three uniforms, scaled by `2 × Spread`).
- 50–85 %: the bell widens into a uniform distribution.
- 85–100 %: values are pushed toward the edges (`sign(w)·√|w|`).

**Bias** skews it: `x = (v + 1) / 2`, `x' = x^γ`, `γ = 4^((0.5 − Bias) × 2)`,
`v' = 2x' − 1`. 50 % is neutral; 100 % crowds values at the top, 0 % at the
bottom. With Spread at 0 % it moves the constant itself.

**Steps**:
- 0–45 %: smooth. The output glides from the old to the new value with a
  cosine curve over `(45 % − Steps) / 45 %` of the time to the next event;
  at 0 % it glides over the whole interval, so X becomes a smooth random
  curve.
- 45–55 %: plain steps.
- 55–100 %: quantized to *Scale* relative to *Root* (1 V/oct). From 55 % to
  70 % all scale notes are allowed; above that, the scale's notes drop out in
  a fixed order (the 2nd, 6th, 4th, 7th, 3rd, 5th scale degree; for
  scales without seven notes, the outermost degrees first) until at 100 %
  only the root remains (octaves). Quantizing happens before the glide, so
  values stay in the scale.

**X Range** maps −1…+1 to the output: *Bipolar* as is, *Unipolar* to 0…1,
*Wide* to −2…+2 (±2 octaves when patched into a pitch input).

**X Mode** *Sorted* sorts the three values so X1 ≤ X2 ≤ X3: handy for chord
voicings and for "low, middle, high" modulation.

### 4.4 Recall (both sections)

Each section has a ring of its last *Loop* decisions (T: `u0…u3`; X: nine
uniforms). For each new decision at index `i`:

```
if uniform01(seed, i, repeatStream) < Recall:  use ring[i mod Loop]   // repeat
else:                                          ring[i mod Loop] = fresh(seed, i)
```

- 0 %: always new.
- 50 %: about half the decisions come from one loop ago, so the pattern keeps
  its shape while changing.
- 100 %: a locked loop of *Loop* decisions: exactly what was playing when the
  knob reached the top.

Because the ring holds **raw** decisions, *Bias*, *Spread*, *Steps*, *Scale*
and *T Mode* still act on a locked loop: lock a melody, then widen *Spread* or
change the scale, and it's the same contour, re-shaped.

Shortening *Loop* keeps the first slots; lengthening fills the new slots on
their first use.

### 4.5 Determinism, transport and seeking

- Fresh decisions are `uniform01(Seed, i, stream)` with separate streams for
  T, X and the repeat tests, so T and X never influence each other.
- The rings are history. On transport start, and on a jump (the tick index
  isn't the previous one + 1), each ring is rebuilt by replaying the decisions
  from tick 0 (or from the last 4,096 ticks) with the current Recall values.
  A render from the same start is always identical; one started later matches
  a full play-through unless a Recall knob was automated before that point.
- **Capture** (5) stores both rings in the node data and turns on
  *Use captured* for that section: the section then plays `ring[i mod Loop]`
  from the stored loop on every tick, ignoring Recall. That is fully
  position-independent: the found pattern is part of the board.
- Transport stop: T gates fall; X outputs hold.

## 5. Module view

```
 ┌──────────────────────────────────────────────────────────────┐
 │ T  ▮ ▯ ▮ ▮ ▯ ▮ ▯ ▮   (loop of 8, repeats ●, new ○)            │
 │    T1 ━ ━   ━     ━   T2   ━   ━ ━   ━     [Capture T] [◉ Use]│
 │ X  ⋰⋱⋰ X1 X2 X3 curves, last 32 draws, scale lines in grey    │
 │    distribution preview ▁▂▅▇▅▂▁          [Capture X] [◉ Use]  │
 └──────────────────────────────────────────────────────────────┘
```

- **T lane:** the last *T Loop* ticks with T1 and T2 hits; repeated decisions
  are marked ● and fresh ones ○, so you can see what Recall does.
- **X lane:** the three outputs over the last 32 draws, with the allowed scale
  notes as grey lines.
- **Distribution preview:** a histogram of the current Spread/Bias shape, drawn
  analytically (no audio data needed).
- **Capture T / Capture X** store the ring; **Use** toggles playback of the
  stored loop. One undo step each.

## 6. Saved state

```json
{
  "type": "recall",
  "params": { "tRecall": 0.0, "xSpread": 0.6, … },
  "data": {
    "t": { "use": false, "loop": [[0.12, 0.88, 0.40, 0.03], … ] },
    "x": { "use": true,  "loop": [[0.5, 0.21, 0.77, 0.9, 0.31, 0.02, 0.66, 0.45, 0.13], … ] }
  }
}
```

Each loop has up to 16 entries of 4 (T) or 9 (X) numbers in 0…1. Missing or
short loops are padded with values from `uniform01(Seed, slot, stream)`;
values are clamped to [0, 1). A new module has `use: false` and empty loops.

## 7. Engine requirements

1. **Node data** (exists) for the captured loops; the module copies the loops
   to the audio thread as the Step Sequencer does (try-lock hand-over).
2. **Live values** (exists): the view needs the current rings and which
   decisions were repeats. The ring is small (16 × 13 floats), so it goes
   through `liveValues` as a flattened list, or a proposed `liveData(json)`
   for structured values.
3. **Capture** reads the live rings in the view and writes `data`; no new
   engine call.
4. **Inside Voice Cells:** each voice runs its own section clocks and rings;
   fresh decisions use `stream + voice index`, so voices play different
   patterns from one patch.

## 8. Tests

- Transport mode: ticks land on the grid for every Sync value; a loop jump
  rebuilds the rings to the same state as playing through.
- Coin: exactly one of T1/T2 per tick; share of T1 ≈ Bias over 10,000 ticks.
- Chance: T1 and T2 independent (joint frequency ≈ Bias²).
- Ratchet: ×3 gives three evenly spaced pulses within a tick; ÷2 fires on
  every other tick of its group.
- Drums: at Bias 50 %, ticks 1 and 9 fire T1 more often than 3 and 11.
- Jitter never moves a gate earlier than its tick; Clock output is never late.
- Spread 0 % gives the constant; 100 % puts more than half the values beyond ±0.5;
  Bias moves the mean in the right direction.
- Steps: 0 % output is continuous; 50 % output is stepped; 100 % only roots.
  Quantized values are always in the scale.
- Recall 100 % repeats the last Loop decisions exactly; 0 % never uses the ring.
  Re-shaping a locked loop (Spread change) keeps the order of the X values.
- Sorted mode: X1 ≤ X2 ≤ X3 always.
- Captured loops play identically from any start position; data round-trips
  and broken loops load safely.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- A *Notes* output (X1 as pitch, T1 as gate) for Voice Cells.
- A third T output and more T modes (Euclidean fills, accents).
- A slow "Y" output that changes once per loop.
- Per-scale-note weights drawn in the view instead of the fixed drop order.
