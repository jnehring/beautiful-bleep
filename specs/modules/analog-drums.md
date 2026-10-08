# Analog Drums

Type id `analog-drums` · category *Sources* · colour proposal `#ef4444`

## 1. Purpose

A complete drum kit in one module, in the style of classic analog drum
machines: a booming resonant kick, a snare of two tones and noise, a
multi-burst clap, closed and open hats from a metallic oscillator bank, a
cowbell and a tuned tom. Each instrument is modelled from the principle of
its circuit (struck resonances, filtered noise, square-wave clusters), not
from samples. Every instrument has its own trigger and accent jack and
output; a *Notes* input plays the whole kit from a sequencer or a MIDI
controller, and a stereo mix with per-instrument level and pan saves the
mixer.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Notes | `notes` | Plays the kit by note number (4.8); velocity is the accent. |
| Kick, Snare, Clap, Tom, C. Hat, O. Hat, Cowbell | `trigger` | Strike that instrument. |
| Kick Acc … Cowbell Acc | `control` (unipolar) | Per-instrument accent, sampled at the trigger. Unpatched: *Accent* (below). |
| Accent | `control` (unipolar) | Kit-wide accent, used by instruments whose own accent jack is unpatched. Unpatched: 0 (no accent). |
| Tom Pitch | `pitch` | Transposes the tom, 1 V/oct, sampled at the trigger (for tuned tom melodies). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Mix L, Mix R | `audio` | All instruments, after each one's *Level* and *Pan*. |
| Kick, Snare, Clap, Tom, Hats, Cowbell | `audio` | Each instrument alone (mono, after *Level*, before *Pan*). Hats carries closed and open. |
| Kick Env | `control` (unipolar) | The kick's amplitude envelope, for sidechain ducking. |

## 3. Controls

**Knobs** (modulatable floats), grouped per instrument in the view:

| Instrument | Knob | Range | Default |
|---|---|---|---|
| Kick | Tune | 30–90 Hz | 48 Hz |
| | Decay | 50 ms – 3 s | 600 ms |
| | Pitch Env | 0–100 % (sweep depth, up to +2 octaves) | 35 % |
| | Attack | 0–100 % (click) | 40 % |
| | Drive | 0–100 % | 15 % |
| Snare | Tune | 120–360 Hz | 185 Hz |
| | Tone | 0–100 % (balance of the two heads) | 50 % |
| | Snappy | 0–100 % (noise level) | 55 % |
| | Decay | 50 ms – 1 s | 250 ms |
| Clap | Tone | 600 Hz – 3 kHz | 1.1 kHz |
| | Decay | 50 ms – 2 s | 350 ms |
| | Spread | 3–25 ms (time between bursts) | 9 ms |
| Tom | Tune | 60–400 Hz | 120 Hz |
| | Decay | 50 ms – 2 s | 450 ms |
| | Bend | 0–100 % (pitch drop) | 40 % |
| Hats | Tune | −12 … +12 st | 0 |
| | Closed | 10–300 ms | 50 ms |
| | Open | 80 ms – 3 s | 500 ms |
| | Tone | 0–100 % (band-pass centre, dark ↔ bright) | 55 % |
| Cowbell | Tune | −12 … +12 st | 0 |
| | Decay | 30 ms – 1 s | 180 ms |
| Kit | Accent Amt | 0–100 % | 50 % |
| | Drift | 0–100 % | 10 % |
| | Level (per instrument) | 0–100 % | 80 % |
| | Pan (per instrument) | −1 … +1 | 0 (hats ±0.2 L, clap +0.15) |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Note Map | Standard, Chromatic from C1, Custom (edited in the view) | Standard |
| Hat Choke | on / off | on |
| Seed | 0–999 | 1 |

## 4. Behaviour

The building blocks are in `patch/common/dsp/Drums.h` (resonator, decays,
band-limited squares, the six-oscillator metal source, clap) and
`dsp/Noise.h`. Every instrument is a small graph of them:

### 4.1 Kick

