# Quantizer Suite

Type id `quantizer-suite` · category *Utility* · colour proposal `#7cb7f5`

## 1. Purpose

Four quantizer channels in one module, each with its own **mode**: plain
quantizing to a scale with a mask of allowed notes, transposing by scale
steps, arpeggiating through a chord, or following the board's harmony (a
*Harmony Master*). Unpatched inputs take the previous channel's signal, so one
melody fed into channel A gives a diatonic harmony on B–D with no extra
cables. A merged *Notes* output plays the four channels on a Voice Cell.

The single-channel *Quantizer* (`quantizer.md`) is the simple, everyday
version, and *Utility*'s *Quantize* mode only rounds to semitones. Quantizer
Suite is for harmony and arpeggios from few sources. It outputs one note per
channel; *Chord Quantizer* builds voiced chords from one input.

## 2. Jacks

**Inputs** (per channel A–D, plus one shared)

| Jack | Type | What it does |
|---|---|---|
| In A … In D | `pitch` | The pitch to quantize, 1 V/oct. Unpatched: In B takes In A's signal, C takes B's, D takes C's (normalling). |
| Trig A … Trig D | `trigger` | Sampling and arpeggio clock (4.3). Unpatched: normalled to the previous channel's Trig like the inputs. |
| Reset | `trigger` | Restarts every channel's arpeggio at its first tone. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out A … Out D | `pitch` | The channel's result, after *Slew*. |
| Change A … Change D | `trigger` | A pulse when the channel's note changes (before slew), or at each sample trigger in *Trigger* sampling even if the note repeats. |
| Notes | `notes` | All four channels as notes, channel A–D on note channels 1–4 (4.6). |

## 3. Controls

Per channel (A–D):

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Steps | −14…+14 (stepped) | A 0, B +2, C +4, D +6 | Scale steps (*Transpose*, *Follow* · *Scale*), chord-tone steps (*Follow* · *Chord*), or arpeggio offset (*Arp*). Ignored (and hidden) in *Quantize*; ignored in *Follow* · *Chord + Scale* and *Root*. |
| Slew | 0–2 s | 0 | Glide on *Out* (constant time per note change, linear in pitch). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Mode | Quantize, Transpose, Arp, Follow | A Quantize, B–D Transpose |
| Root | C … B | C |
| Scale | the 17 scales of `Scales.h` | Major |
| Harmony | Off, Bus A–D | Off |
| Sample | Continuous, Trigger, Track & Hold | Continuous |
| Octave | −3…+3 | 0 |
| Chord | Triad, Seventh, Sus2, Sus4, Fifth, Ninth, Octave | Triad |
| Order | Up, Down, Up-Down, Converge, Random | Up |
| Span | 1–4 octaves | 1 |
| Target | Scale, Chord, Chord + Scale, Root | Chord |
| Notes | on / off | on |

Shared: *Hysteresis* (knob, 0–50 % of a semitone, default 10 %), *Link* (on/off,
default on: B–D use channel A's Root, Scale and Harmony; their own settings are
hidden and kept), *Velocity* (knob, 1–100 %, default 80 %), *Seed* (0–999,
default 0). *Hysteresis*, *Velocity* and the *Slew* knobs are read once per
32-sample chunk.

Settings are named per channel ("Mode A", "Root B", …); *Chord*, *Order* and
*Span* show only in *Arp*, *Target* only in *Follow*.

The allowed-note **mask** of each channel is node data (6), edited on the
keyboard.

## 4. Behaviour

### 4.1 Pitch path (per channel)

```
In → (sampling, 4.3) → quantize (scale ∧ mask, hysteresis) → mode (4.2)
   → + Octave → Out note → Slew → Out
```

Allowed notes are `scale ∧ mask`, relative to *Root* (bit k = Root + k
semitones). With *Harmony* on a valid bus, *Root* and *Scale* come from the
context's `key` and `scale` (`harmony-master.md` 4.1); the mask still applies,
relative to the context's key. An empty result allows only the root.

