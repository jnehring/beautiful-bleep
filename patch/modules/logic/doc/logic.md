# Logic

## Introduction

Logic combines gates and triggers the way digital circuits do: AND, OR, XOR
and their inverses, a flip-flop, and edge detectors. Two rhythms become a
third, a clock is divided by two, and a gate turns into triggers at its start
and end.

## How does it work?

Every input is either **high** or **low**. It goes high when the signal rises
above *Threshold*, and low again when it falls below *Threshold* minus
*Hysteresis*. The hysteresis keeps slow or noisy signals from flickering
around the threshold.

The logic outputs combine **A** and **B**, plus **C** when it is patched:

- **AND:** high when all are high.
- **OR:** high when any is high.
- **XOR:** high when an odd number are high (for two inputs: when they differ).
- **NAND**, **NOR:** AND and OR inverted.
- **NOT A:** A inverted.

An unpatched A or B counts as low, so AND needs both patched. That makes B an
enable: AND of a clock and a gate passes the clock only while the gate is high.

The **flip-flop** (*FF*) changes state on each trigger at *Flip* (or on each
rising edge of A, see *Flip Source*). *Reset* sets it low.

**Rise** and **Fall** fire a trigger when A goes high and low. **Change**
fires whenever AND, OR or XOR changes.

## How to use it?

- **Rhythm from rhythms:** two clocks or patterns into A and B. *AND* plays
  where they meet, *XOR* where they differ, *OR* everything.
- **Mute a clock:** clock into A, a gate into B, use *AND*.
- **Clock ÷ 2:** clock into A, *Flip Source* on *A Rising Edge*, use *FF*.
  Chain more Logic modules for ÷ 4, ÷ 8.
- **Gate to triggers:** a gate into A; *Rise* fires at the start, *Fall* at
  the end. Patch *Fall* into an envelope for a sound on note release.
- **Pulses from an LFO:** an LFO into A, *Threshold* 0.8; *NOT A* is low only
  near the LFO's peaks.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Threshold | −1 … +1 | 0.5 |
| Hysteresis | 0 … 0.5 | 0.02 |
| Flip Source | Flip Jack, A Rising Edge | Flip Jack |

- **Threshold:** the level at which an input counts as high. Applies to every
  input, including *Flip* and *Reset*.
- **Hysteresis:** how far below *Threshold* an input must fall to count as
  low again.
- **Flip Source:** what toggles the flip-flop.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| A, B | gate | The main operands. Unpatched: low. |
| C | gate | Optional third operand for AND, OR, XOR. Unpatched: ignored. |
| Flip | trigger | Toggles *FF* |
| Reset | trigger | Sets *FF* low; wins over a toggle on the same sample |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| AND, OR, XOR | gate | The logic of A, B (and C) |
| NAND, NOR | gate | AND and OR inverted |
| NOT A | gate | A inverted |
| FF | gate | The flip-flop |
| Rise, Fall | trigger | When A goes high, when A goes low |
| Change | trigger | When AND, OR or XOR changes |
