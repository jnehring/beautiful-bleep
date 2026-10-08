# Polymeter Seq

Type id `polymeter-sequencer` · category *Sequencing* · colour proposal `#f59e6b`

## 1. Purpose

A sequencer whose step is split into six independent parameter tracks:
*Trigger*, *Note*, *Octave*, *Gate*, *Probability* and *Ratchet*. Each track
has its own length, loop window and clock division, so the tracks drift
against each other and a few short loops make phrases that take hundreds of
steps to repeat. It's the dedicated polymeter version of the Step Sequencer
(whose *Later* section lists per-lane lengths): the Step Sequencer stays the
simple "one row of steps" tool; Polymeter Seq is for evolving, generative
lines that still land on the song's grid and render the same every time.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Clock | `trigger` | Each pulse is one *base tick*. Unpatched: base ticks follow the transport at *Rate*. |
| Reset | `trigger` | Every track's next step is its loop start (see 4.2). |
| Transpose | `pitch` | Added before quantizing, sampled at each note start (as in the Step Sequencer). |
| Pattern | `control` (unipolar) | Selects the pattern slot: 0…1 maps to slots 1…*Slots used*. Switching follows *Pattern Change* (4.6). |
| Hold | `gate` | While high, no track advances; the current note keeps playing its ratchets. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Notes | `notes` | One note per played (or ratcheted) hit, with velocity. Patch it into a Voice Cell. |
| Pitch | `pitch` | The current quantized pitch, 1 V/oct. Holds between notes. |
| Gate | `gate` | High for each hit's gate length. |
| Velocity | `control` (unipolar) | The current hit's velocity. |
| Trigger | `trigger` | A pulse at each hit, including ratchet repeats. |
| Bar | `trigger` | A pulse when **all** tracks are back at their loop start on the same tick (the full polymeter cycle). |
| Track Ends | `trigger` | A pulse whenever **any** track wraps; useful to drive a Random or a Coin Toss. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Gate Scale | 10–200 % | 100 % | Multiplies every step's gate length. Above 100 % notes overlap the next hit (legato into a Voice Cell). |
| Prob. Bias | −100…+100 % | 0 % | Added to every step's probability. −100 % silences the sequence, +100 % plays every trigger. |
| Ratchet Amt | 0–100 % | 100 % | Scales the ratchet track: 0 % plays single hits only. |
| Swing | 50–75 % | 50 % | Delays every second base tick. |
| Velocity | 0–100 % | 80 % | Base velocity; accent steps (4.1) add 20 %. |
| Spread | 0–100 % | 0 % | Seeded humanize: random velocity variation ±25 % × Spread and timing offset up to ±5 % of a tick × Spread. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Rate | as Step Sequencer: 1/1 … 1/32, straight, dotted, triplet | 1/16 |
| Root | C … B | C |
| Scale | the scale table of `patch/common/dsp/Scales.h` | Minor Pentatonic |
| Octave | −3…+3 | 0 |
| Slots used | 1–8 | 1 |
| Pattern Change | Immediate, Next track end, Next full cycle, Next bar | Next bar |
| Seed | 0–999 | 1 |

**Per track** (stored in node data, edited in the view, not modulatable in v1):

| Setting | Values | Default |
|---|---|---|
| Length | 1–64 steps | 16 (Trigger), 7 (Note), 5 (Octave), 16 (others) |
| Loop start / end | within 1…Length | 1 / Length |
| Division | ×4, ×3, ×2, 1, /2, /3, /4, /5, /6, /7, /8, /16 of the base tick | 1 |
| Direction | Forward, Backward, Ping-Pong, Random | Forward |
| Mute | on/off (a muted track contributes its neutral value) | off |

## 4. Behaviour

### 4.1 Tracks

| Track | Step value | Neutral value |
|---|---|---|
| Trigger | Off, On, Accent | On |
| Note | scale degree −14…+21 (0 = root), relative to *Root* in *Scale* | 0 |
| Octave | −3…+3 | 0 |
| Gate | 5–100 % of the hit's duration, or Tie | 50 % |
| Probability | 0–100 % | 100 % |
| Ratchet | 1–8 hits per step, with a shape: Even, Accelerate, Decelerate | 1, Even |

The **Note** track holds **scale degrees**, not semitones, so changing *Scale*
keeps the contour and every value is always in key. The output pitch is
`quantize(Root + Octave·12 + track octave·12 + degreeToSemitones(deg, scale) + Transpose·12)`,
divided by 12 (1 V/oct). With *Chromatic*, a degree is a semitone.

