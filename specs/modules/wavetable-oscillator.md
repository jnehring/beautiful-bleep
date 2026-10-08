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
| Bank | stepped: *User*, then the 11 factory banks | 1 (Analog) | Which bank plays. Changes crossfade (4.7). |
| X | 0–100 % | 0 % | Column position on the grid (continuous). |
| Y | 0–100 % | 0 % | Row position. |
| Scan | 0–100 % | 0 % | Position along the chosen *Path* (used instead of X/Y when *Path* ≠ Off). |
| Warp | 0–100 % | 0 % | Amount of the phase warp chosen in *Warp Mode*. |
| FM Depth | 0–100 % | 0 % | ±4× frequency swing at 100 % (through zero). |
| Stereo | −50…+50 % | 0 % | X offset of the right channel (in grid widths; 50 % = half the grid). |
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
| 11 | Bell | church-bell partials compressed → stretched | bright → dark |

The generators live in `Wavetable.h` (`factoryBank()`); each frame is built
from its harmonic amplitudes and phases (FFT synthesis), so every factory
frame is band-limited by construction. All 11 take about 0.9 s to build
(FM and Fold most of it), once per process: `prepare()` builds Analog and the
selected bank, a module-local worker thread builds the rest (joined at
process exit). Until a bank is ready, selecting it keeps the current one
playing.

**User bank** (one per module): imported audio, see 4.8.

### 4.3 Position

With *Path* Off: `x = X × 7`, `y = Y × 7` (grid coordinates). With a path,
*Scan* moves along a fixed sequence of the 64 cells, interpolating between
consecutive cells: *Rows* (left to right, row by row), *Snake* (rows
alternating direction, so neighbours are always adjacent), *Columns*,
*Diagonal* (zig-zag across diagonals), *Spiral* (outside in). X and Y are
then ignored (hidden in the view). Position values are smoothed over 1 ms.
Paths work on the current bank's grid (a user bank may be smaller).

*Smooth* blend reads the four surrounding frames and blends bilinearly; *Step*
plays the nearest frame (a deliberate, stepped "digital" sound; the step
itself is crossfaded over 2 ms to avoid clicks). The *Pos X/Y* outputs
report `x/7`, `y/7`.

### 4.4 Warp

`w(φ)` with `a` = *Warp* (`wavetable::warpPhase`):

- **Bend:** a two-segment phase curve with its knee at `(0.5 − 0.45a, 0.5)`:
  the first half of the waveform is squeezed, the second stretched. Brighter,
  "resonant" tones.
- **Sync:** `w = frac(φ × (1 + 7a))`: a hard-sync sweep inside the table.
- **Mirror:** `(1 − a)·φ + a·(2φ for φ < ½, else 2 − 2φ)`: at 100 % the table
  is read forward in the first half of the cycle and backward in the second:
  symmetric shapes, a new even/odd balance.
- **Squash:** reads the whole table in the first `1 − 0.9a` of the cycle
  and holds the table's start value for the rest: a PWM for any wave.
- **Steps:** quantises φ to `2^(11 − 10a)` steps (2048 → 2): lo-fi stairs.

All warps are the identity at `a = 0`. The *Warp* knob takes the mode's name
in the view.

### 4.5 Band-limiting

Each frame is stored as 11 mipmap levels (`Wavetable.h`): level `L` keeps
harmonics up to `1024 / 2^L` in a table of 2048 (levels 0, 1) down to 64
samples. Per sample the oscillator picks the level from the **effective**
frequency `f_eff = |f| × s`, where `s` is the warp's maximum phase slope
(`warpSlope`: Bend `0.5 / min(k, 1 − k)`, Sync `1 + 7a`, Squash
`1 / (1 − 0.9a)`, Mirror `1 + a`, Steps 1): every harmonic read stays below
0.45 × fs, and the two adjacent levels are crossfaded by the fractional
octave, so a pitch sweep never steps in brightness.

The tables hold 4 samples per period of their top harmonic, so the cubic
read's interpolation images set the aliasing floor near the top of a level:
about −60 dB (−71 dB at C4). Twice as large tables in `Wavetable.h` would
lower it.

