# Sequential Switch

Type id `sequential-switch` · category *Utility* · colour proposal `#6366f1`

## 1. Purpose

A rotary switch that moves on each trigger. In one direction it picks one of
up to 8 inputs and passes it to *Out* (8 → 1); in the other it sends *In* to
one of up to 8 outputs (1 → 8). Both sections share one step position, so a
single module can both select a source and route it. A crossfade between
steps makes it usable on audio without clicks, an *Address* input selects
the step directly, and the step can follow the transport. Typical uses:
cycling between modulation sources, distributing one sequence over several
voices, simple 8-step "voltage sequencers" made from knobs.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In 1 … In 8 | `audio` (accepts any float type) | The sources of the 8 → 1 section. An unpatched input contributes its *Level* knob as a constant, so the module doubles as an 8-step value sequencer. |
| In | `audio` | The source of the 1 → 8 section. |
| Step | `trigger` | Advances one step in *Direction*. Unpatched: steps follow the transport at *Rate* (or never, with *Rate* Off). |
| Reset | `trigger` | Back to step 1 (step *Length* for Backward). |
| Address | `control` (unipolar) | While patched, selects the step directly: 0…1 → step 1…*Length* (see 4.3). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out | `audio` | The selected input (8 → 1), with crossfade. |
| Out 1 … Out 8 | `audio` | *In* sent to the selected output (1 → 8); the others carry 0 (or hold, see *Hold*). |
| Gate | `gate` | High while the step is active; low for one sample at each step change, so it retriggers envelopes. |
| End | `trigger` | A pulse when the step wraps to the start of its cycle. |
| Position | `control` (unipolar) | (step − 1) / (Length − 1). |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Level 1 … 8 | −1…+1 | 0 | Gain applied to each input in the 8 → 1 section; the constant when the input is unpatched. With a patched input, +1 passes it unchanged. |
| Fade | 0–2000 ms (exponential), or 0–100 % of a step in *Fade mode* Relative | 2 ms | Crossfade time between steps, for both sections. |
| Slew | 0–100 % | 0 % | Glide for the 8 → 1 section on control signals: the output moves from the old value to the new one along a linear ramp of *Fade* length instead of crossfading. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Length | 2–8 | 4 |
| Direction | Forward, Backward, Ping-Pong, Random, Random walk | Forward |
| Rate | Off, 1/32 … 4 bars (Tempo.h choices) | Off |
| Fade curve | Equal power, Linear | Equal power |
| Fade mode | Time, Relative | Time |
| Hold (1 → 8) | Zero, Hold last value | Zero |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Steps

The position *s* runs 1…*Length*. A **Step** pulse (or a transport tick)
moves it:

- *Forward / Backward:* ±1 with wrap.
- *Ping-Pong:* 1 … L … 2, 1 (ends not repeated).
- *Random:* a seeded step ≠ current (`hash3(Seed, k, 0)`, *k* the step counter).
- *Random walk:* ±1 with equal chance, reflecting at the ends.

In Transport mode (*Step* unpatched, *Rate* set) the counter is
`k = floor(ppq / rateLength)` and the step is derived from *k*, like the
Step Sequencer (`step-sequencer.md` 4.2), so the switch stays locked to the
bars and renders identically from any start point. Random/walk use *k* as the
hash index; a walk is rebuilt from its last 64 moves when jumping (bounded cost).

Reducing *Length* below the current step jumps to the step `((s − 1) mod L) + 1`
at the next sample, with a crossfade.

### 4.2 Crossfade

Every step change starts a crossfade from the old step *a* to the new step *b*
over *Fade* (Relative mode: % of the measured step period). During it,

- 8 → 1: `Out = g_a(t)·In_a·Level_a + g_b(t)·In_b·Level_b`, with equal-power
  `g_a = cos(πt/2)`, `g_b = sin(πt/2)` or linear gains.
- 1 → 8: `Out_a = g_a(t)·In`, `Out_b = g_b(t)·In`.

A step change during a running fade starts a new fade from the **current
mix**: the outgoing gains of all steps still sounding are faded out together
(at most 8 gains, one per step, updated per sample). So fast stepping never
jumps and never sums above 0 dB. *Fade* 0 switches hard on the sample of the edge (right for gates and
stepped control); the 2 ms default is click-free on audio (`specs.md` 7.7).

*Slew* > 0 on the 8 → 1 section replaces the gain crossfade by a value glide:
`Out = lerp(v_a, v_b, t)` where *v* are the scaled inputs at that sample —
the right choice when the module is a value sequencer driving pitch.

### 4.3 Address

With *Address* patched, *Step* and *Rate* are ignored for choosing the step:
`s = 1 + floor(clamp(addr, 0, 0.9999) × L)`. A hysteresis of 2 % of a slot
keeps a noisy or slowly moving address from chattering at slot borders. Each
change of *s* crossfades as above and fires *Gate*'s retrigger; *End* fires
when the address crosses from the last slot back to the first. A *Step* pulse
while *Address* is patched adds an offset of one step (address + steps), so
both can be combined: an LFO sweeps, triggers transpose the sweep.

### 4.4 Edge cases

- *Length* 2 with Ping-Pong = Forward.
- Reset and Step on the same sample: Reset wins, then the step stays at 1.
- Transport stop: the position holds; on start it jumps (with fade) to the
  position for the song position.
- `notes` signals can't be switched in v1 (`specs.md` 7.4); route pitch and gate instead.
- CPU: per sample at most 8 multiply-adds per section during a fade, one
  otherwise. Memory: none beyond a few floats.

## 5. Module view

A ring of 8 slots (only *Length* active) with the current step lit and the
fade shown as a sweeping arc between the old and the new slot. Each slot
shows a mini scope of its input (8 → 1) or output (1 → 8), and its *Level*
knob. Clicking a slot jumps there (with fade) when *Step*, *Rate* and
*Address* are all inactive — a manual selector. The *Address* value is drawn
as a pointer on the ring.

## 6. Saved state

Knobs and settings only; no `data`. The current step is runtime state and
survives recompiles; a freshly loaded board starts at step 1 (or the
transport-derived step).

## 7. Engine requirements

None. `liveValues`: `step`, `fade` (0…1 progress), `from`.

## 8. Tests

- Each direction gives the documented order; Random never repeats; walk stays in range.
- Transport mode: step equals the formula after loop jumps and mid-song starts.
- Address: values at slot centres select the right step; hysteresis prevents
  chatter for a ±1 % noise around a border.
- Crossfade: equal-power gains sum to constant power; interrupted fades are
  continuous (no sample-to-sample jump above the input's own change) and never exceed unity gain.
- Fade 0 switches on the trigger sample exactly.
- Unpatched inputs output their *Level*; Slew glides linearly over *Fade*.
- 1 → 8: only the selected output carries signal outside fades; Hold keeps the last value.

## 9. Later

- Stereo pairs (switch L/R together).
- Per-step lengths (step 3 lasts two clocks).
- A *Notes* switch that routes note streams to several Voice Cells, releasing notes on switching.
- More than 8 steps with chained modules.
