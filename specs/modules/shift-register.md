# Shift Register

Type id `shift-register` · category *Sequencing* · colour proposal `#dc2626`

## 1. Purpose

A looping register of 2–16 bits. On every step the bits move one place along
and the bit falling off the end comes back in at the front, flipped or not
depending on *Lock*. Everything the module outputs is read from those bits: a
stepped voltage (and a quantized pitch) from the first eight, eight gate
outputs from single bits, a gate that combines chosen bits, and a weighted mix
of six bits. One knob moves the pattern from frozen, through slowly mutating,
to completely random, and to a frozen loop of twice the length.

It differs from *Random*: Random draws a whole new value for each slot of its
loop, and its slots are independent. Here only **one bit** is new per step and
the rest is the previous step shifted, so consecutive voltages are related
(each one is roughly half the last plus the new bit), and the gate outputs are
delayed copies of each other. The module is about the bits themselves:
rhythms and melodies that echo, canon-like, through the register.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Clock | `trigger` | Each pulse shifts the register one step. Unpatched: steps follow *Sync* (transport-locked) or *Rate*. |
| Reset | `trigger` | Reloads the start pattern (6) on the next step; that step counts as step 0. |
| Data | `gate` | The bit to write when *Source* is *Data* or *Data ⊕ Loop*. Sampled at each step. |
| Transpose | `pitch` | Added to *Pitch* before quantizing, sampled at each step. |

