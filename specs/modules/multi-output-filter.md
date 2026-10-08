# Multi-out Filter

Type id `multi-out-filter` · category *Audio* · colour proposal `#ec4899`

## 1. Purpose

One filter core, eight simultaneous outputs. A four-pole resonant core is
tapped and its taps are mixed into ten responses — 1- to 4-pole low-pass,
2- and 4-pole band-pass and high-pass, notch and all-pass — and any eight of
them come out at once. A single cutoff modulation therefore drives many
related tones in parallel: send the 4-pole low-pass to the main mix, the
band-pass to a delay, the high-pass to a reverb, all moving together. At full
resonance the core rings as a clean, tunable sine.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In | `audio` | The signal to filter (mono; use two modules or a Voice Cell for stereo). |
| Pitch | `pitch` | Moves the cutoff, scaled by *Key Track*. |
| FM | `audio` | Linear frequency modulation of the cutoff, scaled by *FM Depth*. |

Every knob is also an input (`specs.md` section 7.3). *Cutoff* modulation
works in octaves, as on the Filter.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out 1 … Out 8 | `audio` | The responses chosen in the *Out 1 … Out 8* settings (defaults in 3). |
| Morph | `audio` | A continuous crossfade through Out 1 → Out 8 by the *Morph* knob. |
| Env | `control` (unipolar) | Envelope follower on the 4-pole low-pass (5 ms / 120 ms). |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Cutoff | 20 Hz – 20 kHz (exponential) | 1 kHz | Corner / centre frequency of every response. |
| Resonance | 0–100 % | 20 % | Feedback of the core. Self-oscillates from about 90 %. |
| Drive | 0–100 % | 0 % | Input gain into the core's saturator (0 dB … +24 dB). |
| Comp | 0–100 % | 50 % | Passband compensation: how much the low-frequency loss caused by resonance is made up (4.3). |
| Key Track | 0–100 % | 0 % | How far *Pitch* moves the cutoff. 100 % = one octave per octave. |
| FM Depth | 0–100 % | 0 % | Scale of the *FM* input: cutoff × (1 + 4 · depth · FM), clamped. |
| Morph | 0–100 % | 0 % | Position for the *Morph* output: 0 % = Out 1, 100 % = Out 8. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Out 1 … Out 8 | LP1, LP2, LP3, LP4, BP2, BP4, HP2, HP4, Notch, All-pass | LP1, LP2, LP4, BP2, BP4, HP2, HP4, Notch |
| Saturation | Clean, Soft | Soft |

With the defaults every family is present; LP3 and All-pass are one click
away on any jack, and the same response may be chosen twice (for example to
feed two places with independent cable amounts).

## 4. Behaviour

### 4.1 The core

Four TPT one-pole low-pass stages (`OnePole` from
`patch/modules/filter/dsp/VaFilters.h`) in a cascade, with negative global
feedback from the last stage to the input:

```
 x ─► drive ─► (−) ─► u ─► [1-pole] ─► y1 ─► [1-pole] ─► y2 ─► [1-pole] ─► y3 ─► [1-pole] ─► y4
               ▲                                                                    │
               └──────────────── k · sat(y4) ◄─────────────────────────────────────┘
```

