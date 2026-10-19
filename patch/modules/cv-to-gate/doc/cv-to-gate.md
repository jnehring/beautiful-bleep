# CV to Gate

## Introduction

Turns a control signal into a gate. When the input rises above *Threshold*
the gate goes high. It either stays high while the input does, or lasts a
fixed time.

## How does it work?

- **Length at 0:** the gate follows the input. It is high while the input is
  above *Threshold* and falls when the input drops a little below it (a small
  hysteresis stops chatter on noisy signals).
- **Length above 0:** every time the input rises through *Threshold* a gate of
  that length fires, however long the input stays high. A new crossing during a
  pulse restarts it.

## How to use it?

- **LFO to rhythm:** an LFO into *In*, *Threshold* near the top, *Length* short.
  Each peak fires a short gate.
- **Envelope follower to trigger:** drums into an envelope follower, its output
  here: a trigger on each loud hit.
- **Comparator:** leave *Length* at 0.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Threshold | −10 … +10 | 0.5 |
| Length | 0 … 10 s (0 = follow the input) | 0 |

Both are modulation destinations.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| In | control | The signal to compare. |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Gate | gate | High (1) or low (0). |