Every knob is also an input (`specs.md` section 7.3); *Lock* is the one most
worth modulating.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Voltage | `control` (unipolar) | The first eight bits read as a number (4.3), 0…1, times *Level*. |
| Pitch | `pitch` | The same number spread over *Octaves* and quantized to *Scale* (4.3). |
| Bit 1 … Bit 8 | `gate` | High while that bit is 1, shaped by *Gate Length* (4.4). Bit 1 is the newest bit. |
| Combo | `gate` | The bits chosen in the view (5), combined by *Combine* (4.5). |
| Mix | `control` (bipolar) | Weighted sum of bits 1–6 (4.6). |
| Step | `trigger` | A pulse on every step. |
| Loop | `trigger` | A pulse when the step counter reaches a multiple of *Length* (the pattern's top). |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Lock | −100…+100 % | +80 % | Chance of flipping the recirculating bit: `p = (1 − Lock) / 2`. +100 % frozen, 0 % coin toss, −100 % always flipped (a frozen loop of 2 × *Length*). |
| Rate | 0.05–50 Hz (exp.) | 4 Hz | Step rate when *Sync* is *Free* and Clock is unpatched. |
| Level | 0–100 % | 100 % | Scales *Voltage*. |
| Gate Length | 1–100 % of a step | 50 % | Length of the bit gates and *Combo*. At 100 % consecutive 1s merge into one long gate. |
| Weight 1 … Weight 6 | −1…+1 | 1, ½, ¼, ⅛, 0, 0 | The six mixer sliders (4.6). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Length | 2–16 bits | 8 |
| Sync | Free, 1/32, 1/16, 1/8, 1/4, 1/2, 1 bar, 2 bars, 4 bars, 8 bars (shared list, `patch/common/dsp/Tempo.h`) | 1/16 |
| Source | Loop, Data, Data ⊕ Loop | Loop |
| Combine | Any (OR), All (AND), Odd (XOR) | Any |
| Octaves | 1–4 | 2 |
| Root | C … B | C |
| Scale | the scale list of the Step Sequencer (`patch/common/dsp/Scales.h`) | Minor Pentatonic |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 The register

The register holds 16 bits, `b1` (newest) … `b16` (oldest). *Length* chooses
which bit is fed back: `b_Length`. On each step:

```
out  = b_Length                         // the bit that recirculates
in   = source(out, Data)                // see Source below
flip = uniform01(seed, k, 1) < p        // p = (1 − Lock) / 2, k = step index
b16 … b2 = b15 … b1                     // shift
b1   = in XOR flip
```

The whole register shifts, so bits beyond *Length* still hold older bits:
with *Length* 4, *Bit 5* … *Bit 8* are the bits of *Bit 1* delayed by 4…7
steps. That's deliberate; it gives extra delayed copies of a short pattern.

**Source:**
- *Loop:* `in = out`. The classic looping register.
- *Data:* `in = Data` (high = 1). *Lock* still flips it, so +100 % passes an
  incoming rhythm through unchanged and lower values corrupt it.
- *Data ⊕ Loop:* `in = out XOR Data`. An external gate pattern scrambles the
  loop in a repeatable way.

**Lock** at the extremes is exact: at +100 % `p` is 0 and the pattern repeats
every *Length* steps; at −100 % `p` is 1, every recirculated bit is inverted
and the pattern repeats every 2 × *Length* steps with the second half the
inverse of the first. Between them the pattern mutates; near ±100 % it
changes now and then and stays recognisable.

### 4.2 Timing

Steps come from, in order of priority (as in Random):

1. **Clock patched:** every rising edge is a step. The step index `k`
   counts up from 0 at the last Reset or transport start.
2. **Sync on a note value, transport playing:** `k = floor(ppq / syncBeats)`,
   so steps sit on the song grid and two Shift Registers with the same *Sync*
   line up.
3. **Otherwise:** steps run at *Rate* (or at the synced length at the current
   tempo while the transport is stopped), and `k` keeps counting.

Gate durations need a step length: in Clock mode it is the time between the
last two pulses (first pulse: 1/16 at the current tempo).

### 4.3 Voltage and pitch

`n = Σ_{i=1..8} b_i · 2^(8−i)` is an 8-bit number with **b1 as the most
significant bit**, so the newest bit counts most and each step roughly halves
the previous value and adds the new bit on top. This is why melodies from the
register have a recognisable contour.

- **Voltage** = `n / 255 × Level`.
- **Pitch** = `quantize(Root + n / 255 × Octaves × 12 + Transpose × 12)`
  semitones from C4, divided by 12, with the shared quantizer (ties go down).

Both change only on a step, so a moving *Transpose* never glitches inside
a step.

### 4.4 Bit gates

*Bit i* is high from the step start for *Gate Length* × step if `b_i` is 1.
At 100 % the gate stays high across consecutive 1s (no retrigger), which
makes long and short notes from the same bit. *Bit 2* is *Bit 1* one step
later, *Bit 3* two steps later, and so on: patch neighbouring bits to
different drums for call-and-response patterns.

### 4.5 Combo gate

The view has eight toggles under the bit display (5) that choose which bits
feed *Combo* (default: bits 1 and 4). *Combine* decides how:

- *Any*: high if at least one chosen bit is 1 (denser rhythms).
- *All*: high only if every chosen bit is 1 (sparse accents).
- *Odd*: high if an odd number of chosen bits are 1 (busy, less predictable).

No chosen bits: *Combo* stays low. *Combo* follows *Gate Length* like the bit
gates.

### 4.6 Mixer

`Mix = Σ_{i=1..6} Weight_i · b_i / max(1, Σ |Weight_i|)`

so it stays within −1…+1 whatever the sliders are, and one slider at +1 alone
gives a plain 0/1 copy of that bit. The defaults (1, ½, ¼, ⅛) make a 4-bit
version of *Voltage*; unequal or negative weights give stepped modulation
that isn't monotone in the register's number. Because the weights are knobs,
an LFO on one slider makes the mix shift between two stepped patterns.

### 4.7 Determinism, transport and seeking

- Flips are a pure function of (*Seed*, `k`). The register's state is history,
  so the module also stores a **start pattern** (6). A transport start loads
  it and then fast-forwards from step 0 to the current step with the current
  *Lock* and *Source* (*Data* counts as 0 while fast-forwarding), capped at
  65,536 steps (about 1 ms of work). A loop jump or seek (the step index is
  not the previous one + 1) does the same.
- Hence: a render from the same start position is always identical. A render
  that starts later matches a full play-through exactly unless *Lock* was
  automated or modulated before that point.
- **Capture** (5) writes the current register into the start pattern, so a
  pattern you like becomes part of the board and comes back on every play,
  whatever the seed or the song position.
- Transport stop: gates fall; *Voltage*, *Pitch* and *Mix* hold.
- Changing *Length* never clears bits; it only changes which bit is fed back.

## 5. Module view

```
 ┌────────────────────────────────────────────────────────────┐
 │  ● ○ ○ ● ● ○ ● ○ │ ○ ● ○ ○ ● ○ ○ ●     [Capture] [Load]    │
 │  1           8   │          16    Length ▲                  │
 │  Combo  ☑ ☐ ☐ ☑ ☐ ☐ ☐ ☐     Combine [Any ▾]               │
 │  ▁▃▇▅▂▁▆▃▂▅  ← last 32 values of Voltage, flips marked ✕    │
 └────────────────────────────────────────────────────────────┘
```

- **Bit ring:** the 16 live bits, newest left; bits beyond *Length* dimmed;
  the feedback tap marked. Bits that were flipped on entry flash briefly.
- **Clicking a bit** toggles it in the start pattern and, with **Load**, also
  in the running register (one undo step each).
- **Capture** copies the live register into the start pattern; **Load**
  loads the start pattern into the running register now.
- **Combo toggles** choose the bits for *Combo*.
- **History strip:** the last 32 values of *Voltage*, so you can watch a
  pattern lock or dissolve while turning *Lock*.
- Knobs and settings below; the six Weight sliders sit in a row as vertical
  faders.

## 6. Saved state

```json
{
  "type": "shift-register",
  "params": { "lock": 0.9, "length": 0.4286, … },
  "data": { "start": 43605, "combo": 9 }
}
```

`start` is the 16-bit start pattern (bit 0 = *b1*), `combo` the 8-bit mask
of the Combo toggles (bit 0 = Bit 1). A new module gets `start` from
`hash3(Seed, 0, 7)` masked to 16 bits (never 0, so it plays immediately) and
`combo` 9. Out-of-range values are masked; missing fields get the defaults
(sanitise).

## 7. Engine requirements

1. **Node data** (exists, `ModuleSpec::sanitiseData`) for `start` and `combo`.
2. **One-shot commands** from the view to the running module, without an undo
   entry: *Load* and toggling a live bit. Proposal: `Module::command(name,
   json)`, queued lock-free to the audio thread. *Capture* needs no command:
   the view reads the live register from `liveValues` (`bits`, `k`, `flips`)
   and writes it into `data.start`.
3. **Jump detection** is local (step index discontinuity); no engine change.
4. **Inside Voice Cells:** each voice runs its own register; the flip stream
   uses `stream = 1 + voice index`, so voices drift apart from the same start
   pattern unless *Lock* is +100 %.

## 8. Tests

- Lock +100 %: the output repeats every *Length* steps for every Length; −100 %:
  repeats every 2 × Length and the second half is the bitwise inverse.
- Lock 0 %: the share of flips over 10,000 steps is 50 % ± 2 %.
- Same Seed and start → identical output twice; different Seed → different.
- Seek: jumping to step 1,000 with constant Lock gives the same register as
  playing steps 0…1,000.
- Transport mode steps land on `floor(ppq / syncBeats)` boundaries; Clock mode
  shifts once per pulse; Reset + Clock on the same sample loads the start
  pattern.
- Voltage: register 1000 0000 → 128/255; Pitch quantizes against the scale table.
- Bit gates: Bit 2 equals Bit 1 delayed one step; Gate Length 100 % merges runs.
- Combo: Any/All/Odd truth tables; empty mask stays low.
- Mixer: stays within ±1 for random weights; single weight +1 copies the bit.
- Source Data with Lock +100 % passes the input gate pattern through unchanged.
- Data round-trips; broken `start`/`combo` load safely.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Register lengths up to 32, and a second feedback tap XORed in (maximal-length
  sequences).
- Per-bit probability or mute for the gate outputs.
- A *Notes* output (register pitch + Combo as gate) to play a Voice Cell
  directly.
- Several stored start patterns switched by a control input.
