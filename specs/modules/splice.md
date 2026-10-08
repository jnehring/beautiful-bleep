# Splice

Type id `splice` · category *Audio* · colour proposal `#0284c7`

## 1. Purpose

A tape-style sampler and looper. Audio is recorded onto a **reel** of up to
two minutes of stereo, cut into **splices** by markers, and played back at a
variable, bipolar speed. Within the current splice, *Window Size*, *Position* and
*Overlap* break playback into small repeating pieces (windows), from micro-loops
to overlapping granular textures. Triggers move between splices, a control
signal selects one directly, and reels are imported from and exported to WAV
files. Splice is the module for "record something, then play with it";
*Grains* is the one for a continuously moving live cloud.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In L, In R | `audio` | Recording source. *In R* unpatched: *In L* feeds both sides. |
| Record | `gate` | Rising edge starts recording, falling edge stops (in *Gate* record mode); in *Toggle* mode each rising edge toggles. ORed with the view's record button. |
| Mark | `trigger` | Adds a splice marker at the play (or record) head. |
| Next | `trigger` | Moves to the next splice (wraps). Where the move lands is set by *Shift* (4.3). |
| Select | `control` (unipolar) | While patched, 0…1 selects splice 1…*n* directly (with 2 % hysteresis). |
| Play | `trigger` | Restarts the current splice from its start (or end, when reversed). |
| Speed | `pitch` | 1 V/oct added to *Speed* (as a ratio), so a sequencer plays the reel melodically. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | The playback, mixed with the input per *Monitor*. |
| End | `trigger` | A pulse at the end of each splice pass (and at each window end when *Window Size* < 100 %, see *End Mode*). |
| Position | `control` (unipolar) | The play head within the current splice, 0…1. |
| Splice | `control` (unipolar) | (current splice − 1) / (n − 1). |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Speed | −4…+4 (centre detent at +1), bipolar | +1 | Varispeed as a playback ratio; negative plays backwards. Around 0 the curve is flatter for fine slow-motion; at exactly 0 the head stops (tape stop). |
| Window Size | 0.5 ms … 100 % of the splice (exponential) | 100 % | Length of a window. At 100 % the whole splice plays; smaller values loop a piece of it. |
| Position | 0–100 % | 0 % | Where in the splice the windows are taken from. A slow LFO scrubs through the splice. |
| Overlap | 0–100 % | 0 % | Window overlap / density (4.4): from gaps, to seamless loops, to a dense cloud of 2–4 overlapping windows with pitch-scattered copies. |
| Pick | 0–100 % | 0 % | Selects the target splice when *Select* isn't patched: 0…1 → splice 1…n (moving the knob is the manual way to pick a splice). Changes take effect at the end of the current window/splice (4.3). |
| Overdub | 0–100 % | 100 % | While recording onto existing audio: how much of the old audio is kept (0 % replaces, 100 % fully layers). |
| Level | 0–200 % | 100 % | Output level. |
| Fade | 0–50 ms | 3 ms | Crossfade at splice/window boundaries and on record punch-in/out. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Reel length | 15 s, 30 s, 60 s, 120 s | 60 s |
| Record mode | Gate, Toggle | Toggle |
| Record target | New splice (append), Current splice (overdub), Whole reel | New splice |
| Shift | Immediate, End of window, End of splice | End of splice |
| End Mode | Splice, Window | Splice |
| Loop | Loop, One-shot | Loop |
| Monitor | Off, Input while recording, Always | Input while recording |
| Sync | Free, Bars (fit splice to 1/2/4/8 bars) | Free |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 The reel and splices

The reel is a stereo float buffer of *Reel length* (120 s at 48 kHz = 46 MB;
allocated off the audio thread). Content length *C* ≤ reel length. Markers
are sample positions sorted ascending; *n* markers give *n* + 1 splices
(marker 0 is implicit at 0, the end at *C*). Up to 128 splices.

- **Recording, New splice:** appends at *C*, adds a marker at the old *C* and
  extends *C*. When the reel is full, recording stops and the view flashes.
- **Recording, Current splice:** writes into the current splice at the play
  head (looping within it), `new = in + Overdub × old`, with the play head's
  speed (so recording at Speed ½ writes at half speed — tape behaviour).
- **Recording, Whole reel:** clears markers, records from 0.
- *Mark* during recording splits the take at that point; during playback it
  splits the current splice at the play head. Markers within 10 ms of an
  existing one are ignored.
- Punch-in/out ramps over *Fade*.

### 4.2 Playback

The play head runs through the current splice at *Speed* × `2^(Speed input)`,
with 4-point cubic interpolation. At the splice end (or start, reversed) it
wraps (Loop) or stops and outputs silence (One-shot) until *Play*. *End* fires
at each wrap. With *Sync* Bars, the base speed is set so the splice lasts
exactly the chosen number of bars at the current tempo (pitch follows, like
tape); the splice start is then aligned to the bar line, and the position is
derived from the song position, so renders repeat.

### 4.3 Moving between splices

*Next*, *Select* and *Pick* set a **pending** splice (*Select* overrides *Pick*; *Next* adds one to whichever is in charge). *Shift* decides when
it becomes current: *Immediate* (crossfade over *Fade*), *End of window*, or
*End of splice*. A pending splice is shown in the view. *Play* on the same
sample as a pending change starts the new splice.

### 4.4 Windows: size, position, overlap

Within the current splice of length *S*, a window is a window of length
`G = WindowSize × S` (minimum 0.5 ms) starting at
`start = Position × (S − G)`. Playback loops the window instead of the splice.

*Overlap* controls how windows are played:

- **0–30 %: gaps.** Each window plays once, then silence until the next window
  period; the period is `G / (1 − gap)`, gap up to 75 %. Rhythmic stutter.
