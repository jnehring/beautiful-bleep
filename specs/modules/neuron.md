# Neuron

Type id `neuron` · category *Modulation* · colour proposal `#c026d3`

## 1. Purpose

Two simple artificial neurons. Each one adds up to three weighted inputs,
lets the sum charge a leaky "membrane", and fires a gate when the membrane
crosses a threshold. A second output gives a rectified, sharpened version of
the sum for smooth modulation. Logic outputs combine the two neurons, and each
neuron's third input listens to the other one unless you patch it. Patched
into feedback with slow modulation (or with each other), the pair produces
rhythms and gestures nobody programmed: the module is made for emergent
patterns, not for exact ones.

It overlaps with *Utility*'s comparator only in the simplest case; Neuron adds
the weighted sum, the membrane (integrate-and-fire), spikes with a refractory
time, logic between two units and an internal cross-feedback path with a
one-sample delay.

## 2. Jacks

**Inputs** (per neuron, A and B)

| Jack | Type | What it does |
|---|---|---|
| A In 1, B In 1 | `control` | Unpatched: a constant **+1**, so *W1* works as a bias knob (as in Attenuverter). |
| A In 2, B In 2 | `control` | Unpatched: 0. |
| A In 3, B In 3 | `control` | Unpatched: normalled to the **other** neuron's output chosen in *Cross* (4.4). |
| Reset | `trigger` | Clears both membranes and ends any spike. |

Every knob is also an input (`specs.md` section 7.3). Inputs take any float
signal: audio into a neuron gives audio-rate firing.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| A Gate, B Gate | `gate` | The neuron's firing state (4.2). |
| A Out, B Out | `control` (unipolar) | Rectified, sharpened membrane (4.3). |
| A Spike, B Spike | `trigger` | A pulse each time the gate goes high. |
| AND, OR, XOR | `gate` | Logic of A Gate and B Gate. |
| Diff | `control` (bipolar) | A Out − B Out. |

## 3. Controls

**Knobs** (modulatable floats, one set per neuron)

| Knob | Range | Default (A / B) | What it does |
|---|---|---|---|
| W1, W2, W3 | −2…+2 | A: 0.6, 1, 0.5 · B: 0.9, 1, −1 | Weight of each input. |
| Threshold | −1…+1 | 0.5 / 0.5 | Level the membrane must cross to fire. |
| Hysteresis | 0–100 % | 10 % / 10 % | Gap between the on and off levels (4.2). |
| Leak | 0 ms – 5 s (skewed, 0 = off) | 250 ms / 400 ms | Membrane time constant (4.1). 0: the membrane equals the sum. |
| Sharp | 1–100 (exp.) | 4 / 4 | Gain of the *Out* curve (4.3). |
| Pulse | 1 ms – 1 s (exp.) | 30 ms / 30 ms | Gate length in *Spike* mode. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| A Mode, B Mode | Compare, Spike | Spike, Spike |
| Cross | Out, Gate, Off | Out |
| Reset on Start | on, off | on |

The default patch-free state: A charges from its bias (W1 · +1) and fires
regularly; as A charges, its *Out* (a saw, 4.3) pushes B's membrane down
through W3 = −1 while B's own bias (W1 0.9) charges it, so B fires in the
gaps, irregularly; B's output in turn speeds A up (A fires about every
0.2–0.5 s, B about once a second). (B's W1 was 0.2 in the first draft: B
then never reaches the threshold.) A two-voice rhythm plays out of the box, and patching anything into
In 2 bends it.

## 4. Behaviour

Everything runs per sample, in this order: read inputs (with the cross
normals from the **previous** sample), update both membranes, update gates,
outputs.

### 4.1 Sum and membrane

`s = W1 · In1 + W2 · In2 + W3 · In3`

The membrane `m` follows `s` with a one-pole low-pass of time constant *Leak*:
`m += (s − m) · (1 − e^(−dt / Leak))`. With *Leak* 0, `m = s`. A slow leak
integrates: a short burst at the input has less effect than a sustained one,
and a constant input reaches the threshold only after a delay that depends
on how far above the threshold it is.

### 4.2 Gate

**Compare mode** (a Schmitt trigger): with `h = Hysteresis × 0.5`, the gate
goes high when `m > Threshold + h/2` and low when `m < Threshold − h/2`.
At 0 % it is a plain comparator; more hysteresis stops chatter on noisy or
wobbly inputs and makes the gate "stick" once fired.

**Spike mode** (integrate and fire): when `m` crosses `Threshold + h/2`
upward, the gate goes high for *Pulse* and the membrane is **reset to 0**.
During *Pulse* (refractory time) the membrane is held at 0 and can't fire.
With a constant sum above the threshold the neuron fires periodically, faster
the higher the sum and the shorter the leak, so the input level becomes a
rhythm rate. With `θ = Threshold + h/2 > 0` and a constant `s > θ`, the
rate is `1 / (Pulse − Leak · ln(1 − θ / s))`; it never fires for `s ≤ θ`.
With `θ ≤ 0` it fires again right after each *Pulse* (the fastest rhythm).
The gate is low for at least one sample between pulses (`dsp::LifNeuron`),
so every firing is a visible edge; the period is then *Pulse* + 1 sample.

