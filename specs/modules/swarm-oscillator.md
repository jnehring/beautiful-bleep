# Swarm

Type id `swarm` · category *Sources* · colour proposal `#facc15`

## 1. Purpose

A cloud of up to 16 oscillators played from one pitch. Their pitches are
spread across a chord or scale around the root, so one *Pitch* signal plays
anything from a thick unison to a wide, shimmering chord stack. *Spread*
opens the cloud from unison into the chord, *Warp* morphs the waveform,
*Detune* and its *Pattern* set how the oscillators drift against each other,
*Cross FM* makes them modulate one another, and *Width* scatters them across
the stereo field. When the chord or spread changes, each oscillator glides
to its new note at its own pace, so the swarm moves like a flock instead of
switching.

It's a drone and pad source on its own, and a thick detuned-saw lead with
*Spread* at 0. For a precise chord with named inversions and per-tone pitch outputs, use
the Chord Osc; for several independent notes, a Voice Cell; for spectra
built from partials, the Additive Osc.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Pitch | `pitch` | 1 V/oct of the root (0.0 = C4). |
| Reshuffle | `trigger` | Draws a new random detune pattern and new glide rates (from *Seed* and a counter, 4.4). |
| Sync | `trigger` | Restarts all oscillators at their start phases. |

Every knob is also an input (`specs.md` section 7.3), including *Chord*.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | All oscillators, panned by *Width*. |
| Root | `audio` | Oscillator 1 alone (always on the root, no detune): a clean anchor for sub or sync. |
| Upper | `audio` | Mono sum of the oscillators above the root octave, for separate filtering. |
| Spread | `control` (unipolar) | The current effective spread 0–1 after glide, to drive filters with the cloud's opening. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Octave | −4…+4 (stepped) | 0 | Octave of the root. |
| Coarse | −12…+12 st | 0 | Semitones. |
| Fine | −100…+100 ct | 0 | Cents. |
| Count | 1–16 (continuous) | 8 | Oscillators sounding; the last fades in fractionally. |
| Chord | stepped, the list in 4.2 | Minor 7 | The pitch set the oscillators are spread over. |
| Spread | 0–100 % | 30 % | 0 % all on the root (unison); 100 % stacked over *Range* (4.2). |
| Range | 1–4 octaves (stepped) | 2 | How far the full stack reaches. |
| Warp | 0–100 % | 0 % | Waveform: sine → triangle → rounded saw → saw (4.3). |
| Detune | 0–50 ct | 8 ct | Detune depth, shaped by *Pattern*. |
| Drift | 0–100 % | 20 % | Slow, seeded movement of each detune (0.05–0.5 Hz walks). |
| Cross FM | 0–100 % | 0 % | Ring of phase modulation: each oscillator modulates the next (4.5). |
| Glide | 0–5 s | 300 ms | Average time an oscillator takes to reach a new note; each gets ±50 % of it. |
| Width | 0–100 % | 50 % | Stereo scatter. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Pattern | Fan, Alternate, Random, Outer | Fan |
| Stack | Up, Centred, Down | Up |
| Quality | Normal (1×), High (2×) | Normal |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Root

`f_root = 261.63 Hz × 2^(Octave + Coarse/12 + Fine/1200 + Pitch)`.
Oscillator `k` (0…15) plays `f_root × 2^((p_k + d_k / 100) / 12)`, where
`p_k` is its gliding pitch offset in semitones and `d_k` its detune in cents.

### 4.2 Chords and spread

*Chord* chooses a pitch-class set (semitones above the root). Chords:
Unison {0}, Octaves {0}, Fifths {0 7}, Sus2 {0 2 7}, Sus4 {0 5 7},
Major {0 4 7}, Minor {0 3 7}, Major 7 {0 4 7 11}, Minor 7 {0 3 7 10},
Dominant 7 {0 4 7 10}, Minor 9 {0 3 7 10 14}, Major 9 {0 4 7 11 14},
Add 9 {0 4 7 14}, Quartal {0 5 10 15}, Quintal {0 7 14 21},
Cluster {0 1 2}, and every scale of `patch/common/dsp/Scales.h` (Major … Hirajoshi,
a scale used as a set of 5–8 pitch classes).

