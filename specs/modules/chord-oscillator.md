# Chord Osc

Type id `chord-osc` · category *Sources* · colour proposal `#22d3ee`

## 1. Purpose

One pitch in, a whole chord out. The Chord Osc runs up to six band-limited
oscillators tuned to the tones of a chord built on the *Pitch* input: pick the
quality (major, minor, sevenths, sus, add9, …), the inversion and the voicing,
and morph the waveform of all voices at once. In *Scale* mode it builds
diatonic chords instead: the input selects a scale degree and the chord follows
the key, so a simple melody becomes a chord progression. A separate *Root*
output carries the root alone, and the four lowest chord tones are available as
`pitch` outputs to drive other oscillators.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Pitch | `pitch` | The chord's root, 1 V/oct, 0.0 = C4. In *Scale* mode it is quantized to the scale first (4.4). |
| Latch | `trigger` | When patched, the chord (Pitch, *Chord*, *Inversion*, *Voicing*, *Voices*) is sampled only at each pulse and held until the next (4.5). Unpatched: everything follows continuously. |
| FM | `audio` | Linear through-zero FM for all voices, scaled by *FM Depth*, as on the Oscillator. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | All voices, panned by *Stereo*, gain-compensated (4.6). |
| Root | `audio` | The root tone alone, at the input pitch (plus *Octave* and *Tune*), whatever the inversion and voicing. Full level, mono. |
| Pitch 1–4 | `pitch` | The pitches of the four lowest sounding voices after voicing, low to high. With fewer voices, the remaining outputs repeat the highest one. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Tune | −100…+100 cents | 0 | Fine tuning of all voices. |
| Chord | stepped, one step per entry of the active chord list | Major (chromatic) / Triad (scale) | The chord quality (4.2, 4.4). Modulating it with a slow source walks through the list. Two knobs share the name: `chord` (the 24 chromatic qualities, shown in Chromatic mode) and `stack` (the 10 scale stacks, shown in Scale mode), each with its own step names. |
| Inversion | stepped, −4…+4 | 0 | Moves the lowest (positive) or highest (negative) tones by an octave (4.3). |
| Voicing | stepped, 6 positions | Close | Close, Drop 2, Drop 3, Drop 2+4, Open, Wide (4.3). |
| Voices | stepped, 1–6 | 4 | How many oscillators play; which tones are kept or doubled is in 4.3. |
| Shape | 0–100 % | 67 % (saw) | Waveform morph sine → triangle → saw → square for every voice, the same curve as the Oscillator's *Shape*. |
| Pulse Width | 5–95 % | 50 % | Duty cycle at the square end of *Shape*. |
| Detune | 0–50 cents | 0 | Each voice gets a fixed, seeded offset within ±Detune (4.6). |
| Glide | 0–1 s | 0 | Time (99 %) for a voice to slide to a new pitch when the chord or the input pitch changes; the *Root* output glides with it. 0 jumps. |
| Root Level | 0–100 % | 100 % | Level of the root voice inside *Out L/R* (not at *Root*). Lower it when a bass plays the root separately. |
| Stereo | 0–100 % | 0 % | Spreads the voices across L/R (4.6). |
| FM Depth | 0–100 % | 0 % | Scales the *FM* input: at 100 % an FM signal of ±1 swings each voice's frequency by ±4× its base, through zero. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Mode | Chromatic, Scale | Chromatic |
| Octave | −3…+3 | 0 |
| Root (key) | C, C♯, … B (Scale mode only) | C |
| Scale | the scales of `step-sequencer.md` 4.3 (Scale mode only) | Major |
| Seed | 0–999 | 1 |

*Chord*, *Inversion*, *Voicing* and *Voices* are stepped knobs, not
dropdowns, so they can be modulated; the knob shows the name of the current
step and a modulated knob snaps to the nearest step (no in-between values).

## 4. Behaviour

### 4.1 Pitch

