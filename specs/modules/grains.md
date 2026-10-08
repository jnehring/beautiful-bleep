# Grains

Type id `grains` · category *Audio* · colour proposal `#2563eb`

## 1. Purpose

A granular processor that continuously records its stereo input into a
buffer of several seconds and plays it back as many short overlapping
**grains**. Position, size, pitch and density of the grains turn any sound
into shimmering textures, stretched pads or stuttering rhythms; *Freeze* holds
the buffer so the cloud plays on after the input stops. Grain scheduling is
seeded and can be locked to the transport, so a texture renders identically
every time — something a hardware granular processor can't promise.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In L, In R | `audio` | The signal recorded into the buffer. *In R* unpatched: *In L* feeds both sides. |
| Trigger | `trigger` | In *Triggered* mode each pulse starts one grain (or a burst, see *Density*). In *Continuous* mode it adds an extra grain. |
| Freeze | `gate` | While high, recording stops (ORed with the *Freeze* toggle). |
| Pitch | `pitch` | 1 V/oct, added to *Pitch*. Patch a sequencer here to play the cloud melodically. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | Dry/wet mix of the grains (and the blur stage). |
| Grain | `trigger` | A pulse at each grain start. |
| Grain Env | `control` (unipolar) | The window of the most recent grain, for modulating something else in sync. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Position | 0–100 % | 0 % | Where grains read, as a distance back from the write head (0 % = newest audio, 100 % = oldest). When frozen, an absolute position in the buffer. |
| Size | 5 ms–2 s (exponential) | 120 ms | Grain length. |
| Pitch | −24…+24 semitones | 0 | Playback transposition of each grain. |
| Density | 0–100 % | 50 % | Grains per second, 0.5–200 (exponential) in Continuous mode; in *Sync* mode, selects the note division (4.2). Below 50 % grains are sparse and irregular; the knob's centre is a smooth cloud. |
| Texture | 0–100 % | 40 % | Window shape: 0 % rectangle-ish (5 % fades), 25 % trapezoid, 50 % Hann, 75 % Gaussian (narrow), 100 % percussive (fast attack, exponential decay). Interpolated between neighbours. |
| Spread | 0–100 % | 30 % | Random scatter per grain: position jitter up to ±25 % × Spread of the buffer view and stereo pan across ±Spread (pitch scatter is *Pitch Jitter*). |
| Pitch Jitter | 0–12 semitones | 0 | Random pitch offset per grain; quantized to *Pitch Quant*. |
| Feedback | 0–100 % | 0 % | Part of the output written back into the buffer with the input (soft-clipped). Builds dense, evolving textures. |
| Blur | 0–100 % | 0 % | A diffuse reverb-like smear after the grains (4.5). |
| Mix | 0–100 % | 100 % | Dry/wet. |
| Reverse | 0–100 % | 0 % | Chance that a grain plays backwards. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Mode | Continuous, Triggered | Continuous |
| Sync | Free, 1/64 … 1/4 (straight, dotted, triplet) | Free |
| Buffer | 2, 4, 8, 16 s | 8 s |
| Pitch Quant | Off, Semitones, Octaves, Octaves + fifths | Semitones |
| Max grains | 16, 32, 64 | 32 |
| Freeze | on/off | off |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Buffer

A stereo circular buffer of *Buffer* seconds (32-bit float; 8 s at 48 kHz =
3 MB). The write head records `In + Feedback × softclip(Out_wet)` unless
frozen. Freezing stops writing within one sample but crossfades the write
over 5 ms on both ends so the seam is clean (the write blends from the input
into the old content there, which is the oldest audio, so the frozen buffer
loops seamlessly at the write head); while frozen, *Position* is
measured from the freeze point, so the frozen sound doesn't move. The buffer
is allocated once in `prepare()` for 16 s; changing *Buffer* ducks the output
for 10 ms, empties the buffer (it then starts empty) and fades back in.

### 4.2 Grain scheduling

- **Continuous, Sync Free:** the interval to the next grain is
  `1 / rate × (1 + irregularity × (2u − 1))`, where *rate* comes from
  *Density* and *irregularity* grows as Density falls below 50 % (up to ±90 %).
- **Continuous, Sync on:** grains start on the song grid at the chosen
  division; *Density* above 50 % adds 1–3 subdivisions (2–4 grains per grid
  point), below 50 % skips grid points with probability `(0.5 − d) × 2`.
  Grain *n* is identified by its grid index (`4 × floor(ppq / division)` plus
  the subdivision), so the cloud is phase-locked to the bars. With the
  transport stopped the grid runs on at the last tempo.
- **Triggered:** each *Trigger* pulse starts one grain; *Density* > 50 % turns
  each pulse into a burst of up to 8 grains spaced by Size/4.