Quantizing is the shared `Scales.h` `quantize` (nearest, ties down) with the
Quantizer's hysteresis rule (`quantizer.md` 4.2): the channel remembers its
note and only moves when the input is more than *Hysteresis* past the
midpoint into another note's band.

### 4.2 Modes

Let `q` be the quantized input as an index into the ordered list of allowed
notes (all octaves), and `n(x)` the note of index `x`.

- **Quantize.** `Out = n(q)`.
- **Transpose.** `Out = n(q + Steps)`: Steps moves in allowed notes, so +2 in
  C major turns C into E, A into C (an octave up). With the default Steps
  (0, 2, 4, 6) and normalled inputs, one melody into In A gives four voices
  in diatonic thirds (a seventh chord moving with the melody).
- **Arp.** At each Trig, the channel builds a chord on `n(q)` from scale steps
  (*Chord*: Triad 0 2 4, Seventh 0 2 4 6, Sus2 0 1 4, Sus4 0 3 4, Fifth 0 4,
  Ninth 0 2 4 6 8, Octave 0) over *Span* octaves, giving a tone list of
  `t · Span` notes, low to high. The arpeggio index `a` advances one per
  Trig through that list in *Order*:
  - *Up* 0, 1, … t·Span−1, 0 …; *Down* the reverse;
  - *Up-Down* 0 … top … 1, 0 … (ends not repeated);
  - *Converge* lowest, highest, second lowest, second highest, …;
  - *Random* `floor(uniform01(Seed, counter, channel) · size)`, never the same
    tone twice in a row when size > 1.
  `Out = tone[(a + Steps) mod size]`. The input is re-sampled at every Trig,
  so a moving input changes the chord while the index keeps running (mod the
  new size). *Reset* sets `a = 0` on all channels. With no Trig patched on this
  or any earlier channel, the arpeggio advances at 1/16 notes from the
  transport (`step = floor(ppq / 0.25)`, so it is phase-locked). *Chromatic*
  as the scale builds major-quality chords (Triad 0 4 7, Seventh 0 4 7 10,
  Sus2 0 2 7, Sus4 0 5 7, Fifth 0 7, Ninth 0 4 7 10 14, Octave 0) instead of
  clusters. Tones that coincide (wide spans) count once. The transport-driven
  arpeggio's notes end when the transport stops and start again at the next
  step; *Reset* makes the next step index 0.
- **Follow.** Needs *Harmony* on a bus (otherwise acts as *Quantize* and
  shows "no harmony"). With the context's chord tones `C` (all octaves):
  - *Scale*: as Quantize on the context's scale;
  - *Chord*: nearest note of `C`, then `Steps` chord tones up or down: a
    harmoniser that always lands on the current chord;
  - *Chord + Scale*: nearest scale note, but if a chord tone is within one
    semitone of the input it wins (melodies keep passing notes, long notes land
    on the chord);
  - *Root*: the context's chord root in the octave nearest the input (a bass
    line that follows the chord changes from any contour).
  When the context changes (a chord change), a *Continuous* channel re-quantizes
  on that sample; a *Trigger* channel waits for its next Trig.

### 4.3 Sampling

- **Continuous:** In is read every sample; Out changes whenever the quantized
  note does.
- **Trigger:** In is sampled on each Trig pulse and held.
- **Track & Hold:** Trig is read as a gate: Out follows In while it is high and
  holds while it is low.

