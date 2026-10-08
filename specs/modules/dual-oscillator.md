# Dual Osc

Type id `dual-osc` · category *Sources* · colour proposal `#2dd4bf`

## 1. Purpose

Two analog-style oscillator cores, *A* and *B*, wired together for the
sounds that need two oscillators talking to each other: B frequency-modulates
A (linear through-zero or exponential), A hard-syncs to B, and the pair runs
into a wavefolder that turns soft waves into bright, moving spectra. Every
stage has its own output, so the module is a complete complex-oscillator
voice and also two ordinary oscillators when you only need those.

The single Oscillator stays the simple, cheap source. The Dual Osc is for
cross-modulation without patching (and without the one-sub-block delay a
feedback cable would add, `specs.md` section 7.5).

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Pitch | `pitch` | 1 V/oct for both cores (0.0 = C4). |
| Pitch B | `pitch` | Added to B only. With *B Track* off, B follows only this input. |
| FM | `audio` | External FM into A, added to B's modulation before *FM Depth*. |
| Sync | `trigger` | An external rising edge resets **both** cores (a hard restart for the pair, e.g. one per note). |
| Fold CV | `audio` | Added to *Fold* at audio rate (amount 100 % = full knob range). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| A | `audio` | Core A with its modulation and sync, waveform per *Shape A*. |
| B | `audio` | Core B, waveform per *Shape B*. |
| Mix | `audio` | `(1 − Balance)·A + Balance·B`, before the folder. |
| Out L, Out R | `audio` | The folded mix. With *Width* 0 % both carry the same signal (4.5). |
| Ring | `audio` | `A × B` (sine cores), a clean ring modulation. |
| Sub | `audio` | Square one octave below A (flips each A cycle, also after sync resets). |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Octave A, Octave B | −4…+4 (stepped) | 0, −1 | Whole octaves per core. |
| Tune A, Tune B | −12…+12 st | 0 | Semitones per core. |
| Fine A, Fine B | −100…+100 ct | 0 | Cents per core. |
| Shape A, Shape B | 0–100 % | 67 %, 0 % | Waveform morph sine → triangle → saw → pulse (as the Oscillator's *Shape*). |
| Width A | 5–95 % | 50 % | Pulse width of A's pulse end. |
| FM Depth | 0–100 % | 0 % | How strongly B (and the *FM* input) modulates A. |
| Sync | 0–100 % | 0 % | Blend from free (0 %) through soft sync to hard sync (100 %) of A to B (4.3). |
| Balance | 0–100 % | 50 % | A ↔ B in the mix fed to the folder. |
| Fold | 0–100 % | 0 % | Folder drive: gain 1…12 before folding. 0 % passes the mix unchanged. |
| Symmetry | −1…+1 | 0 | DC bias before the folder: adds even harmonics, moves the folds. |
| Drift | 0–100 % | 10 % | Seeded slow pitch wander of each core, up to ±8 cents at 100 %. |
| Width | 0–100 % | 0 % | Stereo spread of *Out L/R* (4.5). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| FM Mode | Linear (through-zero), Exponential | Linear |
| B Track | On, Off | On |
| B Range | Audio, Low (B ÷ 100: 0.03–200 Hz for vibrato-like modulation) | Audio |
| Quality | Normal (2×), High (4×) | Normal |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Cores

Each core is a phase accumulator in double precision with the four waveforms
of the Oscillator (sine, triangle, saw, pulse), morphed by *Shape*:
crossfades between neighbours, as in `OscillatorDsp.h`.

- `fB = 261.63 Hz × 2^(OctB + TuneB/12 + FineB/1200 + PitchB + [B Track] · Pitch + driftB)`, ÷ 100 in *Low* range.
- `fA0 = 261.63 Hz × 2^(OctA + TuneA/12 + FineA/1200 + Pitch + driftA)`.
- Saw and pulse use polyBLEP; the triangle uses polyBLAMP at its corners, so
  hard-synced triangles stay clean.
- *Drift* is a 0.2 Hz smoothed random walk per core from `hash(Seed, core,
  voice index)` (`Random.h`), so two Voice Cell voices drift apart, and
  renders repeat.

### 4.2 B → A frequency modulation

The modulator `m = sineB + FM input` (B's **sine** regardless of *Shape B*,
so the FM spectrum is predictable; *Shape B* still shapes the *B* output).

- **Linear:** `fA = fA0 × (1 + 4 × FMDepth × m)`. Negative frequencies run A's
  phase backwards (through-zero), so FM at integer ratios stays in tune at any
  depth. The pitch you hear is `fA0` whatever the depth.
- **Exponential:** `fA = fA0 × 2^(4 × FMDepth × m)` (±4 octaves at 100 %).
  Pitch drifts upward with depth, as on analog exponential FM: the classic
  growl and siren sounds.

FM Depth is smoothed over 5 ms; the modulator itself is not smoothed.

### 4.3 Sync

On each B phase wrap (B completing a cycle) at sub-sample position `t`:

- **Hard part:** A's phase is pulled toward 0 by `Sync` (100 % = exact reset).
- **Soft part (0–50 %):** below 50 % the reset only happens when A is in the
  second half of its cycle, and A's direction reverses instead of resetting
  (a "reversing" soft sync), giving gentler, vocal timbres.
- The reset happens at the exact fractional position `t`; the discontinuity
  in each waveform is corrected with a BLEP (saw, pulse) or BLAMP (triangle)
  scaled by the jump size, so sync sweeps don't alias.

The external *Sync* input resets both phases at the trigger's sample offset.

### 4.4 Folder

`x = Mix × (1 + 11 × Fold) + Symmetry + FoldCV`, then a 4-stage folder:
`y = sin(π/2 · x)` blended with a triangle fold (reflection at ±1, repeated)
for the stages after the first, normalised to ±1. Folding is evaluated with
first-order antiderivative anti-aliasing (ADAA) and the whole cross-mod
section (both cores, FM, sync, folder) runs at the *Quality* oversampling
factor with a polyphase half-band decimator. *A*, *B*, *Mix*, *Ring* and
*Sub* are taken from the same oversampled stream after decimation, so all
outputs stay phase-aligned. A 5 Hz DC blocker follows the folder (Symmetry
adds DC).

### 4.5 Stereo

With *Width* > 0, *Out L* and *Out R* fold two slightly different mixes:
L uses `Balance − Width/4`, R `Balance + Width/4`, and R's symmetry is
mirrored (`−Symmetry`). The result is a wide image that collapses cleanly to
mono (the sum keeps the fundamental in phase).

### 4.6 Edge cases and transport

- Unpatched *Pitch*: both cores sit at their knob pitches (A on C4).
- `fA` and `fB` are clamped to ±0.45 × the oversampled rate.
- *Sync* 0 % costs nothing extra; FM Depth 0 % skips the modulator read.
- The transport is ignored (free-running oscillators), except that *Drift*
  is reseeded at transport start for repeatable renders.

### 4.7 CPU

Two cores + folder at 2× ≈ 4× the single Oscillator; at 4× ≈ 7×. Target per
voice at 48 kHz: ≤ 1.5 % (Normal), ≤ 3 % (High) of one core. Unpatched
outputs aren't decimated.

## 5. Module view

```
 ┌───────────────────────────────────────────────────────────────┐
 │  A  Oct ◯ Tune ◯ Fine ◯ Shape ◯ Width ◯        ┌── scope ──┐ │
 │  B  Oct ◯ Tune ◯ Fine ◯ Shape ◯  [B Track] [Audio▾]│ A B Out │ │
 │  FM Depth ◯ [Lin▾]   Sync ◯          Drift ◯    └──────────┘ │
 │  Balance ◯   Fold ◯   Symmetry ◯   Width ◯       fold curve ⌇ │
 └───────────────────────────────────────────────────────────────┘
```

- **Scope:** A, B and Out over two cycles of B (triggered on B's wrap), so
  sync and FM are visible.
- **Fold curve:** the transfer function at the current Fold and Symmetry,
  with a dot tracing the input level.
- Two rows, A above B, so the pair reads like two oscillators. Width 560 px.

## 6. Saved state

Only knob and setting values; no node data.

```json
{ "type": "dual-osc",
  "params": { "octaveA": 0.5, "octaveB": 0.375, "shapeA": 0.67, "fmDepth": 0.0,
              "fmMode": 0.0, "sync": 0.0, "fold": 0.0, "bTrack": 1.0, … } }
```

## 7. Engine requirements

1. **Shared DSP** in `patch/common/dsp/`: `OscCore.h` (phase, morph,
   polyBLEP/BLAMP, extracted from `OscillatorDsp.h` as proposed in
   chord-oscillator.md; the Dual Osc adds fractional-offset BLEP insertion for
   sync), `Oversampler.h` and `Folder.h` (ADAA fold, wavefolder.md). The Dual
   Osc's folder is a fixed 4-stage use of the Folder module's code; the Folder
   module itself has more stages, taps and its own oscillator.
2. **Sub-sample trigger offsets** for the external *Sync* input (already part
   of the `trigger` type, `specs.md` section 7.1).
3. **Inside Voice Cells:** runs per voice; *Drift* differs per voice through
   the voice index.

## 8. Tests

- Tuning: A at 0 V plays 261.63 Hz ±0.1 cent; B at *Octave B* −1 plays 130.81 Hz; *B Track* off ignores *Pitch* for B.
- Linear FM: with B at A's frequency and FM Depth 50 %, the spectrum's fundamental stays at fA0 (through-zero holds the pitch); exponential FM raises the mean pitch.
- Hard sync: A's period equals B's period at *Sync* 100 % for any A pitch; aliasing during a sync sweep (A C4→C7, B at C3) stays below −70 dB (Normal) / −85 dB (High).
- Folder: *Fold* 0 % and *Symmetry* 0 make *Out* equal *Mix* within 1e-5 (after the decimator's delay); output stays within ±1.05; DC after the blocker < 1e-3.
- Stereo: *Width* 0 % gives L = R exactly; L + R at 100 % keeps the fundamental within 3 dB of mono.
- Outputs are phase-aligned: a sync reset appears on A, Mix and Out at the same sample.
- Same Seed → identical renders including Drift; different voice indices drift differently.
- Saved params round-trip; demo types file includes the module.

## 9. Later

- A → B FM as well (bidirectional, with an implicit one-sample delay inside the module).
- A third core as a dedicated modulator, with its own envelope input for FM index.
- Shape outputs per core (separate sine/triangle/saw/pulse jacks).
- Per-core *Pitch* quantizing to a scale (shared `Scales.h`).