- In Continuous mode a *Trigger* pulse adds one extra grain (its own seeded
  numbering, so it doesn't shift the regular grains).

Every random choice of grain *n* (jitter, pan, pitch, reverse, skip) uses
`uniform01(Seed, n, stream)` with one stream per parameter. *n* counts grains
since the transport started (Free and Triggered) or is the grid index
(Sync), so offline renders repeat exactly (`specs.md` 5.3). The buffer
content still depends on the input, so a render repeats when the input does.

If *Max grains* are playing, the oldest grain is faded out over 2 ms and its
slot reused (never a click, never more CPU than the cap).

### 4.3 A grain

At start, a grain fixes its read position, pitch ratio `2^(semitones/12)`,
direction, pan and window. It reads with 4-point cubic (Hermite)
interpolation; the read head moves `ratio` samples per sample (negative when
reversed). A grain reading forward faster than real time near *Position*
0 % could overtake the write head: the start is moved back by
`Size × (ratio − 1)` so it never reads unwritten audio. Window values come
from a 1024-point table per texture shape, interpolated between shapes.

Output gain is normalised by the expected overlap: `1 / sqrt(max(1, rate × Size))`,
smoothed over 50 ms, so turning *Density* or *Size* up doesn't blow up the
level (synced: rate = grains per grid point / division; triggered: up to 4
overlapping burst grains / Size).

### 4.4 Pitch

Grain pitch = *Pitch* knob + *Pitch* input × 12 + jitter, quantized per
*Pitch Quant* (the quantizer applies to the sum, so a sequencer plays in tune).
The pitch input is sampled at each grain's start.

### 4.5 Blur

A small diffusion network after the grains: 4 series allpasses per side
(4.1–22.9 ms, `dsp::Diffuser`, lengths modulated ±0.3 ms) into the shared
FDN (`dsp::Fdn`, 8 lines, Householder, size 0.35, modulation ≈ ±0.3 ms, its
soft limiter on). *Blur* sets both the wet level and the decay (0.3–8 s):
`wet = (1 − ½ Blur) × grains + Blur × fdn`. At Blur 0 the stage idles (and
starts empty when turned up again). Its tail is part of what *Feedback*
writes back, which makes frozen pads endless.

### 4.6 CPU and memory

Per grain per sample: one cubic read per channel, one window lookup, pan:
≈ 20 flops. 32 grains ≈ 1.5 % of one core at 48 kHz; 64 grains ≈ 3 %. Memory:
always the 16 s maximum, `16 × sample rate × 2 × 4 bytes` (6.1 MB at 48 kHz,
12.3 MB at 96 kHz), plus the blur FDN (≈ 2 MB at 48 kHz). Inside a Voice Cell each voice has its own buffer; the
view warns when a cell's total exceeds 64 MB.

### 4.7 Transport and edge cases

- Transport stop doesn't stop the module (it's an effect): Free and Triggered
  keep working; Sync falls back to Free at the last tempo.
- Silent input: grains read silence; nothing special.
- Sample-rate change empties the buffer.

## 5. Module view

A waveform of the buffer (both channels, min/max per pixel, refreshed at 30
fps from a downsampled copy) with the write head, the *Position* window
(Position ± Spread jitter) shaded, and every live grain drawn as a dot moving
through it, size = window, brightness = gain. A lock icon shows *Freeze*.
Below: the window shape preview for *Texture*, then the knobs. Dragging
horizontally on the waveform sets *Position*; vertically sets *Size*.

## 6. Saved state

Knobs and settings only. The live buffer is **not saved** — it's a recording
of whatever is playing. Exception: with *Freeze* on, the view offers *Keep
frozen buffer*; then the buffer (oldest sample first, ending at the freeze
point) is saved with `exportMedia("frozen")` to the media store
(`patch/engine/Media.h`) and its id is referenced in `data`:

```json
{ "type": "grains", "params": { … }, "data": { "frozen": "3f9a0c1d2e3b4a59.wav" } }
```

On load, `setData` reads the WAV (on the message thread; resampled with cubic
interpolation if its rate differs) and hands it to the audio thread
(`RtHandoff`); with the *Freeze* setting on, the module starts frozen on it.
When Freeze turns off, the module records live again and the view clears the
id. A missing file leaves the module recording live.

## 7. Engine requirements

1. **Large allocations off the audio thread:** buffers are allocated in
   `prepare` / `setData` on the message thread and swapped in atomically.
2. **Board media files** (shared with Splice): see `splice.md` section 7.
3. **Waveform view data:** `liveArrays`: `peaks` (256 bins of the valid
   span, oldest first, computed on the message thread from the buffer) and
   `dots` (position, progress and gain of each live grain).

## 8. Tests

- Single grain at Pitch 0, Size 100 ms, rectangle window reproduces the input
  delayed by the position, sample-exact.
- Pitch +12 reads at double speed; cubic interpolation error below −80 dB for a sine.
- Same Seed and input render identical output twice; Sync mode places grains
  on the grid after a loop jump.
- Max grains cap is never exceeded; stealing fades out (no step > −60 dB).
- Freeze stops writing; position stays fixed relative to the freeze point.
- Feedback 100 % with Blur stays bounded (soft clip) over 60 s of noise.
- A grain never reads past the write head.
- Saved frozen buffer round-trips through WAV and plays as the frozen source.
- (The module's tests live in `tests/test_grains_module.cpp`; `test_grains`
  is the shared engine's test.)

## 9. Later

- Load a sample file into the buffer (overlap with *Splice*; share the loader).
- Per-grain filter and spectral grains.
- Grain *Notes* input: each note starts a grain at its pitch (polyphonic playing without a Voice Cell).
- Position follows the playhead of a Splice reel.
