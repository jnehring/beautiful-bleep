# Wavetable Osc

Type id `wavetable-osc` · category *Sources* · colour proposal `#818cf8`

## 1. Purpose

A two-dimensional wavetable oscillator. A *bank* holds 64 single-cycle
waveforms on an 8 × 8 grid; the *X* and *Y* knobs pick a point on that grid
and the oscillator blends the four nearest waveforms. Sweeping X and Y with
envelopes and LFOs gives timbres that move in two independent directions,
e.g. brightness along X and vowel along Y. A *Warp* control bends how each
cycle is read (phase distortion, sync, mirror, squash) for even more motion.
Factory banks come built in; your own single-cycle WAV files can be dropped
in. Every table is stored band-limited at several octaves (mipmaps), so the
oscillator stays clean from sub-bass to the top of the keyboard.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Pitch | `pitch` | 1 V/oct (0.0 = C4). |
| FM | `audio` | Linear, through-zero FM, scaled by *FM Depth*. |
| Sync | `trigger` | Restarts the cycle at the trigger's sample offset (band-limited, 4.5). |

Every knob is also an input (`specs.md` section 7.3), including *Bank*.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | The oscillator. R reads the grid at an offset set by *Stereo* (4.6); with *Stereo* 0 L = R. |
| Sub | `audio` | A sine one octave below, in phase with the main cycle. |
| Pos X | `control` (unipolar) | The column position actually played (left channel), after modulation and path, 0–1. |
| Pos Y | `control` (unipolar) | The row position actually played, 0–1. Use both to drive other modules in step with the scan. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Octave | −4…+4 (stepped) | 0 | Whole octaves. |
| Coarse | −12…+12 st | 0 | Semitones. |
| Fine | −100…+100 ct | 0 | Cents. |
| Bank | stepped: factory banks, then *User* | 1 (Analog) | Which bank plays. Changes crossfade (4.7). |
| X | 0–100 % | 0 % | Column position on the grid (continuous). |
| Y | 0–100 % | 0 % | Row position. |
| Scan | 0–100 % | 0 % | Position along the chosen *Path* (used instead of X/Y when *Path* ≠ Off). |
| Warp | 0–100 % | 0 % | Amount of the phase warp chosen in *Warp Mode*. |
| FM Depth | 0–100 % | 0 % | ±4× frequency swing at 100 % (through zero). |
| Stereo | −50…+50 % | 0 % | X offset of the right channel. |
| Sub Level | 0–100 % | 0 % | Mixes *Sub* into *Out* as well (the *Sub* jack is always full level). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Path | Off (X/Y), Rows, Snake, Columns, Diagonal, Spiral | Off |
| Frame Blend | Smooth (bilinear), Step (nearest) | Smooth |
| Read | Cubic, Linear, Raw (no interpolation, no mipmaps) | Cubic |
| Warp Mode | Bend, Sync, Mirror, Squash, Steps | Bend |
| Quality | Normal (1×), High (2×) | Normal |

## 4. Behaviour

### 4.1 Pitch and phase

`f = 261.63 Hz × 2^(Octave + Coarse/12 + Fine/1200 + Pitch)`, then FM:
`f × (1 + 4 × FMDepth × FM)`. A double-precision phase `φ ∈ [0, 1)` runs at
`f` (backwards for negative `f`). Frames are 2048 samples; the table index
is `w(φ) × 2048`, where `w` is the warp (4.4).

### 4.2 Banks

**Factory banks**, generated procedurally at start-up (no sample files,
identical on every machine, so renders repeat):

| # | Bank | X axis | Y axis |
|---|---|---|---|
| 1 | Analog | sine → triangle → saw → square → pulse 10 % | rounder → brighter (one-pole tilt) |
| 2 | Harmonic | odd → all harmonics | spectral centre low → high |
| 3 | Vowel | a → e → i → o → u | small → large formant shift |
| 4 | Pulse | width 50 % → 3 % | single → double pulse |
| 5 | Sync | synced saw ratio 1 → 8 | saw → triangle carrier |
| 6 | FM | modulation index 0 → 6 | ratio 1, 2, 3 … 8 |
| 7 | Fold | fold amount | symmetry |
| 8 | Organ | drawbar mixes (8 registrations) | percussion harmonic added |
| 9 | Digital | bit depth 8 → 2 bits | sample-and-hold steps 64 → 4 per cycle |
| 10 | Spectra | seeded random spectra (fixed seed) | smoothing |

The generators live with the bank code; each frame is built from its
harmonic amplitudes and phases (FFT synthesis), so every factory frame is
band-limited by construction.

**User bank** (one per module): imported audio, see 4.8.

### 4.3 Position

With *Path* Off: `x = X × 7`, `y = Y × 7` (grid coordinates). With a path,
*Scan* moves along a fixed sequence of the 64 cells, interpolating between
consecutive cells: *Rows* (left to right, row by row), *Snake* (rows
alternating direction, so neighbours are always adjacent), *Columns*,
*Diagonal* (zig-zag across diagonals), *Spiral* (outside in). X and Y are
then ignored (dimmed). Position values are smoothed over 1 ms.