- **30–50 %: seamless.** Windows repeat back to back with a *Fade* crossfade — a clean micro-loop.
- **50–100 %: overlap.** 2 to 4 window voices run with staggered starts
  (overlap factor 1→4); each voice uses a Hann window. Above 75 %, voices get a
  seeded pitch offset of 0, +12, −12 or +7 semitones (`uniform01(Seed, windowIndex, voice)`)
  and pan spread — a granular cloud built from the splice.

Changing *Position* moves the next window's start; running windows finish, so position
sweeps sound like scrubbing, not like jumps. With *Window Size* < 100 % and *End
Mode* Window, *End* fires at each window — a clock derived from the audio.

### 4.5 Import and export

- **Import WAV** (view menu or dropping a file on the module): mono/stereo,
  any sample rate (resampled on a background thread with a windowed-sinc
  converter), 16/24/32-bit. Cue markers in the WAV become splice markers.
  Files longer than the reel are truncated (with a notice). Import can
  replace the reel or append as a new splice.
- **Export WAV**: the whole reel or the current splice, 32-bit float at the
  engine rate, with markers written as cue points.

### 4.6 CPU, memory, edge cases

- CPU: one cubic read per channel per window voice (≤ 4) ≈ 1 % of a core at 48 kHz.
- Memory: the reel (up to 92 MB at 96 kHz, 120 s); the view warns when a
  board's audio buffers exceed 512 MB. Inside a Voice Cell all voices **share
  one reel** (read-only playback per voice; recording only from voice 1) — so
  a Voice Cell becomes a polyphonic sampler without copying memory.
- Empty reel: outputs silence; *End* doesn't fire.
- Speed 0: the head stops; a window/loop still plays with Overlap > 50 % (frozen texture).
- Deleting a splice's marker merges it with the next (view, one undo step).

## 5. Module view

```
 ┌──────────────────────────────────────────────────────────────────┐
 │ ● REC  [Import] [Export ▾]          reel 0:41 / 1:00   12 splices  │
 │ ▁▃▅▇▅▃│▂▄▆█▆▄▂▁│▃▅▃▁▃▅│▆▇▆▅▄▃▂▁▁│ … (waveform, splices alternating) │
 │        ▲ current       ▽ pending                                   │
 │ [ current splice, zoomed: window window shaded, play heads moving ]  │
 └──────────────────────────────────────────────────────────────────┘
```

- Top strip: the whole reel, splices in alternating tints, current and
  pending marked. Click a splice to select it; drag a marker to move it;
  double-click to add a marker; select + Delete to remove one.
- Zoomed strip: the current splice with the window window (Position/Window Size)
  shaded and each window voice's head drawn.
- Splices can be named (shown on hover) and reordered by dragging (the audio
  stays, the play order changes).
- Each marker/structural edit is one undo step; audio itself is not part of
  undo except *Clear reel* and *Import*, which keep the previous reel file.

## 6. Saved state

The reel is **saved as a WAV file beside the board**, never inside the board
JSON:

```json
{
  "type": "splice",
  "params": { "speed": 0.625, "window": 1.0, … },
  "data": {
    "reel": "media/9c41d0…7a.wav",
    "length": 1968000,
    "markers": [0, 96000, 288000, …],
    "order": [0, 1, 2, …],
    "names": { "3": "vox" },
    "current": 2
  }
}
```

- The file name is the SHA-256 of its content, so identical reels are stored
  once and an unchanged reel isn't rewritten on save. A reel is written
  (32-bit float WAV, with cue markers) when the board is saved after the
  audio changed.
- Missing file on load: the module loads with an empty reel and a "reel
  missing — locate…" notice; markers are kept.
- `sanitiseData` sorts and clamps markers to `length`, drops duplicates, and
  makes `order` a permutation.

## 7. Engine requirements

1. **Board media folder.** A place for audio files referenced by the board:
   - App: `<name>.bleepboard.media/` next to the project file.
   - Plugin in Live: Live's project folder isn't known reliably, so media go
     to a user media library (`~/Music/Bleep Patch/Media/<board id>/`), named
     by content hash; *Collect media* in the board menu copies them into a
     chosen folder. Option *Embed small reels* stores reels under 10 s as
     FLAC-compressed base64 in the plugin state, so short loops travel with the set.
   - Copy/paste and cell presets carry the hash; presets export with their media.
2. **Background file I/O** (load, resample, write) off the audio and message
   threads, with buffer swap on the audio thread via an atomic pointer and
   deferred free.
3. **Shared buffers in Voice Cells** (one reel for all voices).
4. **File drop onto a module view** (UI bridge).
5. **Offline renders:** a reel that is still loading when a render starts must
   block the render (allowed outside real time) rather than play silence.

## 8. Tests

- Record → play at Speed 1 reproduces the input sample-exact (Fade 0).
- Speed −1 plays reversed; Speed 2 plays an octave up with the right length; Speed input +1 V doubles speed.
- Marker logic: Mark during record/playback splits correctly; near-duplicate markers ignored; delete merges.
- Shift modes change splices at the right sample; Select hysteresis.
- Windows: Window Size/Position window positions; seamless mode has no discontinuity; Overlap overlap count; seeded pitch offsets repeat.
- Overdub 0 % replaces, 100 % sums.
- Sync Bars: a splice spans exactly N bars at several tempos; after a loop jump it is in phase.
- WAV import (rates, bit depths, cue markers) and export round-trip; hash-named file reused.
- Missing media file loads safely.

## 9. Later

- Per-splice settings (speed, level, loop mode).
- Tape character: wow/flutter, saturation, high-frequency loss on overdub.
- Record from Grains, or Grains reading a Splice reel.
- *Notes* input: each note plays the selected splice at its pitch (a sampler voice per note).
