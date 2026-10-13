# Arpeggiator

Type id `arpeggiator` · category *Sequencing* · colour proposal `#f6a04d`

## 1. Purpose

Plays the notes that are held on a `notes` stream one at a time, in a pattern,
over up to four octaves. The held notes come from a MIDI port, a Keyboard or
any other `notes` source; the result is a `notes` stream (it plays a Voice Cell
directly) and mono *Pitch*, *Gate*, *Velocity* and *Trigger* signals. It steps
like the Step Sequencer: locked to the transport, or one step per *Clock*
pulse.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Notes | `notes` | The keys to arpeggiate. |
| Clock | `trigger` | One step per rising edge. Unpatched: the transport sets the steps (see 4.1). |
| Reset | `trigger` | Ends the sounding note; the next step (Transport: the next *Rate* boundary; Clock: the next pulse) is step 0. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Notes | `notes` | The arpeggio, one note at a time, with the held note's velocity. |
| Pitch | `pitch` | The playing note, 1 V/oct (0.0 = C4). Holds after the note. |
| Gate | `gate` | High while a note sounds; low for one sample between two notes that touch. |
| Velocity | `control` (unipolar) | The playing note's velocity, 0–1. Holds. |
| Trigger | `trigger` | A pulse at each new note. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Gate Length | 1…100 % | 50 % | Share of a step that a note sounds. |
| Swing | 50…75 % | 50 % | Odd steps start late (as in the Step Sequencer, section 4.2 there). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Rate | 1/1 … 1/32T (the Step Sequencer's list) | 1/16 |
| Pattern | Up, Down, Up-Down, Down-Up, Up & Down, Played, Random, Converge, Diverge | Up |
| Octaves | 1…4 | 1 |
| Latch | Off, On | Off |
| Seed | 0…999 | 1 |

## 4. Behaviour

### 4.1 Timing

Shared with the Step Sequencer (`dsp::SeqClock`): with *Clock* patched, every
rising edge is a step and the step length is the time between pulses. Without
it, steps are locked to the song position, so loop jumps and renders land on
the same note; the transport must be playing. *Reset* and a stopping
transport end the sounding note.

### 4.2 The sequence

The held notes are the **pool**, lowest first (*Played*: in the order the keys
went down). With *Octaves* = k the pool is repeated k times, each copy one
octave higher than the one before, and the pattern runs over all of it. For a
pool of N notes (after octaves):

| Pattern | Order of one cycle |
|---|---|
| Up | 0, 1 … N−1 |
| Down | N−1 … 0 |
| Up-Down | 0 … N−1, then back down without repeating the ends (cycle 2N−2) |
| Down-Up | the same, starting from the top |
| Up & Down | up, then down repeating both ends (cycle 2N) |
| Played | the order the keys went down, octaves stacked |
| Random | any note, seeded by *Seed* and the step count, so a render repeats |
| Converge | lowest, highest, second lowest, second highest … |
| Diverge | the middle, then outward (Converge backwards) |

The step count drives everything, so adding or releasing a key changes the
pool from the next step on and the pattern simply continues. A single note
repeats. Notes are limited to MIDI 0…127 (octaves that would go beyond are
clamped).

### 4.3 Latch

With *Latch* **On**, released keys keep playing. The first key pressed after
all keys came up replaces the latched notes; keys pressed while others are
still down are added. Switching *Latch* off drops the latched notes.

### 4.4 Housekeeping

- Nothing held: no notes, *Gate* low, *Pitch* and *Velocity* hold.
- Changing *Pattern* or *Octaves*, or patching or removing *Clock*, ends the
  sounding note, so nothing hangs.
- Removing the *Notes* cable forgets the held keys and ends the note (the
  same rule as Voice Cells, `specs.md` section 8.3.1). Stopping the transport
  only ends the sounding note; held and latched keys stay.
- At most 32 keys are held; beyond that the oldest is dropped.

## 5. Module view

The generic module view (knobs and settings). Later: a display of the pool
with the playing note highlighted.

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

- `NoteBuffer` input and output with sample offsets, `SeqClock` and
  `SeqVoice` from `common/dsp` (exist).
- `liveValues`: `held` (keys held) and `sounding`.

## 8. Tests

`patch/modules/arpeggiator/tests/test_arpeggiator.cpp`:

- Each pattern's note order for three keys played out of order.
- Octaves repeat the pool upwards and stay in 0…127.
- Gate Length sets the note-off sample; steps are exactly one *Rate* apart.
- No notes held: silent; releasing the last key ends the note at once.
- Latch keeps playing, a new chord replaces it, switching off drops it.
- Keys added mid-pattern join from the next step.
- Clock mode: first pulse plays step 0, one note per pulse.
- Transport stop and *Reset* end the note (held keys stay); *Notes* cable removal ends it and forgets the keys.
- Random is repeatable for one seed and differs between seeds.
- Never more than one note sounds; none after the keys come up.

## 9. Later

- Chord and Strum modes (several notes per step).
- Gate pattern lane (rests and accents), *Velocity* mode (played / fixed / accent).
- Step *Direction* change and *Octave* patterns (up, then up two, …).
- A display of the pool.