The **stack** lists the set's notes upward through *Range* octaves:
`s_0 = 0 < s_1 < … ≤ 12·Range` (Unison is just 0; Octaves gives 0 12 24 …).
Chords whose intervals pass the octave (Minor 9, Add 9, …) count as pitch
classes repeated every octave (Minor 9 = {0 2 3 7 10}); Quartal and Quintal
keep stacking their interval (0 5 10 15 20 …, 0 7 14 21 …). With `N =
⌈Count⌉`, oscillator `k` aims at stack position `round(k × (M − 1) / (N − 1))`
of `M` stack notes, so the oscillators cover the whole range evenly whatever
their count. *Stack Centred* builds the stack from −6·Range to +6·Range (the
root in the middle), *Down* from −12·Range to 0; there the root oscillator
takes note 0 and the evenly spread positions give up the one nearest the
root.

*Spread* sets the target as `target_k = quantizeToSet(Spread × stack_k)`:
as *Spread* rises, oscillators leave the root and land on chord notes one
after another, the upper ones first — the cloud blooms open. Ties go down
(as in the Step Sequencer). Oscillator 0 always stays on the root (offset 0),
except in *Stack Down/Centred*, where the root oscillator is the one whose
stack note is 0.

### 4.3 Glide

Each oscillator glides to `target_k` with a one-pole in the semitone domain
whose time constant is `Glide × (0.5 + r_k)`, `r_k` seeded in [0, 1)
(updated every 16 samples, the control rate of targets, glides, detune,
gains and pans, all interpolated per sample). A *Chord* or
*Spread* change therefore spreads out over time, the swarm moving note by
note. Pitch-input changes (the root) are **not** glided by this; they move
the whole swarm at once (use a Voice Cell's glide for portamento).

### 4.4 Waveform, detune and drift

- **Warp** crossfades sine → triangle (polyBLAMP corners) → rounded saw
  (a cosine read through a 2-segment phase-distortion curve: it falls in the
  20 % of the cycle around the wrap and rises over the rest, few upper
  harmonics) → band-limited saw (polyBLEP). The rounded stage keeps dense
  chords from getting harsh before the full saw. Only the two waves around
  the Warp position are computed.
- **Detune pattern** `u_k ∈ [−1, 1]` over the oscillators 1…N−1 (the root,
  oscillator 0, is never detuned): *Fan* spreads linearly (`−1 … +1`; a
  single one gets +1); *Alternate* gives `+1, −1, +½, −½ …`; *Random* draws
  seeded values; *Outer* is `c·|c|` with `c` the Fan value: the highest and
  lowest the most, the middle not at all. `d_k = Detune × u_k + Drift-walk_k`.
- **Drift** adds a slow random walk per oscillator (`OscDrift`, each at its
  own seeded pace of 0.05–0.5 Hz), up to ±0.5 × *Drift* × *Detune*.
- **Reshuffle** draws a new random pattern and glide rates from
  `hash(Seed, shuffleCount)`. The counter resets at transport start, so a
  render with the same triggers is repeatable. Start phases, drift paces and
  pan jitter come from *Seed* alone.

### 4.5 Cross FM

Oscillator `k`'s phase is offset by `CrossFM × 0.5 × out_{k−1}` cycles
(±π radians at 100 %), ring-wise: oscillator 0 is modulated by the last
sounding one,
using the previous sample's value (a one-sample loop inside the module,
far tighter than a feedback cable). Small values add grit and beating
sidebands; large values turn chords into dense, metallic noise. The
modulating signal is always the oscillator's sine, regardless of *Warp*,
which keeps the sidebands predictable. In *High* quality the whole swarm
runs at 2× with a half-band decimator to keep deep cross FM clean.

### 4.6 Stereo and level

Oscillator `k` is panned (constant power, unity in the centre) to
`Width × v_k` with `v_k = ±⌈k/2⌉ / ⌊N/2⌋` (odd k right, even k left, growing
with k, i.e. with distance from the root in *Stack Up*), times a seeded
jitter of ±20 %, clamped to ±1. The root oscillator stays centred. The sum is
divided by `√(Σ levels)` (the fractional last oscillator counts by its
level), so *Count* changes the thickness, not the loudness.

*Upper* is the mono sum (same normalisation, no pan) of the oscillators
whose gliding offset is at least 11.5 semitones. *Spread* (output) is
`Σ|p_k| / Σ|s_k|` over the non-root oscillators, `p_k` the gliding offset and
`s_k` the oscillator's stack note at full spread: 0 on the root, 1 fully
open.

### 4.7 Edge cases and transport

- *Count* 1 is a single oscillator on the root: Spread, Pattern and Cross FM
  do nothing.
- Frequencies are clamped to 0.45 × fs; oscillators above that are muted
  (faded over 2 ms) rather than aliased.
- Changing *Chord* by modulation rounds to the nearest entry; the glide makes
  the change smooth.
- Transport is ignored except for reseeding (Drift walks, Reshuffle
  counter) at transport start. The phases are not restarted there (that
  would click on a running drone); *Sync* does that.

