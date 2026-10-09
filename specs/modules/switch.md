# Switch

Type id `switch` · category *Utility* · colour proposal `#c4b5fd`

This spec merges the earlier *Switch* (4-way selector) and *Sequential
Switch* (`sequential-switch.md`) designs into one module.

## 1. Purpose

A sequential switch with up to 8 steps. One step position drives two
sections at once: 8 → 1 picks one of eight inputs for *Out*, and 1 → 8 sends
*In* to one of eight outputs. The step moves on each trigger, follows the
transport, or is chosen by the *Select* knob (patch a CV onto it to address
the steps directly). Fades between steps never jump, so it works on audio as
well as on control signals. With unpatched inputs, the *Level* knobs make it
an 8-step value sequencer. Typical uses: cycling between modulation sources,
distributing one sequence over several voices, picking a sound source.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In 1 … In 8 | `audio` (any float type) | The sources of the 8 → 1 section. An unpatched input contributes its *Level* as a constant. |
| In | `audio` | The source of the 1 → 8 section. |
| Step | `trigger` | Advances one step in *Direction*. Unpatched: steps follow the transport at *Rate* (or never, with *Rate* Off). |
| Reset | `trigger` | Back to the first step of *Direction* (step *Length* for Backward). Wins over a Step on the same sample. |

Every knob is also an input (`specs.md` section 7.3); a CV on *Select*
addresses the steps directly.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out | `audio` | The selected input (8 → 1), with fade or glide. |
| Out 1 … Out 8 | `audio` | *In* at the selected output (1 → 8); the others carry 0, or hold (see *Idle Outputs*). |
| Gate | `gate` | High, but low for one sample at each step change, so it retriggers envelopes. |
| End | `trigger` | A pulse when the steps start a new cycle (see 4.1). |
| Position | `control` (unipolar) | (step − 1) / (Length − 1). |
| Changed | `trigger` | A pulse at each step change. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Level 1 … 8 | −1…+1 | +1 | Gain on each input of the 8 → 1 section; the constant when the input is unpatched. |
| Select | 0…1 | 0 | Offsets the step by `floor(Select × Length)`; with nothing stepping, it chooses the step. |
| Fade | 0–2 s (skewed, 50 ms in the middle) | 2 ms | Crossfade or glide time on each change, for both sections. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Length | 2–8 | 4 |
| Direction | Forward, Backward, Ping-Pong, Random, Random Walk | Forward |
| Rate | Off, 1/32 … 8 bars (`Tempo.h` choices) | Off |
| Fade Curve | Equal Power, Linear | Equal Power |
| Mode | Crossfade, Glide | Crossfade |
| Idle Outputs | Zero, Hold | Zero |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Steps

The step position is `(step counter's step + Select slot) mod Length`. The
counter moves on each **Step** trigger, or with the transport:

- *Forward / Backward:* ±1 with wrap. Backward starts at step *Length*.
- *Ping-Pong:* 1 … L … 2, 1 (ends not repeated); with Length 2 it equals Forward.
- *Random:* a seeded step ≠ the current one.
- *Random Walk:* ±1 with equal chance, reflecting at the ends.

Random moves are `uniform01(Seed, k, 0)` for counter *k*, so a sequence after
Reset repeats exactly.

**Transport mode** (*Step* unpatched, *Rate* set): the counter is
`k = floor(ppq / rateLength)`, so the switch is locked to the bars and the
stateless directions render identically from any start point. When *k* jumps
(a loop, a mid-song start), the random directions rebuild their position from
the last 64 moves (bounded cost). Transport stopped: the position holds.

**End** fires when the counter returns to the first step of its direction
(every *Length* steps for the random directions), and when *Select* crosses
from the last slot back to the first.

### 4.2 Select

`slot = floor(clamp(Select, 0, 0.9999) × Length)`, with a hysteresis of 2 %
of a slot so a noisy or slowly moving CV doesn't chatter at slot borders. The
slot is added to the counter's step, so both combine: an LFO sweeps the
steps, triggers shift the sweep. Reducing *Length* below the current step
wraps it (`mod Length`), with a fade.

### 4.3 Fades

Every step has an **amount**; the amounts always add up to 1. On a change,
each amount moves linearly from its current value to 1 (the new step) or 0
(all others) over *Fade*. A change during a running fade starts from the
current amounts, so fast stepping never jumps.

Gains follow *Fade Curve*: *Linear* uses the amount itself (the gains add up
to exactly 1, right for correlated signals and control voltages); *Equal
Power* uses `sin(amount · π/2)` (constant power between two uncorrelated
sources; right for audio).

- 8 → 1: `Out = Σ gain_k · v_k`, with `v_k = In_k · Level_k` (or `Level_k`
  when unpatched).
- 1 → 8: `Out_k = gain_k · In` with *Idle Outputs* Zero; with Hold,
  `Out_k = held_k + (In − held_k) · gain_k`, where `held_k` follows the
  output while step *k* is selected. So a held output fades back into the live
  signal when its step comes round.

*Fade* 0 switches hard on the sample of the change (right for gates and
stepped control); the 2 ms default is click-free on audio (`specs.md` 7.7).

**Mode Glide** replaces the 8 → 1 crossfade with a value glide: the output
moves along a straight line from its current value to the new step's value
over *Fade*. This is the right choice when the module is a value sequencer
driving pitch. The 1 → 8 section still fades.

### 4.4 Edge cases

- `notes` signals can't be switched in v1 (`specs.md` 7.4); route pitch and gate instead.
- CPU: at most 8 multiply-adds per section per sample; no allocation.

## 5. Module view

A ring of 8 slots (only *Length* active) with the current step lit and the
fade shown as a sweeping arc between the old and the new slot. Each slot
shows its *Level* knob and a mini scope of its input (8 → 1) or output
(1 → 8). Clicking a slot sets *Select* to it.

The first version uses the generic module view (knobs and settings); the
ring comes later. `liveValues` already reports `step`.

## 6. Saved state

Knobs and settings only; no node data. The current step is runtime state; a
freshly loaded board starts at the first step (or the transport-derived step).

## 7. Engine requirements

None. Transport position via `ppqAt`, `inputConnected` for the unpatched
inputs and for transport mode.

## 8. Tests

- Each direction gives the documented order; Random never repeats; Random Walk moves by one and stays in range.
- Step triggers advance; End fires once per cycle; Reset wins over Step.
- Transport mode: one step per *Rate* length; a loop jump lands on the same step as the first pass; stopped transport holds.
- Select: slot centres pick the right step; 1 % past a border doesn't move it, beyond 2 % it does; wrapping from the last slot to the first fires End.
- Unpatched inputs output their *Level*; patched ones are scaled by it.
- 1 → 8: only the selected output carries signal outside fades; Hold keeps the last value.
- Fades: linear 2 ms fade is halfway after 1 ms; interrupted fades never jump, and with the linear curve the gains always add up to 1.
- Glide moves linearly over *Fade*.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- *Fade mode Relative* (fade as a % of the measured step period).
- Stereo pairs (switch L/R together).
- Per-step lengths (step 3 lasts two clocks).
- A *Notes* switch that routes note streams to several Voice Cells, releasing notes on switching.
- More than 8 steps with chained modules.
