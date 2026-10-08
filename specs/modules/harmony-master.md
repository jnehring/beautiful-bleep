# Harmony Master

Type id `harmony-master` · category *Utility* · colour proposal `#9333ea`

## 1. Purpose

One place that says what key and chord the music is in right now. Harmony
Master holds a **harmonic context** (key root, scale, current chord) and
publishes it board-wide, so every quantizing module can opt into *follow
harmony* instead of being set up one by one: change the chord here and the
sequencers, quantizers and chord modules of the whole Live set follow on the
same sample. The context comes from the knobs, from a transport-synced chord
progression, or from chords played into its *Notes* input. Its own outputs
carry the root, the chord tones and the chord as notes.

Since there is one board per Live set (`specs.md` section 5.4), one Harmony
Master can steer every track at once: a keyboard track sets the chord, a bass
line, an arpeggio and a pad on other tracks follow.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Notes | `notes` | Held notes; in *Detect* source the chord is recognised from them (4.4). |
| Next | `trigger` | *Progression* source, *Trigger* advance: go to the next slot. |
| Reset | `trigger` | *Progression*: go to slot 1 (*Trigger* advance) or restart the progression grid at the next beat (*Transport* advance). |
| Transpose | `pitch` | Shifts key and chord by the input rounded to semitones (1/12 V steps), applied at chord changes and at Next/Reset; a sequencer on this jack modulates the key. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Key | `pitch` | The key root, in the octave set by *Octave* (C … B = 0 … 11/12 V at Octave 0). |
| Root | `pitch` | The chord root, same octave rule. |
| Bass | `pitch` | The chord's bass note (differs from Root for slash chords), one octave below *Root*. |
| Tone 1 … Tone 4 | `pitch` | The chord tones in close position from the root, low to high; triads repeat the root an octave up as Tone 4. |
| Notes | `notes` | The chord as sustained notes (4.6). |
| Change | `trigger` | A pulse at every chord change. |
| Degree | `control` (unipolar) | `(degree − 1) / 6` for diatonic chords (degree 1–7); 0 when the chord root is not in the scale. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Degree | 1–7 (integer) | 1 | *Manual* source: the scale degree the chord is built on. |
| Slot | 1–16 (integer) | 1 | *Progression*, *Select* advance: the slot that plays. |
| Velocity | 1–100 % | 70 % | Velocity of the *Notes* output. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Source | Manual, Progression, Detect | Manual |
| Key | C … B | C |
| Scale | the 17 scales of `patch/common/dsp/Scales.h` | Major |
| Quality | Diatonic Triad, Diatonic Seventh, or any entry of the chord table (4.2) | Diatonic Triad |
| Advance | Transport, Trigger, Select | Transport |
| Scale Policy | Keep, Adapt | Keep |
| Latch | on / off | on |
| Octave | −3…+3 | 0 |
| Bus | A, B, C, D | A |

## 4. Behaviour

### 4.1 The context

The context is a small value, the same for every reader:

| Field | Meaning |
|---|---|
| `key` | key root pitch class, 0–11 (C = 0) |
| `scale` | 12-bit mask relative to `key` (`Scales.h` format) |
| `chordRoot` | pitch class of the chord root |
| `chord` | 12-bit mask of the chord's pitch classes, relative to `chordRoot` |
| `bass` | pitch class of the lowest chord note |
| `degree` | 1–7, or 0 if `chordRoot` is not a scale note |
| `quality` | index into the chord table (for names) |
| `serial` | increases at every change |

After *Transpose* (`t` semitones), `key`, `chordRoot` and `bass` are shifted by
`t` mod 12. A chord change is published on the exact sample it happens.

### 4.2 Building a chord

The chord table is the one in `patch/common/dsp/Chords.h` (shared with Chord
Osc, `chord-oscillator.md` 4.2: Unison, Fifth, Major, Minor, … Quartal).
**Diatonic** qualities stack scale steps on the degree `d` (as Chord Osc's
Scale mode): *Triad* = d, d+2, d+4; *Seventh* adds d+6. The resulting quality
is then looked up in the table (D F A → Minor) for the name and `quality`.
Scales with fewer or more than 7 notes stack the same way (pentatonic triads
become open stacks); *Chromatic* gives the Major (Triad) or Dominant 7
(Seventh) on the semitone instead of a cluster. An explicit quality (e.g.
*Sus4*) is built on the degree's note regardless of the scale.