### 4.8 CPU

16 oscillators with BLEP and pan: about 6× the Oscillator. Target ≤ 1.5 % of
one core per instance at 48 kHz (Normal), ≤ 3 % (High). Muted and
fractional-zero oscillators are skipped; the sines use a polynomial
(error < 1e-6). Measured (one core, 48 kHz): defaults 0.65 %; 16
oscillators, Warp 80 %, Spread 100 % 1.8 %; plus Cross FM 2.9 %; the same at
High 7.7 % (twice the oscillators plus four decimators: over the High
target); the module harness (random settings) 3.6 %.

## 5. Module view

```
 ┌──────────────────────────────────────────────────────────────┐
 │  ┌ pitch map ───────────────────────────────┐   ┌ stereo ┐ │
 │  │ C6 ─  ●     ●                             │   │ · ●  ● │ │
 │  │ C5 ─    ●  ●   ●   (dots glide to targets)│   │●  ●·  ●│ │
 │  │ C4 ─ ●──────────── root                   │   └────────┘ │
 │  └───────────────────────────────────────────┘              │
 │  Chord [Minor 7 ▾]  Stack [Up▾]  Pattern [Fan▾]  [Reshuffle] │
 │  Oct Coarse Fine │ Count Spread Range │ Warp Detune Drift    │
 │  Cross FM  Glide  Width                                       │
 └──────────────────────────────────────────────────────────────┘
```

- **Pitch map:** one dot per oscillator at its current pitch (live values),
  with ghost marks at the chord notes; dots move as they glide.
- **Stereo:** dots placed by pan and level.
- The *Reshuffle* button does the same as the input (one draw, not an undo
  step, since it changes no saved value; the counter is part of the seed state).
- Width 560 px.

## 6. Saved state

Only knob and setting values; no node data.

```json
{ "type": "swarm",
  "params": { "count": 0.4667, "chord": 0.3125, "spread": 0.3, "range": 0.3333,
              "warp": 0.0, "detune": 0.16, "pattern": 0.0, "seed": 0.001, … } }
```

*Chord* is a stepped knob saved normalised over its 33 entries (16 chords,
then the 17 scales of `Scales.h`). Adding entries changes the normalisation,
so new entries need a migration of saved values (the engine has no fixed-slot
stepped knob).

## 7. Engine requirements

1. Shared `Scales.h` (exists) for the scale entries and `Chords.h`, the chord
   table of the Chord Osc (chord-oscillator.md), for the chord masks. The
   sets *Unison*, *Octaves*, *Fifths*, *Quintal* and *Cluster* are not in the
   chord table; the Swarm defines them in its own set list (`SwarmSet`)
   rather than in the shared header.
2. `OscCore.h` and `Oversampler.h` (shared with the other source modules).
3. **Stepped modulatable knob** for *Chord* (same need as Macro Osc *Model*).
4. **Live values:** live arrays `pitch`, `pan`, `level` (per sounding
   oscillator) and `stack` (the chord notes), and the value `count`.
5. Inside Voice Cells: works per voice, but 16 × voices oscillators is heavy;
   the view shows the total count.

## 8. Tests

- *Spread* 0 and *Detune* 0: all oscillators at the root frequency (±0.1 cent); output equals Count × a single oscillator normalised by √Count.
- *Spread* 100 %, *Minor 7*, Range 2, Count 8: the settled pitches are exactly the stacked chord notes in order (after the glide settles).
- Quantizing: intermediate spreads only ever produce chord notes; ties go down.
- Glide: after a chord change each oscillator reaches 99 % of its target within 4.6 × its glide time; times differ per oscillator but are identical across renders with the same Seed.
- Pattern shapes: Fan is monotonic, Alternate alternates sign, Outer has zero detune at the middle.
- Stereo: *Width* 0 gives L = R; the root output never pans.
- Cross FM 0 % leaves the oscillators unmodulated (no difference tones between two of them); more adds sidebands, bounded.
- Aliasing of a saw (Warp 100 %) at C6, in the band below 10 kHz: below −55 dB at Normal (polyBLEP), below −70 dB at High; 16 oscillators at Range 4 with full Cross FM stay finite and bounded.
- Same Seed and the same Reshuffle triggers → bit-identical renders.
- Saved params round-trip; demo types file includes the module.

## 9. Later

- A *Notes* input: the held notes become the pitch set (play the chord from a keyboard).
- A *Notes* output of the swarm's chord, so other Voice Cells follow it.
- Per-oscillator amplitude envelopes triggered in sequence (strum / arpeggio swarm).
- Microtonal sets (cents lists, imported tunings).
