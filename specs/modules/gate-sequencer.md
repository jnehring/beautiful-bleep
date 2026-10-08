# Gate Sequencer

Type id `gate-sequencer` · category *Sequencing* · colour proposal `#d4e157`

## 1. Purpose

A rhythm sequencer with deep steps: four tracks of up to 32 gates, where every
step has its own **probability**, **gate length**, **ratchets** (fast repeats
within the step), **micro-timing** and a **condition** (every Nth loop, first
pass only, only during a fill …). Each track has its own length and rate, so
tracks drift against each other (polymeter) and still land on the bars.
Probabilities are seeded: a pattern that "breathes" plays the same in every
render.

Next to its siblings: the **Step Sequencer** plays a melody; the **Drum Grid**
is the eight-track drum machine with plain On/Accent steps, pattern slots and a
library; the **Polymeter Seq** splits a melodic step into tracks. The Gate
Sequencer has no pitch and no pattern slots — it is the tool for *how* hits
happen: humanised, conditional, ratcheted, evolving rhythms for four voices,
or gates for envelopes and logic.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Clock | `trigger` | Each pulse is one 1/16 *base tick*; every track runs at its *Rate* relative to it (4.2). Unpatched: the transport. |
| Reset | `trigger` | Every track's next step is step 1, and loop counters restart (4.4). |
| Fill | `gate` | While high, *Fill* conditions are true and *Not Fill* false. |
| Mute 1 … 4 | `gate` | While high, the track plays nothing (its counters keep running). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Gate 1 … 4 | `gate` | High for each played step's gate length; ratchets give several gates. |
| Trig 1 … 4 | `trigger` | A pulse at each gate start (each ratchet included). |
| Vel 1 … 4 | `control` (unipolar) | The velocity of the latest hit, 0–1, set on its first sample and held. Patch into a drum module's *Velocity*. |
| Notes | `notes` | Every hit as a note at the track's note number (4.6). |
| Cycle | `trigger` | A pulse when all tracks are on step 1 together (the polymetric cycle, 4.2). |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Chance 1 … 4 | 0–200 % | 100 % | Scales the probabilities of the track's steps below 100 % (4.3): 0 % leaves only the certain steps, 200 % doubles every chance. |
| Nudge Depth | 0–100 % | 100 % | Scales every step's micro-timing offset; 0 % plays straight. |
| Ratchet Decay | 0–100 % | 0 % | Velocity drop over a ratchet: repeat *i* of *r* plays `v · (1 − Decay · i / r)`. |
| Swing | 50–75 % | 50 % | Delays every second step of each track, on its own step grid. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Length 1 … 4 | 1–32 steps | 16 |
| Rate 1 … 4 | 1/1, 1/2, 1/4 … 1/32 straight, dotted and triplet | 1/16 |
| Dice | New every loop, Repeat every 2 / 4 / 8 loops, Fixed | New every loop |
| Seed | 0–999 | 1 |
| Note 1 … 4 | 0–127 | 36, 38, 42, 46 |

## 4. Behaviour

### 4.1 Steps

Each track stores 32 steps; *Length n* limits playback, the rest keep their
data. A step has:

| Field | Values | Default |
|---|---|---|
| On | off / on | off |
| Probability | 0–100 % | 100 % |
| Length | 1–100 % of the step, or *Tie* (gate stays high into the next step) | 50 % |
| Ratchet | 1–8 hits, shape Even / Faster / Slower | 1, Even |
| Nudge | −50…+50 % of a step | 0 |
| Condition | Always, A:B (A of B loops, B 2–8), First, Not First, Fill, Not Fill, Prev, Not Prev | Always |
| Velocity | 1–127 | 100 |

### 4.2 Timing and polymeter

Each track *t* has its own step counter. In Transport mode
`n_t = floor(ppq / stepLen_t)`, position `i_t = n_t mod Length_t`, loop count
`k_t = floor(n_t / Length_t)`. So every track is phase-locked to the bars on
its own grid: a 16-step 1/16 track against a 12-step 1/16 track repeats every
3 bars; a 1/8T track against 1/16 tracks stays exact. A loop jump lands every
track on the right step.