The root pitch in semitones from C4 is
`r = 12 · (Pitch + Octave) + Tune / 100` (Chromatic mode); each voice plays
`r + interval + octave shifts from inversion and voicing + detune`. Frequency
is C4 × 2^(semitones / 12), as on the Oscillator.

### 4.2 Chords (Chromatic mode)

Intervals in semitones above the root, in stacking order (root, third, fifth,
seventh, extension):

| Chord | Name shown | Intervals |
|---|---|---|
| Unison | `C` (1) | 0 |
| Fifth | `C5` | 0 7 |
| Major | `C` | 0 4 7 |
| Minor | `Cm` | 0 3 7 |
| Diminished | `Cdim` | 0 3 6 |
| Augmented | `Caug` | 0 4 8 |
| Sus2 | `Csus2` | 0 2 7 |
| Sus4 | `Csus4` | 0 5 7 |
| Major 6 | `C6` | 0 4 7 9 |
| Minor 6 | `Cm6` | 0 3 7 9 |
| Dominant 7 | `C7` | 0 4 7 10 |
| Major 7 | `Cmaj7` | 0 4 7 11 |
| Minor 7 | `Cm7` | 0 3 7 10 |
| Half-diminished | `Cm7♭5` | 0 3 6 10 |
| Diminished 7 | `Cdim7` | 0 3 6 9 |
| Minor-major 7 | `Cm(maj7)` | 0 3 7 11 |
| 7sus4 | `C7sus4` | 0 5 7 10 |
| Add9 | `Cadd9` | 0 4 7 14 |
| Minor add9 | `Cm(add9)` | 0 3 7 14 |
| 6/9 | `C6/9` | 0 4 7 9 14 |
| Major 9 | `Cmaj9` | 0 4 7 11 14 |
| Minor 9 | `Cm9` | 0 3 7 10 14 |
| Dominant 9 | `C9` | 0 4 7 10 14 |
| Quartal | `C4ths` | 0 5 10 15 |

The table lives in `patch/common/dsp/Chords.h` next to `Scales.h`, so later
modules (a chord sequencer, a strummer) share it.

### 4.3 Voices, inversion and voicing

Building the sounding chord takes four steps, recomputed whenever an input
changes (or only at *Latch* pulses, 4.5):

1. **Tone count.** The chord has `t` tones. If *Voices* < `t`, tones are dropped
   in this order until it fits: fifth, extension, seventh, third. The root is
   never dropped (a two-voice Cmaj9 plays root and third; three voices play
   root, third, seventh, the way a pianist thins a chord). If *Voices* > `t`,
   the extra voices double the chord tones an octave up, root first, then
   fifth, third, …
2. **Inversion** `i > 0`: the lowest tone moves up an octave, `i` times.
   `i < 0`: the highest tone moves down an octave, `|i|` times. The bass tone
   of an inverted chord is shown in the name (`Am7/C`).
3. **Voicing**, applied to the inverted close chord (tones sorted low to high,
   numbered from the top):
   - *Close*: unchanged, everything within an octave where possible.
   - *Drop 2*: the second tone from the top moves down an octave.
   - *Drop 3*: the third from the top moves down an octave.
   - *Drop 2+4*: second and fourth from the top move down an octave.
   - *Open*: the bass tone moves down an octave, the rest stays close.
   - *Wide*: tones alternate between octaves −1, 0, +1, … from the bottom,
     spanning about three octaves.
   Voicings that need more tones than are playing fall back to *Close*.
4. **Range guard.** If the highest voice is above 8 kHz or the lowest below
   16 Hz, the whole chord shifts by octaves back into range. Pitch 1–4 show the
   pitches actually played.

The order of voices is fixed by their position in the stacking order, not by
height, so when the chord changes each oscillator moves to the "same" tone of
the new chord (its third to the new third). With *Glide* that gives smooth
voice leading; without it, each oscillator keeps its phase and only its
frequency jumps, which the band-limited core handles without clicks.

