# Sampler

Type id `sampler` · category *Audio* · colour proposal `#0d9488`

## 1. Purpose

A polyphonic sample player and slicer. A WAV file is loaded, optionally cut
into **slices** (by hand, by transients, or into beats), and played by up to
16 independent **playheads** (voices). Each playhead has its own pitch, speed,
envelope and position, and can sound either the whole sample or one slice.
Notes or triggers start playheads; the play mode decides how they end. It is
the module for "play a sample like an instrument, or chop a loop and
sequence the pieces"; *Splice* is the one for recording onto a reel, *Grains*
for a moving cloud.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Notes | `notes` | Starts and releases playheads (polyphonic). With *Trigger by* = *Note*: the note number picks the slice (4.2) or, in whole-sample mode, the pitch. |
| Trigger | `trigger` | Starts a playhead (*Trigger by* = *CV*). |
| Gate | `gate` | Holds the playhead started by *Trigger* open; falling edge releases it. Unpatched: a trigger is a one-shot of the *Mode* (4.4). |
| Slice | `control` (unipolar) | Picks the slice for the next trigger: 0…1 → slice 1…*n*. Sampled at the trigger. |
| Pitch | `pitch` | 1 V/oct added to *Transpose* for CV-triggered playheads. |
| Speed | `pitch` | 1 V/oct added to *Speed* (as a ratio). |
| Step | `trigger` | Moves the selected slice to the next one (wraps). |
| Stop | `trigger` | Releases all playheads. |
| Velocity | `control` (unipolar) | Velocity for CV-triggered playheads (default 1). |

Every knob (Start, End, Position, …) is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | Sum of all voices not routed to a voice output. |
| Voice 1 … 16 | `audio` | Voice *n* (stereo summed to mono, or the mono sample). A patched jack removes the voice from Out L/R. |
| End | `trigger` | A pulse when a playhead reaches the end of its sample or slice (also at each loop wrap). |
| Slice | `trigger` | A pulse when a playhead starts. |
| Playhead | `control` (unipolar) | Position of the most recently started playhead in the file, 0…1. |
| Active | `control` (unipolar) | Number of sounding voices / *Voices*. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Start | 0–100 % of the file | 0 % | Sample start. In slice mode, trims the start of every slice (as a fraction of the slice). |
| End | 0–100 % | 100 % | Sample end (same). |
| Transpose | −48…+48 semitones | 0 | Pitch shift. |
| Fine | −100…+100 cents | 0 | |
| Speed | −4…+4, +1 in the middle, bipolar | +1 | Playback ratio; negative plays backwards. |
| Position | 0–100 % | 0 % | Scrub position (4.6). |
| Attack | 0.5 ms – 10 s (exp.) | 1 ms | |
| Decay | 1 ms – 10 s | 100 ms | |
| Sustain | 0–100 % | 100 % | |
| Release | 1 ms – 10 s | 50 ms | |
| Level | 0–200 % | 100 % | |
| Pan | −100…+100 % | 0 | |
| Cutoff, Resonance | 20 Hz–20 kHz, 0–100 % | open | Filter after the envelope. |
| Filter Env | −100…+100 % | 0 | Amount the amp envelope shapes the cutoff. |
| Velocity | 0–100 % | 50 % | How much velocity scales level (and cutoff). |
| Crush | 0–100 % | 0 | Sample-rate and bit reduction (shared `Lofi.h`). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Voices | 1–16 | 8 |
| Voice mode | Poly, Mono, Legato, Layers | Poly |
| Trigger by | Note, CV | Note |
| Slice mode | Off (whole sample), On | Off |
| Mode | Gate, To end of sample, To end of slice, Loop, One-shot | Gate |
| Loop style | Forward, Ping-pong | Forward |
| Loop crossfade | 0–50 ms | 5 ms |
| Root note | MIDI 0…127 (auto-detect later) | 60 |
| Key tracking | −100…+200 % | 100 % |
| Position mode | Scrub, Offset | Scrub |
| Voice outs | Off, On (shows Voice 1…16) | Off |
| Layers, Layer pitch, Layer offset | 1–8, ±24 st, 0–200 ms | 2, 7, 0 |
| Quality | Linear, Cubic, Sinc | Cubic |
| Output | Stereo, Mono | Stereo |

## 4. Behaviour

### 4.1 The sample

The file lives in the media store (`Media.h`): the board stores the clip's
id, the markers and per-slice settings. WAV import resamples once to the
engine rate (cubic), accepting 8/16/24-bit and 32-bit float, mono or stereo.
The audio thread never loads: `setData` hands a prepared clip over
(`Handoff.h`), like Splice. While the clip is missing the module is silent
and the view says so.

### 4.2 Slicing

Markers are sample positions, sorted; *n* markers give *n* + 1 slices (the
file start is implicit). Up to 128. All three slicing modes write the same
marker list, so any can be refined by hand afterwards.

