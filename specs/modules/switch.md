# Switch

Type id `switch` · category *Utility* · colour proposal `#c4b5fd`

## 1. Purpose

A four-way selector that works in both directions: four inputs to one output
(*Merge*), or one input to four outputs (*Split*). The position is chosen by a
knob, a CV, or by stepping on each clock pulse, so the Switch can be a manual
source selector, a CV-addressed router, or a sequential switch that cycles
melodies, rhythms or effect paths.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In 1–4 | `control` | *Merge*: the four sources. *Split*: only *In 1* is used. Unpatched sources read 0. |
| Step | `trigger` | Advances the position by one (see 4.2). |
| Reset | `trigger` | Sets the step position to the first position. |

`control` inputs accept `audio`, `pitch` and `gate` signals (`specs.md`
section 7.4), and the outputs pass them through unchanged, so one module routes
any float signal.

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out 1–4 | `control` | *Merge*: only *Out 1*, the selected input. *Split*: *In 1* at the selected output; the other outputs hold or go to 0 (see *Idle*). |
| Position | `control` (unipolar) | The current position, (index − 1) / (Length − 1). |
| Changed | `trigger` | A pulse whenever the position changes. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Select | 0…1 | 0 | Manual position, divided evenly over *Length* positions. Added to the step position (modulo *Length*), so CV can offset a stepping switch. |
| Fade | 0…50 ms | 2 ms | Crossfade time on a change. 0 switches hard (for gates and stepped CV). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Direction | Merge (4 → 1), Split (1 → 4) | Merge |
| Length | 2, 3, 4 | 4 |
| Order | Forward, Backward, Ping-Pong, Random | Forward |
| Idle | Zero, Hold | Zero |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Position

`position = (stepPosition + floor(Select × Length)) mod Length`, with
`Select = 1` treated as the last position. *Select* is read per sample, so an
audio-rate signal on *Select* makes a waveform from four sources (a crude
wavetable).

### 4.2 Stepping

Each *Step* trigger moves `stepPosition` through 0 … Length − 1 by *Order*:
*Forward*, *Backward*, *Ping-Pong* (ends not repeated) or *Random* (seeded,
never the same twice in a row). The seeded sequence restarts on *Reset*, so a
reset pattern repeats identically on every render. *Reset* and *Step* on the
same sample: Reset first, then the step is ignored, so the first position plays.

### 4.3 Fade

On a position change, the old and new connection crossfade linearly over
*Fade*. 2 ms removes clicks from audio. For gates and pitch, set it to 0 so the
change is exact; *Fade* above 0 on a pitch signal makes a short glide.

### 4.4 Idle outputs (Split)

In *Split*, the unselected outputs go to 0 (*Zero*) or keep their last value
(*Hold*). *Hold* makes the Switch a demultiplexing sample and hold: one
random source into *In 1*, stepped by a clock, gives four independent held
values.

## 5. Module view

Four lamps (inputs or outputs, by *Direction*) with the current position lit,
the knobs and settings, and an arrow diagram that flips with *Direction*.
Clicking a lamp sets *Select* to that position.

## 6. Saved state

Only knob and setting values; no node data. The step position is not saved;
a loaded board starts at the first position (or where *Select* points).

## 7. Engine requirements

- The seeded random shared with *Random* and the *Step Sequencer* (`patch/common/dsp/Random.h`).
- `liveValues` for the current position.

## 8. Tests

- Merge: Select 0, 0.25, 0.5, 0.75 at Length 4 picks inputs 1–4; Length 3 maps Select evenly over three.
- Split: In 1 appears only at the selected output; Idle Zero vs Hold.
- Step: Forward, Backward, Ping-Pong sequences are correct; Random never repeats and is identical after Reset for the same Seed.
- Select offsets the step position modulo Length.
- Fade 0 switches on the exact sample; Fade 2 ms gives a linear crossfade of 2 ms.
- Changed fires once per position change and never otherwise.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Eight positions.
- A *Probability* knob for skipping steps.
- Stereo audio pairs (In L/R per position).