In Clock mode, Clock pulses are 1/16 ticks; a track with Rate `r` advances
every `r / (1/16)` ticks (1/8 = every 2 ticks, 1/32 = twice per tick at the
measured tick duration; triplet and dotted rates use the measured duration and
a fractional tick accumulator, so they stay exact over a bar).

*Cycle* fires where all tracks are at position 0 together: in Transport mode at
multiples of `lcm(Length_t · stepLen_t)` (in 1/96-note units), in Clock mode
by checking positions at each tick.

### 4.3 Whether a step plays

For an *On* step at loop `k` and position `i` on track `t`:

1. **Condition** (4.4) must be true.
2. **Probability:** a step at 100 % always plays. Otherwise, with
   `p' = clamp(p · Chance_t, 0, 1)`, the step plays if
   `u < p'`, `u = uniform01(Seed, d · 32 + i, t)` (`patch/common/dsp/Random.h`).
   `d` is the dice index: `k` for *New every loop*, `k mod N` for *Repeat every
   N loops*, 0 for *Fixed*. Chance above 100 % pushes probable steps toward
   certain; modulating it gives a track that thins out and fills up.
3. **Mute** must be low.

Because `u` depends only on the seed, track, step and loop, a render is the
same every time, a loop jump replays the same decisions, and the view can show
in advance which steps will play.

### 4.4 Conditions

- **A:B** — true when `k mod B == A − 1` (e.g. 4:4 = the fourth of every four loops). Loop counts come from the song position, so they stay in phase with the bars.
- **First / Not First** — true on the first loop since the transport started (or since Reset), and the opposite.
- **Fill / Not Fill** — the *Fill* gate at the step's nominal start.
- **Prev / Not Prev** — true when the most recent earlier step on this track that has a probability below 100 % or a condition other than Always actually played (false if there is none). Since every decision is a pure function, *Prev* is evaluated on demand, also after a jump; chains of *Prev* steps are followed back at most one loop.

### 4.5 Gates, ratchets and micro-timing

- **Nudge** moves the whole step, ratchets included, by
  `nudge · Nudge Depth · stepLen`. A negative nudge plays before the grid line;
  in Transport mode the module looks one step ahead (steps are pure functions
  of position), so early hits land exactly. In Clock mode early hits are
  scheduled from the measured tick duration; if a pulse arrives before the
  scheduled time, the hit plays on the pulse.
- **Ratchet** `r` splits the step into `r` hits. *Even*: at `j · stepLen / r`.
  *Faster*: gaps shrink geometrically (each 0.75 × the previous), *Slower*:
  grow (each 1.33 ×), normalised to fill the step. Each hit's gate is the
  step's *Length* of its own slot.
- **Length / Tie:** a Tie step's gate stays high until the next step on the
  track ends its gate or a silent step starts. Two touching gates (100 %, or a
  hit right after another) drop for 1 ms so the next rising edge is clean.
- **Swing** delays the odd steps of each track by `(Swing − 50 %) · 2 · stepLen_t`, before Nudge.
- Velocity outputs carry `velocity/127`, with Ratchet Decay applied per hit.

### 4.6 Notes

Each hit is a note-on at the track's note number with its velocity and a
note-off at its gate end. A new hit on a note that still sounds sends the old
note-off first on the same sample. Tie holds the note. No note is left hanging:
transport stop, Reset, Mute, Length/Rate/Note changes, editing the sounding
step and removing the module all end it. Typical use: *Notes* to a MIDI Out
port and a drum rack in Live, or the gate outputs to drum modules on the board.

## 5. Module view

```
 ┌────────────────────────────────────────────────────────────────────┐
 │ Edit: [On] [Prob] [Len] [Ratch] [Nudge] [Cond] [Vel]  [Randomize ▾]│
 │ 1 Len 16 1/16 │■ □ ■ ▄ │■ □ ■̈ □ │■ □ ■ ▂ │■ □ ■ ⁴     │  M         │
 │ 2 Len 12 1/16 │□ □ □ □ │■ □ □ □ │□ □ ■ □ │            │  M         │
 │ 3 Len 16 1/8T │■ ■ ■ ■ │■ ■ ■ ■ │…                    │  M         │
 │ 4 Len  7 1/16 │□ ■ □ □ │■ □ ■   │                     │  M         │
 │                 ▲ playhead per track                               │
 │ Step 1·7: On ✓  Prob 60 %  Len 50 %  Ratch 3 Faster  Nudge −12 %   │
 │          Cond 2:4  Vel 96                                          │
 └────────────────────────────────────────────────────────────────────┘
```

