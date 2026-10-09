# CV Mixer

Type id `cv-mixer` · category *Utility* · colour proposal `#c4b5fd`

## 1. Purpose

Combines up to four control signals into one, in more ways than adding them.
Each channel has a bipolar level. A *Mode* chooses how the channels combine:
sum, average, the highest or lowest value, or a crossfade that scans across
the four. Use it to blend modulators, to build complex shapes from simple
ones, or to pick between sources with one knob.

Fan-in (`specs.md` section 7.2) already sums cables on any input. The CV Mixer
is for when the result needs its own level, offset or a combine mode other
than sum, or must feed several destinations.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In 1–4 | `control` | The channels. Unpatched: In 1 reads a constant +1, so *Level 1* becomes a manual offset; In 2–4 read 0. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out | `control` (bipolar) | The mix, after *Master*, *Offset* and *Clip*. |
| Inv | `control` (bipolar) | `−Out`. |
| Abs | `control` (unipolar) | `|Out|`, clipped to 0…1 when *Clip* is on. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Level 1–4 | −1…+1 | +1 (1), 0 (2–4) | Bipolar level per channel. |
| Scan | 0…1 | 0 | Only in *Scan* mode: position across channels 1→4. |
| Master | 0…2 | 1 | Gain on the combined signal. |
| Offset | −1…+1 | 0 | Added after *Master*. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Mode | Sum, Average, Max, Min, Scan | Sum |
| Clip | Off, Soft (±1), Hard (±1) | Soft |

## 4. Behaviour

### 4.1 Combining

With `c_n = In n × Level n`. A channel is **active** when its input is
patched; channel 1 is also active when unpatched with a *Level* other than 0
(it is then a manual offset).

| Mode | Mix |
|---|---|
| Sum | `c_1 + c_2 + c_3 + c_4` |
| Average | Sum divided by the number of active channels (none active → 0) |
| Max | the largest `c_n` over active channels (none → 0) |
| Min | the smallest `c_n` over active channels (none → 0) |
| Scan | linear crossfade between neighbouring channels: `Scan × 3` gives the position, 0 = channel 1, 1 = channel 4; channels outside the two neighbours are silent |

`Out = clip(Mix × Master + Offset)`.

Max and Min are the analogue *OR* and *AND* of modular synthesis: Max of two
LFOs gives a shape that follows whichever is higher. Max of an envelope and a
slow LFO gives a floor the envelope can't fall below.

In *Max* and *Min*, inactive channels are ignored, not counted as 0. Otherwise
`Min` of positive signals would always be 0.

### 4.2 Clip

Same as the *Attenuverter*: *Soft* is linear up to ±0.8 and bends smoothly
into ±1, *Hard* a clamp, *Off* none. Default *Soft*, because summing four full-scale modulators
easily exceeds the range most destinations expect.

## 5. Module view

Four channel strips side by side, each with its *Level* knob and a centre-zero
bar meter. To the right: *Mode*, *Master*, *Offset*, and a small scope
of *Out* (the last two seconds). In *Scan* mode, the *Scan* knob appears under
the strips, and the channel strips light up with their current weight.

The first version uses the generic module view (knobs and settings); the
displays described here come later.

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

None. `inputConnected` decides which channels count as patched.

## 8. Tests

- Sum: inputs 0.2, 0.3, unpatched, unpatched, levels 1 → Out 0.5 (Clip Off).
- Average: same → 0.25; In 1 unpatched with Level 0 and nothing else → 0.
- Max / Min choose the right channel and ignore inactive ones.
- Scan at 0, 1/3, 2/3, 1 outputs channel 1, 2, 3, 4 exactly; 1/6 is an equal blend of 1 and 2.
- Master and Offset applied after the mix; Inv = −Out; Abs = |Out|.
- Soft clip: output stays within ±1; values within ±0.8 pass unchanged.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- *Scan* with an equal-power curve and a *Width* control (several channels audible at once).
- More channels via an expander-style *Chain* input (another CV Mixer's Out summed in).
- A *Product* mode (four-quadrant multiply of all channels). Until then, use the *Multiplier*.
