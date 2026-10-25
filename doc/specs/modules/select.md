# Select

Type id `select` · category *Utility / Logic & Routing* · colour proposal `#d8b4fe`

## 1. Purpose

Picks one of up to 8 inputs and passes it to *Out*. It accepts every float
signal type. The input is chosen by the *Select* knob (so by a CV on it),
moved by *Next* triggers or the transport, or jumped to by optional per-input
triggers. Fades between inputs never jump, so it works on audio as well as on
control signals. Typical uses: choosing between several quantizers, A/B
switches, sweeping through sound sources. It is the N → 1 half of the
[Switch](switch.md), with a variable jack count and optional jacks, so a
default module takes little room on the board.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In 1 … In *N* | `audio` (any float type) | The sources. *N* = *Inputs* setting; jacks above *N* are hidden (`when`), their cables kept. An unpatched input is 0. |
| Next | `trigger` | Moves one input in *Order*. Unpatched: follows the transport at *Rate* (or never, with *Rate* Off). |
| Reset | `trigger` | Back to the first input (the last, for Backward). Only with *Reset Input* On. |
| Trig 1 … Trig *T* | `trigger` | Jump to input *k*. *T* = *Slot Triggers*; only with *Slot Triggers* > 0. |

Every knob is also an input (`specs.md` 7.3); a CV on *Select* addresses the inputs directly.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out | `audio` | The selected input, with fade. |
| Changed | `trigger` | A pulse at each change. Only with *Changed Output* On. |

## 3. Controls

**Knobs**

| Knob | Range | Default | What it does |
|---|---|---|---|
| Select | 0…1 | 0 | `floor(Select × Inputs)` is added to the stepping position; with nothing stepping it picks the input. |
| Fade | 0–2 s (skewed, 50 ms in the middle) | 2 ms | Crossfade time on each change. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Inputs | 2–8 | 4 |
| Order | Forward, Backward, Ping-Pong, Random | Forward |
| Rate | Off, 1/32 … 8 bars (`Tempo.h`) | Off |
| Fade Curve | Equal Power, Linear | Equal Power |
| Reset Input | Off, On | Off |
| Slot Triggers | 0–8 | 0 |
| Changed Output | Off, On | Off |
| Seed | 0–999 | 1 |

## 4. Behaviour

The position logic is shared with Route (`common/dsp/SlotSelector.h`).

### 4.1 Position

The position is `(base + slot) mod Inputs`, `base` being the stepping
position and `slot` the Select slot.

- *Next* (rising edge at 0.5): Forward +1, Backward −1, Ping-Pong 1 … N … 2
  (ends not repeated; with 2 inputs equals Forward), Random a seeded step ≠ the
  current one (`uniform01(Seed, k, 0)` for counter *k*).
- *Reset* wins over *Next* on the same sample: base = first position of the order.
- *Trig k* sets `base` so that the position becomes *k*; the next *Next*
  continues from there. If several fire on one sample, the highest wins.
  Triggers beyond *Inputs* are ignored.
- **Transport mode** (*Next* unpatched, *Rate* set): the counter is
  `k = floor(ppq / rateLength)` and the position a pure function of *k*, so
  it is locked to the bars. Random rebuilds from the last 64 moves. Transport
  stopped: the position holds. The first sample already follows the song.

### 4.2 Select

`slot = floor(clamp(Select, 0, 0.9999) × Inputs)` with a hysteresis of 2 % of
a slot, so noisy CVs don't chatter at the borders.

### 4.3 Fades

Every input has an **amount**; the amounts always add up to 1. On a change,
each amount moves linearly to 1 (the new input) or 0 (all others) over *Fade*;
a change during a fade starts from the current amounts, so fast stepping never
jumps. Gains follow *Fade Curve*: Linear uses the amount, Equal Power
`sin(amount · π/2)`. `Out = Σ gain_k · In_k`. *Fade* 0 switches on the sample
of the change (right for gates and stepped control).

### 4.4 Edge cases

- `notes` signals aren't supported (`specs.md` 7.4).
- Reducing *Inputs* below the current position wraps it (`mod Inputs`), with a fade.
- CPU: at most 8 multiply-adds per sample; no allocation.

## 5. Module view

The first version uses the generic module view. `liveValues` reports `slot`.
Later: the mock-up's wire diagram (inputs on the left, the lit wire to *Out*,
clicking an input sets *Select*).

## 6. Saved state

Knobs and settings only; no node data. The position is runtime state; a loaded
board starts at the first input (or the transport-derived one).

## 7. Engine requirements

None. `JackSpec::when` / `ParamSpec::when` for the variable and optional jacks.

## 8. Tests

`common/dsp/tests/test_slot_selector.cpp` (shared core):

- Each order gives the documented sequence; Random never repeats.
- Reset wins over Next; Trig *k* jumps and Next continues from there; triggers beyond the count are ignored.
- Select slot centres pick the right slot; 1 % past a border doesn't move it, well beyond does; Select adds to the stepping.
- Transport mode: a pure function of the tick, also for Random; the first sample follows the song.
- Fades: halfway at half the time; interrupted fades don't jump and linear gains add to 1; Fade 0 switches on the sample; Equal Power keeps constant power.
- Shrinking the slot count wraps the position.

Also: the node types file includes the module (`patch.ui-types`); five demo patches.

## 9. Later

- The wire-diagram module view.
- A *Notes* variant that releases held notes on switching.
- A *Level* per input (as on the Switch).