### 4.2 Timing

The timing model is the Step Sequencer's (`step-sequencer.md` 4.2): a **base
tick** comes from the transport at *Rate* (`tick = floor(ppq / tickLength)`,
phase-locked to the song) or from *Clock* pulses (tick duration = time between
the last two pulses). Swing works as there.

Each track derives its own step counter from the base tick:

- **Division /n:** the track advances every *n* ticks: `trackTick = floor(tick / n)`.
- **Division ×n:** the track advances *n* times per tick. In Transport mode the
  sub-ticks are exact song positions; in Clock mode they are spaced by the last
  measured tick duration (the first tick after a pause is not subdivided).
- `position = map(trackTick, loopStart, loopEnd, direction)`, e.g. Forward:
  `loopStart + trackTick mod (loopEnd − loopStart + 1)`.

Because every position is a pure function of the tick count, a render that
starts in the middle of the song plays exactly what a full playback plays
there (`specs.md` 5.3). Random direction uses `hash3(Seed, trackTick, track)`.

**Hits.** A hit happens when the **Trigger** track advances onto an On or
Accent step and the probability check passes. The other tracks are sampled at
that moment: whatever step they are on gives note, octave, gate, probability
and ratchet. If the Trigger track's division is slower than a value track,
the value track's skipped steps are simply never heard — this is intentional.

**Probability.** Effective probability `p = clamp(step + Prob. Bias, 0, 1)`;
the hit plays if `uniform01(Seed, hitIndex, streamProb) < p`, with `hitIndex`
the Trigger track's tick count (Transport: from the song position; Clock: a
counter that Reset clears).

**Ratchets.** A ratchet value *r* (scaled: `r' = 1 + round((r − 1) × Ratchet Amt)`)
divides the hit's duration (one Trigger-track step) into *r'* sub-hits.
*Even* spaces them equally; *Accelerate* uses positions `(k/r')^1.5`,
*Decelerate* `(k/r')^0.67`. Each sub-hit's gate is the Gate track value × its
own sub-duration. Sub-hits keep the pitch; velocity falls 8 % per repeat.

**Reset.** As Step Sequencer: in Clock mode the next tick is tick 0 for all
tracks; in Transport mode Reset re-anchors the grid. Reset also realigns
*Bar*. **Bar** fires on the tick where every unmuted track sits on its loop
start; the cycle length is the LCM of the tracks' effective periods
(`loop length × division`), shown in the view (e.g. *cycle: 560 steps*).
If the LCM exceeds 2³¹ ticks *Bar* never fires and the view says *∞*.

### 4.3 Gates and notes

- **Tie** on the Gate track holds the note into the next hit; a different
  pitch follows the Step Sequencer's legato order (new note-on, then old
  note-off on the same sample).
- *Gate Scale* > 100 % also overlaps notes; a note that would still be on when
  the same MIDI note number starts again is ended first, on the same sample.
- No hanging notes: Stop, Reset, pattern change, Hold release, track edits and
  removal end every sounding note.

### 4.4 Track edits while playing

Changing Length, loop start/end or Division takes effect at the next tick of
that track; the position is recomputed from the tick count, so the track jumps
to where it "would have been" — the sequencer never loses sync with the song.

### 4.5 Randomize per track

A *Randomize* button per track (and one for all) rewrites that track's steps
with UI-side randomness: Trigger by density (default 50 %), Note within a
range of degrees (default 0…7) with a *step-wise* option (moves of ±1–2
degrees), Probability between bounds, Ratchet with a chance of 2–4 (default
10 %). One undo step each.

### 4.6 Pattern slots

Up to 8 slots, each a full set of six tracks with their lengths, loops,
divisions and directions. *Pattern* (input + knob through the usual knob
input) selects the slot; the switch happens at the moment chosen by
*Pattern Change*. Track tick counters are not reset by a switch, so the new
pattern enters in phase. Slots can be copied/pasted in the view.

### 4.7 CPU and memory

Per tick: six table lookups and one hash; negligible. Data: 8 slots × 6
tracks × 64 steps × 2 bytes ≈ 6 KB, handed to the audio thread like the Step
Sequencer's steps (try-lock swap).

## 5. Module view

