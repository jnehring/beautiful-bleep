# Route

Type id `route` · category *Utility / Logic & Routing* · colour proposal `#99f6e4`

## 1. Purpose

Sends one input to one of up to 8 outputs. It accepts every float signal type.
The output is chosen by the *Select* knob (so by a CV on it), moved by *Next*
triggers or the transport, or jumped to by optional per-output triggers.
Unselected outputs are silent or hold their last value. Fades between outputs
never jump. Typical uses: sending a melody to a chosen quantizer or voice, a
drum to a chosen effect, a clock to a chosen destination. It is the 1 → N half
of the [Switch](switch.md), with a variable jack count and optional jacks. Its
counterpart is [Select](select.md).

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In | `audio` (any float type) | The source. |
| Next | `trigger` | Moves one output in *Order*. Unpatched: follows the transport at *Rate* (or never, with *Rate* Off). |
| Reset | `trigger` | Back to the first output (the last, for Backward). Only with *Reset Input* On. |
| Trig 1 … Trig *T* | `trigger` | Jump to output *k*. *T* = *Slot Triggers*; only with *Slot Triggers* > 0. |

Every knob is also an input (`specs.md` 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out 1 … Out *N* | `audio` | *In* at the selected output, with fade; the others carry 0, or hold. *N* = *Outputs* setting; jacks above *N* are hidden, their cables kept. |
| Changed | `trigger` | A pulse at each change. Only with *Changed Output* On. |

## 3. Controls

Knobs and settings are those of [Select](select.md) with *Outputs* (2–8,
default 4) in place of *Inputs*, plus:

| Setting | Values | Default |
|---|---|---|
| Idle Outputs | Zero, Hold | Zero |

## 4. Behaviour

Position, *Select*, *Next*, *Reset*, *Trig k*, transport mode and fades are
those of Select 4.1–4.3 (shared core `common/dsp/SlotSelector.h`). The output
side:

- Idle Outputs *Zero*: `Out_k = gain_k · In`.
- *Hold*: `Out_k = held_k + (In − held_k) · gain_k`, with `held_k` following the
  output while *k* is selected. A held output fades back into the live signal
  when its turn comes round.
- Outputs above *Outputs* are 0.
- `notes` signals aren't supported (`specs.md` 7.4).
- CPU: at most 8 multiply-adds per sample; no allocation.

## 5. Module view

The first version uses the generic module view. `liveValues` reports `slot`.
Later: the mock-up's wire diagram (the lit wire from *In* to the active output,
a flat line on idle ones, clicking an output sets *Select*).

## 6. Saved state

Knobs and settings only; no node data.

## 7. Engine requirements

None.

## 8. Tests

The shared core is tested in `test_slot_selector.cpp` (see select.md 8). Also:
the node types file includes the module (`patch.ui-types`); five demo patches.

## 9. Later

- The wire-diagram module view.
- A *Notes* variant that releases held notes on switching.
- Hold-on-select options (hold only on control signals).