Normalled Trig (unpatched → previous channel's) makes one clock on Trig A
sample all four channels. *Arp* always advances on Trig, regardless of
*Sample*. If no Trig reaches a channel in *Trigger* mode, it behaves as
*Continuous*.

### 4.4 Slew

*Slew* moves Out from the old to the new note in a fixed time (so short and
long jumps take equally long), starting at the change sample. A new change
during a glide starts a new glide from the current value. Slew 0 jumps.
*Change* fires at the change, not at the end of the glide.

### 4.5 Order of channels

Channels are computed A → D each sample, so normalling never adds delay:
In B (unpatched) reads exactly In A's sample.

### 4.6 Notes output

Each channel with *Notes* on sends its Out note (before slew) on note channel
1–4 (A–D) with *Velocity*: on each change a note-on for the new note, then the
note-off for the old one on the same sample (legato, as the Step Sequencer's
ties); a retrigger on the same note sends note-off then note-on. Notes end when
the transport stops (if the channel is clocked from the transport), when the
channel's Notes setting is turned off, or when the module is removed. Pitches
outside MIDI 0–127 are folded by octaves into range.

## 5. Module view

Four channel strips side by side (A–D), each with:

- the *Mode* (the generic settings and knobs, grouped per channel, show the
  mode's settings and hide the unused ones; tabs are *Later*), *Steps* and
  *Slew* knobs;
- a one-octave keyboard: scale notes lit, masked-out notes crossed, the current
  note highlighted, chord tones dotted in *Arp* and *Follow*. Clicking a lit
  key toggles it in the mask (one undo step);
- the note name of *Out* (`E4`) and a small arpeggio position bar in *Arp*.

A shared row holds *Link*, *Hysteresis*, *Velocity* and *Seed*. With *Link* on,
B–D show A's scale on their keyboards and their Root/Scale/Harmony are greyed.

## 6. Saved state

Knob and setting values, plus the four masks:

```json
{
  "type": "quantizer-suite",
  "params": { "a.mode": 0.0, "b.steps": 0.571, … },
  "data": { "masks": [4095, 4095, 4095, 4095] }
}
```

Each mask is a 12-bit integer relative to the channel's root (bit 0 = root).
`sanitiseData` pads to four entries with 4095 and masks values to 12 bits. A
new module allows all notes.

## 7. Engine requirements

- **Harmony bus** from `harmony-master.md` section 7: each channel's *Harmony*
  setting is declared through `ModuleSpec::harmonyFollow` (one module may
  follow several buses; the compiler adds an edge per bus used).
- **Normalled inputs** use `inputConnected`, as the Attenuverter does.
- Node data for the masks (`sanitiseData`, `setData`) and `liveValues` (each
  channel's note, arpeggio index, mask-effective scale) for the view.
- Shared code: `Scales.h` (quantize), `Chords.h` / `Harmony.h` (chord tones,
  `quantizeSemis`, `stepSemis`, `chordSemis`). The hysteresis helper is in the
  module's own header for now (Chord Quantizer has the same rule); it should
  move to `patch/common/dsp/` when the single Quantizer is built.
- Harmony: the module is a `HarmonyRole::Reader` (every Harmony Master runs
  first); each channel reads `ctx.harmony[bus]`, one context per chunk.
- Notes: a change waits while the chunk's note buffer has no room, so no
  note-off is dropped.

## 8. Tests

- Quantize: every scale ∧ mask combination from a table; empty mask gives the
  root; hysteresis holds a note until the margin is passed.
- Transpose: Steps ±14 across octave boundaries in 5-, 7- and 8-note scales.
- Normalling: one signal into In A with defaults gives the four diatonic
  seventh-chord tones on Out A–D on the same sample.
- Arp: each Order on a 3-note, 1-octave chord gives the documented sequence;
  Random never repeats and is identical for the same Seed; Reset returns to
  index 0; transport-driven arp lands on 1/16 boundaries.
- Follow: Chord target lands only on chord tones; Chord + Scale keeps passing
  notes; Root follows chord changes; a Continuous channel re-quantizes on the
  exact sample of a chord change; no bus → behaves as Quantize.
- Sampling modes and Slew timing (constant time, restart mid-glide).
- Notes: legato order on change, retrigger order on repeats, four channels on
  note channels 1–4, no hanging notes after stop, Notes off and removal.
- Masks round-trip; broken data loads safely.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Per-channel *Range* (input gain) and a *Shift* after quantizing, as the
  single Quantizer has.
- Per-step arpeggio patterns (rests, repeats) in node data.
- Microtonal scales and user scale libraries.
- Velocity from the input's speed of change, or per-channel velocity inputs.
