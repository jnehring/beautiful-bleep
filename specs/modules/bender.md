# Bender

Type id `bender` · category *Audio* · colour proposal `#d8b4fe`

## 1. Purpose

A glitch effect in the spirit of circuit-bent samplers and skipping CDs. It
listens to the input, grabs short pieces of it and, by chance, repeats,
re-pitches, reverses, slices and corrupts them. Low settings add the odd
stutter to a beat; high settings shred it. All decisions come from a seed and
the song position, so a glitch you like comes back every time you play the
section, and the offline render sounds exactly like what you heard.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In L | `audio` | Left input; also feeds the right channel when *In R* is not patched. |
| In R | `audio` | Right input. |
| Clock | `trigger` | When patched, each pulse starts a new segment (overrides *Time* and *Sync*, see 4.1). |
| Glitch | `trigger` | Forces the next segment (or the current one, if *Now* is set) to repeat, regardless of *Chance*. |
| Freeze | `gate` | While high, the current segment loops and the buffer stops recording. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | The processed signal (dry while no glitch is active, see *Mix*). |
| Active | `gate` | High while a glitch (repeat or corruption) is playing. |
| Segment | `trigger` | A pulse at each segment start. |
| Random | `control` (bipolar) | The seeded value that decided the current segment; patch it elsewhere for modulation that matches the glitches. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Time | 1 ms – 2 s | 125 ms | Segment length in Free sync. Synced: a note value (4.1). |
| Chance | 0–100 % | 25 % | Probability that a segment is repeated instead of passed through. |
| Repeats | 1–16 | 4 | How many segment lengths a glitch lasts before audio passes again. No new decision is made while a glitch plays. |
| Bend | −2 … +2 | +1 | Playback speed of repeated segments: 1 normal, 0.5 an octave down, negative reversed (4.3). |
| Bend Var | 0–100 % | 0 % | Seeded per-segment variation of *Bend*: each glitch picks a speed from a set around *Bend*. |
| Slice | 0–100 % | 0 % | Stutter: each repetition gets shorter (ratchets, 4.4). |
| Corrupt | 0–100 % | 0 % | Amount of the corruption chosen by *Mode* (4.5). |
| Edge | 0–100 % | 70 % | Fade at segment boundaries: 0 % hard cuts (clicks on purpose), 100 % 8 ms fades. |
| Mix | 0–100 % | 100 % | Blend of dry and processed. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Sync | Free, 1/64 … 1 bar (straight, dotted, triplet) | 1/16 |
| Mode | Crush, Dropout, Fold, Shuffle, Smear | Crush |
| Corrupt When | Glitches only, Always | Glitches only |
| Bend Steps | Free, Octaves, Fifths + octaves, Semitones | Octaves |
| Now | off / on (Glitch input acts immediately) | off |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Segments and the buffer

The input is written continuously into a 4 s stereo ring buffer. Time is cut
into **segments**:

- **Sync on a note value, transport playing:** segment *k* starts at
  `ppq = k × noteLength`; boundaries are sample-accurate and phase-locked to
  the bar, so glitches land on the grid after a loop jump too.
- **Sync Free (or transport stopped):** segments follow each other from the
  moment the transport stopped or the module started: *Time* long in Free; a
  synced note value keeps its length at the last tempo.
- **Clock patched:** each pulse starts a segment; its length is the time
  since the previous pulse (clamped to 2 s).

At each segment start the module makes one **decision** (4.2). If the
segment is a glitch, the **source** is the audio of the segment that just
ended (the last segment length in the buffer), which is then played
*Repeats* segments long in place of the input. The source (plus 10 ms of
pre-roll for the loop seam) is copied out of the ring when the glitch
starts, so even 16 repeats of a 2 s segment keep their source while the ring
records on.

### 4.2 Seeded decisions