*Smooth* blend reads the four surrounding frames and blends bilinearly; *Step*
plays the nearest frame (a deliberate, stepped "digital" sound; the step
itself is crossfaded over 2 ms to avoid clicks). The *Pos X/Y* outputs
report `x/7`, `y/7`.

### 4.4 Warp

`w(φ)` with `a` = *Warp*:

- **Bend:** a two-segment phase curve with its knee at `(0.5 − 0.45a, 0.5)`:
  the first half of the waveform is squeezed, the second stretched. Brighter,
  "resonant" tones.
- **Sync:** `w = frac(φ × (1 + 7a))`, windowed at the cycle end: a hard-sync
  sweep inside the table; the reset is band-limited as in 4.5.
- **Mirror:** reads forward to `0.5 + 0.5a`, then backward: symmetric shapes,
  new even/odd balance.
- **Squash:** reads the whole table in the first `1 − 0.9a` of the cycle
  and holds the last value (0 for zero-ended tables) for the rest: a PWM for
  any wave.
- **Steps:** quantises φ to `64 × 2^(−5a)` steps (64 → 2): lo-fi stairs.

All warps are 0 at `a = 0` (identity).

### 4.5 Band-limiting

Each frame is stored as 11 mipmap levels: level `L` keeps harmonics up to
`1024 / 2^L` (level 0 full, level 10 the fundamental only), built by FFT
(zeroing bins) and inverse FFT. Per sample the oscillator picks the level
from the **effective** frequency `f_eff = |f| × s`, where `s` is the warp's
maximum phase slope (Bend `1 / (0.5 − 0.45a)`, Sync `1 + 7a`, Squash
`1 / (1 − 0.9a)`, Mirror 2, Steps 1): the level is the lowest one whose top
harmonic × `f_eff` stays below 0.45 × fs. The two adjacent levels are
crossfaded by the fractional octave, so a pitch sweep never steps in
brightness. The remaining discontinuities (Sync reset, Squash hold edge,
Steps, external *Sync*) get a polyBLEP correction scaled by the jump
size. *High* quality runs the whole read at 2× with a half-band decimator,
which also covers fast FM. *Read Raw* bypasses all of this on purpose: level
0, nearest sample, aliasing included.

### 4.6 Stereo and sub

The right channel reads at `x + Stereo × 7` (clamped to the grid; with a
path, `Scan + Stereo`, wrapping). Both channels share the phase, so the sum
is a blend of two timbres, never a phase cancellation of the fundamental.
*Sub* is a sine from `φ/2` (a second phase that halves the main one, reset
with it), so it stays in phase after sync.

### 4.7 Bank changes

Changing *Bank* (by hand or modulation) crossfades over 10 ms from the old
bank to the new one, read at the same position. A bank that is still being
built (import in progress) keeps the old one playing until it's ready.

### 4.8 Importing tables

Drop a WAV file on the view, or use *Import…*:

- Formats: PCM 16/24-bit and 32-bit float, any sample rate, first channel.
- **Slicing:** *Cycle length* (in the import popover, default *Auto*):
  256, 512, 1024, 2048, 4096 samples, or *Auto* (2048 if the length is a
  multiple of it, else the whole file is one cycle). Up to 64 cycles are
  taken; the rest is ignored with a notice.
- Each cycle is resampled to 2048 samples with FFT (band-limited), its DC
  removed, and normalised to peak 1.
- Fewer than 64 cycles fill the grid row by row and the grid shrinks to the
  rows used (`rows = ceil(n / 8)`; one cycle fills the whole grid). With a
  path, Scan covers exactly the imported cycles.
- **Single cells:** dropping a file on one cell of the grid view replaces only
  that cell (first cycle of the file).
- Parsing, resampling and mipmap building run on a background thread; the
  finished bank is swapped in through an atomic pointer and the old one is
  freed on the message thread. An import is one undo step.

### 4.9 Edge cases and transport

- Silent or invalid files: rejected with a message; the bank is unchanged.
- Empty user bank selected: plays a sine (the user bank starts as copy of
  *Analog* row 1 until something is imported).
- `f` is clamped to 0.45 × fs (× 2 at High).
- Free-running; the transport is ignored.

### 4.10 CPU and memory

Per sample: 4 frames (Smooth) × 2 mip levels × cubic (4 taps) = 32 table
reads at most; Step halves it, Linear halves it again. Target ≤ 0.8 % per
voice at 48 kHz (Normal, Smooth, Cubic), ≤ 1.5 % at High. A bank is about
1 MB (64 frames × 2048 × ~2 for mipmaps × 4 bytes); banks are shared by all
voices and all instances using them (factory banks are built once per
process, lazily, the first time they are selected).

## 5. Module view

