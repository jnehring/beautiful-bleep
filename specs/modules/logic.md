# Logic

Type id `logic` · category *Utility* · colour proposal `#86efac`

## 1. Purpose

Boolean logic for gates and triggers. Three inputs, all the usual gates at
once, plus a flip-flop and an edge detector. It turns two rhythms into a
third (AND for where they meet, XOR for where they differ), divides a clock by
two, and turns gates into triggers. Analogue min/max lives in the *CV Mixer*;
Logic only knows high and low.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| A, B | `gate` | The two main operands. Unpatched: low. |
| C | `gate` | Optional third operand for AND, OR and XOR (see 4.1). Unpatched: ignored, not low. |
| Flip | `trigger` | Toggles the flip-flop (*FF* output). |
| Reset | `trigger` | Sets the flip-flop low. |

Float signals on any input are converted at the *Threshold* (see 4.3), not
at the engine's fixed 0.5.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| AND | `gate` | High when all patched operands are high. |
| OR | `gate` | High when any operand is high. |
| XOR | `gate` | High when an odd number of patched operands are high. |
| NAND, NOR | `gate` | AND and OR inverted. |
| NOT A | `gate` | A inverted. |
| FF | `gate` | The flip-flop state. |
| Rise | `trigger` | A pulse on each rising edge of A. |
| Fall | `trigger` | A pulse on each falling edge of A. |
| Change | `trigger` | A pulse whenever AND, OR or XOR changes state. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Threshold | −1…+1 | 0.5 | Level at which a float input counts as high. |
| Hysteresis | 0…0.5 | 0.02 | The input must fall below *Threshold − Hysteresis* to count as low again, so slow or noisy signals don't chatter. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Flip Source | Flip jack, A rising edge | Flip jack |

## 4. Behaviour

### 4.1 Operands

AND, OR and XOR use A, B and C if C is patched, else A and B. A and B always
count, patched or not (an unpatched A or B is low), so AND with only A patched
is always low. That's the hardware behaviour users expect, and it makes *B*
work as an enable: AND of a clock and a gate passes the clock only while the
gate is high.

### 4.2 Flip-flop

A toggle flip-flop: each trigger at its source inverts *FF*; *Reset* sets it
low. With *Flip Source* at *A rising edge*, *FF* is a clock divider by two
from A without extra patching. Reset and a toggle on the same sample: Reset
wins.

### 4.3 Thresholds

All inputs (including *Flip* and *Reset*, which detect a rising edge through
the threshold) use the same *Threshold* and *Hysteresis*. A bipolar LFO into A
with *Threshold* 0 is high in its positive half; with 0.8 it makes short
pulses near its peaks.

Outputs are 0 or 1 per sample. Trigger outputs are single-sample pulses at the
exact sample of the edge (`specs.md` section 7.1).

## 5. Module view

The two knobs and the setting, and a row of small lamps, one per input and
output, lit while high (triggers flash for 50 ms so they're visible).

The first version uses the generic module view (knobs and settings); the
displays described here come later.

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

None. `inputConnected` decides whether C takes part.

## 8. Tests

- Truth tables for AND, OR, XOR, NAND, NOR, NOT with two and three operands.
- Unpatched C is ignored; unpatched A or B counts as low.
- Hysteresis: a sine hovering around Threshold with noise smaller than Hysteresis produces one edge per crossing.
- FF toggles per Flip trigger; with A rising edge as source it halves the rate of a clock on A; Reset wins on the same sample.
- Rise and Fall fire on the exact sample of the edges of A; Change fires when any logic output changes.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- A per-output *Mode* to emit triggers instead of gates.
- Gate delay and pulse lengthener (a gate of set length from each trigger).
- A *Probability* input on the trigger outputs (Bernoulli gate). The planned *Clock* module covers it first.