**Scale Policy.** *Keep*: `scale` is the Key + Scale setting, even when the
chord has notes outside it. *Adapt*: each chord tone outside the scale replaces
the scale note(s) one semitone next to it (the lower one first), so the
published scale always contains the chord. In A minor, an E major chord makes
the scale A harmonic minor while it lasts; followers quantize melodies to the
G♯ automatically.

### 4.3 Sources

**Manual.** The chord is built on *Degree* with *Quality*. Modulating *Degree*
from a sequencer or a slow Random walks through the key's chords.

**Progression.** Up to 16 slots in node data (6), each with a degree (1–7) or
an absolute root (C…B), a quality (*Diatonic* or a table entry), an optional
bass (for slash chords and inversions) and a length (½, 1, 2, 3, 4, 6, 8, 12,
16 beats). *Advance*:

- **Transport** (default): with `T` the total length in quarter notes and `off`
  the Reset offset, `pos = (ppq − off) mod T`; the slot is the one whose
  cumulative span contains `pos`. Phase-locked like every transport module, so
  loop jumps and renders land on the right chord. Transport stopped: the
  current chord holds.
- **Trigger:** each *Next* pulse goes to the next slot (wrapping); *Reset* to
  slot 1. Lengths are ignored.
- **Select:** the *Slot* knob (rounded, wrapped to the slot count) chooses the
  slot directly; modulate it for chord changes from anything.

**Detect.** The chord follows the notes held at *Notes* (4.4). With *Latch*
on, releasing all notes keeps the last chord; off, the context falls back to
the *Manual* chord when nothing is held.

### 4.4 Chord detection

Let `H` be the set of pitch classes held and `b` the pitch class of the lowest
held note. Every pair (root `r` = 0…11, table entry `T` without Unison and
Quartal) is scored:

```
score = 2·|H ∩ T_r| − 1·|T_r \ H| − 1.5·|H \ T_r| + 0.5·[r = b] − 0.01·|T|
```

(`T_r` is T transposed to r; the last term prefers simpler chords.) The best
score wins; ties go to the root in the scale, then to the lower table index. A
single held note gives *Unison* on that note; two notes a fifth apart give
*Fifth*. `bass` = `b`, so C E G A over A is detected as A minor 7, over C as
C major 6.

The held set must be stable for 30 ms before it counts, so a strummed or
slightly early chord is read once, not note by note. At most one detected
change per 30 ms.

### 4.5 Pitch outputs

With octave base `o = Octave` and pitch classes in 0…11:
`Key = o + key/12`, `Root = o + chordRoot/12`, `Bass = o − 1 + bass/12`. Tone n = `Root + (n-th chord interval)/12`, intervals from
the table in stacking order (tones above the 4th are dropped; fewer than 4 are
filled with the root +12, then the fifth +12). Outputs jump at the change
sample; there is no glide (a follower or a Utility adds slew).

### 4.6 Notes output

The chord sounds as notes in close position from *Root* (Tone 1–4 pitches) for
as long as it lasts. At a change, notes that stay (common tones) keep sounding,
new tones get a note-on and leaving tones a note-off on the same sample,
note-ons first. Transport stop (in Progression/Transport) ends all notes and
restarts them when it plays again; removing the module or changing *Bus* never
leaves a note hanging (a Voice Cell also releases them, `specs.md` 8.3.1).

## 5. Module view

The usual knobs and settings, plus:

- **Now playing:** the chord name, large (`Dm7`, `E/G♯`), with the key and
  scale under it (`A minor · adapted`), and a one-octave keyboard with scale
  notes lit and chord tones highlighted.
- **Progression strip** (Progression source): up to 16 slots as blocks whose
  width is their length, the playing slot highlighted. Click a slot to edit
  it in a popover (degree or root, quality, bass, length); drag its right edge
  to change the length; *+* adds a slot, Delete removes one. Each edit is one
  undo step (`setData` after `beginGesture`).
- **Followers:** a count ("6 modules follow bus A"); clicking it selects them
  on the canvas.

The node on the canvas shows the current chord name, so the board's harmony is
readable without opening the view.

## 6. Saved state

Knob and setting values, plus the progression in node data:

```json
{
  "type": "harmony-master",
  "params": { "source": 0.5, "bus": 0.0, … },
  "data": {
    "slots": [
      { "deg": 1, "q": "diatonic-triad", "len": 4 },
      { "deg": 6, "q": "diatonic-triad", "len": 4 },
      { "root": 5, "q": "major7", "bass": 9, "len": 4 },
      { "deg": 5, "q": "diatonic-seventh", "len": 4 }
    ]
  }
}
```

