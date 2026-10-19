# Math

## Introduction

Two rows of arithmetic for audio and control signals. Each row applies one
operation to two values, A and B: add, subtract, multiply, divide, power, min
or max.

## How does it work?

Each row computes

    Out = A op B

Every input has a constant knob next to it. An unpatched input reads its knob; a
patched input replaces it, and its knob is ignored. So a row takes two signals,
or one signal and a constant, or two constants.

- **Add, Subtract:** A + B, A − B.
- **Multiply, Divide:** A × B, A ÷ B. Dividing by a B very close to zero is
  limited so the result stays finite, and B keeps its sign.
- **Power:** A raised to B. A negative A keeps its sign: −2 ^ 2 is −4, not 4.
- **Min, Max:** the lower or higher of the two at each moment.

Outputs are limited to ±1000, and never become NaN or infinite. A row whose
output isn't patched does no work.

## How to use it?

- **Scale and offset:** Multiply with a constant B, then Add with a constant.
- **Invert around 1:** Subtract with A at 1 and a signal into B.
- **Reciprocal:** Divide with A at 1 and a signal into B.
- **Squaring or square root:** Power with B at 2 or 0.5.
- **Clamp a signal:** Min with a constant B as the ceiling, then Max with a
  constant as the floor.
- **Combine two LFOs:** Max or Min takes the upper or lower envelope.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Op 1, Op 2 | Add, Subtract, Multiply, Divide, Power, Min, Max | Multiply, Add |
| A1, B1 Constant | −10 … +10 | +1 |
| A2, B2 Constant | −10 … +10 | 0 |

The constants are modulation destinations.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| A1, B1 | control | Row 1 operands. Unpatched: the constant knob. |
| A2, B2 | control | Row 2 operands. Unpatched: the constant knob. |

The inputs accept audio and pitch signals too.

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out 1 | control | A1 op B1, limited to ±1000 |
| Out 2 | control | A2 op B2, limited to ±1000 |
