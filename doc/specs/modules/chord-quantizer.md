# Chord Quantizer

Type id `chord-quantizer` · category *Utility* · colour proposal `#9f8cf7`

## 1. Purpose

One pitch in, a voiced chord out: up to four quantized pitches and a *Notes*
output. The input is quantized to a chord root (chromatic, to a scale degree,
or to the board's harmony), a chord of the chosen quality is built on it, then
inverted and voiced (close, drop-2, spread, open). With *Voice Leading* on,
each new chord picks the inversion and octave that moves the voices least, so
a jumpy sequence becomes smooth chord changes. A trigger input samples the
chord on the beat.

It is the control-signal sibling of *Chord Osc* (`chord-oscillator.md`), which
builds the same chords as **audio**. Chord Quantizer makes **pitches and
notes**, so the chord can play any Voice Cell, a MIDI instrument in Live via a
port, or several separate oscillators. It shares Chord Osc's chord table and
diatonic stacking (`patch/common/dsp/Chords.h`). *Harmony Master* publishes the
board's current chord in a fixed close position; Chord Quantizer voices chords
from its own input, optionally following that harmony.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Pitch | `pitch` | Selects the chord root (4.1) and, with *Anchor*, the register. |
| Trig | `trigger` | Patched: the chord is sampled at each pulse and held (4.4). Unpatched: continuous. |
| Gate | `gate` | Optional. Patched: *Notes* sound only while it is high (4.5). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Voice 1 … Voice 4 | `pitch` | The voiced chord, low to high (Voice 1 = bass). Unused voices repeat the highest one. |
| Root | `pitch` | The chord root in the octave of Voice 1 or above it, whatever the inversion. |
| Notes | `notes` | The voiced chord as notes (4.5). |
| Change | `trigger` | A pulse whenever the voiced chord changes. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Chord | stepped, one step per entry of the chord list | Major / Triad | Quality (chromatic) or stack (diatonic), as Chord Osc's *Chord* knob. Two stepped knobs share the name: the chord table's first 24 entries (Unison … Quartal) shown in *Chromatic*, the 10 scale stacks shown in *Diatonic*; neither is shown in *Follow*. |
| Inversion | −3…+3 (integer) | 0 | As Chord Osc 4.3 step 2. Ignored while *Voice Leading* chooses. |
| Strum | 0–100 ms | 0 | Delay between successive voices at a change (4.6). |
| Velocity | 1–100 % | 80 % | Velocity of the *Notes* output. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Mode | Chromatic, Diatonic, Follow | Chromatic |
| Root | C … B (shown in Diatonic and Follow) | C |
| Scale | the 17 scales of `Scales.h` (shown in Diatonic and Follow) | Major |
| Harmony | Off, Bus A–D (shown in Diatonic and Follow) | Off |
| Voices | 1–4 | 4 |
| Voicing | Close, Drop 2, Drop 3, Spread, Open | Close |
| Voice Leading | Off, Smooth, Smooth + Top | Off |
| Anchor | Bass, Centre, Top | Bass |
| Range | 1–4 octaves | 2 |
| Strum Order | Up, Down | Up |
| Hysteresis | 0–50 % of a semitone | 10 % |

## 4. Behaviour

### 4.1 Finding the root

- **Chromatic:** the root is the input rounded to the nearest semitone (with
  hysteresis), quality from *Chord* (the chord table: Major, Minor, … Quartal).
- **Diatonic:** the input is quantized to *Root* + *Scale* (`Scales.h`, ties
  down, hysteresis); its degree `d` is the root and *Chord* chooses a stack
  of scale steps (Single, Fifth, Triad, Sus2, Sus4, Sixth, Seventh, Add9,
  Ninth, Quartal, as Chord Osc 4.4), so qualities follow the key. With
  *Harmony* on a valid bus, Root and Scale come from the context's `key` and
  `scale` (`harmony-master.md` 4.1).
- **Follow:** the chord **is** the context's current chord (`chordRoot`,
  `chord`, `bass`) and *Chord* is ignored; the input only sets the register
  (via *Anchor*). A sequence into Pitch then moves the chord's position while
  the harmony comes from the Harmony Master. A slash chord (`bass` ≠ root) is
  inverted so the bass is the lowest voice (without Voice Leading; otherwise
  *Inversion* applies as usual). Without a valid bus, Follow acts as Diatonic
  and shows "no harmony".

The tone count, dropping rules for fewer voices and doubling for more are Chord
Osc's (4.3 step 1): fifth, extension, seventh, third are dropped in that
order; extra voices double root, fifth, third an octave up.

### 4.2 Voicing

From the close chord (after *Inversion*), tones sorted low to high, numbered
from the top:

- *Close:* unchanged, within an octave where possible.
- *Drop 2:* the second from the top moves down an octave.
- *Drop 3:* the third from the top moves down an octave.
- *Spread:* the bass (lowest tone) moves down an octave, the others are
  rearranged as root–fifth–third–seventh upwards so adjacent voices are at
  least a fourth apart where possible (a wide pad voicing).
- *Open:* every second tone from the bottom (2nd, 4th) moves up an octave.

Voicings that need more tones than *Voices* fall back to *Close*.

**Anchor and register.** Let `p` be the input pitch in semitones (before
rounding). The voiced chord is shifted by whole octaves so that its bass
(*Bass*), its average (*Centre*) or its top voice (*Top*) is the closest
possible to `p`. *Range* limits the span: tones beyond `Range` octaves above
the bass fold down by octaves.

### 4.3 Voice leading

With *Voice Leading* on, *Inversion* is ignored. On each new chord the module
compares candidate voicings against the previous output `v_prev` (sorted):

