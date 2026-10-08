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
| Speed | −4…+4, +1 in the middle of the knob, bipolar | +1 | Varispeed as a playback ratio; negative plays backwards. At 0 the head stops (tape stop: silence). |
| Window Size | 0.001 % … 100 % of the splice (exponential), at least 0.5 ms | 100 % | Length of a window. At 100 % the whole splice plays; smaller values loop a piece of it. |
| Position | 0–100 % | 0 % | Where in the splice the windows are taken from. A slow LFO scrubs through the splice. |
| Overlap | 0–100 % | 40 % | Window overlap / density (4.4): from gaps, to seamless loops (the default), to a dense cloud of 2–4 overlapping windows with pitch-scattered copies. |
| Pick | 0–100 % | 0 % | Selects the target splice when *Select* isn't patched: 0…1 → splice 1…n (moving the knob is the manual way to pick a splice; only a moving knob picks, so recording or loading doesn't jump to its splice). Changes take effect per *Shift* (4.3). |
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
  extends *C*. The new splice becomes current; playback pauses while it is
  recorded and starts from its beginning when recording stops. Takes shorter
  than 10 ms are dropped. When the reel (*Reel length*) is full, recording
  stops.
- **Recording, Current splice:** writes into the current splice with an
  overdub head that starts at the play head and runs at the playback speed,
  looping within the splice, `new = in + Overdub × old` (so recording at
  Speed ½ writes at half speed — tape behaviour). Playback goes on.
- **Recording, Whole reel:** clears markers, records from 0.
- *Mark* during recording splits the take at that point; during playback it
  splits the current splice at the play head. Markers within 10 ms of an
  existing one are ignored.
- Punch-in/out ramps over *Fade* (appending: the punch-out fades the take's
  last *Fade* samples in place; overdub: writing continues while the ramp
  falls).

### 4.2 Playback

The play head runs through the current splice at *Speed* × `2^(Speed input)`,
with 4-point cubic interpolation. Reads outside the reel's content are silent;
reads past a splice's end (a crossfade tail) hear the following audio. At the splice end (or start, reversed) it
wraps (Loop) or stops and outputs silence (One-shot) until *Play*. *End* fires
at each wrap. With *Sync* on 1, 2, 4 or 8 bars, the base speed is set so the splice lasts
exactly that many bars at the current tempo (pitch follows, like tape; the
*Speed* knob only keeps its sign); window starts are derived from the song
position (window *k* starts at `k × period` counted from song position 0),
so the splice start sits on the bar line, a jump lands in phase (the voice
joins mid-window with a *Fade* ramp) and renders repeat.

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
  period; the period is `G / (1 − gap)`, gap from 75 % (at 0 %) down to 0
  (at 30 %). Rhythmic stutter.
- **30–50 %: seamless.** Windows repeat back to back; each voice plays *Fade*
  longer than the period and the two overlap with equal-power ramps — a clean
  micro-loop (at Fade 0, a sample-exact loop).
- **50–100 %: overlap.** 2 to 4 window voices run with staggered starts
  (overlap factor 2→4, period `G / factor`); each voice uses a Hann window and
  a gain of 2 / factor. Above 75 %, a growing share of the windows (0 → 100 %
  from 75 to 100 % Overlap) gets a seeded pitch offset of 0, +12, −12 or +7
  semitones and a pan position (`uniform01(Seed, windowIndex, stream)`) — a
  granular cloud built from the splice. Pitched voices stay centred on the
  window.

Changing *Position* moves the next window's start; running windows finish, so position
sweeps sound like scrubbing, not like jumps. With *Window Size* < 100 % and *End
Mode* Window, *End* fires at each window — a clock derived from the audio.

### 4.5 Import and export