```
 ┌──────────────────────────────────────────────────────────────────┐
 │ Slot [1][2][3][4]·[5]·[6]·[7]·[8]   [Randomize all ▾]  cycle: 560 │
 │ TRIG  16 /1 →  ■ □ ■ ◆ □ ■ □ ■ ■ □ ■ ◆ □ ■ □ ■       [M][⟳]   │
 │ NOTE   7 /1 →  ▃ ▅ ▁ ▇ ▃ ▂ ▅ ┆                          [M][⟳]   │
 │ OCT    5 /2 →  ─ ▲ ─ ▼ ─ ┆                               [M][⟳]   │
 │ GATE  16 /1 ↔  ▅ ▅ ▂ ═ ▅ …                              [M][⟳]   │
 │ PROB  12 /1 →  ▇ ▇ ▄ ▇ ▂ …                              [M][⟳]   │
 │ RATCH  9 ×1 ?  1 1 3 1 2 …                              [M][⟳]   │
 └──────────────────────────────────────────────────────────────────┘
```

- One row per track with its own playhead; the loop window is a bracket you
  drag at both ends; steps outside it are dimmed, beyond Length hidden.
- The number field (length), division and direction sit at the row start;
  scroll or click to change.
- Editing per track works as the Step Sequencer's lanes (click/drag, Shift
  for fine, double-click resets to the neutral value). The Note row shows
  note names for the current scale on hover.
- A **phase strip** at the bottom shows each track's position in its loop as
  a small arc and the full-cycle progress, so the drift is visible.
- Slot buttons: click to select (when the *Pattern* input isn't patched),
  right-click to copy/paste/clear. Edits are one undo step per drag.

## 6. Saved state

```json
{
  "type": "polymeter-sequencer",
  "params": { "rate": 0.47, "scale": 0.75, … },
  "data": {
    "slot": 0,
    "slots": [
      { "tracks": {
          "trig":  { "len": 16, "lo": 0, "hi": 15, "div": "1", "dir": "fwd", "mute": false, "steps": [1,0,1,2, …] },
          "note":  { "len": 7, …, "steps": [0,2,-1,4,0,1,3] },
          "oct":   { …, "steps": [0,1,0,-1,0] },
          "gate":  { …, "steps": [50,50,20,-1, …] },
          "prob":  { …, "steps": [100,100,60, …] },
          "ratch": { …, "steps": [[1,0],[1,0],[3,1], …] }
      } },
      … up to 8 …
    ],
    "randomize": { "density": 0.5, "degrees": [0, 7], "stepwise": true }
  }
}
```

Gate `-1` is Tie. Ratchet pairs are `[count, shape]`. `sanitiseData` clamps
every value, fixes `lo ≤ hi < len`, pads `steps` to 64 with the neutral
value and fills missing slots with the default pattern (a four-on-the-floor
Trigger track and a 7-step rising Note track, so a new module plays at once).

## 7. Engine requirements

Nothing new: node data, `setData`, `liveValues` (one position per track,
`cycle`, `slot`), the shared scales and transport helpers already exist.
`Scales.h` needs a `degreeToSemitones(degree, scale)` helper (scale degrees
across octaves, including negative degrees). Inside a Voice Cell it runs per
voice like any module; outside is the usual place.

## 8. Tests

- Transport mode: each track's position equals the formula for every division
  (/n and ×n), and after a loop jump or starting mid-song.
- Two tracks of lengths 3 and 4 produce a 12-step cycle; *Bar* fires every 12
  ticks and after Reset on the next aligned tick.
- Loop window: positions stay within lo…hi for all directions; ping-pong
  doesn't repeat end steps.
- Probability 0 % / 100 % / Bias extremes; the same Seed renders identically twice;
  different seeds differ.
- Ratchets: counts and spacing for each shape; Ratchet Amt 0 gives single hits.
- Degrees: every scale maps degrees −14…+21 to the right semitones.
- No hanging notes after stop, Reset, pattern change, Hold and removal.
- Pattern change happens at the moment the setting says, tracks stay in phase.
- Saved data round-trips; broken `lo/hi/len` and short arrays load safely.

## 9. Later

- Make per-track length, loop and division modulatable (inputs per track).
- Extra tracks: a modulation track (`control` output), slide, micro-timing.
- Per-track "reset on Bar" and track-to-track resets (one track restarts another).
- Chord track (stacked degrees, polyphonic notes).
- Record from a *Notes* input into the Note track.