A **struck resonator** (complex one-pole) models the ringing bridged-T
network of an analog kick: a short pulse (width 0.5–2 ms, set by *Attack*)
strikes it, it rings at *Tune* and dies away with T60 = *Decay*. The pitch
envelope is an exponential decay (≈ Decay / 10) added to the resonator's
frequency, starting at `Tune × 2^(2 × Pitch Env)`; since the resonator's
amplitude doesn't depend on its frequency, the sweep doesn't change the
level. The attack pulse, high-passed at 1 kHz, is also mixed in as the
click. *Drive* is a soft clip (tanh) on the output, which squares off the
body for long, distorted kicks. Re-striking while it rings adds to the
ringing (no click, natural build-up on rolls).

### 4.2 Snare

Two resonators at *Tune* and *Tune* × 1.62 (the two drum-head modes; *Tone*
crossfades their levels), each with a short sweep, plus white noise through
a 1.8 kHz high-pass and a TPT low-pass at 9 kHz, shaped by its own decay
(*Decay*). *Snappy* is the noise level. Accent raises the noise more than
the tones, as in the circuits where accent drives the snare's noise VCA
harder.

### 4.3 Clap

Band-passed noise (TPT SVF, Q 2 at *Tone*) gated by **four** quick bursts
spaced by *Spread* with ±15 % seeded jitter per hit, followed by a longer
diffuse tail (*Decay*). The bursts are sawtooth-shaped envelopes (1 ms rise,
6 ms fall). This is `Drums.h Clap` with the burst count fixed at 4.

### 4.4 Tom

A resonator at *Tune* (× *Tom Pitch*) with a pitch drop of up to an octave
(*Bend*, time ≈ Decay / 4) and a little pink noise in the attack. With
*Tom Pitch* or the Chromatic note map it plays melodies.

### 4.5 Hats

`Drums.h Metal`: six band-limited squares at fixed inharmonic ratios
(transposed by *Tune*), summed, through two band-passes (≈ 7 kHz and 10 kHz,
moved by *Tone*) and a 6 kHz high-pass. Two decay envelopes share the
source: closed (*Closed*) and open (*Open*). With *Hat Choke* on, a closed
hit chokes a ringing open hat with a 3 ms fade (never a hard cut). The metal
oscillators are free-running, with phases seeded on `transportStarted`.

### 4.6 Cowbell

Two band-limited squares at ≈ 540 Hz and 800 Hz (× *Tune*) through a
band-pass at ≈ 2.6 kHz, with a two-stage envelope: a sharp first 15 ms drop
to 30 %, then the *Decay* tail. This gives the characteristic "clank then
ring".

### 4.7 Accent and Drift