*Spike* fires on each rising gate edge in either mode.

### 4.3 Out

*Compare* mode: `Out = clamp(Sharp · (m − Threshold), 0, 1)`, then a soft
knee over the top 5 % so it doesn't kink at 1 (`dsp::neuronOut`). *Sharp* 1
gives a rectified copy of the membrane above the threshold; *Sharp* 100 is
almost a gate with a short ramp.

*Spike* mode: the same ramp moved down by `1 / Sharp`, so it ends at the
threshold: `Out = clamp(Sharp · (m − Threshold) + 1, 0, 1)`. (In Spike mode the
membrane is reset as soon as it crosses the threshold, so the Compare formula
would stay near 0.) *Out* shows the charging membrane, a saw-like shape that
drops at each spike: useful as a modulation locked to the neuron's rhythm.

### 4.4 Cross normals

*In 3* of each neuron, when unpatched, receives the other neuron's *Out*
(*Cross Out*), its *Gate* as 0/1 (*Cross Gate*) or nothing (*Off*). The
normal is internal and delayed by **one sample**, so feedback between the
two neurons is much tighter than a feedback cable (`specs.md` section 7.5,
one sub-block). A cable patched into *In 3* replaces the normal; patching a
neuron's own output back into its *In 2* through a cable works too, with the
usual feedback-cable delay.

### 4.5 Logic

From A Gate and B Gate: **AND**, **OR**, **XOR** (high when exactly one
fires). **Diff** = A Out − B Out, a bipolar signal that swings toward the more
active neuron.

### 4.6 Transport and determinism

Neuron has no randomness: the same inputs give the same outputs, sample for
sample. With *Reset on Start* on, both membranes and gates are cleared when
the transport starts, so a render is identical every time. Off, the module
keeps running through starts and stops (useful for free, ambient patches).
A loop jump changes nothing by itself. *Reset* clears the state at any time.

Very small *Leak* with cross-feedback can oscillate at audio rate: that is
allowed (it's a feature for audio use), and the outputs stay in range.

## 5. Module view

Two columns, one per neuron:

```
 ┌───────────── A ─────────────┬───────────── B ─────────────┐
 │ In1 ─W1─┐                   │ In1 ─W1─┐                   │
 │ In2 ─W2─┼─Σ─▶ membrane ▁▃▅▇│ │ In2 ─W2─┼─Σ─▶ ▃▅▇│▁▃       │
 │ In3 ─W3─┘   ─ ─ threshold ─ │ │ In3 ─W3─┘   ─ ─ ─ ─ ─      │
 │ Gate ▮ ▮  ▮                 │ │ Gate  ▮   ▮ ▮              │
 └─────────────────────────────┴─────────────────────────────┘
          AND ▫  OR ▪  XOR ▪            Cross [Out ▾]
```

Each column shows the membrane over the last 2 seconds with the threshold and
hysteresis band as lines, and the gate as a strip below; the threshold line
can be dragged (it is the *Threshold* knob). Spikes flash a dot. A line under
the columns says what the cross normals carry. The weights are the grouped
knobs below (*Neuron A*, *Neuron B*). (Dimming the cross normal when *In 3*
has a cable needs the view to know which input jacks are patched, which the
view API doesn't offer yet.)

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

1. **Normalled inputs** to the module's own outputs: the module needs to know
   whether *In 1* and *In 3* are patched (`ProcessContext::inputConnected`,
   exists) and handles the normals itself; no engine change.
2. **Live values** (exist): `liveValues` membraneA/B and spike counters
   spikesA/B; `liveArrays` membraneA/B and gateA/B (the last 2 s in 128
   points) for the view.
3. **Inside Voice Cells:** each voice has its own pair of neurons. With
   *Voice In › Velocity* into *In 2*, louder notes fire faster rhythms.

## 8. Tests

- Compare mode: gate switches at Threshold ± h/2 exactly; Hysteresis 0 equals a
  plain comparator; no chatter on a noisy input inside the band.
- Spike mode: constant input above threshold fires at the documented rate
  (± 1 sample per period); input at or below threshold never fires; the
  membrane is 0 during *Pulse*.
- Leak 0: membrane equals the sum sample by sample.
- Unpatched In 1 reads +1; unpatched In 3 follows the other neuron's Out or
  Gate with exactly one sample delay; Cross Off reads 0; a cable overrides it.
- Logic outputs match the truth tables; Diff = A Out − B Out.
- Out stays within 0…1 for any Sharp; Sharp 1 equals `m − Threshold` below 0.95.
- Default settings fire both neurons within 2 seconds, without any cable.
- Reset on Start: two renders are identical sample for sample.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- More neurons (a row of four with a weight matrix drawn in the view).
- Learning: weights that strengthen when two neurons fire together
  (Hebbian), slowly, for patches that evolve over minutes.
- A seeded noise input per neuron for spontaneous firing.