Every random choice is `hash(Seed, segment index, purpose)` (`dsp/Random.h`,
SplitMix64), where the segment index is *k* from the song position in
transport sync, or a counter that resets on `transportStarted` otherwise.
Per segment the module draws: glitch yes/no (`u < Chance`), the Bend
variation, slice order (Shuffle), dropout pattern, and the value sent to the
*Random* output. The same section therefore glitches the same way in every
playback and offline render, and changing *Chance* keeps the decisions that
still pass (the draw is fixed, only the threshold moves), so automating it
adds and removes glitches predictably.

A *Glitch* pulse forces the next decision to "yes" (or, with *Now*,
immediately starts a glitch with the last segment as source).

### 4.3 Bend

A glitch reads its source at speed *Bend* (× the per-segment variation),
snapped by *Bend Steps* (Octaves: ±0.25, ±0.5, ±1, ±2; Fifths add ×1.5 and
×0.75; Semitones: 2^(n/12); with Octaves or Fifths, |speed| < 0.125 snaps
to 0). *Bend Var* draws one value per glitch and picks a factor from
{1, ½, 2, −1, 1.5, ¾, −½, ¼}; the share of the set in use grows with Bend Var
(0 % is always 1). Reads use cubic interpolation. Negative speeds
read the segment backwards from its end. Speed 0 holds a single frame (a
buzz: two 2 ms grains at the head, half a grain apart under sin² windows, so
it's a tone, not DC). At speed ≠ 1 the source is read cyclically within the
segment, so a segment always lasts its full length; the loop point is
crossfaded over the Edge time into the pre-roll before the source, so the
wrap is continuous. *Bend* may be modulated at audio rate:
it changes the read speed continuously, never jumps the read position.

### 4.4 Slice (stutter)

With *Slice* above 0, each repetition inside a glitch is shorter than the
last: repetition *r* plays `length × (1 − Slice)^r` (minimum 3 ms), the
classic accelerating stutter. In transport sync, slice lengths are rounded to
the nearest power-of-two division of the segment, so ratchets stay on the
grid (1/16 → 1/32 → 1/64 …).

### 4.5 Corrupt modes

| Mode | What *Corrupt* does |
|---|---|
| Crush | Sample-rate reduction (48 kHz → 1 kHz) and bit depth (16 → 3 bits) together; no anti-alias filter, on purpose. |
| Dropout | Splits each repetition into 16 cells; each cell is silent with probability *Corrupt* (seeded). With *Edge* the gaps fade; without, they snap. |
| Fold | Gain up to +24 dB into a sine wavefolder, then a hard clip: from grit to shredded. |
| Shuffle | Splits the source into 8 slices and plays them in a seeded order; *Corrupt* is the share of slices that move from their place. |
| Smear | Short random read-position jitter (up to 20 ms × Corrupt) per 5 ms grain: a scratchy, smeared copy of the source. |

*Corrupt When* = *Always* also applies the corruption to the passing audio
between glitches (but Shuffle and Smear only act on glitches).
Mode is a setting; switching it ramps the corruption out over 10 ms, changes
the mode and ramps it back in over 10 ms (20 ms in all). Shuffle crossfades
at slice changes over the Edge time; Smear's jitter is a smooth seeded curve
(points every 5 ms), so it scratches rather than clicks. Dropout gaps fade
over a quarter of the Edge time (at most a cell).

### 4.6 Freeze

*Freeze* high: the current source segment loops indefinitely (as a glitch
with unlimited repeats; while passing, a glitch starts at once from the last
segment length), the buffer stops recording, and *Bend*, *Slice* and
*Corrupt* keep acting on the held loop. Freeze low: the glitch ends at the
next segment boundary (so the release lands on the grid), and recording
continues.

### 4.7 Clicks, Edge and tails

- Every transition (pass → glitch, repetition → repetition, glitch → pass)
  uses a raised-cosine crossfade of `Edge × 8 ms`. At Edge 0 the switch is
  instant; that's the only way the module clicks, and it's a choice.
- **Transport stop:** a glitch in progress finishes its repeats, then the
  module passes audio (segments continue in Free timing). Nothing hangs.
- The module has no tail: once a glitch ends, output is the input again.

### 4.8 CPU and memory

- Very cheap: one write, at most two interpolated reads per channel during
  crossfades, plus the corruption stage. ≈ 0.2 % of one core at 48 kHz.
- Ring 4 s stereo (rounded to a power of two: 2 MB at 48 kHz) plus two
  source copies of 2 s stereo (1.5 MB at 48 kHz): ≈ 3.5 MB at 48 kHz,
  14 MB at 192 kHz.
- Works per voice inside Voice Cells (each voice glitches on its own; with
  the same Seed they glitch in unison unless *Voice In › Random* is patched
  onto a knob).

## 5. Module view

```
 ┌───────────────────────────────────────────────────────────────┐
 │ ▕▔▔▔▔▕▔▔▔▔▕████▕█▌█▌▕▔▔▔▔▕████▕▔▔▔▔▕▔▔▔▔▕  segments (1 bar)    │
 │      pass  glitch stut   pass  glitch                         │
 │ ┌─────────────────────────────────────────┐                   │
 │ │ ∿∿∿∿~~~∿∿∿  buffer, source segment boxed│  ◉ FREEZE [Glitch] │
 │ └─────────────────────────────────────────┘                   │
 └───────────────────────────────────────────────────────────────┘
```

- **Segment strip:** the last bar of segments: passed (empty), glitched
  (filled), sliced (split). With transport sync it shows the *upcoming*
  decisions of the next bar too (they're deterministic), so you can see what
  *Chance* and *Seed* will do before it happens.
- **Source bar:** the read head inside the current source segment (the
  input waveform is left for later).
- **Freeze** latches (ORed with the gate); **Glitch** sends a pulse.

## 6. Saved state

```json
{
  "type": "bender",
  "params": { "time": 0.4, "chance": 0.25, "bend": 0.75, … },
  "data": { "freezeLatched": false }
}
```

Buffer content is not saved.

## 7. Engine requirements

1. **Shared delay toolkit** `patch/common/dsp/Delay.h` (ring buffer, cubic
   read) and the hash in `dsp/Random.h`.
2. **Look-ahead decisions for the view:** `liveArrays` exports `plan`, the
   decisions of the current and next bar (0 pass, 1 glitch start, 2 repeat,
   3 sliced repeat), computed from the same hash on the message thread from
   the last chunk's song position, Chance, Repeats and Seed (forced glitches
   excluded), and `history`, the last 64 segments as they happened.
3. Node data for the latched Freeze.

## 8. Tests

- Transport sync: segment boundaries at the right samples for each note
  value, including after a loop jump.
- Determinism: the same Seed and section give bit-identical output in two
  renders; a different Seed gives different decisions.
- Raising *Chance* only adds glitches: every segment glitched at 30 % is
  also glitched at 60 % (same seed).
- Bend: speed 0.5 halves the pitch of a sine source; −1 plays a ramp
  backwards; audio-rate modulation of Bend causes no discontinuity in the
  read position.
- Slice: repetition lengths follow `(1 − Slice)^r` (Free) and powers of two
  (synced).
- Each Corrupt mode at 0 % is transparent (bit-exact passthrough for Crush,
  Fold, Dropout).
- Edge > 0: no transition step larger than the crossfade allows; Edge 0
  switches on the exact sample.
- Freeze holds the segment; release lands on a segment boundary.
- Transport stop mid-glitch finishes the glitch and returns to dry audio.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Per-segment probability lanes drawn in the view (a glitch "sequencer").
- Tape-stop / tape-start effect as a sixth mode.
- Multi-segment memory: pick sources from up to 4 segments back.
- Output *Notes* events for each glitch to drive other glitch-reactive voices.