- **Accent** `a` (0–1, from the instrument's jack, *Accent*, or velocity)
  scales level by `1 + Accent Amt × a` (up to +6 dB) and, per instrument,
  something characteristic: kick sweep depth and drive, snare noise, clap
  tail level, hat brightness, tom bend, cowbell first-stage level.
- **Drift** gives each hit a small seeded variation of tune (± 0.3 % × Drift),
  decay (± 5 %) and level (± 0.5 dB), like component tolerances and thermal
  drift. Values come from `hash(Seed, instrument, hit counter)`; the counter
  resets on `transportStarted`, so renders repeat exactly. At 0 % every hit is
  identical.

### 4.8 Notes input

The *Notes* input triggers instruments on note-on; note-off is ignored (all
voices are one-shot). Velocity / 127 is the accent.

| Note | Standard map |
|---|---|
| 35, 36 (B0, C1) | Kick |
| 37 | Clap (rim slot) |
| 38, 40 | Snare |
| 39 | Clap |
| 41, 43, 45, 47, 48, 50 | Tom, transposed so 45 plays *Tune* (others ±semitones) |
| 42, 44 | Closed hat |
| 46 | Open hat |
| 56 | Cowbell |

*Chromatic from C1* maps C1 … F♯1 to kick, snare, clap, tom, closed hat,
open hat, cowbell. *Custom* stores a 128-entry map edited in the view.

### 4.9 Polyphony, retriggering and clicks

Each instrument is one voice (as in the circuits), except that a re-strike
never clicks: resonator instruments add to the ringing; noise and square
instruments restart their envelopes from the current level (attack from the
current value, like the ADSR). Knob changes apply per sample and smoothly;
the resonators keep their state when *Tune* moves, so audio-rate modulation
of tunings bends the ringing tone instead of clicking.

The module is meant to sit on the top level, not inside a Voice Cell (it's a
whole kit). Inside one it works per voice like any module.

### 4.10 Transport and CPU

Hits ring out after the transport stops. Each idle instrument sleeps
(costs nothing) once its output is below −90 dB. All seven sounding at once
cost ≈ 0.3 % of one core at 48 kHz; the hats' six squares are the largest
part.

## 5. Module view

```
 ┌─────────────────────────────────────────────────────────────────┐
 │ KICK      SNARE     CLAP     TOM      HATS        COWBELL   KIT │
 │ (Tune)    (Tune)    (Tone)   (Tune)   (Tune)      (Tune)  Acc.  │
 │ (Decay)   (Tone)    (Decay)  (Decay)  (Closed)    (Decay) Drift │
 │ (PitchE)  (Snappy)  (Spread) (Bend)   (Open)                    │
 │ (Attack)  (Decay)                     (Tone)                    │
 │ (Drive)                                                         │
 │ ▮lvl ◐pan ▮lvl ◐pan ▮ ◐      ▮ ◐      ▮ ◐         ▮ ◐           │
 │ [▶]       [▶]       [▶]      [▶]      [▶C] [▶O]   [▶]           │
 └─────────────────────────────────────────────────────────────────┘
```

- One column per instrument with its knobs, a level fader and a pan knob, a
  small hit LED and an audition button (*▶*, strikes at accent 0).
  Shift-click auditions with full accent.
- **Note map** button opens a list of the 128 notes (only Custom is
  editable): click a row, pick an instrument.
- The window is 720 px wide; on narrow screens the columns scroll.

## 6. Saved state

Knob and setting values, plus the custom note map (only when used):

```json
{
  "type": "analog-drums",
  "params": { "kick.tune": 0.3, "kick.decay": 0.45, … },
  "data": { "noteMap": { "36": "kick", "38": "snare", "60": "cowbell" } }
}
```

Unknown instrument names and notes outside 0–127 are dropped when loading.

## 7. Engine requirements

1. **Many knobs on one node:** ~33 knobs. The view must lay them out in
   groups (a `group` field on `ParamSpec`, used for the columns and for the
   modulation picker's sub-menus).
2. **Shared drum building blocks** in `dsp/Drums.h` (already there: Resonator,
   Metal, Clap, Square, Decay); the kit reuses them rather than the separate
   per-instrument drum nodes.
3. **Audition events** from the view (as in Perc Voice, section 7).
4. **Notes input on a non-cell module:** the module reads `notesIn` directly
   (the engine already passes `NoteBuffer`s to modules).
5. Node data for the custom note map (`sanitiseData`).

## 8. Tests

- Each instrument, struck alone at defaults, produces a non-silent, finite
  output that falls below −80 dB within 1.5 × its decay setting.
- Kick: fundamental at *Tune* ± 2 % after the sweep; Pitch Env 0 gives no
  sweep; re-striking during the ring adds without a step discontinuity.
- Hats: closed chokes open with a 3 ms fade when *Hat Choke* is on, and not
  when off.
- Clap: four bursts at the set spacing (± jitter) are visible in the
  envelope.
- Notes: the Standard map plays the right instrument and output; velocity
  60 vs 127 changes level by the accent formula; note-offs do nothing.
- Per-instrument accent jack overrides *Accent*; unpatched falls back.
- Drift 0: hits are bit-identical; Drift > 0 with the same Seed: two renders
  are bit-identical.
- Mix L/R equals the sum of the separate outputs after pan.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- More instruments: rim/clave, maracas, conga, cymbal (share *Metal*).
- Per-instrument *Notes* outputs echoing what was played (for chaining).
- A built-in pattern grid (or pairing with a drum-lane sequencer module).
- Per-instrument choke groups beyond the hats.
