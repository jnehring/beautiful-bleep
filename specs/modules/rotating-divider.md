# Rotating Div

Type id `rotating-divider` · category *Sequencing* · colour proposal `#f4a259`

## 1. Purpose

Eight clock dividers in one module, fed by one base clock. Each output carries
a division from a chosen *Set* (by default /1 … /8), and one *Rotate* knob
shifts the whole set across the outputs, so a single gesture (or an LFO on
*Rotate*) turns a steady hi-hat line into half-time, odd-meter or sparse
patterns. Divisions are derived from the song position, so they stay aligned to
Live's bars, after loop jumps and across renders.

It is the "many related divisions, one control" tool. The planned *Clock*
module (`specs.md` section 12) is the general rhythm source: each of its
outputs is set up on its own (divide **or** multiply, Euclidean patterns,
probability, swing). Rotating Div only divides, has no randomness, and its
outputs are always a family of the same base clock.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Clock | `trigger` | Each pulse is one base step. Unpatched: the base step is *Base* at the transport's tempo, phase-locked to the song (4.2). |
| Reset | `trigger` | All outputs start a new cycle on the next base step (4.4). |

Every knob is also an input (`specs.md` section 7.3); *Rotate* is the one to
modulate.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out 1 … Out 8 | `gate` (or `trigger`, see *Output*) | Output *k* fires once every `d(k)` base steps, `d(k)` from 4.1. |
| Stair | `control` (unipolar) | The eight outputs read as an 8-bit binary number, Out 1 the most significant bit, scaled to 0…1 (4.5). A stepped, rhythmic modulation shape that repeats with the pattern. |
| Align | `trigger` | A pulse on base steps where **every** output starts a cycle together (every `lcm` of the divisions, and at each *Realign* boundary). A natural "phrase start". |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Rotate | 0–16 (integer) | 0 | Shifts the set across the outputs (4.1). The modulated value is rounded to the nearest integer. |
| Width | 1–99 % | 50 % | Gate length, as a share of the output's own period (*Gate Length* = *Division*) or of one base step (*Base Step*). Ignored in *Trigger* output mode. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Set | Integers, Odds, Evens, Primes, Powers of 2, Fibonacci, Custom | Integers |
| Rotate Mode | Wrap, Extend | Wrap |
| Rotate Sync | Immediate, Next Step, Next Bar | Next Step |
| Base | 1/1, 1/2, and 1/4 … 1/32 each straight, dotted and triplet (as the Step Sequencer's *Rate*) | 1/16 |
| Realign | Never, 1 bar, 2 bars, 4 bars, 8 bars | Never |
| Output | Gate, Trigger | Gate |
| Gate Length | Division, Base Step | Division |

## 4. Behaviour

### 4.1 Sets and rotation

Each *Set* is a series `s(0), s(1), s(2), …`; the first eight values are the
default divisions:

| Set | Series | Out 1 … Out 8 at Rotate 0 |
|---|---|---|
| Integers | n + 1 | 1 2 3 4 5 6 7 8 |
| Odds | 2n + 1 | 1 3 5 7 9 11 13 15 |
| Evens | 2n + 2 | 2 4 6 8 10 12 14 16 |
| Primes | 1, then the primes | 1 2 3 5 7 11 13 17 |
| Powers of 2 | 2ⁿ | 1 2 4 8 16 32 64 128 |
| Fibonacci | 1, 2, 3, 5, 8, … | 1 2 3 5 8 13 21 34 |
| Custom | eight values from node data (6) | user's own, 1–64 each |

With `r` the rounded *Rotate* value and `k` = 0…7 the output index:

- **Wrap:** `d(k) = s((k + r) mod 8)`: the eight values cycle round the
  outputs. Rotate 1 on Integers gives 2 3 4 5 6 7 8 1. *Rotate* 8…16 repeats
  0…8.
- **Extend:** `d(k) = s(k + r)`: the series continues, so the outputs slide
  towards slower divisions. Rotate 4 on Integers gives 5 … 12; on Powers of 2,
  16 … 2048. Custom has no series beyond its eight values, so it always wraps.

Divisions are capped at 4096 base steps.

### 4.2 Timing

**Transport mode** (Clock unpatched). With `b` the *Base* length in quarter
notes and `off` the reset offset (4.4), the base-step position is
`x = (ppq − off) / b` (a float). With *Realign* set to `R` bars (4/4 assumed,
as `Tempo.h` does: `R · 4` quarter notes), the count restarts at every R-bar
boundary: `x = ((ppq − off) mod 4R) / b`. For output *k*:

- cycle index `c = floor(x / d(k))`, phase `φ = frac(x / d(k))`;
- the output starts a cycle (rising edge, or trigger) when `c` changes;
- in *Gate* mode it is high while `φ · d(k) · b < gateBeats`, with
  `gateBeats = Width · d(k) · b` (*Division*) or `Width · b` (*Base Step*).

Everything is a pure function of the song position: two Rotating Divs with the
same settings agree, a loop jump lands on the same state as the first pass,
and an offline render is identical to playback.

**Realign** exists because odd divisions don't fit a bar: a /3 of 1/16 notes
drifts against the bar line (3 against 16) and repeats only every 3 bars.
*Never* keeps that polymetric drift; *1 bar* restarts every output on each
downbeat, so the last cycle in the bar is shortened (a /3 plays steps 1, 4, 7,
10, 13, 16 then 1 again). A gate whose cycle is cut short ends early; a gate
always drops for at least 1 ms before its next rise.

**Transport stopped:** all gates fall and the outputs stay low; *Stair* holds
0. When the transport starts (and after a loop jump), the state is worked out
from the position with no "catching up": an output fires only if one of its
cycles starts exactly there (within one sample); a gate in the middle of its
cycle stays high only if it already was, else it waits for the next cycle.
From then on every rise is a pure function of the position, so a loop's second
pass fires on the same samples as the first.

**Clock mode** (Clock patched). A counter `n` advances on every pulse
(`n` = 0 on the first pulse after Reset). Output *k* starts a cycle on pulses
where `n mod d(k) = 0`. Gate lengths use the measured pulse period `T` (time
between the last two pulses; a 1/16 at 120 BPM before there are two):
`Width · d(k) · T` or `Width · T`, clamped to `d(k) · T − 1 ms`. *Realign* has
no effect in Clock mode (there is no bar); patch a bar-rate trigger into
*Reset* instead.

### 4.3 Rotate changes

A new *Rotate* (or *Set*, *Rotate Mode*) applies according to *Rotate Sync*:

- **Immediate:** the new mapping applies from the next sample. In transport
  mode every output's phase is recomputed with its new division, so it may be
  mid-cycle; a new rising edge only happens at the next cycle start.
- **Next Step** (default): the change waits for the next base step boundary.
  Fast modulation of *Rotate* is therefore quantized to the grid.
- **Next Bar:** the change waits for the next bar line (transport mode) or for
  *Align* (clock mode).

In every mode a gate that is already high finishes its length under the old
division, so a rotation never produces truncated "clicks" of gate; if the new
division starts a cycle while that gate is still high, the output drops for
one sample so the new rise is seen. A pending change that is superseded before
it applies is dropped (and turning back to the current mapping cancels it).
*Next Bar* in clock mode applies at the next pulse where every output starts a
cycle (*Align*).

### 4.4 Reset

- **Clock mode:** the next Clock pulse is `n = 0`; a Reset and a Clock on the
  same sample count as `n = 0`.
- **Transport mode:** `off` is set so that the next base step boundary is
  `x = 0` (like the Step Sequencer's Reset). With *Realign* on, Reset only
  shifts the realign grid by the same offset. Reset is cleared when the
  transport stops, so playback from the same place always sounds the same.

### 4.5 Stair and Align

*Stair* = `(Σ gate(k) · 2^(8−k)) / 255` over k = 1…8, so Out 1 is the most
significant bit. It changes only on base-step edges and at gate ends, so patching it into
a quantizer gives a repeating melody whose length is the pattern's `lcm`.
In *Trigger* output mode each output counts as high for one base step after its
pulse, so *Stair* still moves.

*Align* fires on base steps where `x mod d(k) = 0` for all k (after rotation),
and at each Realign boundary: wherever all eight outputs start a cycle on the
same sample.

## 5. Module view

The usual knobs and settings, with a **division ring** above them: eight
spokes, one per output, labelled with the current division (`/3`), and a small
gate lamp at each. Dragging the ring rotates it (writes *Rotate*, one undo
step; `beginGesture`). A pending rotation (4.3) shows as a ghost ring until it
applies.

```
        /1 ●
   /8 ○      ○ /2          Set: Integers   Rotate: 0
 /7 ○    ↻     ● /3        Base: 1/16      Realign: 1 bar
   /6 ○      ○ /4
        /5 ○
```

With *Set* = *Custom*, eight number fields (1–64, the series before rotation)
appear under the ring; clicking a spoke's label focuses its field.
Below the ring, a strip shows the next 32 base steps for all eight outputs, so
the effect of a rotation is visible before it applies.

## 6. Saved state

Knob and setting values, plus node data for the custom set:

```json
{
  "type": "rotating-divider",
  "params": { "rotate": 0.0, "set": 0.0, … },
  "data": { "custom": [1, 2, 3, 4, 6, 8, 12, 16] }
}
```

`sanitiseData` pads the array to eight entries (with the Integers values),
rounds each value and clamps it to 1–64. A new module stores the Integers set
as its custom values, so switching to *Custom* starts from /1…/8.

## 7. Engine requirements

None beyond what exists: transport position (`ppqAt`), node data (`setData`,
`sanitiseData`) and `liveValues` (base step, the eight gate states, pending
rotation) for the view.

Shared with the *Clock* module: bars assume 4/4 until `Transport` carries Live's
time signature. When it does, *Realign* and *Next Bar* use the real bar length.

## 8. Tests

- Transport mode, Integers, Rotate 0: output k fires every k+1 base steps at
  the exact samples, for straight, dotted and triplet *Base*, and after a loop
  jump.
- Every *Set* produces the documented divisions; Wrap and Extend rotations
  match the table (including Rotate 8 = Rotate 0 in Wrap); divisions cap at 4096.
- Realign 1 bar: a /3 at 1/16 fires on steps 1, 4, 7, 10, 13, 16, 1; the
  shortened gate drops ≥ 1 ms before the downbeat.
- Rotate Sync: Next Step changes apply exactly at the next boundary; a high
  gate is never cut by a rotation; a superseded pending change never applies.
- Clock mode: one count per pulse; Reset + Clock on one sample is `n = 0`;
  gate lengths follow the measured period.
- Width in Division vs Base Step mode; Trigger mode emits one-sample pulses.
- Stair equals the binary formula; Align fires at the lcm and Realign boundaries.
- Transport stop: all outputs low, no pulses on restart other than those due at
  the start position.
- Custom data round-trips; short, non-integer or out-of-range arrays load safely.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Per-output *Offset* (phase shift in base steps) and per-output mute.
- Multiplication sets (×2, ×3, …) for ratchet-like outputs.
- A *Swing* knob applied to the base step.
- *Rotate* by a trigger input (advance by one per pulse).
- Real time signatures (see 7).