- **Manual:** double-click the waveform to add, drag to move, double-click a
  marker to remove; a *Snap to zero crossing* toggle moves a marker to the
  nearest zero crossing within 2 ms.
- **Threshold:** the button *Detect* runs a transient detector over the file
  (spectral-flux onset function with adaptive median, *Threshold* sets
  sensitivity, *Min gap* the shortest slice). It replaces the markers and
  runs on the message thread; the result is stored.
- **Beats:** equal divisions; or *BPM* + *Bars* of the file, so a loop of
  known tempo is cut on the grid. A *Detect BPM* button estimates the tempo
  from the onset function; the user corrects it.

Slice → trigger mapping in slice mode:

- *Trigger by* = *Note*: note numbers from the *Root* note upward select
  slices 1…*n* (slice-per-key, like a drum rack). Notes beyond *n* are ignored.
- *Trigger by* = *CV*: the *Slice* input picks (0…1 → 1…*n*), sampled at the
  trigger; unpatched, the *current slice* chosen in the view plays.
- A **Next** button and the *Step* input (trigger) advance the current slice;
  *Random* picks one (seeded, so renders repeat).

With *Slice mode* off, the whole sample (trimmed by *Start/End*) plays and
notes transpose it relative to *Root*.

### 4.3 Playheads

Each voice holds: position (fractional frames), direction, envelopes,
filter state, and the slice it plays. Voice allocation follows *Voice mode*:

- **Poly:** a new start takes a free voice; with none free the quietest in
  release, else the oldest, fades out over 5 ms and is taken.
- **Mono / Legato:** one voice; Legato changes pitch without retriggering the
  envelope or restarting the position.
- **Layers:** one start fires *k* playheads at once (setting *Layers*,
  1–8) with per-layer offsets for pitch (cents or semitone steps / chord
  presets) and position (in ms), for unison and chords.

Allocation is deterministic from the notes and the *Seed*.

### 4.4 Play modes

Per voice, with the start (and end) points from the sample or the slice:

| Mode | Behaviour |
|---|---|
| Gate | Plays while the note/gate is held; release fades out (Release) wherever the head is. Reaching the end stops it (silence) unless Loop. |
| To end of sample | Plays to the sample *End*, ignoring the gate-off and slice ends; the envelope's release applies at the end only (a 5 ms fade). |
| To end of slice | Plays to the next marker (or *End*), then stops with a fade. |
| Loop | Loops the sample *Start…End*, or in slice mode the slice, until released. Loop style and crossfade apply. |
| One-shot | Plays through the slice/sample regardless of note length; the gate-off does nothing. |

Each slice can override *Mode* (default *Inherit*); the override is stored
with the markers. *End* pulses on every wrap and end.

### 4.5 Pitch and speed

Pitch ratio = `2^((note − Root) × KeyTrack/12 + Transpose/12 + Fine/1200 + PitchCV)`.
In **Repitch** time mode, speed multiplies the pitch ratio (tape-style): one
ratio, one interpolated read. In **Stretch** mode (v2), the read speed comes
from *Speed* alone and pitch from the pitch ratio, using a granular/WSOLA
engine (windows 20–60 ms, transient preservation). v1 ships Repitch only;
the setting and the saved field are reserved so boards saved with it keep
loading. Interpolation: linear, 4-point cubic, or windowed-sinc (8-point),
with a lowpass when pitching up to avoid aliasing (as Splice does).

*Auto* root note runs a pitch detector over the file once and stores the
result; the user can override.

### 4.6 Moving the playhead

- **Position** knob/CV: while a voice sounds, a change scrubs: the head is set
  to `Start + Position × (End − Start)` (or the slice) with a 3 ms crossfade.
- With *Position mode* = *Offset*, the value is read at the trigger and adds
  to the start (random-access starts: a sequencer or LFO decides where in the
  sample a hit begins).
- *Scrub* mode: Position sets the head directly and continuously, the speed
  being the position's rate of change (a turntable-style scratch). Speed 0
  freezes.
- Dragging in the view scrubs the most recent voice.

### 4.7 Envelope, filter, level

ADSR amplitude envelope per voice (linear attack, exponential decay/
release), time-scaled by key tracking if enabled. A second envelope amount
(*Filter Env*) shapes the cutoff of a per-voice state-variable filter
(`Svf.h`). Velocity scales level and, with *Velocity* > 0, cutoff. Choke
groups: a start in group *g* releases (5 ms fast release) every playing
voice of the same group.

### 4.8 Stereo and outputs

Stereo clips play stereo; *Pan* balances them; mono clips pan equally.
*Output* = *Mono* sums to both sides. A patched *Voice n* jack carries that
voice dry-pan-less and takes it out of Out L/R.

### 4.9 Transport

