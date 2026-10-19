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
| Tuning | 12 Notes, Equal Divisions, Scale File | 12 Notes |
| Divisions | 5 … 72 (with Equal Divisions) | 19 |

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

### 4.3a Microtonal tunings

*Tuning* replaces the 12-note grid. The shared type is `dsp::Tuning` in `Scales.h`: up to 128 degrees per period, as cents above the root, ascending from 0,
repeating every `period` cents (1200 for an octave). `index(octaves, rounding)` returns the nearest (or next lower / higher) step of the infinite ladder and
`pitch(index)` its pitch in octaves; both are allocation-free and the 12-note functions are unchanged.

- **Equal Divisions:** `Tuning::edo(Divisions)`, 5 – 72 equal steps of the octave. *Scale* and the keyboard are not used; *Root* still moves the grid by whole semitones.
- **Scale File:** a text file in the common scale-file format, loaded in the view (button *Load scale file…*). Lines starting with `!` are comments; the next line is a description; then the
  number of notes N (1 – 128); then N pitches, each either cents (contains a `.`: `701.955`) or a ratio (`3/2`, or a whole number) and anything after a space is ignored. The last
  pitch is the period (usually `2/1`), the others are the degrees above the root `1/1`. Pitches must rise and stay below 10 octaves. A file that doesn't parse is refused and the
  view shows why. The text (at most 16 KB) lives in the node's data (`scaleText`, `scaleName`; `scaleNotes`, `scalePeriod`, `scaleError` are written by the module). With *Scale File*
  chosen and no usable file, the module quantizes to 12 equal steps.
- **Hysteresis** is a fraction of the tuning's average step (period ÷ number of notes).
- **Notes In:** a note's quantized pitch is exact in the outgoing event (`pitch` field, octaves); its note number is the nearest key. The note-off ends the same note.
- *Out* carries the exact pitch. *Trigger* and *Gate* fire when the step changes.

Presets and boards from before are unaffected: new settings default to *12 Notes*, which takes exactly the old path.

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
- Tunings (`common/dsp/tests/test_tuning.cpp`): equal divisions (19 steps, 12 = semitones), scale-file parsing (cents, ratios, CRLF, rejects), nearest / down / up rounding, and the Quantizer core on 24 divisions with a root and back to 12 notes.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Chord output (*Out 2–4*: the 3rd, 5th, 7th of the scale above *Out*).
- Note weights / probabilities in the custom scale.
- Microtonal tunings in the Quantizer Suite, Chord Quantizer and Harmony Master (the Quantizer has them, §4.3a; they share `dsp::Tuning`).