- **Import WAV** (the view's drop target, or dropping a file on the reel):
  `BleepView.mediaDrop` imports it into the media store (`Media.h`: PCM
  8/16/24/32-bit, float, any channel count, any rate); the view puts the id
  in the data, and `setData` loads it on the message thread, resamples it to
  the engine rate (cubic) and hands it to the audio thread, which copies it
  into the reel 65536 frames per chunk (about 60 ms for a full 120 s reel at
  48 kHz; the output is silent meanwhile). Files longer than 120 s are
  truncated. Import replaces the reel. (The media store has no cue chunks, so
  WAV cue markers are not read; markers live in the node data.)
- **Export**: `exportMedia("reel")` (the whole reel) and `exportMedia("splice")`
  (the current splice), 32-bit float at the engine rate. The view saves the
  reel this way automatically when its audio changed and recording has
  stopped, and stores the returned id.

### 4.6 CPU, memory, edge cases

- CPU: one cubic read per channel per window voice (≤ 4) ≈ 1 % of a core at 48 kHz.
- Memory: the reel is allocated once in `prepare()` for the 120 s maximum
  (46 MB at 48 kHz, 92 MB at 96 kHz); *Reel length* limits recording. A
  loaded file is held on the message thread until it has been copied in.
  (Later, engine: inside a Voice Cell all voices **share one reel** —
  read-only playback per voice; recording only from voice 1. Today each voice
  has its own reel, and the board's memory-heavy warning applies.)
- Empty reel: outputs silence; *End* doesn't fire.
- Speed 0: the head stops (silence).
- Deleting a splice's marker merges it with the next (view: double-click the
  marker; one undo step).

## 5. Module view

```
 ┌──────────────────────────────────────────────────────────────────┐
 │ ● REC  [Import] [Export ▾]          reel 0:41 / 1:00   12 splices  │
 │ ▁▃▅▇▅▃│▂▄▆█▆▄▂▁│▃▅▃▁▃▅│▆▇▆▅▄▃▂▁▁│ … (waveform, splices alternating) │
 │        ▲ current       ▽ pending                                   │
 │ [ current splice, zoomed: window window shaded, play heads moving ]  │
 └──────────────────────────────────────────────────────────────────┘
```

- Top strip: the whole reel (`liveArrays` `peaks`, 512 bins), splices in
  alternating tints, current (bar) and pending (dashed) marked, every
  voice's head. Click a splice to select it (a view command, takes effect per
  *Shift*); drag a marker to move it; double-click to add a marker;
  double-click a marker to remove it.
- Zoomed strip: the current splice with the window (Position/Window Size)
  shaded and each window voice's head drawn.
- Rec, Mark, Next, Play and Clear reel are module buttons; the header shows
  the reel time, splice count and whether the reel is unsaved.
- (Later: naming splices on hover, reordering them by dragging.)
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
    "reel": "9c41d0…7a.wav",
    "length": 1968000,
    "markers": [96000, 288000, …],
    "names": { "3": "vox" },
    "current": 2
  }
}
```

- `reel` is a media-store id (a content hash, `Media.h`), so identical reels
  are stored once. Markers (frames at the engine rate, the implicit 0
  excluded) are in the data, not in the WAV. The view writes the reel
  (32-bit float WAV) after the audio changed; the audio thread's structure
  (length, markers, current) is mirrored into the data by the view.
- Missing file on load: the module loads with an empty reel and a "reel
  missing — locate…" notice; markers are kept.
- `sanitiseData` sorts and clamps markers to `length`, drops duplicates and
  invalid ids, clamps `current`, and keeps short string `names`. (`order` —
  a play order different from the reel order — is left for later.)

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
- WAV export and import round-trip through the media store (the reel and its
  markers come back; the loaded reel is copied in slice by slice); the
  hash-named file is reused. (Rates and bit depths are the media store's
  tests.)
- Missing media file loads safely.

## 9. Later

- Splice play order (`order` in the data) and splice names in the view.
- Import that appends as a new splice; WAV cue markers in and out (needs cue
  chunks in the media store).
- Shared reels in Voice Cells (engine support).
- Saving the reel when the board is saved, without the view open (engine:
  ask modules with unsaved media at save time).
- Per-splice settings (speed, level, loop mode).
- Tape character: wow/flutter, saturation, high-frequency loss on overdub.
- Record from Grains, or Grains reading a Splice reel.
- *Notes* input: each note plays the selected splice at its pitch (a sampler voice per note).