Nothing is tied to the song position, except *Beats* → *BPM*/*Bars*, which
can show a **Sync** option (playing a loop-length sample at the song's tempo
by setting *Speed* to `songBPM / fileBPM`), as in Splice. Transport jumps
release no voices.

## 5. Module view

- A large **waveform** (min/max peaks cached from the clip; zoom with
  scroll/pinch, scroll horizontally), markers as lines with slice numbers,
  the trimmed region highlighted, **Start/End handles** to drag, the current
  slice highlighted, one **dot per playhead** moving in real time (via
  `liveValues`).
- A toolbar: *Load* (file picker + drop target), *Slicing* mode tabs with
  their controls (*Detect*, threshold, beats, BPM), *Snap*, *Next*, *Clear*,
  *Audition* (click a slice to hear it).
- Below, per-slice settings for the selected slice: Mode, Transpose, Level,
  Pan, Reverse, Choke group, Name.
- The knobs in rows: Pitch/Speed, Envelope, Filter, Output.

## 6. Saved state

In the node's `data` (JSON, sanitised in `setData`):

```
{ "clip": "<media id>", "length": <frames>, "root": 60 | "auto",
  "markers": [<frames>…], "current": <slice>,
  "slices": { "<i>": { "mode": "inherit|…", "transpose": 0, "level": 1,
                       "pan": 0, "reverse": false, "choke": 0, "name": "" } },
  "slicing": { "kind": "manual|threshold|beats", "threshold": 0.5,
               "minGap": 30, "beats": 16, "bpm": 120, "bars": 4 } }
```

The audio itself is in the media folder; boards store only the id (like
Splice and Grains).

## 7. Engine requirements

- Media: reuse `Media.h`; `exportMedia` is not needed (the clip is imported,
  not recorded).
- A `notes` input with per-note voice release (as the Voice Cell); the module
  has no inner patch, so it implements its own allocator.
- Up to 16 optional mono outputs + 6 fixed ones = 22 output jacks. If the
  jack list is too long for the module view, the voice outputs sit behind a
  *Voice outs* toggle (default off) that shows jacks 1–16 only when on.
- `liveValues` for the playhead dots (voice position, up to 16 floats).
- A transient detector and a pitch detector in `patch/common/dsp/`
  (`Onsets.h`, `PitchDetect.h`), both message-thread only.
- A stretch engine in v2 (`patch/common/dsp/Stretch.h`).

## 8. Tests

- Whole-sample playback at ratio 1 reproduces the clip exactly (sample for
  sample after the envelope's 1 ms attack); ratio 2 plays in half the time,
  one octave up (measured by autocorrelation on a sine clip).
- Slice mapping: note *Root + i* plays exactly slice *i* and stops at the
  marker in *To end of slice*; CV mode picks the same slices for the same
  values (boundaries with hysteresis).
- Each play mode: Gate releases at gate-off; To end ignores it; Loop wraps
  seamlessly (no discontinuity above −60 dB with crossfade); One-shot runs on.
- Poly: 16 simultaneous voices are independent; voice 17 steals the oldest
  with no click (fade); Mono/Legato behave per 4.3.
- Beat slicing of an N-beat loop gives equal slices; threshold detection finds
  the known onsets of a synthesised click loop within 5 ms.
- Position scrub crossfades (no click above −50 dB); backwards play reaches
  the start and stops.
- Determinism: the same notes and seed render identically at 44.1/48/96 kHz
  (modulo resampling), voice-output routing removes the voice from the mix.
- The module harness: finite output within ±64 in every state, including no
  clip, a one-sample clip, and markers at the extremes.

## 8a. Implementation notes (v1, as built)

Differs from the text above where noted:

- Slicing kind, threshold, min gap, beats, BPM and bars are view settings
  saved in the node data (section 6), not knobs. Detection runs in the engine
  through `perform("detect" | "bpm")` and returns through `takeData`.
- The onset detector is energy-flux based (no FFT); `Onsets.h`.
- Interpolation *Sinc* is an 8-tap table; there is no anti-alias lowpass when
  pitching up yet.
- Position *Scrub* jumps playheads when Position changes; the turntable-style
  continuous scratch mode is not built.
- Root note is an integer; *Auto* root (pitch detection) and the Sync option
  are not built. The waveform has no zoom yet.
- Stretch time mode is not built (v2); the setting is not exposed.
- Seed is not a setting; Random slice uses a counter.

## 9. Later

- Waveform zoom, root-note auto-detect, the tempo Sync option, an anti-alias
  lowpass for Sinc when pitching up, scratch mode.
- **Time-stretch** (Stretch time mode, section 4.5).
- Per-slice start/end offsets and per-slice envelopes.
- Sample sets: several files mapped across the keyboard (multisampling,
  round-robin, velocity layers).
- Slice sequencing in the view (a built-in pattern of slice indices).
- Recording into the sampler (resample the board, as Splice does).
- Warp markers: stretch a loop to a grid by moving its beat markers.
- Export slices as separate WAV files.
- MPE: per-note pressure to filter or position.
