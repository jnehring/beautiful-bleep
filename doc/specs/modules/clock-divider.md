# Clock Div

Type id `clock-divider` · category *Sequencing* · colour `#e9b44c`

## 1. Purpose

Eight clock dividers in one module, fed by one base clock, each output with
its own division (1–64). It is the plain, predictable divider: what you set is
what you get. Rotating Div (`rotating-divider.md`) is the sibling for a
*family* of divisions moved by one knob; its timing code is the model for this
one, minus the sets, rotation and pending changes.

## 2. Jacks

| Jack | Type | What it does |
|---|---|---|
| Clock (in) | `trigger` | Each pulse is one base step. Unpatched: the base step is *Base* at the transport's tempo, phase-locked to the song. |
| Reset (in) | `trigger` | All outputs start a new cycle on the next base step. |
| Out 1 … Out 8 | `gate` (or `trigger`) | Output *k* fires once every `Div k` base steps. |

## 3. Controls

Knobs: *Div 1 … Div 8* (stepped integer 1–64, defaults 2 3 4 5 6 8 16 32,
modulatable, rounded), *Width* (1–99 %, 50 %, hidden in Trigger mode).
Settings: *Base* (as the Step Sequencer's *Rate*, 1/16), *Realign* (Never,
1, 2, 4, 8 bars), *Output* (Gate, Trigger), *Gate Length* (Division, Base
Step), *Sync To* (Auto, Clock, Transport).

## 4. Behaviour

Timing is as Rotating Div 4.2 and 4.4 with `d(k) = Div k` (clamped to 1–64):

- **Transport mode:** `x = (ppq − off) / b`, restarting every *Realign* bars
  (4/4 assumed); output *k* starts a cycle when `floor(x / d(k))` changes.
  A pure function of the song position, so loops and renders agree. Start,
  stop→play and jumps are worked out from the position without catching up.
- **Clock mode:** a counter advances per pulse (0 on the first pulse after
  Reset); output *k* fires where `n mod d(k) = 0`. Gate length uses the
  measured pulse period.
- **Gates:** high for `Width` of the output's period or of one base step,
  never longer than the cycle minus 1 ms; a rise on a still-high gate drops
  the output for one sample.
- **Changing a division** takes effect at the output's next cycle edge
  (transport) or next pulse (clock). A high gate is never cut.
- **Transport stopped:** outputs low; Reset offset cleared.

## 5. Module view

The generic view: the eight *Div* knobs, *Width* and the settings.

## 6. Saved state

Knob and setting values only.

## 7. Tests

`patch/modules/clock-divider/tests/test_clock_divider.cpp`: exact rise samples
for straight, dotted and triplet *Base*, loop jumps, division clamping,
Realign (/3 steps and the 1 ms gap), a division change under a high gate,
Clock mode (counts, Reset + Clock, gate length, Trigger), Width, Reset and
stop.

## 8. Later

- Per-output *Offset* (phase shift in base steps) and probability.
- Multiplication (×2, ×3, …) as negative divisions.
- A *Swing* knob applied to the base step.