```
 ┌───────────────────────────────────────────────────────────────┐
 │  Bank [ 3 Vowel ▾ ]  [Import…]       ┌ waveform ────────────┐ │
 │  ┌ grid 8×8 ──────────┐              │   ╱╲   ╱‾╲            │ │
 │  │ ∿ ∿ ∿ ∿ ∿ ∿ ∿ ∿    │              │  ╱  ╲_╱   ╲__  L  R   │ │
 │  │ ∿ ∿ ● ∿ ∿ ∿ ∿ ∿ ◌R │              └──────────────────────┘ │
 │  │ …   path drawn ↝   │   3D stack view of the current row ▸   │
 │  └────────────────────┘                                        │
 │  Oct Coarse Fine │ X  Y  Scan │ Warp [Bend▾]  FM Depth          │
 │  Stereo  Sub Level │ [Path▾] [Smooth▾] [Cubic▾] [Normal▾]       │
 └───────────────────────────────────────────────────────────────┘
```

- **Grid:** 64 thumbnails; a dot shows the played position (live values), a
  hollow dot the right channel; the path is drawn when one is chosen.
  Dragging on the grid sets X and Y together (one gesture). Dropping a file
  on a cell replaces it (4.8).
- **Waveform:** the current blended cycle after warp, L and R overlaid.
- **Stack view:** the 8 frames of the current row (or the path's
  neighbourhood) drawn in perspective, to see how the table evolves.
- Width 640 px.

## 6. Saved state

Knob and setting values, plus the user bank when one exists:

```json
{
  "type": "wavetable-osc",
  "params": { "bank": 0.2, "x": 0.0, "y": 0.0, "warp": 0.0, "path": 0.0, … },
  "data": {
    "user": { "name": "my-pad.wav", "frames": 24, "length": 2048,
              "pcm16": "<base64, frames × 2048 little-endian int16>" }
  }
}
```

Only the 2048-sample frames are stored (mipmaps are rebuilt on load). 64
frames are 256 KB of PCM, about 350 KB as base64. `sanitiseData` checks
that the decoded size matches `frames × length`, clamps `frames` to 1–64,
and drops a broken `user` entry (the bank then falls back to the sine of
4.9). *Bank* is saved normalised over a fixed range of 32 slots: slot 0 is
*User* (shown last in the menu), factory banks start at slot 1 and new ones
are appended, so adding factory banks never remaps a saved board.

## 7. Engine requirements

1. **`WavetableBank.h`** in `patch/common/dsp/`: frames, mipmap build (FFT —
   needs a small real FFT, e.g. a header-only radix-2 of our own), reader
   with bilinear frame blend and mip crossfade. Shared with the Macro Osc
   *Table* model.
2. **Background work for modules.** `ModuleSpec` hook to build heavy data
   (the mipmaps) off the audio and message threads, and a safe swap/free
   pattern (atomic pointer + deferred deletion on the message thread).
3. **File drop on module views** with the file passed to the module's view
   code (WAV parsing in `patch/common/`, no external dependency).
4. **Larger node data.** The board document must handle ~350 KB per node;
   undo stores it by reference (copy-on-write) rather than copying it for
   every unrelated edit. Later, a binary asset store in the board document
   (deduplicated by hash) replaces the base64 field.
5. **Stepped modulatable knob** for *Bank* (shared need with Macro Osc).
6. **Live values:** played X/Y for both channels.

## 8. Tests

- Pitch: 0 V = 261.63 Hz ±0.1 cent with *Analog* (0,0) = sine.
- Mipmaps: for every factory frame and each level L, no harmonic above `1024 / 2^L` (< −120 dB); a C1→C8 sweep at 48 kHz keeps aliasing below −80 dB (Normal, Warp 0) and −60 dB with Sync warp at 100 %.
- Mip crossfade: no step in RMS brightness larger than 0.5 dB between adjacent semitones.
- Position: X/Y at grid points play exactly that frame (bit-exact, Read Cubic at level 0 vs the stored frame); Smooth blend at (0.5, 0.5) of a cell equals the average of the four.
- Paths: Scan 0 and 1 reach the path's first and last cells; *Snake* never jumps between non-adjacent cells.
- Warps at 0 % equal no warp; Squash at 100 % holds over 90 % of the cycle.
- Stereo 0 → L = R; *Sub* is one octave below and keeps phase after a Sync.
- Import: 16/24/32f WAVs of 1, 8, 64, 100 cycles load as 1, 8, 64, 64 frames; DC is removed; an invalid file leaves the bank unchanged.
- Saved user bank round-trips bit-exact (int16); a truncated base64 field loads safely.
- Bank change and import swap are click-free (no sample jump > 0.1 at a static pitch); the audio thread never allocates or blocks (checked with the allocation guard in tests).
- Demo types file includes the module.

## 9. Later

- Spectral frame blend (magnitudes and phases interpolated) as a third *Frame Blend* mode.
- Drawing and editing frames in the view (pencil, harmonic sliders).
- Import of multi-frame wavetable files with embedded cycle-length markers, and image-to-table import.
- Several user banks per board, shared between modules through the asset store.
- A 3rd dimension (Z: a stack of grids).