`u = x − k · sat(y4)`. All stages share the prewarped gain `G = g / (1 + g)`.
The zero-delay feedback equation is solved in closed form for *Clean*
(`u = (x − k·S) / (1 + k·G⁴)`, S being the stages' state contribution) and
with one or two Newton steps for *Soft*, reusing `solveFeedback` from
`VaFilters.h`. `k = 4.4 · Resonance`; the core oscillates where `k` passes 4.

This core has the same mathematics as the Filter's transistor-ladder types;
the Multi-out Filter does not add another ladder sound. What is new is the
output stage: all responses at once, compensation per response and an
amplitude-controlled sine at the top.

### 4.2 Responses by pole mixing

With `y0 = u` (the feedback node), each response is a fixed mix of the five
taps — binomial coefficients of `(1 + s)^−n` expansions:

| Response | Mix of y0 … y4 | Slope / shape |
|---|---|---|
| LP1 | `y1` | 6 dB/oct |
| LP2 | `y2` | 12 dB/oct |
| LP3 | `y3` | 18 dB/oct |
| LP4 | `y4` | 24 dB/oct |
| BP2 | `2 · (y1 − y2)` | 6 dB/oct each side |
| BP4 | `4 · (y2 − 2y3 + y4)` | 12 dB/oct each side |
| HP2 | `y0 − 2y1 + y2` | 12 dB/oct |
| HP4 | `y0 − 4y1 + 6y2 − 4y3 + y4` | 24 dB/oct |
| Notch | `y0 − 2y1 + 2y2` | zero at the cutoff |
| All-pass | `y0 − 4y1 + 4y2` | flat level, 360° phase turn |

The gains of BP2 and BP4 put their peaks at 0 dB without resonance. Each
output costs a handful of multiply-adds, so all eight are almost free once
the core runs. Resonance appears in every response (the feedback acts on
`u`), so a resonant HP4 and a resonant LP4 peak at the same frequency.

### 4.3 Compensation

Feedback of the 4-pole low-pass lowers the passband by `1 / (1 + k)`. *Comp*
multiplies the core's input by `(1 + k)^Comp`, so at Comp 0 % resonance thins the
bass (the classic behaviour), at 100 % the low-pass keeps full level at any
resonance, and 50 % is in between. The compensated gain applies to every
response, so the high-passes get louder with resonance at high *Comp*;
outputs are scaled per response so that the passband (LPs: DC, HPs: Nyquist,
BPs: the peak at Resonance 0) stays at 0 dB ±1 dB at Comp 100 %.

### 4.4 Self-oscillation as a sine

From about 90 % the core rings at the cutoff. The ZDF topology puts the
oscillation exactly at the prewarped cutoff, so with *Key Track* 100 % it
plays in tune (±2 cents from C1 to C7 at 48 kHz).

- **Soft** saturation is a `tanh` on the feedback tap with an amplitude
  target: the loop gain is reduced by a slow (20 ms) level detector when
  `|y4|` exceeds 0.8, so the oscillation settles at about ±1 with low
  harmonic distortion (THD below 1 % on LP4) instead of the squarish
  clipping of a plain saturator. LP4 is then the purest sine; BP4 and the
  others carry the same sine with different phase and level.
- **Clean** has no saturation; above `k = 4` the output would grow without
  bound, so in *Clean* `k` is capped at 3.98 (rings, never runs away).
- With no input, the oscillation needs a seed: a −120 dB seeded noise
  (deterministic per node, so renders repeat) is added to the input while
  *Resonance* is above 85 %.

### 4.5 Cutoff

`fc = 20 Hz · 2^(c + KeyTrack · Pitch)` with `c` the knob in octaves (0…10),
then `fc ← fc · (1 + 4 · FMDepth · FM)`, clamped to 5 Hz … 0.45 · fs. A
negative product clamps at 5 Hz rather than going through zero (a filter has
no negative cutoff). Coefficients are computed per sample when anything
modulates the cutoff (one `tan`), once per sub-block otherwise. For audio-rate
FM above a few kHz, a fast `tan` approximation (error < 0.1 % below 0.45 · fs)
is used.

### 4.6 Morph output

`Morph` crossfades linearly between neighbouring outputs in jack order:
position `7 · Morph`, e.g. 50 % sits halfway between Out 4 and Out 5. With the
default assignment, sweeping *Morph* goes LP1 → LP2 → LP4 → BP2 → BP4 → HP2
→ HP4 → Notch: one cable on *Morph* gives the multimode sweep of a single
filter, with the order chosen by the jacks' settings.

### 4.7 Edge cases and CPU

- **Unpatched outputs** are not mixed (needs `ctx.outputConnected`, 7); the
  core always runs.
- **Setting changes** on an output jack crossfade the old and new response
  over 10 ms.
- **Saturation change** keeps the stage states (no reset): the core is the
  same, only the feedback nonlinearity changes.
- **Denormals:** stage states flushed below 1e−20.
- **CPU:** one four-pole core (with Newton steps in *Soft*) plus up to nine
  mixes: about the cost of the Filter's *Ladder Tanh*, i.e. one Filter module,
  for eight outputs.

## 5. Module view

The usual knobs and settings, plus a response display:

```
 ┌───────────────────────────────────────────────────────────────┐
 │ dB   LP4 ━━━━━━━━━╮            ┌ legend: 1 2 3 4 5 6 7 8       │
 │      BP2 ─ ─ ─ ─╱ ╲ ─ ─ ─      │  (click to show/hide)         │
 │      HP4 ......╱   ╲........   │                               │
 │                    ▲ cutoff                        20 Hz…20 kHz│
 └───────────────────────────────────────────────────────────────┘
 [Out 1 LP1 ▾] [Out 2 LP2 ▾] … [Out 8 Notch ▾]
```

- One curve per output, in eight distinct colours that also tint the output
  jacks on the node; the *Morph* curve is drawn bold. Patched outputs are
  shown by default, unpatched ones dimmed.
- Dragging horizontally on the plot sets *Cutoff*, vertically *Resonance*
  (one undo step per drag).
- A row of eight dropdowns sets the response per output jack. The node shows
  each jack's response name as its label (*LP4*, *BP2* …), so the canvas reads
  correctly without opening the view.
- Above 90 % resonance a small tuner shows the oscillation's note and cents.

## 6. Saved state

Only knob and setting values; no node data. The eight output assignments are
ordinary settings (`out1` … `out8`), so they are saved, undoable and copied
with the node.

```json
{
  "type": "multi-out-filter",
  "params": { "cutoff": 0.5674, "resonance": 0.2, "drive": 0.0,
              "comp": 0.5, "keyTrack": 0.0, "fmDepth": 0.0, "morph": 0.0,
              "out1": 0.0, "out2": 0.1111, "out3": 0.3333, "out4": 0.4444,
              "out5": 0.5556, "out6": 0.6667, "out7": 0.7778, "out8": 0.8889,
              "saturation": 1.0 }
}
```

## 7. Engine requirements

1. **Output connection flags** `ctx.outputConnected` (also requested by the
   Filter Bank), to skip unpatched mixes.
2. **Jack labels from settings:** an output's display name can follow a
   setting's value (`ModuleSpec` output label callback), so *Out 3* shows as
   *LP4*. Saved cables keep referring to the stable jack ids `out1` … `out8`.
3. **Shared primitives:** `OnePole`, `prewarp` and `solveFeedback` move from
   `patch/modules/filter/dsp/VaFilters.h` to `patch/common/dsp/` so both
   modules use the same code.

## 8. Tests

- Each response, Resonance 0, against the analytic magnitude at 0.25×, 1×, 4×
  the cutoff (within 0.5 dB): LP slopes 6/12/18/24 dB/oct, HP2/HP4, BP peaks
  at 0 dB, notch below −40 dB at the cutoff, all-pass flat within 0.1 dB.
- All-pass: phase at the cutoff is 180° (±2°).
- Resonance peak: all resonant responses peak at the same frequency.
- Comp 100 %: LP4 DC gain within 1 dB of 0 dB for every Resonance.
- Self-oscillation (*Soft*, Resonance 100 %, no input): starts within 100 ms,
  amplitude 0.8–1.2, LP4 THD < 1 %, frequency within 2 cents of the cutoff
  at 100 Hz, 1 kHz, 5 kHz; same Seed → identical render.
- Key Track 100 %: oscillation follows *Pitch* 1 V/oct over six octaves.
- Clean at Resonance 100 % with full-scale noise stays bounded (no growth over
  10 s).
- Morph 50 % equals the average of Out 4 and Out 5.
- Output setting change: no sample step above 0.05 on a sine.
- Audio-rate FM at Depth 100 %: stable, no NaN.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Stereo: In L/R with a *Stereo Offset* knob moving the right channel's
  cutoff (the Dual Filter covers two-cutoff shapes meanwhile).
- More mixable responses: low/high shelves and a "peak" response from the
  same taps; user-defined tap mixes (five sliders per jack).
- A per-jack level knob.
- A 2-pole core option (an SVF tapped the same way) for a lighter, brighter
  character.