Changing *Voices* fades the added or removed oscillators in or out over 5 ms.

### 4.4 Scale mode

The *Pitch* input is quantized to *Root* + *Scale* (nearest note, ties go
down, the shared `Scales.h`). Its scale degree `d` is the chord's root; the
chord is stacked from scale steps, so the quality follows the key: in C major,
D gives D minor, G gives G major, B gives B diminished.

The *Chord* knob then offers a list of stacks, in scale steps above `d`:

| Chord | Degrees | In C major on D |
|---|---|---|
| Single | d | D |
| Fifth | d, d+4 | D A |
| Triad | d, d+2, d+4 | D F A |
| Sus2 | d, d+1, d+4 | D E A |
| Sus4 | d, d+3, d+4 | D G A |
| Sixth | d, d+2, d+4, d+5 | D F A B |
| Seventh | d, d+2, d+4, d+6 | D F A C |
| Add9 | d, d+2, d+4, d+8 | D F A E |
| Ninth | d, d+2, d+4, d+6, d+8 | D F A C E |
| Quartal | d, d+3, d+6, d+9 | D G C F |

Degrees wrap around the scale and add an octave as they pass the root, so the
same rules hold for 5-, 6-, 7- and 8-note scales (pentatonic "triads" become
open, quartal-sounding stacks). *Chromatic* as the scale stacks semitones; the
view says so (clusters). The shown name is the real quality found (`Dm7`), not
the stack name. Inversion and voicing work as in 4.3.

### 4.5 Latch

With *Latch* patched, the module samples *Pitch* and the four stepped knobs at
each pulse and holds the resulting chord until the next one. A sequencer's
*Trigger* into *Latch* and its *Pitch* into *Pitch* therefore change chords
exactly on the step, even if the pitch slews or a modulator moves *Chord*
between steps. *Tune*, *Shape*, *Detune* and the other knobs stay continuous.
Before the first pulse the module plays the chord as if unlatched.

### 4.6 Mixing, detune and stereo

- **Level.** Out L/R = Σ voice · gᵢ / √n, where n is the number of voices and
  gᵢ is 1 (root: *Root Level*); n follows the 5 ms voice fades, so changing
  *Voices* doesn't step the level. A four-voice saw chord is about as loud as
  two saws. Peaks can reach ±√n (±2.45 for six square voices); voices 2–6
  start at seeded random phases (voice 1 and *Root* at phase 0, like the
  Oscillator), so they rarely add up in phase. *Root* is a single voice at
  full level (±1).
- **Detune.** Each voice's offset is
  `Detune · (2 · uniform01(Seed, voiceIndex, 0) − 1)` cents (the counter-based
  random of `Random.h`), fixed while playing, so renders repeat. Inside a Voice
  Cell, every voice of the cell gets the same offsets; patch *Voice In ›
  Random* onto *Detune* for per-note variation.
- **Stereo.** The n voices get the evenly spaced positions
  `Stereo · (2j / (n − 1) − 1)`, j = 0…n−1, handed out from the centre
  outwards and alternating sides (voice order root, 3rd, 5th, …: centre or
  just left, then right, left, …), so the root sits nearest the centre.
  Equal-power panning with unity gain in the centre; at 0 % everything is
  centred and L = R.

### 4.7 DSP

Each voice is the Oscillator's core (`dsp::OscCore`): a phase accumulator per
voice, the sine/triangle/saw/square morph with polyBLEP for saw and square,
through-zero FM. The *Root* output is a seventh core whose pitch is summed
exactly as the Oscillator's, so at Glide 0 it is sample-identical to an
Oscillator at the same pitch and Shape. Glide is a one-pole in the pitch
(semitone) domain. The chord is rebuilt only when the stepped knobs, the
quantized root (Scale mode) or the settings change. Voices that are not
playing (beyond *Voices*) use no CPU after their fade-out; the Root core and
the Pitch 1–4 sort are skipped while nothing reads them. Measured: about
1.2 % of one core in the module harness (random settings, 48 kHz).