A slot has either `deg` (1–7) or `root` (0–11); `q` is a chord-table id or
`diatonic-triad` / `diatonic-seventh`; `bass` (0–11) is optional; `len` is one of
the allowed beat values. `sanitiseData` drops invalid slots, clamps values,
snaps `len` to the nearest allowed value and keeps at most 16. A new module has
the four slots I – vi – IV – V, four beats each. An empty list behaves like
*Manual*.

## 7. Engine requirements

**A board-wide harmony bus** (new, owned by this module's work):

1. **Context buses.** The engine keeps four harmony buses (A–D). Each holds a
   `HarmonyContext` (the fields of 4.1, plain data) and, per processing chunk,
   the context at the chunk start plus up to 8 changes with their sample
   offsets. `ProcessContext` gains `const HarmonyBus* harmony` (the four
   buses); a reader calls `harmony[bus].at(sample)`. A bus nobody publishes to
   is `valid = false`.
2. **One publisher per bus.** A Harmony Master publishes to its *Bus*. If two
   publish to the same bus, the one created first wins; the other shows "Bus A
   already has a Harmony Master" and publishes nothing.
3. **Ordering.** A module that follows a bus gets an implicit dependency on
   the bus's master, as if a cable ran between them, so the master is
   processed first and a chord change and a note on the same sample agree. If
   that edge closes a cycle (a sequencer that follows bus A also feeds the
   master's *Notes*), it is treated like a feedback cable (`specs.md` 7.5):
   the follower reads the context one sub-block late. The canvas draws no
   cable; followers show a small bus badge instead.
4. **Followers declare it.** `ModuleSpec` gains `harmonyFollow`: the index of
   the follower's *Harmony* setting (Off, A, B, C, D). The compiler adds the
   dependency edges from it; changing the setting recompiles like patching.
5. **Across cells.** Buses are board-wide and reach inside cells and Voice
   Cells (exceptions to "cables don't cross cell borders": the context is not
   a cable). All voices of a Voice Cell read the same context. Cell presets
   store only the bus letter, so a preset follows the master of the board it
   is loaded into.
6. **Shared code.** `patch/common/dsp/Chords.h` (with Chord Osc): the chord
   table, diatonic stacking, and `detectChord(heldMask, bassPc)` from 4.4;
   `Harmony.h`: `HarmonyContext`, `quantizeToChord`, `adaptScale`.

**The follow contract** for quantizing modules (each module's own spec lists
its details): a *Harmony* setting, default *Off*. When set to a bus with a valid
context, the module takes `key` and `scale` from the context instead of its
own Root and Scale settings (which are greyed and kept). Modules with a chord
notion also offer *chord tones* (quantize to `chord`). An invalid bus falls
back to the module's own settings and shows "no harmony". Current followers:
Step Sequencer (Root/Scale, applied at each step start), Quantizer Suite,
Chord Quantizer, Quantizer; Random's *Semitones* and Utility's *Quantize*
can join later.

## 8. Tests

- Diatonic stacking: all 7 degrees in Major, Natural Minor and Major
  Pentatonic give the documented chords; Chromatic gives major / dominant 7.
- Detection: a table of held sets (triads, sevenths, inversions, C6 vs Am7 by
  bass, single notes, fifths, clusters) gives the expected root, quality, bass;
  a strum spread over 20 ms changes the chord once.
- Scale Policy Adapt: A minor + E major publishes A harmonic minor; Keep leaves
  it unchanged.
- Progression in Transport advance: chord changes on the exact samples; after a
  loop jump the right slot plays; Trigger and Select advance as documented.
- Bus: a follower on the same sample as a change reads the new chord; two
  masters on one bus → the first wins; a cycle through *Notes* is delayed by
  one sub-block and doesn't deadlock.
- Notes output: common tones held across a change, note-ons before note-offs,
  no hanging notes after stop, Bus change and removal.
- Progression data round-trips; broken slots load safely.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Chord suggestions: next-chord candidates ranked by common function.
- A *Tension* knob that adds extensions (9, 11, 13) from the scale.
- Key detection from a longer note history, not only the chord.
- Progression slots with per-slot scale (modulation to another key).
- An *Anticipate* time for followers that sample slightly before the bar.
- Publish the context to external plugins over Bleep Bus.