- Each row is a track with its length and rate at the left (drag the length
  marker at the end of the row; click the rate to choose). Each track has its
  own playhead; columns are 18 px and scroll for 32 steps.
- **Edit** buttons choose what a drag edits; the row then shows that field as
  bars (Prob, Len, Vel, Nudge as a horizontal shift, Ratchet as tick marks).
  In *On* view, every cell still shows its probability as fill height, ratchet
  ticks and a condition badge, so a track reads at a glance.
- Click a step to select it (Shift/drag for several); the **inspector** line
  edits every field of the selection at once.
- Steps that will be skipped on the coming pass (probability or condition)
  are drawn hollow — possible because decisions are pure functions.
- **M** toggles mute in the view (a data setting, OR-ed with the Mute input).
- **Randomize** per track: density, probability range, ratchet chance,
  nudge range (UI-side random, one undo step). **Euclid** fills a track with
  `k` hits evenly spread over its Length (rotation offset).
- Copy/paste a track; rotate a track ◀ ▶. Every gesture is one undo step.

## 6. Saved state

```json
{
  "type": "gate-sequencer",
  "params": { "length1": 0.4839, "rate1": 0.35, "dice": 0.0, … },
  "data": {
    "tracks": [
      { "mute": false,
        "steps": [ { "on": 1, "p": 100, "l": 50, "t": 0, "r": 1, "rs": 0,
                     "n": 0, "c": [0, 0], "v": 100 }, … 32 entries … ] },
      … 4 tracks …
    ]
  }
}
```

`l` 1–100, `t` 1 = Tie; `rs` ratchet shape 0 Even, 1 Faster, 2 Slower; `n`
nudge −50…50; `c` is `[kind, arg]`: 0 Always, 1 A:B with arg `A·10 + B`,
2 First, 3 Not First, 4 Fill, 5 Not Fill, 6 Prev, 7 Not Prev. Missing tracks
or steps are padded with defaults, values clamped. A new module has track 1 on
every 4th step, track 2 on steps 5 and 13, track 3 on every 2nd step with
60 % probability on the off-beats, and track 4 empty.

## 7. Engine requirements

1. Node data, data hand-over and live values exist (Step Sequencer section 7).
   Live values: `pos` (4 positions), `hits`, `upcoming` (bit masks of the
   steps that will play on the current pass, per track).
2. Shared sequencer clock and note emitter (`SeqClock.h`, `SeqNotes.h`, see the
   Cartesian Seq spec), extended with **look-ahead scheduling**: emit events at
   a sample offset up to one step ahead of the grid position.
3. Transport start detection for *First* (the engine's transport state change).

## 8. Tests

- Polymeter: tracks of 16 and 12 steps at 1/16 realign after 3 bars; *Cycle*
  fires there; a loop jump lands every track correctly; 1/8T stays exact.
- Probability: 100 % always plays, 0 % never; over 10 000 steps 50 % plays
  50 ± 2 %; same Seed → identical output; *Fixed* dice repeats every loop,
  *Repeat every 4* repeats with period 4.
- Chance 0 % silences < 100 % steps; Chance 200 % doubles p (clamped).
- Conditions: A:B on loops; First only after start or Reset; Fill follows the
  gate; Prev / Not Prev follow the earlier step, also after a jump.
- Ratchets: counts and times for Even, Faster and Slower; Ratchet Decay
  velocities.
- Nudge: a −25 % step plays a quarter step early in Transport mode; Nudge
  Depth 0 % plays straight; Clock mode early hits.
- Gates: touching gates have a 1 ms gap; Tie holds; Mute silences without
  moving counters.
- No hanging notes after stop, Reset, Mute, edits and removal.
- Saved data round-trips; broken `tracks` load safely.

## 9. Later

- More tracks (8) and per-track direction (backward, ping-pong, random).
- Per-step parameter locks for a `control` output per track.
- Pattern slots (sharing the Drum Grid's slot and library mechanism).
- Choke pairs (track 3 closes track 4's gate).
- Record hits from a *Notes* input, with nudge from the played timing.