- candidates: every inversion (0 … tones−1) of the chosen *Voicing*, each in the
  octave shifts that keep the anchor within ±1 octave of `p` (at most
  4 × 3 = 12 candidates for four voices);
- cost of a candidate `c`:
  `Σᵢ |cᵢ − v_prevᵢ| + 3 · unisons + 2 · |anchor(c) − p| / 12`,
  where `unisons` counts pairs of voices on the same pitch and the last term keeps the
  chord from drifting away from the input's register;
- *Smooth + Top* adds `4 · |c_top − v_prev_top|`, so the top voice moves as
  little as possible (a held melody note);
- the lowest cost wins; ties go to the lower candidate.

The first chord (or the first after Voice Leading is switched on) uses
*Inversion* as usual. The search runs at chord changes only, on the audio
thread, with no allocation.

### 4.4 Sampling

**Trig unpatched:** the chord is recomputed whenever the quantized root, the
context (*Follow*/*Harmony*), or a stepped knob (*Chord*, *Inversion*) changes;
hysteresis keeps a noisy input from flickering between roots (in *Follow* the
root's octave has the same hysteresis). Without Voice Leading the register
(octave shift from *Anchor*) also follows the input continuously, moving once
the anchor is more than 6 semitones + *Hysteresis* away from the input; with
Voice Leading the register is chosen at chord changes only.

**Trig patched:** *Pitch*, the context, *Chord* and *Inversion* are read only at
each pulse; the result is held until the next pulse. A pulse that produces the
same chord fires no *Change* (but retriggers *Notes*, 4.5). Before the first
pulse the module behaves as unpatched. A Trig on the same sample as a Harmony
Master chord change reads the new chord (`harmony-master.md` 7.3).

### 4.5 Notes output

- **Gate unpatched:** the chord sounds continuously. At a change, voices that
  keep their pitch keep sounding; changed voices send a note-on for the new
  pitch, then a note-off for the old one (legato, as the Step Sequencer's ties).
  With Trig patched, each pulse retriggers all voices (note-off, then note-on).
- **Gate patched:** note-ons when Gate rises (with the current chord), note-offs
  when it falls; a chord change while the gate is high behaves as above.
- Notes end when the module is removed or its inputs are unpatched; a Voice
  Cell also releases them (`specs.md` 8.3.1).

### 4.6 Strum

With *Strum* > 0, a change reaches voice `i` (in *Strum Order*: Up = bass first)
`i · Strum / (Voices − 1)` after the change (no delay with one voice). The Voice outputs and the Notes
output both follow the strummed times; *Change* fires at the first voice. A new
change during a strum cancels its pending voices and starts again from the
current state.

## 5. Module view

The usual knobs and settings, plus:

- the **chord name** (`Am7/C`, from the table) and, in *Follow*, the bus and
  the Harmony Master's chord;
- a **two-octave keyboard** with each voice drawn as a numbered dot at its key
  and the root marked; the previous chord shown faintly while *Voice
  Leading* is on, so the movement is visible;
- in *Diatonic*, the scale's chords as a row of seven buttons (I, ii, iii, …):
  clicking one previews it on the keyboard (no state change, no sound; click
  again to leave the preview).

## 6. Saved state

Only knob and setting values; no node data. The voice-leading memory
(`v_prev`) is runtime state and survives recompiles (modules are reused by
node id), but not saving; after loading, the first chord uses *Inversion*.

## 7. Engine requirements

- **Harmony bus** (`harmony-master.md` section 7) for *Follow* and the
  *Harmony* setting: the module is a `HarmonyRole::Reader` and reads
  `ctx.harmony[bus]` (one context per chunk; *Chromatic* ignores the bus).
- **Shared code:** `patch/common/dsp/Chords.h` (chord table, diatonic stacks,
  tone dropping and doubling, inversion and the Close/Drop voicings) is
  extracted from Chord Osc so both modules build identical chords; *Spread* and
  *Open* as defined here are `VoicingSpread` and `VoicingOpenUp` there; the
  voice-leading search is `leadChord` / `leadVoices`.
- **Delayed notes** for *Strum*: note events scheduled up to 100 ms ahead,
  held in the module and emitted in the right chunk (no engine change; a
  fixed-size queue in the module).
- `liveValues` / `liveArrays` for the view (voice pitches, the previous
  voices, chord quality index, root, the bus chord, the key and scale).
- Notes: a change waits while the chunk's note buffer has no room for it, so
  no note-off is ever dropped.

## 8. Tests

- Chromatic: input C, E, A with Major/Minor/Dominant 7 gives the table's tones;
  inversions ±3 as in Chord Osc.
- Diatonic: all seven degrees of C major with Triad and Seventh; a 5-note scale
  stacks without errors.
- Voicings: each voicing on Cmaj7 gives the documented pitches; fallback to
  Close for too few voices; Range folds tones.
- Anchor: Bass/Centre/Top place the chord nearest the input.
- Voice leading: C → F → G → C in Smooth moves each voice ≤ 2 semitones;
  Smooth + Top keeps a common top note; the cost tie rule picks the lower
  candidate; deterministic for the same input sequence.
- Trig: sampled and held; a moving input between pulses changes nothing.
- Follow: chord equals the bus context; register from the input; same-sample
  Trig and chord change read the new chord; no bus → Diatonic.
- Notes: common tones held, legato order, retrigger on pulses, Gate mode, no
  hanging notes after removal or unpatching; Strum spacing on exact samples.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- More than four voices (up to six, matching Chord Osc).
- Per-voice octave offsets and a bass-only output with its own octave.
- A *Tension* control that adds scale extensions.
- Voice-leading memory saved in node data, so a reloaded set continues smoothly.
- Arpeggiated output (an index input selects one voice), complementing the
  Quantizer Suite's *Arp* mode.
