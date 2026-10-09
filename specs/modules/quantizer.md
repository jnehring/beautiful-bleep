# Quantizer

Type id `quantizer` · category *Utility* · colour proposal `#93c5fd`

## 1. Purpose

Snaps a pitch signal to the notes of a scale, so any modulator becomes a
melody. It shares the scales of the *Step Sequencer* and adds a custom
scale drawn on a keyboard, transposition before and after quantizing, and a
trigger whenever the note changes. *Utility*'s *Quantize* mode only rounds to
semitones; this is the musical version.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In | `pitch` | The signal to quantize, 1 V/oct (0.0 = C4). Any float signal works: a bipolar LFO spans two octaves. |
| Clock | `trigger` | Optional. Patched: the output only changes on a clock (sample and hold, then quantize). Unpatched: continuous. |
| Transpose | `pitch` | Added **before** quantizing, so the result stays in the scale. |
| Shift | `pitch` | Added **after** quantizing (chromatic transposition; the result can leave the scale). |
| Root In | `pitch` | Optional. Patched: overrides the *Root* setting with the input's semitone within the octave (so another quantizer or a sequencer can set the key). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out | `pitch` | The quantized pitch, plus *Shift*. |
| Trigger | `trigger` | A pulse whenever *Out* changes to another note. |
| Gate | `gate` | Low for one millisecond at each note change, high otherwise, so CV to Notes or an envelope retriggers per note. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Range | 0…4 octaves | 1 octave | Gain on *In* before quantizing. A bipolar LFO at full scale spans ±*Range*. |
| Hysteresis | 0…50 % of a semitone | 10 % | The input must move this far past the midpoint between two notes before the output changes; stops flicker on noisy or slow inputs. |
| Glide | 0…2 s | 0 | A slew on *Out* (the trigger still fires at the note change). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Root | C … B | C |
| Scale | the 17 scales of `patch/common/dsp/Scales.h`, plus *Custom* | Major |
| Rounding | Nearest, Down, Up | Nearest |

## 4. Behaviour

### 4.1 Signal path

```
In × Range + Transpose → (Clock: sample & hold) → quantize (Root, Scale, Rounding, Hysteresis)
   → + Shift → Glide → Out
```

Quantizing uses `dsp::quantize` from `Scales.h` for *Nearest* (ties go down,
as in the Step Sequencer). *Down* takes the highest scale note at or below the
input, *Up* the lowest at or above it.

*Range* is relative to 1 V/oct: at 1 octave, an input of +1 is one octave up.
*Range* applies to *In* only, not to *Transpose*.

### 4.2 Hysteresis

The quantizer remembers the current note. It moves to a new note only when
the input lies in the new note's band by more than *Hysteresis* (measured in
semitones from the boundary between the two). At 0 it behaves exactly like
plain quantizing.

### 4.3 Custom scale

*Custom* uses a 12-note mask the user sets in the view by clicking keys on a
one-octave keyboard (relative to *Root*). An empty mask behaves as
chromatic, like `Scales.h` already does. Clicking a key while another scale is
selected copies that scale into the mask and switches *Scale* to *Custom*,
so any scale is a starting point.

### 4.4 Triggers

*Trigger* and *Gate* fire when the quantized note (before *Shift* and *Glide*)
changes. A change in *Shift* alone does not fire them. With *Clock* patched
they fire at most once per clock, and only if the note is different.

## 5. Module view

A one-octave keyboard showing the scale (lit keys) and the current note
(highlighted), plus the knobs and settings. Clicking a key toggles it in the
custom scale (see 4.3). Below the keyboard, the note name of *Out* (e.g. "E4").

## 6. Saved state

Knob and setting values, plus node data for the custom mask:

```json
{ "customMask": 2741 }
```

(12 bits, bit *k* = *k* semitones above the root.) `sanitiseData` keeps the
lower 12 bits and defaults to the Major mask.

## 7. Engine requirements

- `Scales.h` gains `quantizeDown` and `quantizeUp` next to `quantize`.
- `liveValues` for the current note (keyboard highlight).

## 8. Tests

- A slow ramp from −1 to +1 at Range 1 octave produces exactly the scale notes in order, each once, for every scale.
- Ties go down with *Nearest*; *Down* and *Up* pick the correct neighbours.
- Transpose before quantizing stays in scale; Shift after does not.
- Root In: a pitch of 4/12 (E4) or 16/12 (E5) sets the root to E.
- Hysteresis: a sine of ±0.05 semitone around a boundary causes no change with 10 %, but does with 0 %.
- Clock patched: output changes only on clock pulses; Trigger fires only when the note differs.
- Custom mask round-trips through node data; empty mask is chromatic.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Chord output (*Out 2–4*: the 3rd, 5th, 7th of the scale above *Out*).
- Note weights / probabilities in the custom scale.
- Microtonal scales (scala files) and non-12-EDO tunings.