## 5. Module view

The usual knobs and settings, plus a chord display above them:

```
 ┌──────────────────────────────────────────────────────────┐
 │   Am7/C           Scale: C Major · degree vi              │
 │   ┌┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┐                 │
 │   │ │█│ │ │█│ │ │ │ │ │ │█│ │ │ │ │█│ │ │   (3 octaves)    │
 │   C3        C4        A4      E5                          │
 │   1:C4  2:E4  3:G4  4:A4                                  │
 └──────────────────────────────────────────────────────────┘
```

- The chord name with inversion slash and, in Scale mode, the key and the
  Roman-numeral degree.
- A three-octave keyboard centred on the chord, with the sounding voices lit
  (root in a stronger colour).
- The note names of Pitch 1–4. A small lock icon shows when *Latch* holds the
  chord.
- The keyboard is display only; the chord is played through *Pitch*.

## 6. Saved state

Only knob and setting values; no node data.

```json
{ "type": "chord-osc",
  "params": { "chord": 0.087, "stack": 0.222, "inversion": 0.5, "voicing": 0.0, "voices": 0.6, "shape": 0.67, … } }
```

Each mode has its own *Chord* knob (`chord` over the 24 chromatic
qualities, `stack` over the 10 scale stacks), so switching *Mode* keeps both
choices. Both are normalised over their list: new entries may only be
appended together with a migration of saved values.

## 7. Engine requirements

1. **Shared oscillator core.** Move the Oscillator's per-voice phase, morph and
   polyBLEP code into `patch/common/dsp/OscCore.h`, used by Oscillator, Chord
   Osc and Folder's internal oscillator. The Oscillator's output must not change
   (its tests guard that).
2. **Chord table** in `patch/common/dsp/Chords.h` (4.2, 4.4 lists plus the naming
   function). Macro Osc's *Chord* model and Swarm Osc can read the same table.
3. **Stepped knobs** that display the step name (chord, voicing) on the knob
   and in the modulation ring: `ParamSpec::stepped` (exists).
4. **Live values** (numbers only): `rootPc`, `quality` (table index, −1 for a
   Scale-mode cluster), `bassPc`, `degree`, `count`, `latched`,
   `voicePitch1…6`; the view builds the chord name from them.

## 8. Tests

- Every chromatic chord at root C4 produces exactly its intervals (FFT peak per voice with Shape = sine, Voices = tone count).
- Tone dropping and doubling follow the order of 4.3 for Voices 1–6 on a 5-tone chord.
- Inversion ±1…±4 and each voicing give the expected pitch sets; the range guard keeps all voices between 16 Hz and 8 kHz.
- Scale mode: in C major the triads on all seven degrees have qualities maj, min, min, maj, maj, min, dim; quantizing ties go down; 5-note scales wrap correctly.
- Latch: modulating *Chord* between pulses doesn't change the output; a pulse and a pitch change on the same sample use the new pitch.
- Chord changes with Glide 0 produce no discontinuity larger than one polyBLEP step; voice-count changes fade over 5 ms.
- Level: Out stays within ±√6 for 6 voices of square at Stereo 0 and L = R; *Root* is identical (within 1e-6) to an Oscillator at the same pitch, Shape, Pulse Width and FM.
- Aliasing: a saw voice at C7 keeps aliases below 10 kHz under −50 dB (polyBLEP).
- The same Seed gives identical Detune offsets; different Seeds differ.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- A *Notes* output that plays the chord into a Voice Cell while a *Gate* input is high (chord memory for poly patches).
- Strum: a *Strum* knob delaying each voice's onset after a Latch pulse, up and down patterns.
- User chords (12-key toggle grid saved as node data) and a chord progression list stepped by *Latch*.
- Per-voice outputs (audio) for separate processing.
- Voice-leading mode that picks the inversion closest to the previous chord automatically.
