# Index

Type id `index` · category *Utility / Logic & Routing* · colour proposal `#fcd34d`

## 1. Purpose

Turns a CV or gates into a **step**: a whole number from 0 to *Steps* − 1,
sent as the position `i / (Steps − 1)`. That is the one form a discrete value
is driven in, on the board and in Live:

- a Live Params row picks the item `min + round(v × (max − min))`
  (`live-link.md` section 8);
- a cabled choice, toggle or integer setting reads `round(v × (n − 1))`
  (`Program.cpp`, `Module::setting`).

So one *Index* feeds a dropdown or an on/off button in a module, or in Live,
with the same cable. Set *Steps* to the number of choices on the target (2 for
a toggle). Phase 2 (section 9) makes every discrete setting a valid target.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In | `control` | *CV* mode: the value to split into steps. |
| Up | `trigger` | *Count* mode: next step in *Order*. Unpatched: follows the transport at *Rate* (or never, with *Rate* Off). |
| Down | `trigger` | *Count* mode: the step before. |
| Reset | `trigger` | *Count* mode: back to the first step of the order. |
| Gate 1 … Gate *K* | `gate` | *Gates* and *Binary* modes. *K* = *Gate Inputs* (hidden above it with `when`, cables kept). |

Every knob is also an input (`specs.md` 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out | `control` (0…1) | `i / (Steps − 1)`. Patch it to a discrete setting, a Dial-style knob or a Live Params row. |
| Index | `control` | The raw whole number `i` (0 … *Steps* − 1), for Math or a display. |
| Changed | `trigger` | A pulse at each change of step. Only with *Changed Output* On. |

## 3. Controls

**Knobs**

| Knob | Range | Default | What it does |
|---|---|---|---|
| Offset | 0…1 | 0 | `floor(Offset × Steps)` is added to the step, wrapping (`mod Steps`). A CV on it shifts the step; in *CV* mode use *In* instead. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Mode | CV, Count, Gates, Binary | CV |
| Steps | 2–32 | 4 |
| Input Range | 0…1, −1…+1 | 0…1 |
| Order | Forward, Backward, Ping-Pong, Random | Forward |
| Wrap | Wrap, Stop | Wrap |
| Rate | Off, 1/32 … 8 bars (`Tempo.h`) | Off |
| Gate Inputs | 1–8 | 3 |
| Default Step | 0–31 | 0 |
| Changed Output | Off, On | Off |
| Seed | 0–999 | 1 |

*Mode* is a setting a cable may drive, like the Filter's *Type*.

## 4. Behaviour

### 4.1 Steps, Out and Index

The module always holds one step `i`, clamped to 0 … *Steps* − 1. Then
`Index = i` and `Out = i / (Steps − 1)`. The division is exact, so the target's
`round(v × (n − 1))` returns `i` whenever *Steps* = *n*. With a wrong *Steps*
the target gets a neighbour, never garbage: the module cannot know the target.

### 4.2 CV mode

`u` = *In*, taken to 0…1 (−1…+1 mapped by `(x + 1) / 2`), NaN → 0, clamped.
`i = floor(min(u, 0.9999) × Steps)`, with a hysteresis of 2 % of a step so a
noisy CV does not chatter at the borders (as Select, section 4.2). Unpatched:
step 0.

### 4.3 Count mode

The core is `common/dsp/IndexStepper.h`. It reuses the order maths of
`SlotSelector.h` (`stepAt`, `randomMove`) but is its own class, since Index
goes up to 32 steps and has no fades.

- *Up* (rising edge at 0.5) moves in *Order*; *Down* moves the other way.
  *Down* goes against the order in Forward/Backward and acts like *Up* in
  Ping-Pong and Random. Forward/Backward wrap with *Wrap* Wrap and stop at the ends with *Stop*;
  Ping-Pong turns round at the ends (ends not repeated); Random takes a
  seeded step ≠ the current one (`uniform01(Seed, k, 0)`).
- *Reset* wins over *Up*/*Down* on the same sample.
- **Transport mode** (*Up* unpatched, *Rate* set): the counter is
  `k = floor(ppq / rateLength)` and the step a pure function of *k*, so it is
  locked to the bars. Transport stopped: the step holds.

### 4.4 Gates mode

*Gate k* is high at ≥ 0.5 and selects step *k* − 1 (Gate 1 → step 0, so *K*
gates cover *K* steps, as in Binary mode). The step is that of the **highest**
gate that is high; with none high it is *Default Step* (0 unless set). Gates
for a step beyond *Steps* − 1 are ignored.

### 4.5 Binary mode

Gate *k* adds 2^(*k* − 1) to the step: three gates address 8 steps, one gate is
an on/off switch. The sum is clamped to *Steps* − 1. Useful for a bank of
switches or a binary counter patched from a clock divider.

### 4.6 Offset

After the mode has produced a step: `i' = (i + floor(Offset × Steps)) mod Steps`.
Applied last, so it works in every mode.

### 4.7 Timing and edge cases

- The step changes on the sample of the input change; there is no smoothing
  (a discrete value cannot be half-way). The receiver reads a driven setting
  once per block, so a change takes effect within one block.
- *Changed* fires only when the step really changes.
- Lowering *Steps* below the current step clamps it.
- `notes` signals are not accepted (`specs.md` 7.4). A `gate` or `trigger`
  cable into *In* reads as 0 or 1.
- CPU: negligible; no allocation.

## 5. Module view

The generic module view first, `liveValues` reporting `step`. Later: a large
step number and a row of *Steps* cells with the active one lit, clickable in
*Count* mode to jump there.

## 6. Saved state

Knobs and settings only. The step is runtime state; a loaded board starts at
*Default Step* (Gates, Binary), step 0 (CV, Count), or the transport-derived
step.

## 7. Engine requirements

Phase 1: none. `JackSpec::when` for the optional jacks; `Mode` added to
`cableableSettings()`.

## 8. Tests

`common/dsp/tests/test_index.cpp` (the core, written):

- CV: the centre of each band gives that step; 1 % past a border does not move
  it, well beyond does; −1…+1 range maps correctly; NaN gives 0.
- Count: each order gives its documented sequence; Wrap and Stop at the ends;
  Reset wins; Random never repeats; transport mode is a pure function of the
  tick.
- Gates: highest high gate wins; none high gives *Default Step*; gates beyond
  *Steps* are ignored.
- Binary: sums of gates, clamping at *Steps* − 1.
- Output: `Out = i / (Steps − 1)` and `round(Out × (Steps − 1)) = i` for
  *Steps* 2 … 32; *Index* equals `i`.
- *Offset* wraps; lowering *Steps* clamps; *Changed* fires only on a change.
- Round trip: Index → Out → a cabled dropdown (phase 2) ends on the same
  choice for every item.

Written: the node types file and five demos (`presets/demos/index.mjs`). Ideas for more demos: CV to a Filter *Type*; three gates to a toggle bank; a clock
counting through a Chorus *Mode*; a Live Params row driven by *Out*.

## 9. Phase 2: every discrete setting accepts a cable (implemented)

Before this, only the settings listed in `cableableSettings()` (`Registry.cpp`)
could be driven by a cable. *Index* is of little use on the board without the rest.

1. **All Choice, Bool and Int settings are drivable** (`isCableable()` in
   `Registry.cpp`), except those of ports and cells, and of the modules listed
   in `staticModules()` (Audio Console, Recorder, Sampler, Live Params), which
   arm recordings, open files or change structure. Single settings can go on
   `staticSettings()`. The old list stays for settings that are not discrete.
   A module reads a driven setting through `Module::setting()` (once per
   block) or `value()`; no module reads the raw knob. Settings a module only
   reads in `prepare()` (e.g. some Wavetable Osc quality options) change at the
   next prepare, not live.
2. **Absolute, not offset.** A cabled discrete setting takes the cable as
   absolute: while a cable is connected, the setting is `round(v × (n − 1))`
   with `v` the summed cables (clamped to 0…1), the knob is ignored, and the
   cable's amount is ignored (`Program.cpp`; fan-in still sums). Without a
   cable it is the knob, as now. This is how a Live Params row already
   behaves, so the same cable gives the same result on both sides. For the
   settings already on the list this changes the result only when the knob is
   not on the first choice and a cable is connected.
3. **View.** The cable popover of such a cable has no amount slider ("sets
   the value"). The module view (`common/ui/bleep-view.js`) shows the live choice
   in the dropdown, toggle or number, locked and outlined in the modulation
   colour while the cable is there. Checked for syntax only, not seen in the
   running app.
4. **Migration.** Boards saved with a cable into an existing cableable setting
   keep loading; the stored amount is ignored.

Tests for phase 2 (`tests/controller_modules_test.cpp`): for every drivable
setting of every module, a Dial at `i / (n − 1)` ends on item `i` (56,000
checks); a cable wins over a knob on the last item; without the cable the
knob is back, for every setting. Not yet tested: the saved-board migration.

## 10. Later

- *Steps* following the target (the board reading the choice count of the
  cabled setting), so no *Steps* setting has to match by hand.
- A *Notes* mode (note number → step).
- A *Learn* button that sets *Steps* from the first cable's target.