The remaining discontinuities get a polyBLEP correction scaled by the jump,
at their sub-sample time: the cycle reset with *Sync* and *Steps* warps (the
warped reading jumps from `w(1⁻)` to `w(0)`) and each step edge of *Steps*
(when at most one falls in a sample). *Squash*'s hold and the other warps
are continuous in value (the table is periodic). The external *Sync* input
restarts the cycle (and the sub) at its sample, which plays the midpoint of
the jump (the polyBLEP of a jump at the sample instant). *High* quality runs
the whole read at 2× with a half-band decimator, which also covers fast FM.
*Read Raw* bypasses all of this on purpose: level 0, nearest sample,
aliasing included.

### 4.6 Stereo and sub

The right channel reads at `x + Stereo × 7` (clamped to the grid; with a
path, `Scan + Stereo`, wrapping). Both channels share the phase, so the sum
is a blend of two timbres, never a phase cancellation of the fundamental.
*Sub* is a sine from `φ/2` (a second phase that halves the main one, reset
with it), so it stays in phase after sync.

### 4.7 Bank changes

Changing *Bank* (by hand or modulation, read once per chunk) crossfades over
10 ms from the old bank to the new one, read at the same position (clamped
to each bank's grid). A factory bank that is still being built keeps the old
one playing until it's ready; a new user bank (an import) swaps in with the
same crossfade.

### 4.8 Importing tables

Drop a WAV file on *Import…* in the view (or click it to choose one). The
view imports it into the media store (`api.importMedia`, `Media.h`: one
media folder, files referenced by a content-hash id) and sets the node data
to `{ "sample": id, "name": file name, "cycle": length }`:

- Formats: whatever `media::decodeWav` reads (PCM 8/16/24/32-bit, float
  32/64-bit, any sample rate); the first channel is used.
- **Slicing:** *Cycle* (a menu next to *Import…*, default *Auto*): 256, 512,
  1024, 2048, 4096 samples, or *Auto* (2048 if the length is a multiple of
  it, else the whole file is one cycle). Up to 64 cycles are taken; the view
  shows a notice when the file has more (live value `userCycles`).
- Each cycle is resampled to 2048 samples by its spectrum (band-limited), its
  DC removed, and normalised to peak 1 (`wavetable::bankFromCycles`).
- Fewer than 64 cycles fill the grid row by row (8 columns) and the grid
  shrinks to the rows used (`rows = ceil(n / 8)`; fewer than 8 cycles make a
  single row; one cycle fills the whole grid). With a path, Scan covers the
  grid of the imported cycles (the last row padded with the last cycle).
- **Single cells:** dropping a file on one cell of the grid view replaces only
  that cell with the file's first cycle: `"cells": { "<index>": id }` in the
  node data (index = column + 8 × row). Without an imported file the other
  cells start as sines.
- `setData` (message thread) loads the media with `media::load`, slices and
  builds the bank with its mipmaps (about 45 ms for 64 cycles) and hands it
  to the audio thread with `RtHandoff`; the module keeps the last three banks
  alive so the audio thread's crossfade never reads a freed bank. An import
  is one `setData`, so one undo step; the importing view also switches
  *Bank* to *User*.

### 4.9 Edge cases and transport

- Silent or unreadable files: rejected (live value `userError`, a message in
  the view); the bank is unchanged.
- Empty user bank selected: plays a sine.
- `f` is clamped to 0.45 × the (oversampled) rate.
- Free-running; the transport is ignored.

### 4.10 CPU and memory

Per sample: 4 frames (Smooth) × 2 mip levels × cubic (4 taps) = 32 table
reads at most per channel; Step halves it, Linear halves the taps. Measured
at 48 kHz (one core): 0.56 % Normal (target 0.8 %), 2.0 % High; the High
cost is mostly the `Oversampler.h` decimators. A factory bank is 1.6 MB
(64 frames × 6380 floats with mipmaps and guards), all 11 about 18 MB, built
once and shared by every instance and voice; a user bank is per instance.

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

- **Grid:** one 32-point thumbnail per frame (live array `thumbs`, sent
  after a bank change and about once a second); a dot shows the played
  position (live values `xL`, `yL`), a ring the right channel (`xR`, `yR`);
  the path is drawn when one is chosen. Dragging on the grid sets X and Y
  together (one gesture). Dropping a file on a cell replaces it (4.8).
- **Waveform:** the current blended cycle after warp, L and R overlaid (live
  arrays `waveL`, `waveR`, computed on the message thread from the bank).
- **Stack view:** the frames of the current row drawn in perspective, the
  played column highlighted.
- The bank name, *Import…*, the *Cycle* menu and import notices sit above
  the grid. Width 640 px (`ui/wavetable-osc.js`).

## 6. Saved state

Knob and setting values, plus the user bank's media when one exists:

```json
{
  "type": "wavetable-osc",
  "params": { "bank": 0.0, "x": 0.0, "y": 0.0, "warp": 0.0, "path": 0.0, … },
  "data": { "sample": "0123456789abcdef.wav", "name": "my-pad.wav", "cycle": 0,
            "cells": { "12": "fedcba9876543210.wav" } }
}
```

No samples are stored in the board: the WAV files live in the media folder,
referenced by id, and the mipmaps are rebuilt on load. `sanitiseData` keeps
only valid ids, a known cycle length and cell indices 0–63; a missing file
loads as the sine of 4.9. *Bank* is saved normalised over its choice list
(*User* first, then the factory banks): appending factory banks later
remaps saved values and needs a migration.

## 7. Engine requirements

1. **`Wavetable.h`** in `patch/common/dsp/` (exists): frames, mipmap build
   (own radix-2 FFT), reader with bilinear frame blend and mip crossfade,
   warps, factory banks, user banks from cycles.
2. **Background work for modules:** still missing as an engine hook. The
   module builds factory banks on its own worker thread (once per process)
   and user banks in `setData` on the message thread, handing them over with
   `RtHandoff`.
3. **File drop on module views:** `BleepView.mediaDrop` and `api.importMedia`
   with the media store (exists).
4. **Larger node data:** not needed; the data holds media ids only.
5. **Stepped modulatable knob** for *Bank* (exists).
6. **Live values / arrays:** played X/Y for both channels, the waveform and
   the thumbnails (exist).
7. `bleep_dump_types` links the modules without `engine/Media.cpp`; the
   module carries a weak stand-in for `media::load` (GCC/Clang) until the
   build adds it.

## 8. Tests

- Pitch: 0 V = 261.63 Hz ±0.1 cent with *Analog* (0,0) = sine; *Sub* one octave below.
- Aliasing: a saw frame at C1, C4, C6, C7 and just below C8 stays below −58 dB, and with Sync warp at 100 % (Normal and High) below −58 dB (the cubic read's floor, 4.5). The mipmaps themselves are tested in `common/dsp/tests/test_wavetable.cpp`.
- Mip crossfade: no step in high-frequency level larger than 0.5 dB between adjacent semitones (C5–C8).
- Position: X/Y at grid points play exactly that frame (Read Cubic, level 0, within 1e-5); Smooth blend at the centre of a cell equals the average of the four.
- Paths: every path visits each cell once on 8×8, 8×3, 5×1 and 1×1 grids; *Snake* and *Spiral* only step to neighbours; Scan 0 and 1 reach the path's first and last cells.
- Warps at 0 % equal no warp; Squash at 100 % holds over 90 % of the cycle.
- Stereo 0 → L = R; after a Sync the output and *Sub* equal a freshly started oscillator.
- User banks: 1, 8, 64, 100 cycles give 1, 8, 64, 64 frames; DC is removed.
- Bank changes and user-bank swaps are click-free (no sample step more than 0.1 above the static signal's).
- The module harness covers node data (sanitising, broken JSON) and the audio path with every input fed.
- Demo types file includes the module.

## 9. Later

- Spectral frame blend (magnitudes and phases interpolated) as a third *Frame Blend* mode.
- Drawing and editing frames in the view (pencil, harmonic sliders).
- Import of multi-frame wavetable files with embedded cycle-length markers, and image-to-table import.
- Several user banks per board, shared between modules through the asset store.
- A 3rd dimension (Z: a stack of grids).
