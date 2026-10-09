# Stage Seq

Type id `stage-sequencer` · category *Sequencing* · colour proposal `#e3a73b`

## 1. Purpose

A sequencer of **stages** rather than steps: up to 16 stages, each with a
pitch and a **length in clock pulses** (1–8), plus a gate mode that decides
how those pulses sound — one long note, a note per pulse, only the first
pulse, silence, or ratchets. Per-stage slides, velocity and accent make it a
natural bass-line and lead tool. Stages play forward, reverse, pendulum, or as
a seeded random or Brownian walk that still locks to the transport.

The Step Sequencer gives every step the same duration and works in lanes of
up to 32 steps; the Stage Seq gives each stage its own duration, so a few
stages make long, uneven phrases (8 stages of 1–8 pulses = 8 to 64 pulses),
and its gate modes describe rhythm per stage instead of per step.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Clock | `trigger` | Each pulse is one pulse of the current stage. Unpatched: pulses follow the transport at *Rate*. |
| Reset | `trigger` | The next pulse is pulse 1 of stage 1 (see 4.2). |
| Hold | `gate` | While high, the current stage repeats instead of advancing (4.3). |
| Transpose | `pitch` | Added before quantizing, sampled at each stage start. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Notes | `notes` | The notes of 4.4, with velocity; slides become legato. |
| Pitch | `pitch` | The current stage's quantized pitch, gliding over *Slide Time* into slide stages. Holds on Rest stages. |
| Gate | `gate` | The gates of 4.4. |
| Velocity | `control` (unipolar) | The current stage's velocity, accent included, 0–1. |
| Accent | `gate` | High while an accented stage's notes sound (jack id `accentgate`, as the knob is `accent`). |
| Trigger | `trigger` | A pulse at each new note start (each ratchet included; a legato slide doesn't retrigger). |
| Stage | `control` (unipolar) | Stage index / (Stages − 1). |
| Stage Start | `trigger` | A pulse at the start of every stage, whatever its gate mode. |
| End | `trigger` | A pulse when the cycle returns to its first stage (Forward, Reverse, Pendulum) or a phrase restarts (Random, Brownian). |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Gate Length | 1–100 % of a pulse | 50 % | Gate length for *First*, *Every* and *Ratchet* notes (of the ratchet's sub-pulse). |
| Slide Time | 1 ms–2 s (curved, 150 ms in the middle) | 80 ms | Glide time of *Pitch* into a slide stage. |
| Accent | 0–100 % | 50 % | How much accented stages are boosted: `v' = v + Accent · (127 − v)`. |
| Swing | 50–75 % | 50 % | Delays every second pulse (pulse count, not stage count). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Stages | 1–16 | 8 |
| Rate | 1/1, 1/2, 1/4 … 1/32 straight, dotted and triplet | 1/16 |
| Mode | Forward, Reverse, Pendulum, Random, Brownian | Forward |
| Phrase | 1, 2, 4, 8, 16 bars (Random and Brownian only) | 4 bars |
| Root, Scale, Octave | as the Step Sequencer (shared scale table) | C, Major, 0 |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Stages

The module always stores 16 stages; *Stages* limits playback. Each stage has:

| Field | Values | Default |
|---|---|---|
| Pitch | −24…+36 semitones above Root + Octave | 0 |
| Pulses | 1–8 | 1 |
| Gate mode | Rest, First, Every, Hold, Ratchet | Every |
| Ratchet | 2–4 sub-gates per pulse (used by *Ratchet*) | 2 |
| Slide | off / on | off |
| Velocity | 1–127 | 100 |
| Accent | off / on | off |

Pitch is `quantize(Root + Octave·12 + pitch + Transpose·12)` with the Step
Sequencer's scale table (`patch/common/dsp/Scales.h`, ties go down).

### 4.2 Timing

Time is counted in **pulses**: in Transport mode `n = floor(ppq / pulseLen)`
(`pulseLen` = *Rate* in quarter notes), in Clock mode `n` counts Clock pulses
since Reset (and *Rate* still says what a pulse is worth, for *Phrase*).
The pulse duration for Gate Length, ratchets and Swing is `pulseLen` or, in
Clock mode, the time between the last two pulses (fallback 1/16 at 120 BPM).

The playing order is a list of stages:

- **Forward:** 1 … S. **Reverse:** S … 1.
- **Pendulum:** 1 … S … 2 (end stages once per turn; S = 1 plays stage 1).
- **Random:** each next stage is drawn from the other S − 1 stages with
  `uniform01(phraseSeed, visit, 0)` (so never the same twice in a row, S > 1);
  the first stage of a phrase is a free draw, `phraseSeed = hash3(Seed, phrase, 99)`.
- **Brownian:** from the current stage, +1 with 50 %, −1 with 25 %, stay with 25 % (wrapping at both ends), drawn from `hash3(Seed, visit, 1)`.

For the three fixed orders the cycle is `C = Σ pulses` over the order, and the
position is found arithmetically: `m = n mod C`, the stage is the first whose
running pulse sum exceeds `m`, and `m −` the previous sum is the pulse within
it. This keeps the module phase-locked to the bars: a loop jump lands on the
right stage and pulse.

**Random and Brownian** can't be computed from `n` directly, because the
stage lengths decide when the next choice happens. So the walk restarts at
stage 1 (Brownian) or at a fresh draw (Random) at every *Phrase* boundary,
with `visit` counting from 0 inside the phrase and the phrase index mixed into
the seed. After a jump, the module replays the current phrase from its start
(at most 16 bars × 48 pulses = 768 visits of pure hashing, done in one block;
in normal playback the walk just steps on from its cached position). A phrase
is the pulses whose start lies in it: phrase `p` starts at pulse
`ceil(p · phraseLen / pulseLen)`, which keeps dotted and triplet rates exact.
A stage that would cross the phrase end is cut short there. The same Seed
therefore gives the same walk every time, in real time and offline.

**Reset.** As the Step Sequencer: in Clock mode the next pulse is stage 1,
pulse 1 (and visit 0 of a new phrase); in Transport mode the pulse grid
re-anchors so the next pulse boundary starts stage 1. A Reset and a Clock on
the same sample play stage 1.

### 4.3 Hold

While *Hold* is high, a stage that ends starts again (same stage, same
pitch, new pulses). In Clock mode the order continues where it left off when
Hold falls (the replayed pulses are not counted; the next pulse after Hold
falls is the stage that would have come next). In Transport mode Hold freezes the *output*, not the clock: when
Hold falls, the module rejoins the transport position at the next pulse, so
it is never out of phase afterwards. Hold during Random or Brownian also
freezes the walk's visible stage; the hidden walk keeps running.

Entering a stage in the middle (after a jump, a transport start inside a
stage, or when Hold falls) counts as entering it: *First* and *Hold* stages
start their note on that pulse, *Stage Start* fires.

### 4.4 Gate modes, slides and notes

Within a stage of `P` pulses:

| Mode | Gate output | Notes |
|---|---|---|
| Rest | low | none; Pitch, Velocity hold |
| First | high for Gate Length of the first pulse | one note |
| Every | high for Gate Length of each pulse | P notes, same pitch |
| Hold | high for the whole stage (all P pulses) | one note of P pulses |
| Ratchet | each pulse split into *Ratchet* sub-pulses, each gated for Gate Length of a sub-pulse | P × Ratchet notes |

**Slide** on stage *k* makes the transition **into** *k* legato: the previous
stage's last note (if it is still sounding or is a *Hold*) is not ended
before; the new note-on comes first and the old note-off follows on the same
sample, so a Voice Cell with Glide in legato mode slides. The *Gate* stays
high across the boundary, and *Pitch* glides with *Slide Time* (exponential
approach, reaching 99 % in Slide Time). For a slide into a *First* or *Every*
stage the previous gate is extended to the boundary. Slide into a Rest stage
is ignored.

**Accent** raises the velocity of all the stage's notes as set by the *Accent*
knob and keeps the *Accent* gate high while they sound.

**No hanging notes:** changing Stages, Mode, a stage's gate mode or pulses,
Reset, transport stop, the end of a phrase and removing the module all end
the sounding note. Shortening the current stage's pulses below the current
pulse ends the stage at the next pulse.

## 5. Module view

The editor is a **timeline**: each stage is a column whose width is
proportional to its pulse count, so the view shows the rhythm as it plays.

```
 ┌───────────────────────────────────────────────────────────────────┐
 │ [Randomize ▾]  [◀ ▶ rotate]  [Clear]          cycle: 23 pulses    │
 │ Pitch  │ C3      │E3│ G3 ╱╱│  A3            │ —  │ G3 │ E3  │    │
 │ Pulses │ ●●●     │● │ ●●   │ ●●●●           │ ●● │ ●  │ ●●● │    │
 │ Gate   │ Hold    │Ev│ Rat×3│ Every          │Rest│ 1st│ Hold│    │
 │ Slide  │         │  │  ⤴   │                │    │    │  ⤴  │    │
 │ Vel    │ ▇       │▅ │ ▆    │ ▇              │    │ ▃  │ ▆   │    │
 │ Accent │ >       │  │      │ >              │    │    │     │    │
 │          1        2   3      4                5    6    7          │
 └───────────────────────────────────────────────────────────────────┘
```

- **Pitch:** vertical drag, scale-snapped (Shift: semitones); note names shown;
  double-click resets to the root. Slide stages show a ramp from the previous pitch.
- **Pulses:** drag the right edge of a stage column to change its pulses
  (1–8); the following stages move. Or scroll on the dots.
- **Gate:** click cycles Rest → First → Every → Hold → Ratchet; on a Ratchet
  stage, scroll sets 2–4.
- **Slide**, **Accent:** click toggles. **Vel:** drag.
- The playhead shows the stage and the pulse within it. In Random and
  Brownian, the last eight visited stages fade out as a trail.
- **Randomize** popover: lanes (pitch, pulses, gate, slide, accent, velocity),
  pitch range in octaves, max pulses (default 4), slide and accent chance
  (default 15 % each). UI-side random, one undo step, as in the Step Sequencer.
- Every drag is one undo step. The window is 600 px wide and scrolls when
  16 stages of 8 pulses don't fit (minimum 12 px per pulse).

## 6. Saved state

```json
{
  "type": "stage-sequencer",
  "params": { "stages": 0.4667, "mode": 0.0, "phrase": 0.5, … },
  "data": {
    "stages": [ { "p": 0, "n": 1, "g": 2, "r": 2, "s": 0, "v": 100, "a": 0 },
                … 16 entries … ],
    "randomize": { "lanes": ["pitch", "pulses", "gate"], "octaves": 1,
                   "maxPulses": 4, "slide": 0.15, "accent": 0.15 }
  }
}
```

`g`: 0 Rest, 1 First, 2 Every, 3 Hold, 4 Ratchet. Missing entries are padded
with the defaults of 4.1, values clamped. A new module has 8 stages on scale
degrees 0, 0, 4, 2, 0, 4, 7, 4 (semitones 0, 0, 7, 4, 0, 7, 12, 7) with pulses
2, 1, 1, 2, 1, 1, 3, 1 and gates Hold, Every, Every, Hold, First, Every, Hold,
Ratchet ×2; stages 1 and 5 are accented and stage 7 slides, so it plays a
recognisable 12-pulse line right away.

## 7. Engine requirements

1. Node data, data hand-over and live values exist (Step Sequencer section 7).
   Live values: `stage`, `pulse`, `sounding`; live array `trail` (the last
   eight stages entered, newest first).
2. Shared sequencer helpers (`SeqClock.h` for pulses, `SeqNotes.h`'s
   `SeqVoice` for notes). The **phrase replayer** lives in the module's DSP
   (`StageSequencerDsp::locate`): a cached walk position that steps on, and
   restarts from the phrase start when the position moves backwards or into
   another phrase.
3. The glide is a one-pole in the module (coefficient `exp(−ln 100 / (Slide
   Time · fs))`, 99 % after Slide Time).

## 8. Tests

- Forward with pulses 2, 1, 3: stage starts land on pulses 0, 2, 3, cycle 6;
  Reverse and Pendulum produce the documented orders and cycle lengths.
- Loop jump in Transport mode lands on the right stage and pulse.
- Random never repeats a stage (S > 1); Brownian moves only by −1, 0, +1 with
  wrapping; both replay identically after a jump and with the same Seed, and
  restart at each Phrase boundary.
- Gate modes: note counts and gate lengths per stage for each mode; Ratchet 3
  on a 2-pulse stage gives 6 notes of the right length.
- Slide: legato order (note-on before note-off on one sample), Gate stays
  high, Pitch reaches 99 % after Slide Time; slide into Rest is ignored.
- Accent velocity formula; Accent gate covers exactly the accented notes.
- Hold repeats the stage; in Transport mode the module is back in phase at the
  first pulse after Hold falls.
- No hanging notes after stop, Reset, Stages/pulse/mode edits and removal.
- Saved data round-trips; broken `stages` arrays load safely.

## 9. Later

- Pulses 0 (skip) and longer stages (up to 32 pulses).
- Per-stage probability, a per-stage *Mod* value and output.
- A Bias knob for Brownian, and Random without repeats (shuffle).
- Stage groups (repeat stages 3–5 twice before going on).
- Record a played line from a *Notes* input into stages, durations included.
